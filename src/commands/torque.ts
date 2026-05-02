import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import {
  configFilePath,
  findTarget,
  findIncompleteTargets,
  getConfigWarnings,
} from '../core/config.js';
import { saveRun, loadRun, listRuns } from '../core/history.js';
import { readFileSync } from 'fs';
import { runEngine, runSweepEngine, runArchitectEngine } from '../core/engine.js';
import { DeepEngine } from '../core/engines/deep.js';
import { detectProvider } from '../core/providers/index.js';
import { runFeatureEngine, resolveSpec } from '../core/engine-feature.js';
import type { ClickPhase, HardenPhase, RunEconomics } from '../core/engine.js';
import { ShellAgent } from '../core/agents/shell.js';
import { APIAgent } from '../core/agents/api.js';
import { modelRegistry } from '../core/model-registry.js';
import { LocalMLXProvider, LOCAL_MLX_DEFAULT_PORT } from '../core/providers/local.js';
import { buildSwarmConfig } from '../core/swarm.js';
import { isValidSpecialization } from '../core/agents/specialized.js';
import { RatchetLogger } from '../core/logger.js';
import { logger as pinoLogger } from '../lib/logger.js';
import { generateReport, writeReport } from '../core/report.js';
import { writePDF } from '../core/pdf-report.js';
import { generateScoreCard, generatePRDescription } from '../core/pr-comment.js';
import { runScan } from './scan.js';
import type { ScanResult } from '../core/scanner';
import { analyzeScoreGaps, generateNextMoveRecommendation } from '../core/score-optimizer.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import { parseScopeArg, resolveScope, formatScopeForDisplay } from '../core/scope.js';
import type { Click, RatchetRun, Target } from '../types.js';
import { GUARD_PROFILES } from '../types.js';
import type { GuardProfileName } from '../types.js';
import { formatDuration } from '../core/utils.js';
import {
  printHeader,
  exitWithError,
  validateInt,
  printFields,
  validateProjectEnv,
  CLICK_PHASE_LABELS,
  formatScoreDelta,
  renderClickTable,
} from '../lib/cli.js';
import { STATE_FILE } from './status.js';
import { requireLicense } from '../core/license.js';
import { startBackgroundRun, updateProgress } from '../core/background.js';

function printEconomics(economics: RunEconomics): void {
  const total = economics.landed + economics.rolledBack;
  const efficiencyPct = (economics.efficiency * 100).toFixed(1);
  const landedPct = total > 0 ? ((economics.landed / total) * 100).toFixed(0) : '0';

  process.stdout.write('\n' + chalk.bold('  📊 Run Economics') + '\n');
  process.stdout.write(`  Wall time:     ${formatDuration(economics.totalWallTimeMs)}\n`);
  process.stdout.write(
    `  Effective:     ${formatDuration(economics.effectiveTimeMs)} (${efficiencyPct}% efficiency)\n`,
  );
  process.stdout.write(`  Wasted:        ${formatDuration(economics.wastedTimeMs)}\n`);
  process.stdout.write('\n');
  process.stdout.write(`  Landed:        ${economics.landed}/${total} clicks (${landedPct}%)\n`);
  if (economics.rolledBack > 0) {
    process.stdout.write(`  Rolled back:   ${economics.rolledBack}/${total}\n`);
  }
  if (economics.timedOut > 0) {
    process.stdout.write(`  Timed out:     ${economics.timedOut}/${total}\n`);
  }
  process.stdout.write('\n');
  if (economics.scoreDelta !== 0 || economics.issuesFixed > 0) {
    if (economics.scoreDelta !== 0) {
      const sign = economics.scoreDelta > 0 ? '+' : '';
      process.stdout.write(`  Score delta:   ${sign}${economics.scoreDelta}\n`);
    }
    if (economics.issuesFixed > 0) {
      process.stdout.write(`  Issues fixed:  ${economics.issuesFixed}\n`);
    }
    process.stdout.write('\n');
  }
  if (economics.totalCost > 0) {
    process.stdout.write(`  Est. cost:     $${economics.totalCost.toFixed(4)}\n\n`);
  }
  if (economics.recommendations.length > 0) {
    process.stdout.write(chalk.bold('  💡 Recommendations:') + '\n');
    for (const rec of economics.recommendations) {
      process.stdout.write(`  → ${chalk.dim(rec)}\n`);
    }
    process.stdout.write('\n');
  }
}

function printDeductionBreakdown(result: ScanResult): void {
  const deductedCategories = result.categories.filter((c) => c.score < c.max);
  if (deductedCategories.length === 0) {
    process.stdout.write(chalk.green('\n  ✨ No deductions — perfect score!\n\n'));
    return;
  }

  process.stdout.write(chalk.bold('\n  📊 Score Deduction Breakdown\n'));
  process.stdout.write(chalk.dim('  ' + '─'.repeat(74)) + '\n');

  for (const cat of deductedCategories) {
    const catDeduction = cat.max - cat.score;
    process.stdout.write(
      `\n  ${cat.emoji} ${chalk.bold(cat.name)} ` +
        `${chalk.dim(`${cat.score}/${cat.max}`)}  ` +
        `${chalk.red(`−${catDeduction} pts`)}\n`,
    );

    for (const sub of cat.subcategories) {
      if (sub.score >= sub.max) continue;
      const deduction = sub.max - sub.score;
      const reason = sub.issuesDescription ?? sub.summary ?? '—';

      if (sub.locations && sub.locations.length > 0) {
        const shown = sub.locations.slice(0, 5);
        for (let i = 0; i < shown.length; i++) {
          const loc = shown[i]!;
          const subLabel = i === 0 ? sub.name.padEnd(22) : ''.padEnd(22);
          process.stdout.write(
            `    ${chalk.dim(subLabel)}  ${chalk.cyan(loc.padEnd(38))}  ` +
              `${chalk.yellow(reason)}  ${chalk.red(`−${deduction} pts`)}\n`,
          );
        }
        if (sub.locations.length > 5) {
          process.stdout.write(
            chalk.dim(`    ${''.padEnd(22)}  ... and ${sub.locations.length - 5} more\n`),
          );
        }
      } else {
        process.stdout.write(
          `    ${chalk.dim(sub.name.padEnd(22))}  ${chalk.dim('(no specific locations)'.padEnd(38))}  ` +
            `${chalk.yellow(reason)}  ${chalk.red(`−${deduction} pts`)}\n`,
        );
      }
    }
  }
  process.stdout.write('\n');
}

