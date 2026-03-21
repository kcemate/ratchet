import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { printHeader, exitWithError, validateInt, severityColor, printFields, validateProjectEnv, CLICK_PHASE_LABELS, formatScoreDelta } from '../lib/cli.js';
import { requireLicense } from '../core/license.js';
import { STATE_FILE } from './status.js';
import { saveRun } from '../core/history.js';
import { runSweepEngine, runArchitectEngine } from '../core/engine.js';
import { runTierEngine, planTierTargets } from '../core/tier-engine.js';
import type { ClickPhase } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { RatchetLogger } from '../core/logger.js';
import { writePDF } from '../core/pdf-report.js';
import { runScan } from './scan.js';
import type { ScanResult } from './scan.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import { parseScopeArg, resolveScope, formatScopeForDisplay } from '../core/scope.js';
import type { Click, RatchetRun, SwarmConfig } from '../types.js';
import { formatDuration } from '../core/utils.js';
import { readFileSync } from 'fs';
import { LearningStore } from '../core/learning.js';
import { allocateClicks } from '../core/allocator.js';
import { generateScorePlan } from '../core/score-optimizer.js';

// ──────────────────────────────────────────────────────────────────────────────
// Command
// ──────────────────────────────────────────────────────────────────────────────

export function improveCommand(): Command {
  const cmd = new Command('improve');

  cmd
    .description(
      'Scan → fix → rescan → report. One command.\n\n' +
        'Runs a multi-sweep across all high-severity issue types, then generates\n' +
        'a before/after PDF showing exactly what was fixed and how the score changed.',
    )
    .option('-n, --clicks <number>', 'Total clicks to run across all issue types (default: 10)', '10')
    .option('--out <path>', 'Output PDF path (default: docs/improve-report.pdf)')
    .option('--no-swarm', 'Disable swarm mode (swarm is on by default)')
    .option('--no-adversarial', 'Disable adversarial QA (adversarial is on by default)')
    .option('--no-architect', 'Disable architect phase (architect+surgical is the default)')
    .option('--scope <spec>', 'Limit changes to specific files: diff, branch, staged, <glob>, or file:a.ts,b.ts')
    .addHelpText('after', '\nExample:\n  $ ratchet improve\n  $ ratchet improve --clicks 14\n  $ ratchet improve --no-swarm --no-adversarial\n')
    .action(async (options: { clicks: string; out?: string; swarm: boolean; adversarial: boolean; architect: boolean; scope?: string }) => {
      const cwd = process.cwd();

      printHeader('⚙  Ratchet Improve');

      // License gate — improve requires Builder or higher
      requireLicense('improve');

      const config = await validateProjectEnv(cwd);

      const clickCount = validateInt(options.clicks, 'clicks', 1);

      const outPath = options.out ?? join(cwd, 'docs', 'improve-report.pdf');

      // Resolve scope to concrete file list
      let scopeFiles: string[] = [];
      if (options.scope) {
        const scopeSpec = parseScopeArg(options.scope);
        scopeFiles = await resolveScope(scopeSpec, cwd);
        if (scopeFiles.length === 0) {
          process.stdout.write(chalk.yellow(`  ⚠  Scope "${options.scope}" matched no files — no restriction applied.\n\n`));
        }
      }

      const scopeFields: Array<[string, string]> = [];
      if (options.scope) {
        scopeFields.push(['Scope', chalk.cyan(formatScopeForDisplay(options.scope, scopeFiles, cwd))]);
      }

      printFields([
        ['Clicks', chalk.yellow(String(clickCount))],
        ['Tests',  chalk.dim(config.defaults.testCommand)],
        ['Output', chalk.dim(outPath)],
        ...scopeFields,
      ]);

      // ── Step 1: Scan (before) ──
      const scanSpinner = ora('  Scanning codebase…').start();
      let scoreBefore: ScanResult;
      try {
        scoreBefore = await runScan(cwd);
        scanSpinner.succeed(
          `  Scan complete: ${chalk.bold(`${scoreBefore.total}/100`)} · ${chalk.yellow(String(scoreBefore.totalIssuesFound))} issues`,
        );
      } catch (err) {
        scanSpinner.fail('  Scan failed: ' + String(err));
        process.exit(1);
      }

      // Print issue breakdown
      process.stdout.write('\n' + chalk.dim('  Issues to fix:') + '\n');
      (scoreBefore.issuesByType || [])
        .filter(i => i.count > 0)
        .slice(0, 8)
        .forEach(i => {
          const sev = severityColor(i.severity)('●');
          process.stdout.write(`    ${sev} ${chalk.bold(String(i.count))} ${chalk.dim(i.description)}\n`);
        });
      process.stdout.write('\n');

      // ── Step 2: Fix (architect phase → surgical phase) ──
      // Default: first half of clicks = architect mode (structural, high-leverage)
      //          second half          = surgical sweep (cleanup what's left)
      // Opt out of architect phase with --no-architect.
      const target = { name: 'improve', path: '.', description: 'Improve all issue types across the codebase' };
      config.guards = { maxLinesChanged: 40, maxFilesChanged: 10 };

      const baseScore = scoreBefore.total;
      // Smart swarm: auto-disable on high-score codebases (>75) unless explicitly requested
      const useSwarm = options.swarm !== false && baseScore <= 75;
      const useAdversarial = options.adversarial !== false;
      const useArchitect = options.architect !== false;

      if (options.swarm !== false && baseScore > 75) {
        process.stdout.write(chalk.dim(`  Auto-skipping swarm (score ${baseScore}/100 > 75 — diminishing returns)\n`));
      }

      const allocation = allocateClicks(scoreBefore, clickCount);
      const architectClicks = useArchitect ? allocation.architectClicks : 0;
      const surgicalClicks = useArchitect ? allocation.surgicalClicks : clickCount;
      if (useArchitect) {
        process.stdout.write(chalk.dim(`  Allocation: ${allocation.reasoning}\n`));
      }

      if (useSwarm) {
        config.swarm = {
          enabled: true,
          agentCount: 3,
          specializations: ['security', 'quality', 'errors'],
          parallel: true,
          worktreeDir: '/tmp/ratchet-swarm',
        };
      }

      const modeFields: Array<[string, string]> = [
        ['Swarm',       useSwarm ? `${chalk.green('on')} ${chalk.dim('(3 agents)')}` : chalk.dim('off')],
        ['Adversarial', useAdversarial ? chalk.green('on') : chalk.dim('off')],
      ];
      if (useArchitect) {
        modeFields.push(['Strategy', `${chalk.cyan(`${architectClicks} architect`)} ${chalk.dim('→')} ${chalk.green(`${surgicalClicks} surgical`)}`]);
      }
      printFields(modeFields);

      // Print score optimization plan
      const scorePlan = generateScorePlan(scoreBefore);
      process.stdout.write('\n' + chalk.dim(scorePlan) + '\n\n');

      // Model tiering: architect phase gets the configured (expensive) model,
      // surgical phase uses sonnet for mechanical fixes (70%+ cost reduction)
      const architectModel = config.model; // Opus or whatever is configured
      const surgicalModel = config.model?.includes('opus') ? config.model.replace('opus', 'sonnet') : config.model;
      const architectAgent = new ShellAgent({ model: architectModel, cwd });
      const surgicalAgent = new ShellAgent({ model: surgicalModel, cwd });
      if (surgicalModel !== architectModel) {
        process.stdout.write(chalk.dim(`  Model tiering: architect=${architectModel || 'default'}, surgical=${surgicalModel || 'default'}\n`));
      }
      // Legacy alias for phases that don't need tiering
      const agent = architectAgent;
      const logger = new RatchetLogger(target.name, cwd);

      const learningStore = new LearningStore(cwd);
      await learningStore.load();

      acquireLock(cwd);

      let run: RatchetRun;
      let spinner: ReturnType<typeof ora> | null = null;

      const makeCallbacks = (totalClicks: number, clickOffset: number = 0) => ({
        onScanComplete: () => {},
        onClickStart: async (n: number, total: number) => {
          const globalN = n + clickOffset;
          const phase = clickOffset === 0 && useArchitect ? chalk.cyan('[architect] ') : chalk.green('[surgical] ');
          spinner = ora(`  ${phase}Click ${chalk.bold(String(globalN))}/${totalClicks} — fixing…`).start();
          if (globalN === 1) {
            await logger.initLog({ id: 'pending', target, clicks: [], startedAt: new Date(), status: 'running' }).catch(() => {});
          }
        },
        onClickPhase: (phase: ClickPhase, n: number) => {
          const globalN = n + clickOffset;
          if (spinner) spinner.text = `  Click ${chalk.bold(String(globalN))}/${totalClicks} — ${CLICK_PHASE_LABELS[phase]}`;
        },
        onClickComplete: async (click: Click, _rolledBack: boolean) => {
          if (spinner) {
            const globalN = click.number + clickOffset;
            if (click.testsPassed) {
              spinner.succeed(
                `  Click ${chalk.bold(String(globalN))} — ${chalk.green('✓ landed')}` +
                  (click.commitHash ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`) : '') +
                  (click.issuesFixedCount ? chalk.dim(` — ${click.issuesFixedCount} issues fixed`) : ''),
              );
            } else {
              spinner.warn(`  Click ${chalk.bold(String(globalN))} — ${chalk.yellow('✗ rolled back')}`);
            }
            spinner = null;
          }
        },
        onError: (err: Error, n: number) => {
          if (spinner) { spinner.fail(`  Click ${n + clickOffset} — error: ${err.message}`); spinner = null; }
        },
      });

      try {
        // Phase 1: Architect (structural, high-leverage)
        let architectRun: RatchetRun | null = null;
        let scanAfterArchitect = scoreBefore;

        if (useArchitect && architectClicks > 0) {
          process.stdout.write(chalk.cyan('  ◆ Architect phase\n'));
          architectRun = await runArchitectEngine({
            target,
            clicks: architectClicks,
            config,
            cwd,
            agent,
            createBranch: true,
            adversarial: useAdversarial,
            scanResult: scoreBefore,
            learningStore,
            scoreOptimized: true,
            scope: scopeFiles,
            scopeArg: options.scope,
            callbacks: makeCallbacks(clickCount, 0),
          });
          // Use scan after architect as input to surgical
          if (architectRun.clicks.length > 0) {
            try { scanAfterArchitect = await runScan(cwd); } catch { /* fallback */ }
          }
        }

        // Phase 2: Tier-aware surgical (targets tier boundaries for max score gain)
        // Relax guards for tier engine: larger batches for mechanical fixes
        config.guards = { maxLinesChanged: 200, maxFilesChanged: 16 };
        process.stdout.write(chalk.green('  ◆ Surgical phase (tier-aware)\n'));

        // Show tier plan
        const tierPlan = planTierTargets(scanAfterArchitect, surgicalClicks);
        if (tierPlan.length > 0) {
          for (const t of tierPlan) {
            const arrow = `${t.gap.currentScore}→${t.gap.currentScore + t.gap.pointsAtNextTier}/${t.gap.maxScore}`;
            process.stdout.write(
              chalk.dim(`    ${t.gap.subcategory}: ${t.clickBudget} clicks, +${t.gap.pointsAtNextTier}pt (${arrow}), ${t.gap.files.length} files\n`)
            );
          }
          process.stdout.write('\n');
        }

        const surgicalRun = await runTierEngine({
          target,
          clicks: surgicalClicks,
          config,
          cwd,
          agent: surgicalAgent,
          createBranch: architectClicks === 0, // only create branch if no architect phase
          adversarial: useAdversarial,
          scanResult: scanAfterArchitect,
          learningStore,
          scope: scopeFiles,
          scopeArg: options.scope,
          callbacks: makeCallbacks(clickCount, architectClicks),
        });

        // Merge: combine architect + surgical clicks into one run for the report
        if (architectRun) {
          // Renumber clicks sequentially and merge
          const archClicks = architectRun.clicks.map(c => ({ ...c }));
          const surgClicks = surgicalRun.clicks.map(c => ({ ...c, number: c.number + architectClicks }));
          run = {
            ...surgicalRun,
            id: architectRun.id,
            startedAt: architectRun.startedAt,
            clicks: [...archClicks, ...surgClicks],
          };
        } else {
          run = surgicalRun;
        }
      } catch (err) {
        if (spinner) (spinner as ReturnType<typeof ora>).fail();
        console.error(chalk.red('\nFatal error: ') + String(err));
        releaseLock(cwd);
        process.exit(1);
      }

      releaseLock(cwd);
      await logger.finalizeLog(run).catch(() => {});

      // ── Step 3: Rescan (after) ──
      const rescanSpinner = ora('  Rescanning codebase…').start();
      let scoreAfter: ScanResult;
      try {
        scoreAfter = await runScan(cwd);
        rescanSpinner.succeed(
          `  Rescan complete: ${chalk.bold(`${scoreAfter.total}/100`)} (${formatScoreDelta(scoreBefore.total, scoreAfter.total)}) · ${scoreAfter.totalIssuesFound} issues remaining`,
        );
      } catch (err) {
        rescanSpinner.fail('  Rescan failed: ' + String(err));
        scoreAfter = scoreBefore; // fallback to before
      }

      // ── Step 4: Generate PDF (dd-report-v7 format) ──
      const pdfSpinner = ora('  Generating results PDF…').start();
      const landed = run.clicks.filter(c => c.testsPassed);
      const rolledBack = run.clicks.filter(c => !c.testsPassed);
      const duration = run.finishedAt
        ? formatDuration(run.finishedAt.getTime() - run.startedAt.getTime())
        : formatDuration(Date.now() - run.startedAt.getTime());

      try {
        const pdfPath = await writePDF({
          run,
          cwd,
          scoreBefore,
          scoreAfter,
          projectName: scoreBefore.projectName || 'project',
        });

        // Copy to requested output path if different
        if (pdfPath !== outPath) {
          const { copyFileSync } = await import('fs');
          copyFileSync(pdfPath, outPath);
        }

        const size = Math.round(readFileSync(outPath).length / 1024);
        pdfSpinner.succeed(`  PDF saved: ${chalk.cyan(outPath)} (${size} KB)`);
      } catch (err) {
        pdfSpinner.fail('  PDF generation failed: ' + String(err));
      }

      // Persist run
      await saveRun(cwd, run, scoreBefore, scoreAfter).catch(() => {});
      await writeFile(join(cwd, STATE_FILE), JSON.stringify(run, null, 2), 'utf-8').catch(() => {});

      // ── Summary ──
      const issuesFixed = scoreBefore.totalIssuesFound - scoreAfter.totalIssuesFound;

      process.stdout.write(`\n${chalk.bold('  ' + '─'.repeat(46))}\n\n  ${chalk.bold('Done.')}\n`);
      printFields([
        ['Score',  `${scoreBefore.total} → ${chalk.bold(String(scoreAfter.total))} (${formatScoreDelta(scoreBefore.total, scoreAfter.total)})`],
        ['Issues', `${scoreBefore.totalIssuesFound} → ${scoreAfter.totalIssuesFound}${issuesFixed > 0 ? chalk.green(` (${issuesFixed} fixed)`) : ''}`],
        ['Clicks', `${landed.length} landed · ${rolledBack.length} rolled back`],
        ['Time',   duration],
        ['PDF',    chalk.cyan(outPath)],
      ]);

      if (landed.length > 0) {
        process.stdout.write(chalk.dim(`  Run ${chalk.cyan('ratchet tighten --pr')} to open a pull request.\n`) + '\n');
      }
    });

  return cmd;
}
