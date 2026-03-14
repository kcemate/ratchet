import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { loadConfig, configFilePath, findTarget } from '../core/config.js';
import { runEngine } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { RatchetLogger } from '../core/logger.js';
import { isRepo } from '../core/git.js';
import type { Click, RatchetRun } from '../types.js';

const STATE_FILE = '.ratchet-state.json';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function torqueCommand(): Command {
  const cmd = new Command('torque');

  cmd
    .description(
      'Run the Ratchet click loop — autonomous iterative improvement.\n' +
        'Creates a branch, runs N analyze→build→test→commit cycles, logs progress.',
    )
    .requiredOption('-t, --target <name>', 'Target name from .ratchet.yml')
    .option('-n, --clicks <number>', 'Number of clicks to run (overrides config default)')
    .option('--dry-run', 'Preview without making any changes', false)
    .option('--verbose', 'Show detailed per-click output', false)
    .option('--no-branch', 'Skip creating a ratchet branch', false)
    .action(
      async (options: {
        target: string;
        clicks?: string;
        dryRun: boolean;
        verbose: boolean;
        branch: boolean;
      }) => {
        const cwd = process.cwd();

        console.log(chalk.bold('\n⚙  Ratchet Torque\n'));

        // Check git repo
        if (!(await isRepo(cwd))) {
          console.error(
            chalk.red('  Not a git repository.') +
              '\n  Ratchet requires git to track changes and roll back on failure.' +
              '\n\n  ' + chalk.dim('To initialize a git repo:') +
              '\n    ' + chalk.cyan('git init && git add -A && git commit -m "init"') + '\n',
          );
          process.exit(1);
        }

        // Load config
        let config;
        try {
          config = loadConfig(cwd);
        } catch (err) {
          console.error(
            chalk.red('Error loading .ratchet.yml: ') +
              String(err) +
              '\n' +
              chalk.dim(`  Run ${chalk.cyan('ratchet init')} to create one.`),
          );
          process.exit(1);
        }

        // Resolve target
        const target = findTarget(config, options.target);
        if (!target) {
          if (config.targets.length === 0) {
            console.error(
              chalk.red(`  Target "${options.target}" not found — .ratchet.yml has no targets defined.`) +
                '\n\n  Add a target to .ratchet.yml:\n' +
                chalk.dim(
                  '    targets:\n' +
                  '      - name: my-target\n' +
                  '        path: src/\n' +
                  '        description: "Improve code quality in src/"',
                ) + '\n',
            );
          } else {
            const available = config.targets.map((t) => chalk.cyan(t.name)).join(', ');
            console.error(
              chalk.red(`  Target "${options.target}" not found in .ratchet.yml.`) +
                `\n  Available: ${available}\n`,
            );
          }
          process.exit(1);
        }

        // Resolve click count
        const clickCount = options.clicks
          ? parseInt(options.clicks, 10)
          : config.defaults.clicks;

        if (isNaN(clickCount) || clickCount < 1) {
          console.error(chalk.red('--clicks must be a positive integer'));
          process.exit(1);
        }

        // Print run summary
        console.log(`  Target : ${chalk.cyan(target.name)}`);
        console.log(`  Path   : ${chalk.dim(target.path)}`);
        console.log(`  Agent  : ${chalk.dim(config.agent)}`);
        console.log(`  Clicks : ${chalk.yellow(String(clickCount))}`);
        console.log(`  Tests  : ${chalk.dim(config.defaults.testCommand)}`);
        if (options.dryRun) {
          console.log('\n' + chalk.yellow('  [DRY RUN] No changes will be committed.'));
        }
        console.log('');

        // Set up logger
        const logger = new RatchetLogger(target.name, cwd);

        // Create agent
        const agent = new ShellAgent({
          model: config.model,
        });

        // Spinner state
        let spinner: ReturnType<typeof ora> | null = null;
        const runStart = Date.now();

        // Graceful Ctrl+C handler
        const sigintHandler = () => {
          if (spinner) {
            spinner.fail(chalk.yellow('  Interrupted by user (Ctrl+C)'));
            spinner = null;
          } else {
            process.stdout.write('\n');
          }
          console.log(chalk.dim('\n  Run interrupted. Partial progress may be saved in .ratchet-state.json\n'));
          process.exit(130);
        };
        process.once('SIGINT', sigintHandler);

        let run: RatchetRun;
        try {
          run = await runEngine({
            target,
            clicks: clickCount,
            config,
            cwd,
            agent,
            createBranch: options.branch && !options.dryRun,
            callbacks: {
              onClickStart: async (clickNumber, total) => {
                spinner = ora(
                  `  Click ${chalk.bold(String(clickNumber))}/${total} — analyzing…`,
                ).start();

                // Init log on first click
                if (clickNumber === 1) {
                  const partialRun: RatchetRun = {
                    id: 'pending',
                    target,
                    clicks: [],
                    startedAt: new Date(),
                    status: 'running',
                  };
                  await logger.initLog(partialRun).catch(() => {});
                }
              },

              onClickComplete: async (click: Click, rolledBack: boolean) => {
                if (spinner) {
                  if (click.testsPassed) {
                    spinner.succeed(
                      `  Click ${chalk.bold(String(click.number))} — ${chalk.green('✓ passed')}` +
                        (click.commitHash
                          ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`)
                          : ''),
                    );
                  } else {
                    spinner.warn(
                      `  Click ${chalk.bold(String(click.number))} — ${chalk.yellow('✗ rolled back')}`,
                    );
                  }
                  spinner = null;
                }

                if (options.verbose) {
                  if (click.filesModified.length > 0) {
                    console.log(
                      chalk.dim(
                        `     files: ${click.filesModified.join(', ')}`,
                      ),
                    );
                  }
                }
              },

              onError: (err: Error, clickNumber: number) => {
                if (spinner) {
                  spinner.fail(
                    `  Click ${chalk.bold(String(clickNumber))} — ${chalk.red('error')}: ${err.message}`,
                  );
                  spinner = null;
                }
              },
            },
          });
        } catch (err) {
          if (spinner) spinner.fail();
          console.error(chalk.red('\nFatal error: ') + String(err));
          process.exit(1);
        } finally {
          process.removeListener('SIGINT', sigintHandler);
        }

        // Finalize log
        await logger.finalizeLog(run).catch(() => {});

        // Persist run state for `ratchet status` / `ratchet tighten`
        try {
          await writeFile(join(cwd, STATE_FILE), JSON.stringify(run, null, 2), 'utf-8');
        } catch {
          // Non-fatal
        }

        // Final summary
        const passedClicks = run.clicks.filter((c) => c.testsPassed).length;
        const duration = formatDuration(Date.now() - runStart);

        console.log('\n' + chalk.bold('  ' + '─'.repeat(46)));
        console.log(
          `\n  ${chalk.bold('Done.')} ` +
            `${chalk.green(String(passedClicks))}/${run.clicks.length} clicks landed · ` +
            `${chalk.dim(duration)}`,
        );

        if (passedClicks > 0) {
          console.log(
            `\n  Log: ${chalk.dim(`docs/${target.name}-ratchet.md`)}`,
          );
          console.log(
            `  Run ${chalk.green('ratchet tighten --pr')} to open a pull request.\n`,
          );
        } else {
          console.log(chalk.dim('\n  No clicks landed. Try adjusting your target description.\n'));
        }
      },
    );

  return cmd;
}