export function torqueCommand(): Command {
  const cmd = new Command('improve');

  cmd
    .description(
      'Autonomous iterative code improvement — the Ratchet engine.\n\n' +
        'Creates a branch (ratchet/<target>-<timestamp>), runs N clicks,\n' +
        'and writes a live log to docs/<target>-ratchet.md.\n\n' +
        'Each click: analyze → propose → build → test → commit (or revert).',
    )
    .option(
      '-t, --target <name>',
      'Target name defined in .ratchet.yml (omit to use auto-detection)',
    )
    .option(
      '-n, --clicks <number>',
      'Number of clicks to run (overrides defaults.clicks in config)',
    )
    .option(
      '--dry-run',
      'Preview mode — analyze and propose without committing any changes (default: true)',
      true,
    )
    .option('--apply', 'Actually commit changes — required to override --dry-run', false)
    .option('--verbose', 'Show per-click timing, proposal preview, and modified files', false)
    .option('--no-branch', 'Run on the current branch instead of creating a ratchet branch', false)
    .option(
      '--mode <mode>',
      'Run mode: "normal" (default), "harden" (write tests first, then improve), or "feature" (build from spec)',
    )
    .option(
      '--spec <text-or-file>',
      'Feature specification — quoted string or path to a .md file (required with --mode feature)',
    )
    .option('--swarm', 'Enable swarm mode — N agents compete per click, best change wins', false)
    .option('--agents <number>', 'Number of competing agents in swarm mode (default: 3)')
    .option(
      '--focus <specs>',
      'Comma-separated specializations: security,performance,quality,errors,types',
    )
    .option(
      '--focus-category <category>',
      'Force torque to target a specific score category:' +
        ' testing, security, type-safety, error-handling, performance, code-quality',
    )
    .option(
      '--debate',
      'Enable debate round in swarm mode — judge picks winner (default: true)',
      true,
    )
    .option('--no-debate', 'Disable debate round — pick winner by score only')
    .option(
      '--personalities <names>',
      'Comma-separated personality names for swarm agents (e.g. the-surgeon,the-hawk)',
    )
    .option(
      '--adversarial',
      'Enable adversarial QA — red team tests each landed change for regressions',
      false,
    )
    .option('--sweep', 'Sweep mode — fix one issue type across the entire codebase', false)
    .option(
      '--category <type>',
      'Filter sweep to a specific issue category (e.g. line-length, console-cleanup, console-log)',
    )
    .option(
      '--guards <profile>',
      'Guard profile: tight (3/40), refactor (12/280), broad (20/500), atomic (no limits)',
    )
    .option(
      '--max-lines <number>',
      'Max lines changed per click before auto-rollback (overrides --guards)',
    )
    .option(
      '--max-files <number>',
      'Max files changed per click before auto-rollback (overrides --guards)',
    )
    .option(
      '--no-escalate',
      'Disable adaptive escalation — stay on single-file target even when stalled',
    )
    .option(
      '--no-guard-escalation',
      "Disable smart guard escalation — don't auto-bump guard profile on consecutive guard rejections",
    )
    .option(
      '--architect',
      'Enable architect mode — structural refactoring with relaxed guards (20 files, 500 lines)',
    )
    .option(
      '--plan-first',
      'Run a planning click 0 before execution clicks — read-only, generates a structured plan',
      false,
    )
    .option('--json', 'Output full run economics as JSON (for CI/CD integration)', false)
    .option(
      '--explain-deductions',
      'After scanning, show a detailed breakdown of points lost per subcategory and file',
      false,
    )
    .option(
      '--no-pr-comment',
      'Disable the before/after score card appended to output after torque completes',
    )
    .option(
      '--no-pr-comment-footer',
      'Hide the "Powered by Ratchet" footer in score cards (paid tiers)',
    )
    .option(
      '--scope <spec>',
      'Limit changes to specific files: diff, branch, staged, <glob>, or file:a.ts,b.ts',
    )
    .option('--resume <id>', 'Resume an interrupted run by its run ID')
    .option('--no-auto-resume', 'Start fresh even if an interrupted run exists')
    .option('--background', 'Detach from terminal and run in background', false)
    .option(
      '--fast',
      'Enable context pruning for faster clicks — inject focused issue context into agent prompts (experimental)',
      false,
    )
    .option(
      '--timeout <minutes>',
      'Maximum wall time in minutes (stops cleanly after current click finishes)',
    )
    .option(
      '--budget <dollars>',
      'Maximum estimated cost in USD (stops when budget would be exceeded)',
    )
    .option(
      '--deep',
      'Use DeepEngine for full semantic picture — re-runs every 3 clicks (default budget: $5.00)',
    )
    .option('--stop-on-regression', 'Stop immediately when a score regression is detected', false)
    .option('--no-strategy', 'Disable self-evolving strategy loading and evolution for this run')
    .option(
      '--deep-analyze',
      'Run a multi-turn ReACT analysis loop before the first click — reads files, ' +
        'queries GitNexus for blast radius, and produces a structured risk assessment',
      false,
    )
    .option(
      '--parallel <number>',
      'Run multiple specs/targets in parallel (requires multiple --spec or --specs-file)',
    )
    .option(
      '--specs-file <path>',
      'Path to a markdown file where each ## heading is a separate task spec',
    )
    .option(
      '--model <model>',
      'Model to use for fixes (overrides provider default, e.g. glm-5.1:cloud, kimi-k2.6:cloud)',
    )
    .option(
      '--provider <provider>',
      'Provider to use: anthropic, openai, openrouter, ollama-cloud, local, si',
    )
    .option('--local', 'Use local on-device MLX model instead of cloud API (privacy mode)', false)
    .option(
      '--local-port <number>',
      `Port for local MLX server (default: ${LOCAL_MLX_DEFAULT_PORT})`,
    )
    .option(
      '--pro',
      'Force best-tier fix engine — uses the strongest model for your configured provider (best tier)',
      false,
    )
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ ratchet improve\n' +
        '  $ ratchet improve --target src\n' +
        '  $ ratchet improve --target api --clicks 3\n' +
        '  $ ratchet improve --target src --apply   # actually commit changes\n' +
        '  $ ratchet improve --target src --dry-run  # preview only (default)\n' +
        '  $ ratchet improve --target src --verbose --no-branch\n' +
        '  $ ratchet improve --provider ollama-cloud --model glm-5.1:cloud\n' +
        '  $ ratchet improve --provider openrouter --pro\n',
    )
    .action(
      async (options: {
        target?: string;
        clicks?: string;
        dryRun: boolean;
        apply: boolean;
        verbose: boolean;
        branch: boolean;
        mode?: string;
        spec?: string;
        swarm: boolean;
        agents?: string;
        focus?: string;
        focusCategory?: string;
        debate: boolean;
        personalities?: string;
        adversarial: boolean;
        sweep: boolean;
        category?: string;
        guards?: string;
        maxLines?: string;
        maxFiles?: string;
        escalate: boolean;
        guardEscalation: boolean;
        architect: boolean;
        planFirst: boolean;
        json: boolean;
        prComment: boolean;
        prCommentFooter: boolean;
        scope?: string;
        resume?: string;
        autoResume: boolean;
        background: boolean;
        fast: boolean;
        timeout?: string;
        budget?: string;
        stopOnRegression: boolean;
        explainDeductions: boolean;
        parallel?: string;
        specsFile?: string;
        model?: string;
        provider?: string;
        local: boolean;
        localPort?: string;
        pro: boolean;
        deepAnalyze: boolean;
        deep: boolean;
      }) => {
        const cwd = process.cwd();

        // Safety: --apply overrides the default --dry-run=true
        if (options.apply) {
          options.dryRun = false;
        }
        if (options.dryRun && !options.apply) {
          logger.info(chalk.yellow('  ⚠  Dry-run mode (default). Use --apply to commit changes.'));
        }

        // ── Parallel mode
        if (options.parallel) {
          const maxWorkers = parseInt(options.parallel, 10);
          if (isNaN(maxWorkers) || maxWorkers < 1) {
            exitWithError(
              `  Invalid --parallel value: ${options.parallel}\n  Must be a positive integer (e.g. --parallel 3).`,
            );
          }

          printHeader('⚡ Ratchet Parallel');

          const { runParallel, buildParallelReport } = await import('../core/parallel.js');
          const { parseSpecsFile } = await import('../core/parallel.js');
          const mode =
            options.mode === 'feature'
              ? 'feature'
              : options.mode === 'harden'
                ? 'harden'
                : 'normal';
          const clicks = options.clicks ? parseInt(options.clicks, 10) : 7;

          let tasks: import('../core/parallel.js').ParallelTask[] = [];

          // Load from specs file if provided
          if (options.specsFile) {
            const { readFileSync: rfs } = await import('fs');
            try {
              const content = rfs(options.specsFile, 'utf-8');
              const specs = parseSpecsFile(content);
              tasks = specs.map((spec, i) => {
                const firstLine = spec.split('\n')[0] ?? '';
                const title = firstLine.startsWith('## ')
                  ? firstLine.slice(3).trim()
                  : `task-${i + 1}`;
                return {
                  id: `specs-${i + 1}-${title.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
                  spec,
                  mode,
                  clicks,
                };
              });
            } catch (err) {
              exitWithError(
                `  Could not read specs file: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          // Add any --spec values as additional tasks
          if (options.spec) {
            const specText = options.spec;
            const title = specText.split('\n')[0]?.slice(0, 40) ?? 'task';
            tasks.push({
              id: `spec-${title.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
              spec: specText,
              mode,
              clicks,
            });
          }

          // Add --target as a task if provided (non-feature mode)
          if (options.target && tasks.length === 0) {
            tasks.push({
              id: `target-${options.target}`,
              target: options.target,
              mode,
              clicks,
            });
          }

          if (tasks.length === 0) {
            exitWithError(
              '  --parallel requires at least one task.\n' +
                '  Use --specs-file <path> or --spec "..." to specify tasks.',
            );
          }

          const parallelConfig: import('../core/parallel.js').ParallelConfig = {
            maxWorkers,
            tasks,
            model: options.model,
            guards: options.guards,
            debate: options.debate,
            strategy: (options as Record<string, unknown>)['strategy'] !== false,
          };

          const result = await runParallel(parallelConfig, cwd);
          process.stdout.write(buildParallelReport(result));

          if (result.totalLanded === 0 && result.totalClicks > 0) process.exit(2);
          else if (result.totalRolledBack > 0) process.exit(1);
          return;
        }
        // ── End parallel mode

        // Background mode: detach and run in a child process
        if (options.background && !process.env['RATCHET_BACKGROUND']) {
          const filteredArgs = process.argv.slice(2).filter((a) => a !== '--background');
          const result = await startBackgroundRun(cwd, filteredArgs);
          process.stdout.write(
            `\n  ⚙  Ratchet running in background\n\n` +
              `  Run ID : ${result.runId}\n` +
              `  PID    : ${result.pid}\n` +
              `  Log    : ${result.logPath}\n\n` +
              `  Monitor: ratchet status\n` +
              `  Stop   : ratchet stop ${result.runId}\n\n`,
          );
          process.exit(0);
        }

        printHeader('⚙  Ratchet Torque');

        const { trackEvent } = await import('../core/telemetry.js');
        trackEvent('torque');

        // License gate — torque requires Pro or higher
        requireLicense();

        // Validate git repo, warn about dirty worktree, and load config
        const config = await validateProjectEnv(cwd);

        // If config was auto-detected, show a banner so the user knows
        if (config._source === 'auto-detected') {
          process.stdout.write(
            chalk.dim('  ✦ No .ratchet.yml found — running in zero-config mode.') +
              chalk.dim(' Run ' + chalk.cyan('ratchet init') + ' to create a config.\n') +
              '\n',
          );
          if (config._noTestCommand) {
            pinoLogger.warn('No test command detected — harden mode auto-enabled');
          }
        }

        // Resolve harden mode: explicit --mode flag takes precedence, then config default
        const hardenMode = options.mode === 'harden' || config.defaults.hardenMode === true;

        // Validate --focus-category
        const VALID_FOCUS_CATEGORIES = [
          'testing',
          'security',
          'type-safety',
          'error-handling',
          'performance',
          'code-quality',
        ];
        if (options.focusCategory && !VALID_FOCUS_CATEGORIES.includes(options.focusCategory)) {
          exitWithError(
            `  Invalid --focus-category: ${options.focusCategory}\n` +
              `  Valid categories: ${VALID_FOCUS_CATEGORIES.join(', ')}`,
          );
        }

        // Validate feature mode requirements
        const featureMode = options.mode === 'feature';
        if (featureMode && !options.spec) {
          exitWithError(
            `  --mode feature requires --spec <text-or-file>\n\n` +
              `  Examples:\n` +
              `    ${chalk.cyan('ratchet improve --mode feature --spec "Add user authentication with JWT"')}\n` +
              `    ${chalk.cyan('ratchet improve --mode feature --spec ./specs/auth.md')}`,
          );
        }

        // Resolve swarm mode
        if (options.swarm) {
          const agentCount = options.agents ? validateInt(options.agents, 'agents', 1, 5) : 3;

          let focusSpecs: string[] | undefined;
          if (options.focus) {
            focusSpecs = options.focus.split(',').map((s) => s.trim());
            const invalid = focusSpecs.filter((s) => !isValidSpecialization(s));
            if (invalid.length > 0) {
              exitWithError(
                `  Invalid --focus specialization(s): ${invalid.join(', ')}\n` +
                  `  Valid: security, performance, quality, errors, types`,
              );
            }
          }

          // Support personality overrides from env (set by `ratchet swarm` command)
          const envPersonalities = process.env['RATCHET_PERSONALITIES'];
          const personalitiesArg = options.personalities ?? (envPersonalities || undefined);
          const personalityList = personalitiesArg
            ? personalitiesArg.split(',').map((p: string) => p.trim())
            : undefined;

          // Debate flag: respect --no-debate env or CLI flag
          const debateEnabled = options.debate !== false && !process.env['RATCHET_NO_DEBATE'];

          config.swarm = buildSwarmConfig({
            swarm: true,
            agents: agentCount,
            focus: focusSpecs,
            debate: debateEnabled,
            personalities: personalityList,
          });
        }

        // Warn about incomplete targets and invalid field values silently dropped by the parser
        if (config._source === 'file') {
          try {
            const rawYml = readFileSync(configFilePath(cwd), 'utf-8');
            const warnings = [...getConfigWarnings(rawYml), ...findIncompleteTargets(rawYml)];
            for (const w of warnings) {
              pinoLogger.warn(w);
            }
            if (warnings.length > 0) process.stdout.write('\n');
          } catch {
            // Non-fatal
          }
        }

        // Resolve target (skip for sweep/feature modes)
        let target;
        if (options.sweep) {
          // Sweep mode: use a synthetic target representing the whole codebase
          target = {
            name: 'sweep',
            path: '.',
            description: 'Sweep mode — fix one issue type across the entire codebase',
          };
        } else if (featureMode && !options.target) {
          // Feature mode without explicit target: use a synthetic target
          target = {
            name: 'feature',
            path: '.',
            description: 'Feature mode — build from specification',
          };
        } else if (options.target) {
          target = findTarget(config, options.target);
          if (!target) {
            if (config.targets.length === 0) {
              exitWithError(
                `  Target "${options.target}" not found — .ratchet.yml has no targets defined.\n\n` +
                  `  Add a target to .ratchet.yml:\n` +
                  chalk.dim(
                    '    targets:\n      - name: my-target\n        path: src/\n' +
                      '        description: "Improve code quality in src/"',
                  ),
              );
            }
            const available = config.targets.map((t) => chalk.cyan(t.name)).join(', ');
            exitWithError(
              `  Target "${options.target}" not found in .ratchet.yml.\n  Available: ${available}`,
            );
          }
        } else {
          // No --target flag: use first auto-detected target
          target = config.targets[0];
          if (!target) {
            exitWithError(
              `  No target specified and none could be auto-detected.\n` +
                `  Use ${chalk.cyan('--target <name>')} or run ${chalk.cyan('ratchet init')} to create a .ratchet.yml.`,
            );
          }
        }

        // Resolve click count (sweep mode defaults to 5); may be overridden by --resume
        let clickCount = options.clicks
          ? parseInt(options.clicks, 10)
          : options.sweep
            ? 5
            : config.defaults.clicks;

        if (isNaN(clickCount) || clickCount < 1) {
          exitWithError(
            `  Invalid --clicks value: ${chalk.bold(String(options.clicks ?? ''))}\n` +
              `  Must be a positive integer (e.g. ${chalk.cyan('--clicks 5')}).`,
          );
        }

        if (options.clicks && options.clicks.includes('.')) {
          exitWithError(
            `  Invalid --clicks value: ${chalk.bold(options.clicks)}\n` +
              `  Fractional clicks are not allowed — must be a whole number (e.g. ${chalk.cyan('--clicks 5')}).`,
          );
        }

        // Set up click guards
        // Resolution priority: --max-lines/--max-files > --guards > target config > mode defaults
        const VALID_PROFILES: GuardProfileName[] = ['tight', 'refactor', 'broad', 'atomic'];
        if (options.maxLines || options.maxFiles) {
          // Explicit per-dimension override takes highest priority
          const base =
            options.guards && VALID_PROFILES.includes(options.guards as GuardProfileName)
              ? (GUARD_PROFILES[options.guards as GuardProfileName] ?? GUARD_PROFILES.tight!)
              : GUARD_PROFILES.tight!;
          config.guards = {
            maxLinesChanged: options.maxLines
              ? parseInt(options.maxLines, 10)
              : base.maxLinesChanged,
            maxFilesChanged: options.maxFiles
              ? parseInt(options.maxFiles, 10)
              : base.maxFilesChanged,
          };
        } else if (options.guards) {
          if (!VALID_PROFILES.includes(options.guards as GuardProfileName)) {
            exitWithError(
              `  Invalid --guards profile: "${options.guards}"\n  Valid profiles: ${VALID_PROFILES.join(', ')}`,
            );
          }
          config.guards = options.guards as GuardProfileName;
        }
        // Otherwise leave config.guards as-is (from .ratchet.yml) or undefined (engine uses mode defaults)

        // Resolve scope to concrete file list
        let scopeFiles: string[] = [];
        if (options.scope) {
          const scopeSpec = parseScopeArg(options.scope);
          scopeFiles = await resolveScope(scopeSpec, cwd);
          if (scopeFiles.length === 0) {
            process.stdout.write(
              chalk.yellow(
                `  ⚠  Scope "${options.scope}" matched no files — no restriction applied.\n\n`,
              ),
            );
          }
        }

        // Print run summary
        const fields: Array<[string, string]> = options.sweep
          ? [
              [
                'Mode',
                chalk.yellow('sweep') +
                  (options.category ? chalk.dim(` (${options.category})`) : ''),
              ],
            ]
          : featureMode
            ? [
                ['Mode', chalk.yellow('feature')],
                [
                  'Spec',
                  chalk.dim(
                    (options.spec ?? '').slice(0, 60) +
                      ((options.spec ?? '').length > 60 ? '…' : ''),
                  ),
                ],
              ]
            : [
                ['Target', chalk.cyan(target.name)],
                ['Path', chalk.dim(target.path)],
              ];
        fields.push(
          ['Agent', chalk.dim(config.agent)],
          ['Clicks', chalk.yellow(String(clickCount))],
          ['Tests', chalk.dim(config.defaults.testCommand)],
          [
            'Guards',
            (() => {
              if (config.guards === undefined) return chalk.dim('mode defaults');
              if (config.guards === 'atomic') return chalk.yellow('atomic (no limits)');
              if (typeof config.guards === 'string') {
                const g = GUARD_PROFILES[config.guards as GuardProfileName];
                return chalk.dim(
                  `${config.guards} (≤${g!.maxLinesChanged} lines, ≤${g!.maxFilesChanged} files)`,
                );
              }
              return chalk.dim(
                `≤${config.guards.maxLinesChanged} lines, ≤${config.guards.maxFilesChanged} files`,
              );
            })(),
          ],
          [
            'Mode',
            featureMode
              ? chalk.yellow('feature')
              : hardenMode
                ? chalk.yellow('harden')
                : chalk.dim('normal'),
          ],
        );
        if (options.scope)
          fields.push(['Scope', chalk.cyan(formatScopeForDisplay(options.scope, scopeFiles, cwd))]);
        if (options.local) {
          const port = options.localPort ?? String(LOCAL_MLX_DEFAULT_PORT);
          fields.push(['Model', chalk.green(`local MLX :${port}`)]);
        } else if (options.provider) {
          fields.push(['Provider', chalk.cyan(options.provider)]);
          if (options.model) fields.push(['Model', chalk.cyan(options.model)]);
        } else if (options.model) {
          fields.push(['Model', chalk.cyan(options.model)]);
        }
        if (options.architect) fields.push(['Architect', chalk.yellow('enabled')]);
        if (options.planFirst) fields.push(['Plan-first', chalk.yellow('enabled')]);
        if (options.fast) fields.push(['Fast', chalk.yellow('context pruning')]);
        if (options.adversarial) fields.push(['QA', chalk.yellow('adversarial')]);
        if (config.swarm?.enabled) {
          const specs = config.swarm.specializations.join(', ');
          fields.push([
            'Swarm',
            `${chalk.yellow(`${config.swarm.agentCount} agents`)} ${chalk.dim(`(${specs})`)}`,
          ]);
        }
        printFields(fields, !options.dryRun);
        if (options.dryRun) {
          process.stdout.write(chalk.yellow('  [DRY RUN] No changes will be committed.\n') + '\n');
        }

        // Set up logger
        const logger = new RatchetLogger(target.name, cwd);

        // Create agent — local mode uses on-device MLX model via OpenAI-compatible API
        let agent: ShellAgent | APIAgent;
        if (options.local) {
          const port = options.localPort ? parseInt(options.localPort, 10) : LOCAL_MLX_DEFAULT_PORT;
          if (isNaN(port) || port < 1 || port > 65535) {
            exitWithError(
              `  Invalid --local-port value: ${options.localPort}\n  Must be a valid port number (1–65535).`,
            );
          }
          const localProvider = new LocalMLXProvider(port);
          const running = await localProvider.isRunning();
          if (!running) {
            exitWithError(
              `  Local MLX server not reachable on port ${port}.\n\n` +
                `  Start it with:\n` +
                `    mlx_lm.server --model training-data/ratchet-fix-fused-v2 --port ${port}\n\n` +
                `  Or install mlx-lm:\n` +
                `    pip install mlx-lm`,
            );
          }
          process.stdout.write(
            chalk.dim(
              '  🔒 Local mode: using on-device model (best for console, catch, N+1 fixes)\n',
            ) + '\n',
          );
          agent = new APIAgent({ provider: localProvider });
        } else {
          // Build explicit provider config from CLI flags
          const explicitConfig = options.provider
            ? {
                provider:
                  options.provider as import('../core/providers/index.js').ProviderConfig['provider'],
                apiKey: undefined as string | undefined,
                model: options.model,
              }
            : undefined;

          // Resolve API key for explicit provider
          if (explicitConfig) {
            switch (explicitConfig.provider) {
              case 'ollama-cloud':
                explicitConfig.apiKey = process.env['OLLAMA_CLOUD_API_KEY'];
                break;
              case 'anthropic':
                explicitConfig.apiKey = process.env['ANTHROPIC_API_KEY'];
                break;
              case 'openai':
                explicitConfig.apiKey = process.env['OPENAI_API_KEY'];
                break;
              case 'openrouter':
                explicitConfig.apiKey = process.env['OPENROUTER_API_KEY'];
                break;
              case 'si':
                explicitConfig.apiKey = process.env['RATCHET_SI_KEY'];
                break;
            }
          }

          // Detect provider first (uses env keys), then resolve model for that provider
          const baseProvider = explicitConfig
            ? detectProvider(
                explicitConfig as import('../core/providers/index.js').ProviderConfig,
                options.model,
              )
            : detectProvider(undefined, options.model);

          const useProEngine = options.pro || baseProvider.name === 'Anthropic';
          const tier: 'cheap' | 'standard' | 'best' = useProEngine ? 'best' : 'standard';
          const fixModel = options.model ?? modelRegistry.getModelForTier(tier, baseProvider.name);

          if (baseProvider.name === 'Anthropic') {
            process.stdout.write(chalk.green(`  ⚡ Pro fix engine: ${fixModel}\n`) + '\n');
            agent = new ShellAgent({ model: fixModel, cwd });
          } else if (useProEngine) {
            process.stdout.write(chalk.green(`  ⚡ Pro fix engine: ${fixModel}\n`) + '\n');
            const fixProvider = fixModel ? detectProvider(undefined, fixModel) : baseProvider;
            agent = new APIAgent({ provider: fixProvider });
          } else {
            process.stdout.write(chalk.dim(`  Standard fix engine: ${fixModel}\n`) + '\n');
            const fixProvider = fixModel ? detectProvider(undefined, fixModel) : baseProvider;
            agent = new APIAgent({ provider: fixProvider });
          }
        }

        // Spinner state
        let spinner: ReturnType<typeof ora> | null = null;
        const runStart = Date.now();
        let capturedEconomics: RunEconomics | undefined;
        let clickStartTime = 0;
        let currentHardenPhase: HardenPhase | undefined;
        // Live score tracking
        let lastKnownScore: number | undefined;
        let lastKnownDelta: number | undefined;
        // Live run reference — set by onRunInit callback, used by signal handlers
        let liveRun: RatchetRun | undefined;
        // --deep: tracks click offset across segments (for display numbering)
        let deepClickOffset = 0;
        let deepTotalCost = 0;

        const saveInterruptedRun = async (totalClickCount: number): Promise<void> => {
          if (!liveRun) return;
          liveRun.status = 'interrupted';
          liveRun.finishedAt = new Date();
          liveRun.resumeState = {
            completedClicks: liveRun.clicks.length,
            totalClicks: totalClickCount,
            target: target.name,
            scoreAtStart: scoreBefore?.total,
            interruptedAt: new Date().toISOString(),
          };
          try {
            await saveRun(cwd, liveRun);
            process.stdout.write(
              chalk.dim(
                `\n  Run saved. Resume with: ${chalk.cyan(`ratchet improve --resume ${liveRun.id}`)}\n`,
              ) + '\n',
            );
          } catch {
            // Non-fatal
          }
        };

        // Graceful Ctrl+C and SIGTERM handlers
        const makeHandler = (msg: string, code: number) => () => {
          if (spinner) {
            spinner.fail(chalk.yellow(msg));
            spinner = null;
          } else {
            process.stdout.write('\n');
          }
          releaseLock(cwd);
          void saveInterruptedRun(clickCount).then(() => process.exit(code));
        };
        const sigintHandler = makeHandler('  Interrupted by user (Ctrl+C)', 130);
        const sigtermHandler = makeHandler('  Terminated (SIGTERM)', 143);

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

        // --resume: load interrupted run and adjust click count + target
        if (options.resume) {
          const entry = await loadRun(cwd, options.resume);
          if (!entry) {
            exitWithError(`  Interrupted run "${options.resume}" not found in .ratchet/runs/`);
          }
          const rs = entry!.run.resumeState;
          if (!rs) {
            exitWithError(
              `  Run "${options.resume}" has no resume state — it was not interrupted.`,
            );
          }
          const remainingClicks = rs.totalClicks - rs.completedClicks;
          if (remainingClicks <= 0) {
            exitWithError(`  Run "${options.resume}" has no remaining clicks to resume.`);
          }
          // If no --target was given, restore the target from the interrupted run
          if (!options.target) {
            const resumedTarget = findTarget(config, rs.target);
            if (resumedTarget) {
              (target as Target) = resumedTarget;
            }
          }
          process.stdout.write(
            chalk.cyan(
              `\n  Resuming run ${chalk.bold(options.resume)} ` +
                `from click ${rs.completedClicks + 1}/${rs.totalClicks}\n\n`,
            ),
          );
          // Override click count with remaining clicks
          clickCount = remainingClicks;
        }

        // Auto-resume: if no explicit --resume and no explicit --target, check for interrupted runs
        if (!options.resume && !options.target && options.autoResume !== false) {
          try {
            const allRuns = await listRuns(cwd);
            const interrupted = allRuns.find((e) => e.run.status === 'interrupted');
            if (interrupted) {
              options.resume = interrupted.run.id;
              const resumedAt = (interrupted.run.resumeState?.completedClicks ?? 0) + 1;
              const resumeTotal = interrupted.run.resumeState?.totalClicks ?? '?';
              process.stdout.write(
                chalk.cyan(
                  `  ⚡ Auto-resuming interrupted run ${chalk.bold(interrupted.run.id)} ` +
                    `(click ${resumedAt}/${resumeTotal})...\n\n`,
                ),
              );
            }
          } catch {
            // Non-fatal
          }
        }

        const engineFn = options.sweep
          ? runSweepEngine
          : options.architect
            ? runArchitectEngine
            : runEngine;

        // Feature mode: resolve spec and run feature engine
        if (featureMode) {
          let resolvedSpec = options.spec!;
          try {
            resolvedSpec = await resolveSpec(options.spec!);
          } catch (err) {
            exitWithError(
              `  Could not read spec file: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          let featureRun: RatchetRun;
          try {
            featureRun = await runFeatureEngine({
              target,
              clicks: clickCount,
              config,
              cwd,
              agent,
              spec: resolvedSpec,
              createBranch: options.branch && !options.dryRun,
              adversarial: options.adversarial,
              callbacks: {
                onClickStart: async (clickNumber: number, total: number) => {
                  clickStartTime = Date.now();
                  const label =
                    clickNumber === 0
                      ? 'planning…'
                      : `implementing step ${clickNumber}/${total - 1}…`;
                  spinner = ora(`  Click ${chalk.bold(String(clickNumber))} — ${label}`).start();
                },
                onClickPhase: (phase, clickNumber) => {
                  if (!spinner) return;
                  spinner.text = `  Click ${chalk.bold(String(clickNumber))} — ${CLICK_PHASE_LABELS[phase]}`;
                },
                onClickComplete: async (click, _rolledBack) => {
                  if (spinner) {
                    if (click.testsPassed) {
                      spinner.succeed(
                        `  Click ${chalk.bold(String(click.number))} — ${chalk.green('✓ passed')}` +
                          (click.commitHash ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`) : ''),
                      );
                    } else {
                      spinner.warn(
                        `  Click ${chalk.bold(String(click.number))} — ${chalk.yellow('✗ rolled back')}` +
                          (click.rollbackReason ? chalk.dim(` — ${click.rollbackReason}`) : ''),
                      );
                    }
                    spinner = null;
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
                onRunComplete: async (run: RatchetRun) => {
                  liveRun = run;
                },
              },
            });
          } catch (err) {
            if (spinner) (spinner as ReturnType<typeof ora>).fail();
            pinoLogger.error({ err }, 'Fatal error');
            process.exit(1);
          } finally {
            process.removeListener('SIGINT', sigintHandler);
            process.removeListener('SIGTERM', sigtermHandler);
            releaseLock(cwd);
          }

          await logger.finalizeLog(featureRun!).catch(() => {});

          const passedFeatureClicks = featureRun!.clicks.filter((c) => c.testsPassed).length;
          const rolledBackFeature = featureRun!.clicks.length - passedFeatureClicks;
          const duration = formatDuration(Date.now() - runStart);

          renderClickTable(featureRun!.clicks);
          process.stdout.write('\n' + chalk.bold('  ' + '─'.repeat(46)) + '\n');
          process.stdout.write(
            `\n  ${chalk.bold('Done.')} ` +
              `${chalk.green(String(passedFeatureClicks))} landed` +
              (rolledBackFeature > 0
                ? ` · ${chalk.yellow(String(rolledBackFeature))} rolled back`
                : '') +
              ` · ${chalk.dim(duration)}\n`,
          );
          process.stdout.write(
            `\n  Plan: ${chalk.dim(`docs/${target.name}-feature-plan.md`)}\n` +
              `  Run ${chalk.green('ratchet ship --pr')} to open a pull request.\n\n`,
          );

          await saveRun(cwd, featureRun!).catch(() => {});

          if (featureRun!.clicks.length > 0 && passedFeatureClicks === 0) process.exit(2);
          else if (featureRun!.clicks.length > 0 && rolledBackFeature > 0) process.exit(1);
          return;
        }

        // ── Deep pre-scan (--deep flag) ──
        // Run DeepEngine for full semantic analysis before the fix loop.
        // Used as the initial scanResult for better issue prioritization.
        // When using standard runEngine: re-runs every 3 clicks (segment loop).
        const deepBudget = options.budget ? parseFloat(options.budget) : 5.0;
        let scanForFix: ScanResult | undefined = scoreBefore;

        if (options.deep) {
          const deepSpinner = ora('  Deep analysis…').start();
          try {
            const provider = detectProvider();
            const deepEngine = new DeepEngine(provider);
            scanForFix = await deepEngine.analyze(cwd, { budget: deepBudget });
            deepTotalCost += deepBudget * 0.1; // rough estimate for first scan
            deepSpinner.succeed(
              `  Deep analysis: ${chalk.bold(String(scanForFix.totalIssuesFound))} findings ` +
                chalk.dim(`· Deep analysis cost: $${deepTotalCost.toFixed(2)} total`),
            );
          } catch (err) {
            deepSpinner.fail('  Deep analysis failed — using classic scan');
            pinoLogger.warn({ err }, 'Deep pre-scan failed in torque');
            scanForFix = scoreBefore;
          }
        }

        let run: RatchetRun;
        try {
          if (options.deep && engineFn === runEngine && !options.dryRun) {
            // ── Segmented deep loop: run 3 clicks, re-run Deep, repeat ──
            let remaining = clickCount;
            let segScan: ScanResult | undefined = scanForFix;
            const segRuns: RatchetRun[] = [];

            while (remaining > 0) {
              const segClicks = Math.min(3, remaining);

              // Re-run Deep on subsequent segments (every 3rd click boundary)
              if (segRuns.length > 0) {
                const reDeepSpinner = ora(
                  `  Re-running Deep analysis (click ${deepClickOffset + 1})…`,
                ).start();
                try {
                  const budgetLeft = deepBudget - deepTotalCost;
                  if (budgetLeft > 0.05) {
                    const provider = detectProvider();
                    segScan = await new DeepEngine(provider).analyze(cwd, { budget: budgetLeft });
                    deepTotalCost += budgetLeft * 0.1; // rough per-segment estimate
                    reDeepSpinner.succeed(
                      `  Deep reassessment: ${segScan.totalIssuesFound} findings ` +
                        chalk.dim(`· Deep analysis cost: $${deepTotalCost.toFixed(2)} total`),
                    );
                  } else {
                    reDeepSpinner.warn('  Deep budget exhausted — using last scan result');
                  }
                } catch (err) {
                  reDeepSpinner.warn('  Deep re-analysis failed — using previous scan');
                  pinoLogger.warn({ err }, 'Deep re-scan failed in torque segment loop');
                }
              }

              const segRun = await runEngine({
                target,
                clicks: segClicks,
                config,
                cwd,
                agent,
                createBranch: segRuns.length === 0 && options.branch && !options.dryRun,
                hardenMode,
                adversarial: options.adversarial,
                scanResult: segScan,
                deepScanResult: segScan,
                category: options.category,
                escalate: options.escalate,
                architectEscalation: options.escalate !== false,
                guardEscalation: options.guardEscalation !== false,
                planFirst: options.planFirst,
                contextPruning: options.fast,
                scoreOptimized: true,
                timeoutMs: options.timeout ? parseFloat(options.timeout) * 60 * 1000 : undefined,
                budgetUsd: options.budget ? parseFloat(options.budget) : undefined,
                stopOnRegression: options.stopOnRegression,
                noStrategy: (options as Record<string, unknown>)['strategy'] === false,
                focusCategory: options.focusCategory,
                deepAnalyze: options.deepAnalyze,
                scope: scopeFiles,
                scopeArg: options.scope,
                callbacks: {
                  onScanComplete: () => {},
                  onClickStart: async (clickNumber, total, hardenPhase) => {
                    clickStartTime = Date.now();
                    currentHardenPhase = hardenPhase;
                    const displayN = clickNumber + deepClickOffset;
                    const phaseTag = hardenPhase ? chalk.dim(` [${hardenPhase}]`) : '';
                    spinner = ora(
                      `  Click ${chalk.bold(String(displayN))}/${clickCount}${phaseTag} — analyzing…`,
                    ).start();
                    void total;
                    if (displayN === 1) {
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
                    const phaseTag = currentHardenPhase
                      ? chalk.dim(` [${currentHardenPhase}]`)
                      : '';
                    spinner.text =
                      `  Click ${chalk.bold(String(clickNumber + deepClickOffset))}/${clickCount}${phaseTag} — ` +
                      `${CLICK_PHASE_LABELS[phase]}`;
                  },
                  onClickScoreUpdate: (
                    _n: number,
                    _b: number,
                    scoreAfter: number,
                    delta: number,
                  ) => {
                    lastKnownScore = scoreAfter;
                    lastKnownDelta = delta;
                  },
                  onClickComplete: async (click: Click, _rolledBack: boolean) => {
                    if (spinner) {
                      const displayN = click.number + deepClickOffset;
                      if (click.testsPassed) {
                        let scoreSuffix = '';
                        if (click.scoreAfterClick !== undefined && lastKnownScore !== undefined) {
                          const before = lastKnownScore - (lastKnownDelta ?? 0);
                          scoreSuffix = ` — Score: ${before} → ${click.scoreAfterClick} (${formatScoreDelta(before, click.scoreAfterClick)})`;
                          if (click.issuesFixedCount && click.issuesFixedCount > 0) {
                            scoreSuffix += chalk.dim(` — ${click.issuesFixedCount} issues fixed`);
                          }
                        }
                        spinner.succeed(
                          `  Click ${chalk.bold(String(displayN))} — ${chalk.green('✓ passed')}` +
                            (click.commitHash
                              ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`)
                              : '') +
                            scoreSuffix,
                        );
                      } else {
                        spinner.warn(
                          `  Click ${chalk.bold(String(displayN))} — ${chalk.yellow('✗ rolled back')}` +
                            (click.rollbackReason ? chalk.dim(` — ${click.rollbackReason}`) : ''),
                        );
                      }
                      spinner = null;
                    }
                    lastKnownDelta = undefined;
                  },
                  onError: (err: Error, clickNumber: number) => {
                    if (spinner) {
                      spinner.fail(
                        `  Click ${chalk.bold(String(clickNumber + deepClickOffset))} — ` +
                          `${chalk.red('error')}: ${err.message}`,
                      );
                      spinner = null;
                    }
                  },
                  onRunEconomics: (economics: RunEconomics) => {
                    capturedEconomics = economics;
                  },
                  onRunInit: (r: RatchetRun) => {
                    liveRun = r;
                  },
                  onCheckpoint: async (r: RatchetRun) => {
                    await saveRun(cwd, r).catch(() => {});
                  },
                  onEscalate: (reason: string) => {
                    if (spinner) {
                      spinner.warn(
                        chalk.yellow(
                          `  ⚠   Stall detected (${reason}) — switching to cross-file sweep`,
                        ),
                      );
                      spinner = null;
                    } else {
                      process.stdout.write(
                        chalk.yellow(
                          `  ⚠   Stall detected (${reason}) — switching to cross-file sweep\n`,
                        ),
                      );
                    }
                  },
                  onArchitectEscalate: (reason: string) => {
                    if (spinner) {
                      spinner.warn(
                        chalk.yellow(
                          `  ⚡ Standard clicks stalled — escalating to architect mode (${reason})`,
                        ),
                      );
                      spinner = null;
                    } else {
                      process.stdout.write(
                        chalk.yellow(
                          `  ⚡ Standard clicks stalled — escalating to architect mode (${reason})\n`,
                        ),
                      );
                    }
                  },
                },
              });

              segRuns.push(segRun);
              remaining -= segClicks;
              deepClickOffset += segRun.clicks.length;
            }

            // Merge segment runs: renumber clicks sequentially
            const firstSeg = segRuns[0]!;
            let globalIdx = 0;
            const allClicks: Click[] = [];
            for (const seg of segRuns) {
              for (const c of seg.clicks) {
                allClicks.push({ ...c, number: ++globalIdx });
              }
            }
            run = {
              ...segRuns[segRuns.length - 1]!,
              id: firstSeg.id,
              startedAt: firstSeg.startedAt,
              clicks: allClicks,
            };
          } else {
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
              scanResult: options.deep ? scanForFix : scoreBefore,
              deepScanResult: options.deep ? scanForFix : undefined,
              category: options.category,
              escalate: options.escalate,
              architectEscalation: options.escalate !== false,
              guardEscalation: options.guardEscalation !== false,
              planFirst: options.planFirst,
              contextPruning: options.fast,
              scoreOptimized: true,
              timeoutMs: options.timeout ? parseFloat(options.timeout) * 60 * 1000 : undefined,
              budgetUsd: options.budget ? parseFloat(options.budget) : undefined,
              stopOnRegression: options.stopOnRegression,
              noStrategy: (options as Record<string, unknown>)['strategy'] === false,
              focusCategory: options.focusCategory,
              deepAnalyze: options.deepAnalyze,
              scope: scopeFiles,
              scopeArg: options.scope,
              callbacks: {
                onScanComplete: (scan: ScanResult) => {
                  const topIssues = scan.issuesByType.slice(0, 3);
                  const targetStr = topIssues
                    .map((t) => `${t.subcategory} (${t.count}/${t.count + 1})`)
                    .join(', ');
                  process.stdout.write(
                    `  📊 Initial scan: ${chalk.bold(`${scan.total}/${scan.maxTotal}`)} ` +
                      `(${scan.totalIssuesFound} issues found)\n`,
                  );
                  if (targetStr) {
                    process.stdout.write(`     Targeting: ${chalk.dim(targetStr)}\n`);
                  }
                  // Score ceiling detection
                  const gaps = analyzeScoreGaps(scan);
                  const sweepableGaps = gaps.filter((g) => g.sweepable);
                  const nonSweepableGaps = gaps.filter((g) => !g.sweepable);
                  const reachablePoints = sweepableGaps.reduce(
                    (sum, g) => sum + g.pointsAvailable,
                    0,
                  );
                  const allPoints = gaps.reduce((sum, g) => sum + g.pointsAvailable, 0);
                  const reachableScore = Math.min(100, scan.total + reachablePoints);
                  const ceilingScore = Math.min(100, scan.total + allPoints);
                  if (reachablePoints > 0) {
                    process.stdout.write(
                      `  📈 Reachable by torque: ~${reachableScore}/100 ` +
                        `(+${reachablePoints}pts from ${sweepableGaps.length} fixable categories)\n`,
                    );
                  }
                  if (nonSweepableGaps.length > 0) {
                    const archNames = nonSweepableGaps
                      .slice(0, 2)
                      .map((g) => g.subcategory)
                      .join(', ');
                    const etcSuffix = nonSweepableGaps.length > 2 ? ', etc.' : '';
                    process.stdout.write(
                      `     Ceiling: ${ceilingScore}/100 — ${nonSweepableGaps.length} categories need architect mode ` +
                        `(${archNames}${etcSuffix})\n`,
                    );
                  }

                  // Proactive --architect recommendation when structural issues dominate
                  if (!options.architect) {
                    const structuralPoints = nonSweepableGaps.reduce(
                      (sum, g) => sum + g.pointsAvailable,
                      0,
                    );
                    const structuralDominant =
                      structuralPoints >= reachablePoints ||
                      (nonSweepableGaps.length > 0 && reachablePoints <= 2);
                    if (structuralDominant && nonSweepableGaps.length > 0) {
                      const details = nonSweepableGaps
                        .slice(0, 3)
                        .map(
                          (g) =>
                            `${g.subcategory}: ${g.currentCount} issues (+${g.pointsAvailable}pts)`,
                        )
                        .join(', ');
                      const architectHint = chalk.bold('--architect');
                      process.stdout.write(
                        chalk.yellow(
                          `\n  ⚠️  Structural issues detected — ${architectHint} recommended\n`,
                        ) +
                          chalk.dim(`     ${details}\n`) +
                          chalk.dim(`     Run: ${chalk.green('ratchet improve --architect')}\n`),
                      );
                    }
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
                      `  📋 Click 0 — Plan ready: ${plan.filesToTouch.length} files, ` +
                        `~${plan.estimatedClicks} clicks estimated`,
                    );
                    spinner = null;
                  }
                  process.stdout.write(
                    chalk.dim(
                      `     Files to touch: ${plan.filesToTouch.slice(0, 5).join(', ')}` +
                        `${plan.filesToTouch.length > 5 ? `, +${plan.filesToTouch.length - 5} more` : ''}\n`,
                    ) + '\n',
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
                  spinner.text =
                    `  Click ${chalk.bold(String(clickNumber))}/${clickCount}${phaseTag} — ` +
                    `${CLICK_PHASE_LABELS[phase]}`;
                },

                onClickScoreUpdate: (
                  _clickNumber: number,
                  scoreBefore: number,
                  scoreAfter: number,
                  delta: number,
                ) => {
                  lastKnownScore = scoreAfter;
                  lastKnownDelta = delta;
                  // Store for use in onClickComplete
                  void scoreBefore; // used via lastKnownScore tracking
                },

                onClickComplete: async (click: Click, rolledBack: boolean) => {
                  const clickDelta = lastKnownDelta;
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
                  // Tip: suggest --pro when click failed or had 0 score delta
                  if (
                    !options.pro &&
                    (rolledBack || (clickDelta !== undefined && clickDelta <= 0))
                  ) {
                    process.stdout.write(
                      chalk.dim('  ⚡ Tip: Use --pro for the best model tier\n'),
                    );
                  }
                  // Reset per-click tracking
                  lastKnownDelta = undefined;

                  if (options.verbose) {
                    const elapsed = formatDuration(Date.now() - clickStartTime);
                    process.stdout.write(chalk.dim(`     time: ${elapsed}`) + '\n');
                    if (click.proposal) {
                      const preview =
                        click.proposal.length > 120
                          ? click.proposal.slice(0, 120) + '…'
                          : click.proposal;
                      process.stdout.write(chalk.dim(`     proposal: ${preview}`) + '\n');
                    }
                    if (click.filesModified.length > 0) {
                      process.stdout.write(
                        chalk.dim(`     files: ${click.filesModified.join(', ')}`) + '\n',
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

                onRunEconomics: (economics: RunEconomics) => {
                  capturedEconomics = economics;
                },

                onRunInit: (run: RatchetRun) => {
                  liveRun = run;
                },

                onCheckpoint: async (run: RatchetRun) => {
                  try {
                    await saveRun(cwd, run);
                  } catch {
                    // Non-fatal
                  }
                  // Update background progress.json if running detached
                  const bgRunId = process.env['RATCHET_BG_RUN_ID'];
                  if (bgRunId) {
                    const passedSoFar = run.clicks.filter((c) => c.testsPassed).length;
                    const latestScore = run.clicks.at(-1)?.scoreAfterClick;
                    await updateProgress(cwd, bgRunId, {
                      clicksCompleted: run.clicks.length,
                      clicksTotal: clickCount,
                      score: latestScore,
                      status: run.status === 'running' ? 'running' : run.status,
                    }).catch(() => {});
                    void passedSoFar;
                  }
                },

                onEscalate: (reason: string) => {
                  if (spinner) {
                    spinner.warn(
                      chalk.yellow(
                        `  ⚠   Stall detected (${reason}) — switching to cross-file sweep`,
                      ),
                    );
                    spinner = null;
                  } else {
                    process.stdout.write(
                      chalk.yellow(
                        `  ⚠   Stall detected (${reason}) — switching to cross-file sweep\n`,
                      ),
                    );
                  }
                },
                onArchitectEscalate: (reason: string) => {
                  if (spinner) {
                    spinner.warn(
                      chalk.yellow(
                        `  ⚡ Standard clicks stalled — escalating to architect mode (${reason})`,
                      ),
                    );
                    spinner = null;
                  } else {
                    process.stdout.write(
                      chalk.yellow(
                        `  ⚡ Standard clicks stalled — escalating to architect mode (${reason})\n`,
                      ),
                    );
                  }
                },
              },
            });
          } // end else (non-deep or non-standard engine path)
        } catch (err) {
          if (spinner) (spinner as ReturnType<typeof ora>).fail();
          pinoLogger.error({ err }, 'Fatal error');
          process.exit(1);
        } finally {
          process.removeListener('SIGINT', sigintHandler);
          process.removeListener('SIGTERM', sigtermHandler);
          releaseLock(cwd);
        }

        // Finalize log
        await logger.finalizeLog(run).catch(() => {});

        // Show Deep analysis total cost if --deep was used
        if (options.deep && deepTotalCost > 0) {
          process.stdout.write(
            chalk.dim(`  Deep analysis cost: $${deepTotalCost.toFixed(2)} total\n`),
          );
        }

        // Capture score after the run and generate report
        let scoreAfter;
        try {
          scoreAfter = await runScan(cwd);
        } catch {
          // Non-fatal
        }

        // --explain-deductions: show per-subcategory/file deduction breakdown
        if (options.explainDeductions && scoreAfter) {
          printDeductionBreakdown(scoreAfter);
        }

        // Compute pass/fail counts (used below and in final summary)
        const passedClicks = run.clicks.filter((c) => c.testsPassed).length;
        const rolledBack = run.clicks.length - passedClicks;

        // Generate and display PR score card if enabled and we have both scores
        if (options.prComment && scoreBefore && scoreAfter && passedClicks > 0 && !options.dryRun) {
          const scoreCard = generateScoreCard(scoreBefore, scoreAfter, {
            footer: options.prCommentFooter,
          });
          process.stdout.write('\n' + chalk.dim('  ─'.repeat(23)) + '\n\n');
          process.stdout.write(
            scoreCard
              .split('\n')
              .map((l) => '  ' + l)
              .join('\n') + '\n',
          );

          // Write PR description to file for use with `ratchet ship --pr`
          const changedFiles = run.clicks
            .filter((c) => c.testsPassed)
            .flatMap((c) => c.filesModified)
            .filter((f, i, arr) => arr.indexOf(f) === i);
          const prDesc = generatePRDescription(scoreBefore, scoreAfter, changedFiles, {
            footer: options.prCommentFooter,
          });
          const prDescPath = join(cwd, `docs/${target.name}-pr-description.md`);
          await writeFile(prDescPath, prDesc, 'utf-8').catch(() => {});
        }

        const reportPath = await writeReport({ run, cwd, scoreBefore, scoreAfter }).catch(
          () => null,
        );
        await writePDF({ run, cwd, scoreBefore, scoreAfter }).catch(() => null);

        // Persist run state for `ratchet status` / `ratchet ship` / regen-pdf
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
        const rolledPart =
          rolledBack > 0 ? ` · ${chalk.yellow(String(rolledBack))} rolled back` : '';

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
          if (run.architectEscalatedAtClick !== undefined) {
            const stdClicks = run.clicks.filter((c) => c.number <= run.architectEscalatedAtClick!);
            const archClicks = run.clicks.filter((c) => c.number > run.architectEscalatedAtClick!);
            const stdLanded = stdClicks.filter((c) => c.testsPassed).length;
            const archLanded = archClicks.filter((c) => c.testsPassed).length;
            process.stdout.write(
              chalk.yellow(
                `\n  ⚡ Escalated to architect mode after click ${run.architectEscalatedAtClick}`,
              ) +
                chalk.dim(
                  ` (${stdLanded}/${stdClicks.length} standard · ${archLanded}/${archClicks.length} architect)\n`,
                ),
            );
          } else {
            process.stdout.write(chalk.yellow(`\n  🏗️  Escalated to architect mode mid-run.\n`));
          }
        }

        if (passedClicks > 0) {
          process.stdout.write(`\n  Log: ${chalk.dim(`docs/${target.name}-ratchet.md`)}\n`);
          if (reportPath) {
            process.stdout.write(
              `  Report: ${chalk.dim(`docs/${target.name}-ratchet-report.md`)}\n`,
            );
          }
          process.stdout.write(
            `  Run ${chalk.green('ratchet ship --pr')} to open a pull request.\n` + '\n',
          );
        } else {
          const skipped = run.skippedClicks ?? 0;
          const fps = run.falsePositivesFound ?? 0;
          process.stdout.write('\n');
          if (fps > 0 || skipped > 0) {
            process.stdout.write(
              chalk.yellow(
                '  No clicks landed — scanner issues were filtered as false positives.\n',
              ),
            );
            if (fps > 0) {
              process.stdout.write(
                chalk.dim(
                  `  • ${fps} false positive(s) filtered (patterns found only in comments, strings, or docs)\n`,
                ),
              );
            }
            if (skipped > 0) {
              process.stdout.write(
                chalk.dim(
                  `  • ${skipped} click(s) skipped — no real issues to fix after filtering\n`,
                ),
              );
            }
            process.stdout.write('\n');
            process.stdout.write('  Next steps:\n');
            process.stdout.write(
              `  • Run ${chalk.green('ratchet scan')} to review remaining issues manually\n`,
            );
            process.stdout.write(
              `  • Use ${chalk.green('ratchet improve --architect')}` +
                ` for structural issues that need multi-file refactors\n`,
            );
            process.stdout.write(
              `  • Review flagged files directly — the scanner found patterns in non-code contexts\n`,
            );
          } else {
            process.stdout.write(chalk.dim('  No clicks landed.\n'));
            process.stdout.write('\n');
            process.stdout.write('  Next steps:\n');
            process.stdout.write(
              `  • Try ${chalk.green('ratchet improve --architect')}` +
                ` for structural issues requiring larger refactors\n`,
            );
            process.stdout.write(
              `  • Try ${chalk.green('ratchet improve --plan-first')}` +
                ` to generate a multi-step plan before executing\n`,
            );
            process.stdout.write(
              `  • Run ${chalk.green('ratchet scan')} to review remaining issues and adjust your target\n`,
            );
          }
          process.stdout.write('\n');
        }

        // Print economics summary (or JSON output)
        if (options.json) {
          if (capturedEconomics) {
            const jsonOutput = {
              ...capturedEconomics,
              earlyStopReason: run.earlyStopReason ?? null,
              timeoutReached: run.timeoutReached ?? false,
              budgetReached: run.budgetReached ?? false,
            };
            process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
          }
        } else if (capturedEconomics) {
          printEconomics(capturedEconomics);
        }

        // Print strategy evolution summary
        if ((options as Record<string, unknown>)['strategy'] !== false && run.clicks.length > 0) {
          try {
            const { loadStrategy } = await import('../core/strategy.js');
            const updatedStrategy = await loadStrategy(cwd);
            if (updatedStrategy && updatedStrategy.runSummaries.length > 0) {
              const lastSummary =
                updatedStrategy.runSummaries[updatedStrategy.runSummaries.length - 1];
              const prevVersion = updatedStrategy.version - 1;
              process.stdout.write(
                chalk.dim(
                  `  📝 Strategy updated (v${prevVersion} → v${updatedStrategy.version}): `,
                ) +
                  chalk.dim(lastSummary.keyInsight) +
                  '\n\n',
              );
            }
          } catch {
            // Non-fatal
          }
        }

        // Print report summary
        const report = generateReport({ run, cwd, scoreBefore, scoreAfter });
        process.stdout.write('\n' + report + '\n');

        // Print next-move recommendation
        if (scoreAfter) {
          process.stdout.write(generateNextMoveRecommendation(scoreAfter));
        }

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
