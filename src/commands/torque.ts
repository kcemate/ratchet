import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { configFilePath, findTarget, findIncompleteTargets, getConfigWarnings } from '../core/config.js';
import { saveRun } from '../core/history.js';
import { readFileSync } from 'fs';
import { runEngine, runSweepEngine, runArchitectEngine } from '../core/engine.js';
import type { ClickPhase, HardenPhase } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { buildSwarmConfig } from '../core/swarm.js';
import { isValidSpecialization } from '../core/agents/specialized.js';
import { RatchetLogger } from '../core/logger.js';
import { generateReport, writeReport } from '../core/report.js';
import { writePDF } from '../core/pdf-report.js';
import { generateScoreCard, generatePRDescription } from '../core/pr-comment.js';
import { runScan } from './scan.js';
import type { ScanResult } from './scan.js';
import { analyzeScoreGaps } from '../core/score-optimizer.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import type { Click, RatchetRun } from '../types.js';
import { GUARD_PROFILES } from '../types.js';
import type { GuardProfileName } from '../types.js';
import { formatDuration } from '../core/utils.js';
import { printHeader, exitWithError, validateInt, printFields, validateProjectEnv, CLICK_PHASE_LABELS, formatScoreDelta, renderClickTable } from '../lib/cli.js';
import { STATE_FILE } from './status.js';
import { requireLicense } from '../core/license.js';

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
    .option('--category <type>', 'Filter sweep to a specific issue category (e.g. line-length, console-cleanup, console-log)')
    .option('--guards <profile>', 'Guard profile: tight (3/40), refactor (12/280), broad (20/500), atomic (no limits)')
    .option('--max-lines <number>', 'Max lines changed per click before auto-rollback (overrides --guards)')
    .option('--max-files <number>', 'Max files changed per click before auto-rollback (overrides --guards)')
    .option('--no-escalate', 'Disable adaptive escalation — stay on single-file target even when stalled')
    .option('--no-guard-escalation', 'Disable smart guard escalation — don\'t auto-bump guard profile on consecutive guard rejections')
    .option('--architect', 'Enable architect mode — structural refactoring with relaxed guards (20 files, 500 lines)')
    .option('--plan-first', 'Run a planning click 0 before execution clicks — read-only, generates a structured plan', false)
    .option('--no-pr-comment', 'Disable the before/after score card appended to output after torque completes')
    .option('--no-pr-comment-footer', 'Hide the "Powered by Ratchet" footer in score cards (paid tiers)')
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
        category?: string;
        guards?: string;
        maxLines?: string;
        maxFiles?: string;
        escalate: boolean;
        architect: boolean;
        planFirst: boolean;
        prComment: boolean;
        prCommentFooter: boolean;
      }) => {
        const cwd = process.cwd();

        printHeader('⚙  Ratchet Torque');

        // License gate — torque requires Pro or higher
        requireLicense('torque');

        // Validate git repo, warn about dirty worktree, and load config
        const config = await validateProjectEnv(cwd);

        // If config was auto-detected, show a banner so the user knows
        if (config._source === 'auto-detected') {
          process.stdout.write(
            chalk.dim('  ✦ No .ratchet.yml found — running in zero-config mode.') +
              chalk.dim(' Run ' + chalk.cyan('ratchet init') + ' to create a config.\n') + '\n',
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
            if (warnings.length > 0) process.stdout.write('\n');
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

        // Set up click guards — resolution priority: --max-lines/--max-files > --guards > target config > mode defaults
        const VALID_PROFILES: GuardProfileName[] = ['tight', 'refactor', 'broad', 'atomic'];
        if (options.maxLines || options.maxFiles) {
          // Explicit per-dimension override takes highest priority
          const base = options.guards && VALID_PROFILES.includes(options.guards as GuardProfileName)
            ? GUARD_PROFILES[options.guards as GuardProfileName] ?? GUARD_PROFILES.tight!
            : GUARD_PROFILES.tight!;
          config.guards = {
            maxLinesChanged: options.maxLines ? parseInt(options.maxLines, 10) : base.maxLinesChanged,
            maxFilesChanged: options.maxFiles ? parseInt(options.maxFiles, 10) : base.maxFilesChanged,
          };
        } else if (options.guards) {
          if (!VALID_PROFILES.includes(options.guards as GuardProfileName)) {
            exitWithError(`  Invalid --guards profile: "${options.guards}"\n  Valid profiles: ${VALID_PROFILES.join(', ')}`);
          }
          config.guards = options.guards as GuardProfileName;
        }
        // Otherwise leave config.guards as-is (from .ratchet.yml) or undefined (engine uses mode defaults)

        // Print run summary
        const fields: Array<[string, string]> = options.sweep
          ? [['Mode', chalk.yellow('sweep') + (options.category ? chalk.dim(` (${options.category})`) : '')]]
          : [['Target', chalk.cyan(target.name)], ['Path', chalk.dim(target.path)]];
        fields.push(
          ['Agent',  chalk.dim(config.agent)],
          ['Clicks', chalk.yellow(String(clickCount))],
          ['Tests',  chalk.dim(config.defaults.testCommand)],
          ['Guards', (() => {
            if (config.guards === undefined) return chalk.dim('mode defaults');
            if (config.guards === 'atomic') return chalk.yellow('atomic (no limits)');
            if (typeof config.guards === 'string') {
              const g = GUARD_PROFILES[config.guards as GuardProfileName];
              return chalk.dim(`${config.guards} (≤${g!.maxLinesChanged} lines, ≤${g!.maxFilesChanged} files)`);
            }
            return chalk.dim(`≤${config.guards.maxLinesChanged} lines, ≤${config.guards.maxFilesChanged} files`);
          })()],
          ['Mode',   hardenMode ? chalk.yellow('harden') : chalk.dim('normal')],
        );
        if (options.architect) fields.push(['Architect', chalk.yellow('enabled')]);
        if (options.planFirst) fields.push(['Plan-first', chalk.yellow('enabled')]);
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
          process.stdout.write(chalk.dim('\n  Run interrupted. Partial progress may be saved in .ratchet-state.json\n') + '\n');
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
          process.stdout.write(chalk.dim('\n  Process terminated. Partial progress may be saved in .ratchet-state.json\n') + '\n');
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

        const engineFn = options.sweep ? runSweepEngine : options.architect ? runArchitectEngine : runEngine;

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
            category: options.category,
            escalate: options.escalate,
            architectEscalation: options.architect !== false,
            guardEscalation: options.guardEscalation !== false,
            planFirst: options.planFirst,
            callbacks: {
              onScanComplete: (scan: ScanResult) => {
                const topIssues = scan.issuesByType.slice(0, 3);
                const targetStr = topIssues
                  .map((t) => `${t.subcategory} (${t.count}/${t.count + 1})`)
                  .join(', ');
                process.stdout.write(
                  `  📊 Initial scan: ${chalk.bold(`${scan.total}/${scan.maxTotal}`)} (${scan.totalIssuesFound} issues found)\n`,
                );
                if (targetStr) {
                  process.stdout.write(`     Targeting: ${chalk.dim(targetStr)}\n`);
                }
                // Score ceiling detection
                const gaps = analyzeScoreGaps(scan);
                const sweepableGaps = gaps.filter(g => g.sweepable);
                const nonSweepableGaps = gaps.filter(g => !g.sweepable);
                const reachablePoints = sweepableGaps.reduce((sum, g) => sum + g.pointsAvailable, 0);
                const allPoints = gaps.reduce((sum, g) => sum + g.pointsAvailable, 0);
                const reachableScore = Math.min(100, scan.total + reachablePoints);
                const ceilingScore = Math.min(100, scan.total + allPoints);
                if (reachablePoints > 0) {
                  process.stdout.write(
                    `  📈 Reachable by torque: ~${reachableScore}/100 (+${reachablePoints}pts from ${sweepableGaps.length} fixable categories)\n`,
                  );
                }
                if (nonSweepableGaps.length > 0) {
                  const archNames = nonSweepableGaps.slice(0, 2).map(g => g.subcategory).join(', ');
                  const etcSuffix = nonSweepableGaps.length > 2 ? ', etc.' : '';
                  process.stdout.write(
                    `     Ceiling: ${ceilingScore}/100 — ${nonSweepableGaps.length} categories need architect mode (${archNames}${etcSuffix})\n`,
                  );
                }
                process.stdout.write('\n');
                lastKnownScore = scan.total;
              },

              onPlanStart: () => {
                spinner = ora('  📋 Click 0 — Planning…').start();
              },

              onPlanComplete: (plan) => {
                if (spinner) {
                  spinner.succeed(
                    `  📋 Click 0 — Plan ready: ${plan.filesToTouch.length} files, ~${plan.estimatedClicks} clicks estimated`,
                  );
                  spinner = null;
                }
                process.stdout.write(
                  chalk.dim(`     Files to touch: ${plan.filesToTouch.slice(0, 5).join(', ')}${plan.filesToTouch.length > 5 ? `, +${plan.filesToTouch.length - 5} more` : ''}\n`) + '\n',
                );
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
                      `  Click ${chalk.bold(String(click.number))} — ${chalk.yellow('✗ rolled back')}` +
                        (click.rollbackReason ? chalk.dim(` — ${click.rollbackReason}`) : ''),
                    );
                  }
                  spinner = null;
                }
                // Reset per-click tracking
                lastKnownDelta = undefined;

                if (options.verbose) {
                  const elapsed = formatDuration(Date.now() - clickStartTime);
                  process.stdout.write(chalk.dim(`     time: ${elapsed}`) + '\n');
                  if (click.proposal) {
                    const preview = click.proposal.length > 120
                      ? click.proposal.slice(0, 120) + '…'
                      : click.proposal;
                    process.stdout.write(chalk.dim(`     proposal: ${preview}`) + '\n');
                  }
                  if (click.filesModified.length > 0) {
                    process.stdout.write(
                      chalk.dim(
                        `     files: ${click.filesModified.join(', ')}`,
                      ) + '\n',
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

              onEscalate: (reason: string) => {
                if (spinner) {
                  spinner.warn(chalk.yellow(`  ⚠   Stall detected (${reason}) — switching to cross-file sweep`));
                  spinner = null;
                } else {
                  process.stdout.write(chalk.yellow(`  ⚠   Stall detected (${reason}) — switching to cross-file sweep\n`));
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

        // Compute pass/fail counts (used below and in final summary)
        const passedClicks = run.clicks.filter((c) => c.testsPassed).length;
        const rolledBack = run.clicks.length - passedClicks;

        // Generate and display PR score card if enabled and we have both scores
        if (options.prComment && scoreBefore && scoreAfter && passedClicks > 0 && !options.dryRun) {
          const scoreCard = generateScoreCard(scoreBefore, scoreAfter, { footer: options.prCommentFooter });
          process.stdout.write('\n' + chalk.dim('  ─'.repeat(23)) + '\n\n');
          process.stdout.write(scoreCard.split('\n').map((l) => '  ' + l).join('\n') + '\n');

          // Write PR description to file for use with `ratchet tighten --pr`
          const changedFiles = run.clicks
            .filter((c) => c.testsPassed)
            .flatMap((c) => c.filesModified)
            .filter((f, i, arr) => arr.indexOf(f) === i);
          const prDesc = generatePRDescription(scoreBefore, scoreAfter, changedFiles, { footer: options.prCommentFooter });
          const prDescPath = join(cwd, `docs/${target.name}-pr-description.md`);
          await writeFile(prDescPath, prDesc, 'utf-8').catch(() => {});
        }

        const reportPath = await writeReport({ run, cwd, scoreBefore, scoreAfter }).catch(() => null);
        await writePDF({ run, cwd, scoreBefore, scoreAfter }).catch(() => null);

        // Persist run state for `ratchet status` / `ratchet tighten` / regen-pdf
        try {
          const stateWithScores = { ...run, _scoreBefore: scoreBefore, _scoreAfter: scoreAfter };
          await writeFile(join(cwd, STATE_FILE), JSON.stringify(stateWithScores, null, 2), 'utf-8');
        } catch {
          // Non-fatal
        }

        // Persist to run history
        await saveRun(cwd, run, scoreBefore, scoreAfter).catch(() => {
          // Non-fatal
        });

        // Final summary
        const duration = formatDuration(Date.now() - runStart);

        const landedPart = `${chalk.green(String(passedClicks))} landed`;
        const rolledPart = rolledBack > 0
          ? ` · ${chalk.yellow(String(rolledBack))} rolled back`
          : '';

        // Per-click result table
        renderClickTable(run.clicks);

        process.stdout.write('\n' + chalk.bold('  ' + '─'.repeat(46)) + '\n');
        process.stdout.write(
          `\n  ${chalk.bold('Done.')} ` +
            `${landedPart}${rolledPart} · ` +
            `${chalk.dim(duration)}\n`,
        );

        if (run.earlyStopReason) {
          const returned = clickCount - run.clicks.length;
          process.stdout.write(
            `\n  💰 Cycles: ${passedClicks} used, ${returned} returned to balance\n` +
            `  ⏹ Stopped early: ${run.earlyStopReason}\n`,
          );
        }

        if (run.architectEscalated) {
          process.stdout.write(chalk.yellow(`\n  🏗️  Escalated to architect mode mid-run.\n`));
        }

        if (passedClicks > 0) {
          process.stdout.write(
            `\n  Log: ${chalk.dim(`docs/${target.name}-ratchet.md`)}\n`,
          );
          if (reportPath) {
            process.stdout.write(
              `  Report: ${chalk.dim(`docs/${target.name}-ratchet-report.md`)}\n`,
            );
          }
          process.stdout.write(
            `  Run ${chalk.green('ratchet tighten --pr')} to open a pull request.\n` + '\n',
          );
        } else {
          process.stdout.write(chalk.dim('\n  No clicks landed. Try adjusting your target description.\n') + '\n');
        }

        // Print report summary
        const report = generateReport({ run, cwd, scoreBefore, scoreAfter });
        process.stdout.write('\n' + report + '\n');

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
