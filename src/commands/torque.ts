import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { loadConfig, configFilePath, findTarget, findIncompleteTargets, getConfigWarnings } from '../core/config.js';
import { saveRun } from '../core/history.js';
import { readFileSync } from 'fs';
import { checkStaleBinary } from '../core/stale-check.js';
import { runEngine } from '../core/engine.js';
import type { ClickPhase, HardenPhase } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { buildSwarmConfig } from '../core/swarm.js';
import { isValidSpecialization } from '../core/agents/specialized.js';
import { RatchetLogger } from '../core/logger.js';
import { generateReport, writeReport } from '../core/report.js';
import { writePDF } from '../core/pdf-report.js';
import { runScan } from './scan.js';
import type { ScanResult } from './scan.js';
import { isRepo, status as gitStatus } from '../core/git.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import type { Click, RatchetRun } from '../types.js';
import { formatDuration } from '../core/utils.js';

const STATE_FILE = '.ratchet-state.json';

export function torqueCommand(): Command {
  const cmd = new Command('torque');

  cmd
    .description(
      'Run the Ratchet click loop — autonomous iterative code improvement.\n\n' +
        'Creates a branch (ratchet/<target>-<timestamp>), runs N clicks,\n' +
        'and writes a live log to docs/<target>-ratchet.md.\n\n' +
        'Each click: analyze → propose → build → test → commit (or revert).',
    )
    .option('-t, --target <name>', 'Target name defined in .ratchet.yml (omit to use auto-detection)')
    .option('-n, --clicks <number>', 'Number of clicks to run (overrides defaults.clicks in config)')
    .option('--dry-run', 'Preview mode — analyze and propose without committing any changes', false)
    .option('--verbose', 'Show per-click timing, proposal preview, and modified files', false)
    .option('--no-branch', 'Run on the current branch instead of creating a ratchet branch', false)
    .option('--mode <mode>', 'Run mode: "normal" (default) or "harden" (write tests first, then improve)')
    .option('--swarm', 'Enable swarm mode — N agents compete per click, best change wins', false)
    .option('--agents <number>', 'Number of competing agents in swarm mode (default: 3)')
    .option('--focus <specs>', 'Comma-separated specializations: security,performance,quality,errors,types')
    .option('--adversarial', 'Enable adversarial QA — red team tests each landed change for regressions', false)
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ ratchet torque\n' +
        '  $ ratchet torque --target src\n' +
        '  $ ratchet torque --target api --clicks 3\n' +
        '  $ ratchet torque --target src --dry-run\n' +
        '  $ ratchet torque --target src --verbose --no-branch\n',
    )
    .action(
      async (options: {
        target?: string;
        clicks?: string;
        dryRun: boolean;
        verbose: boolean;
        branch: boolean;
        mode?: string;
        swarm: boolean;
        agents?: string;
        focus?: string;
        adversarial: boolean;
      }) => {
        const cwd = process.cwd();

        console.log(chalk.bold('\n⚙  Ratchet Torque\n'));

        // Warn if the compiled binary is stale
        const staleWarning = checkStaleBinary();
        if (staleWarning) {
          console.warn(chalk.yellow(`  ${staleWarning}\n`));
        }

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
        const allDirty = [...ws.staged, ...ws.unstaged, ...ws.untracked];
        const dirtyFiles = allDirty.length;
        if (dirtyFiles > 0) {
          const fileWord = dirtyFiles === 1 ? 'file' : 'files';
          const shown = allDirty.slice(0, 3).join(', ');
          const extra = dirtyFiles > 3 ? ` +${dirtyFiles - 3} more` : '';
          console.warn(
            chalk.yellow(`  ⚠  Dirty worktree: ${dirtyFiles} uncommitted ${fileWord}`) +
              chalk.dim(` (${shown}${extra}).`) +
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

        // If config was auto-detected, show a banner so the user knows
        if (config._source === 'auto-detected') {
          console.log(
            chalk.dim('  ✦ No .ratchet.yml found — running in zero-config mode.') +
              chalk.dim(' Run ' + chalk.cyan('ratchet init') + ' to create a config.\n'),
          );
          if (config._noTestCommand) {
            console.warn(
              chalk.yellow('  ⚠  No test command detected — harden mode auto-enabled.') +
                chalk.dim(' Changes will be validated more conservatively.\n'),
            );
          }
        }

        // Resolve harden mode: explicit --mode flag takes precedence, then config default
        const hardenMode = options.mode === 'harden' || config.defaults.hardenMode === true;

        // Resolve swarm mode
        if (options.swarm) {
          const agentCount = options.agents ? parseInt(options.agents, 10) : 3;
          if (isNaN(agentCount) || agentCount < 1 || agentCount > 5) {
            console.error(
              chalk.red(`  Invalid --agents value: ${chalk.bold(String(options.agents))}`) +
                '\n  Must be 1-5.\n',
            );
            process.exit(1);
          }

          let focusSpecs: string[] | undefined;
          if (options.focus) {
            focusSpecs = options.focus.split(',').map((s) => s.trim());
            const invalid = focusSpecs.filter((s) => !isValidSpecialization(s));
            if (invalid.length > 0) {
              console.error(
                chalk.red(`  Invalid --focus specialization(s): ${invalid.join(', ')}`) +
                  '\n  Valid: security, performance, quality, errors, types\n',
              );
              process.exit(1);
            }
          }

          config.swarm = buildSwarmConfig({
            swarm: true,
            agents: agentCount,
            focus: focusSpecs,
          });
        }

        // Warn about incomplete targets and invalid field values silently dropped by the parser
        if (config._source === 'file') {
          try {
            const rawYml = readFileSync(configFilePath(cwd), 'utf-8');
            const warnings = [
              ...getConfigWarnings(rawYml),
              ...findIncompleteTargets(rawYml),
            ];
            for (const w of warnings) {
              console.warn(chalk.yellow(`  ⚠  ${w}`));
            }
            if (warnings.length > 0) console.log('');
          } catch {
            // Non-fatal
          }
        }

        // Resolve target
        let target;
        if (options.target) {
          target = findTarget(config, options.target);
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
        } else {
          // No --target flag: use first auto-detected target
          target = config.targets[0];
          if (!target) {
            console.error(
              chalk.red('  No target specified and none could be auto-detected.') +
                '\n  Use ' + chalk.cyan('--target <name>') + ' or run ' +
                chalk.cyan('ratchet init') + ' to create a .ratchet.yml.\n',
            );
            process.exit(1);
          }
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
        console.log(`  Mode   : ${hardenMode ? chalk.yellow('harden') : chalk.dim('normal')}`);
        if (options.adversarial) {
          console.log(`  QA     : ${chalk.yellow('adversarial')}`);
        }
        if (config.swarm?.enabled) {
          const specs = config.swarm.specializations.join(', ');
          console.log(`  Swarm  : ${chalk.yellow(`${config.swarm.agentCount} agents`)} ${chalk.dim(`(${specs})`)}`);
        }
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
        let currentHardenPhase: HardenPhase | undefined;
        // Live score tracking
        let lastKnownScore: number | undefined;
        let lastKnownDelta: number | undefined;

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

        // Capture score before the run (non-fatal)
        // This also serves as the initial scan for the engine's scan-driven mode
        let scoreBefore: ScanResult | undefined;
        try {
          scoreBefore = await runScan(cwd);
        } catch {
          // Non-fatal — report will omit Before/After
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
            hardenMode,
            adversarial: options.adversarial,
            // Pass the pre-run scan to avoid a redundant re-scan
            scanResult: scoreBefore,
            callbacks: {
              onScanComplete: (scan: ScanResult) => {
                const topIssues = scan.issuesByType.slice(0, 3);
                const targetStr = topIssues
                  .map((t) => `${t.subcategory} (${t.count}/${t.count + 1})`)
                  .join(', ');
                console.log(
                  `  📊 Initial scan: ${chalk.bold(`${scan.total}/${scan.maxTotal}`)} (${scan.totalIssuesFound} issues found)`,
                );
                if (targetStr) {
                  console.log(`     Targeting: ${chalk.dim(targetStr)}`);
                }
                console.log('');
                lastKnownScore = scan.total;
              },

              onClickStart: async (clickNumber, total, hardenPhase?: HardenPhase) => {
                clickStartTime = Date.now();
                currentHardenPhase = hardenPhase;
                const phaseTag = hardenPhase ? chalk.dim(` [${hardenPhase}]`) : '';
                spinner = ora(
                  `  Click ${chalk.bold(String(clickNumber))}/${total}${phaseTag} — analyzing…`,
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

              onClickPhase: (phase: ClickPhase, clickNumber: number) => {
                if (!spinner) return;
                const total = clickCount;
                const phaseLabel: Record<ClickPhase, string> = {
                  analyzing: 'analyzing…',
                  proposing: 'proposing…',
                  building: 'building…',
                  testing: 'testing…',
                  committing: 'committing…',
                };
                const phaseTag = currentHardenPhase ? chalk.dim(` [${currentHardenPhase}]`) : '';
                spinner.text = `  Click ${chalk.bold(String(clickNumber))}/${total}${phaseTag} — ${phaseLabel[phase]}`;
              },

              onClickScoreUpdate: (_clickNumber: number, scoreBefore: number, scoreAfter: number, delta: number) => {
                lastKnownScore = scoreAfter;
                lastKnownDelta = delta;
                // Store for use in onClickComplete
                void scoreBefore; // used via lastKnownScore tracking
              },

              onClickComplete: async (click: Click, rolledBack: boolean) => {
                if (spinner) {
                  if (click.testsPassed) {
                    // Build score suffix if we have data
                    let scoreSuffix = '';
                    if (click.scoreAfterClick !== undefined && lastKnownScore !== undefined) {
                      const before = lastKnownScore - (lastKnownDelta ?? 0);
                      const after = click.scoreAfterClick;
                      const delta = after - before;
                      const deltaStr = delta > 0 ? chalk.green(`+${delta}`) : delta < 0 ? chalk.red(String(delta)) : chalk.dim('±0');
                      scoreSuffix = ` — Score: ${before} → ${after} (${deltaStr})`;
                      if (click.issuesFixedCount && click.issuesFixedCount > 0) {
                        scoreSuffix += chalk.dim(` — ${click.issuesFixedCount} issues fixed`);
                      }
                    }
                    spinner.succeed(
                      `  Click ${chalk.bold(String(click.number))} — ${chalk.green('✓ passed')}` +
                        (click.commitHash
                          ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`)
                          : '') +
                        scoreSuffix,
                    );
                  } else {
                    spinner.warn(
                      `  Click ${chalk.bold(String(click.number))} — ${chalk.yellow('✗ rolled back')}`,
                    );
                  }
                  spinner = null;
                }
                // Reset per-click tracking
                lastKnownDelta = undefined;

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
          if (spinner) (spinner as ReturnType<typeof ora>).fail();
          console.error(chalk.red('\nFatal error: ') + String(err));
          process.exit(1);
        } finally {
          process.removeListener('SIGINT', sigintHandler);
          process.removeListener('SIGTERM', sigtermHandler);
          releaseLock(cwd);
        }

        // Finalize log
        await logger.finalizeLog(run).catch(() => {});

        // Capture score after the run and generate report
        let scoreAfter;
        try {
          scoreAfter = await runScan(cwd);
        } catch {
          // Non-fatal
        }

        const reportPath = await writeReport({ run, cwd, scoreBefore, scoreAfter }).catch(() => null);
        await writePDF({ run, cwd, scoreBefore, scoreAfter }).catch(() => null);

        // Persist run state for `ratchet status` / `ratchet tighten`
        try {
          await writeFile(join(cwd, STATE_FILE), JSON.stringify(run, null, 2), 'utf-8');
        } catch {
          // Non-fatal
        }

        // Persist to run history
        await saveRun(cwd, run, scoreBefore, scoreAfter).catch(() => {
          // Non-fatal
        });

        // Final summary
        const passedClicks = run.clicks.filter((c) => c.testsPassed).length;
        const rolledBack = run.clicks.length - passedClicks;
        const duration = formatDuration(Date.now() - runStart);

        const landedPart = `${chalk.green(String(passedClicks))} landed`;
        const rolledPart = rolledBack > 0
          ? ` · ${chalk.yellow(String(rolledBack))} rolled back`
          : '';

        // Per-click result table
        if (run.clicks.length > 0) {
          console.log('');
          for (const click of run.clicks) {
            const icon = click.testsPassed ? chalk.green('✓') : chalk.yellow('✗');
            const label = click.testsPassed ? chalk.green('passed') : chalk.yellow('rolled back');
            const hash = click.commitHash
              ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`)
              : '';
            const files = click.filesModified.length > 0
              ? chalk.dim(` — ${click.filesModified.slice(0, 2).join(', ')}${click.filesModified.length > 2 ? ` +${click.filesModified.length - 2}` : ''}`)
              : '';
            console.log(`  ${icon} Click ${chalk.bold(String(click.number))}  ${label}${hash}${files}`);
          }
        }

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
          if (reportPath) {
            console.log(
              `  Report: ${chalk.dim(`docs/${target.name}-ratchet-report.md`)}`,
            );
          }
          console.log(
            `  Run ${chalk.green('ratchet tighten --pr')} to open a pull request.\n`,
          );
        } else {
          console.log(chalk.dim('\n  No clicks landed. Try adjusting your target description.\n'));
        }

        // Print report summary
        const report = generateReport({ run, cwd, scoreBefore, scoreAfter });
        console.log('\n' + report);

        // Exit codes: 0 = all passed, 1 = partial, 2 = all failed
        if (run.clicks.length > 0 && passedClicks === 0) {
          process.exit(2);
        } else if (run.clicks.length > 0 && rolledBack > 0) {
          process.exit(1);
        }
      },
    );

  return cmd;
}
