import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { configFilePath, findTarget, findIncompleteTargets, getConfigWarnings } from '../core/config.js';
import { saveRun } from '../core/history.js';
import { readFileSync } from 'fs';
import { runEngine, runSweepEngine } from '../core/engine.js';
import type { ClickPhase, HardenPhase } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { buildSwarmConfig } from '../core/swarm.js';
import { isValidSpecialization } from '../core/agents/specialized.js';
import { RatchetLogger } from '../core/logger.js';
import { generateReport, writeReport } from '../core/report.js';
import { writePDF } from '../core/pdf-report.js';
import { runScan } from './scan.js';
import type { ScanResult } from './scan.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import type { Click, RatchetRun } from '../types.js';
import { formatDuration } from '../core/utils.js';
import { printHeader, exitWithError, validateInt, printFields, loadConfigOrExit, warnIfStaleBinary, warnIfDirtyWorktree, assertIsRepo, CLICK_PHASE_LABELS, formatScoreDelta, renderClickTable } from '../lib/cli.js';

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
    .option('--sweep', 'Sweep mode — fix one issue type across the entire codebase', false)
    .option('--max-lines <number>', 'Max lines changed per click before auto-rollback (default: 40)')
    .option('--max-files <number>', 'Max files changed per click before auto-rollback (default: 3)')
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
        sweep: boolean;
        maxLines?: string;
        maxFiles?: string;
      }) => {
        const cwd = process.cwd();

        printHeader('⚙  Ratchet Torque');

        warnIfStaleBinary();

        // Check git repo
        await assertIsRepo(cwd);

        // Warn about dirty worktree — each click stashes before applying changes,
        // so existing uncommitted work won't be lost, but the user should know.
        await warnIfDirtyWorktree(cwd);

        // Load config
        const config = loadConfigOrExit(cwd);

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
          const agentCount = options.agents ? validateInt(options.agents, 'agents', 1, 5) : 3;

          let focusSpecs: string[] | undefined;
          if (options.focus) {
            focusSpecs = options.focus.split(',').map((s) => s.trim());
            const invalid = focusSpecs.filter((s) => !isValidSpecialization(s));
            if (invalid.length > 0) {
              exitWithError(`  Invalid --focus specialization(s): ${invalid.join(', ')}\n  Valid: security, performance, quality, errors, types`);
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

        // Resolve target (skip for sweep mode)
        let target;
        if (options.sweep) {
          // Sweep mode: use a synthetic target representing the whole codebase
          target = { name: 'sweep', path: '.', description: 'Sweep mode — fix one issue type across the entire codebase' };
        } else if (options.target) {
          target = findTarget(config, options.target);
          if (!target) {
            if (config.targets.length === 0) {
              exitWithError(
                `  Target "${options.target}" not found — .ratchet.yml has no targets defined.\n\n  Add a target to .ratchet.yml:\n` +
                chalk.dim('    targets:\n      - name: my-target\n        path: src/\n        description: "Improve code quality in src/"'),
              );
            }
            const available = config.targets.map((t) => chalk.cyan(t.name)).join(', ');
            exitWithError(`  Target "${options.target}" not found in .ratchet.yml.\n  Available: ${available}`);
          }
        } else {
          // No --target flag: use first auto-detected target
          target = config.targets[0];
          if (!target) {
            exitWithError(
              `  No target specified and none could be auto-detected.\n  Use ${chalk.cyan('--target <name>')} or run ${chalk.cyan('ratchet init')} to create a .ratchet.yml.`,
            );
          }
        }

        // Resolve click count (sweep mode defaults to 5)
        const clickCount = options.clicks
          ? parseInt(options.clicks, 10)
          : options.sweep ? 5 : config.defaults.clicks;

        if (isNaN(clickCount) || clickCount < 1) {
          exitWithError(`  Invalid --clicks value: ${chalk.bold(String(options.clicks ?? ''))}\n  Must be a positive integer (e.g. ${chalk.cyan('--clicks 5')}).`);
        }

        if (options.clicks && options.clicks.includes('.')) {
          exitWithError(`  Invalid --clicks value: ${chalk.bold(options.clicks)}\n  Fractional clicks are not allowed — must be a whole number (e.g. ${chalk.cyan('--clicks 5')}).`);
        }

        // Set up click guards
        const maxLines = options.maxLines ? parseInt(options.maxLines, 10) : 40;
        const maxFiles = options.maxFiles ? parseInt(options.maxFiles, 10) : 3;
        config.guards = { maxLinesChanged: maxLines, maxFilesChanged: maxFiles };

        // Print run summary
        const fields: Array<[string, string]> = options.sweep
          ? [['Mode', chalk.yellow('sweep')]]
          : [['Target', chalk.cyan(target.name)], ['Path', chalk.dim(target.path)]];
        fields.push(
          ['Agent',  chalk.dim(config.agent)],
          ['Clicks', chalk.yellow(String(clickCount))],
          ['Tests',  chalk.dim(config.defaults.testCommand)],
          ['Guards', chalk.dim(`≤${maxLines} lines, ≤${maxFiles} files per click`)],
          ['Mode',   hardenMode ? chalk.yellow('harden') : chalk.dim('normal')],
        );
        if (options.adversarial) fields.push(['QA', chalk.yellow('adversarial')]);
        if (config.swarm?.enabled) {
          const specs = config.swarm.specializations.join(', ');
          fields.push(['Swarm', `${chalk.yellow(`${config.swarm.agentCount} agents`)} ${chalk.dim(`(${specs})`)}`]);
        }
        printFields(fields, !options.dryRun);
        if (options.dryRun) {
          process.stdout.write(chalk.yellow('  [DRY RUN] No changes will be committed.\n') + '\n');
        }

        // Set up logger
        const logger = new RatchetLogger(target.name, cwd);

        // Create agent
        const agent = new ShellAgent({
          model: config.model,
          cwd,
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
          exitWithError('\n  ' + String(err));
        }

        // Capture score before the run (non-fatal)
        // This also serves as the initial scan for the engine's scan-driven mode
        let scoreBefore: ScanResult | undefined;
        try {
          scoreBefore = await runScan(cwd);
        } catch {
          // Non-fatal — report will omit Before/After
        }

        const engineFn = options.sweep ? runSweepEngine : runEngine;

        let run: RatchetRun;
        try {
          run = await engineFn({
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
                const phaseTag = currentHardenPhase ? chalk.dim(` [${currentHardenPhase}]`) : '';
                spinner.text = `  Click ${chalk.bold(String(clickNumber))}/${clickCount}${phaseTag} — ${CLICK_PHASE_LABELS[phase]}`;
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
                      scoreSuffix = ` — Score: ${before} → ${after} (${formatScoreDelta(before, after)})`;
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
        renderClickTable(run.clicks);

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
