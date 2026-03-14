import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { loadConfig, configFilePath, findTarget, findIncompleteTargets } from '../core/config.js';
import { readFileSync } from 'fs';
import { runEngine } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { RatchetLogger } from '../core/logger.js';
import { isRepo, status as gitStatus } from '../core/git.js';
import { acquireLock, releaseLock } from '../core/lock.js';
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

        // Warn about dirty worktree — each click stashes before applying changes,
        // so existing uncommitted work won't be lost, but the user should know.
        const ws = await gitStatus(cwd);
        const dirtyFiles = ws.staged.length + ws.unstaged.length + ws.untracked.length;
        if (dirtyFiles > 0) {
          const fileWord = dirtyFiles === 1 ? 'file' : 'files';
          console.warn(
            chalk.yellow(`  ⚠  Dirty worktree: ${dirtyFiles} uncommitted ${fileWord}.`) +
              chalk.dim(' Ratchet will stash these before each click and restore them on rollback.\n'),
          );
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

        // Warn about incomplete targets silently dropped by the parser
        try {
          const rawYml = readFileSync(configFilePath(cwd), 'utf-8');
          const warnings = findIncompleteTargets(rawYml);
          for (const w of warnings) {
            console.warn(chalk.yellow(`  ⚠  ${w}`));
          }
          if (warnings.length > 0) console.log('');
        } catch {
          // Non-fatal — config file may not exist (already handled above)
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
          const provided = options.clicks ?? '';
          console.error(
            chalk.red(`  Invalid --clicks value: ${chalk.bold(String(provided))}`) +
              '\n  Must be a positive integer (e.g. ' +
              chalk.cyan('--clicks 5') + ').\n',
          );
          process.exit(1);
        }

        if (options.clicks && options.clicks.includes('.')) {
          console.error(
            chalk.red(`  Invalid --clicks value: ${chalk.bold(options.clicks)}`) +
              '\n  Fractional clicks are not allowed — must be a whole number (e.g. ' +
              chalk.cyan('--clicks 5') + ').\n',
          );
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
        let clickStartTime = 0;

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

        // Graceful SIGTERM handler (kill, CI timeout, Docker stop, systemd)
        const sigtermHandler = () => {
          if (spinner) {
            spinner.fail(chalk.yellow('  Terminated (SIGTERM)'));
            spinner = null;
          } else {
            process.stdout.write('\n');
          }
          console.log(chalk.dim('\n  Process terminated. Partial progress may be saved in .ratchet-state.json\n'));
          process.exit(143); // 128 + 15 (SIGTERM)
        };

        process.once('SIGINT', sigintHandler);
        process.once('SIGTERM', sigtermHandler);

        // Acquire lock — prevent concurrent ratchet runs on the same repo
        try {
          acquireLock(cwd);
        } catch (err) {
          console.error(chalk.red('\n  ' + String(err)) + '\n');
          process.exit(1);
        }

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
                clickStartTime = Date.now();
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
                  const elapsed = formatDuration(Date.now() - clickStartTime);
                  console.log(chalk.dim(`     time: ${elapsed}`));
                  if (click.proposal) {
                    const preview = click.proposal.length > 120
                      ? click.proposal.slice(0, 120) + '…'
                      : click.proposal;
                    console.log(chalk.dim(`     proposal: ${preview}`));
                  }
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
          process.removeListener('SIGTERM', sigtermHandler);
          releaseLock(cwd);
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
        const rolledBack = run.clicks.length - passedClicks;
        const duration = formatDuration(Date.now() - runStart);

        const landedPart = `${chalk.green(String(passedClicks))} landed`;
        const rolledPart = rolledBack > 0
          ? ` · ${chalk.yellow(String(rolledBack))} rolled back`
          : '';

        console.log('\n' + chalk.bold('  ' + '─'.repeat(46)));
        console.log(
          `\n  ${chalk.bold('Done.')} ` +
            `${landedPart}${rolledPart} · ` +
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
