import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';
import type { RatchetRun, Target, RatchetConfig, Click, HardenPhase, CategoryDelta, ClickGuards } from '../types.js';
import { GUARD_PROFILES } from '../types.js';
import type { Agent } from './agents/base.js';
import type { IssueTask } from './issue-backlog.js';
import { buildBacklog, groupBacklogBySubcategory, enrichBacklogWithRisk, groupByDependencyCluster } from './issue-backlog.js';
import { buildScoreOptimizedBacklog } from './score-optimizer.js';
import { buildArchitectPrompt, buildPlanPrompt } from './agents/shell.js';
import type { PlanResult } from '../types.js';
import { mkdir, writeFile } from 'fs/promises';
import { executeClick } from './click.js';
import { SwarmExecutor } from './swarm.js';
import * as git from './git.js';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';
import type { LearningStore } from './learning.js';
import { clearCache as clearGitNexusCache } from './gitnexus.js';
import { IncrementalScanner } from './scan-cache.js';

export type ClickPhase = 'analyzing' | 'proposing' | 'building' | 'testing' | 'committing';
export type { HardenPhase };

/**
 * Compute per-category score deltas between two scan results.
 * Returns entries only for categories that exist in either scan.
 */
export function diffCategories(before: ScanResult, after: ScanResult): CategoryDelta[] {
  const deltas: CategoryDelta[] = [];

  // Build maps keyed by category name
  const beforeMap = new Map(before.categories.map(c => [c.name, c]));
  const afterMap = new Map(after.categories.map(c => [c.name, c]));

  // Union of all category names
  const names = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  for (const name of names) {
    const b = beforeMap.get(name);
    const a = afterMap.get(name);

    const beforeScore = b?.score ?? 0;
    const afterScore = a?.score ?? 0;
    const max = b?.max ?? a?.max ?? 0;

    const beforeIssues = b?.subcategories.reduce((sum, s) => sum + s.issuesFound, 0) ?? 0;
    const afterIssues = a?.subcategories.reduce((sum, s) => sum + s.issuesFound, 0) ?? 0;
    const issuesFixed = Math.max(0, beforeIssues - afterIssues);

    const delta = afterScore - beforeScore;
    const wastedEffort = issuesFixed > 0 && delta === 0;

    deltas.push({ category: name, before: beforeScore, max, after: afterScore, delta, issuesFixed, wastedEffort });
  }

  return deltas;
}

export interface EngineCallbacks {
  onClickStart?: (clickNumber: number, total: number, hardenPhase?: HardenPhase) => Promise<void> | void;
  onClickPhase?: (phase: ClickPhase, clickNumber: number) => Promise<void> | void;
  onClickComplete?: (click: Click, rolledBack: boolean) => Promise<void> | void;
  onRunComplete?: (run: RatchetRun) => Promise<void> | void;
  onError?: (err: Error, clickNumber: number) => Promise<void> | void;
  onScanComplete?: (scan: ScanResult) => Promise<void> | void;
  onClickScoreUpdate?: (clickNumber: number, scoreBefore: number, scoreAfter: number, delta: number) => Promise<void> | void;
  onEscalate?: (reason: string) => Promise<void> | void;
  onPlanStart?: () => Promise<void> | void;
  onPlanComplete?: (plan: PlanResult) => Promise<void> | void;
}

export interface EngineRunOptions {
  target: Target;
  clicks: number;
  config: RatchetConfig;
  cwd: string;
  agent: Agent;
  createBranch?: boolean;
  hardenMode?: boolean;
  adversarial?: boolean;
  sweep?: boolean;
  callbacks?: EngineCallbacks;
  /** If provided, skip the initial scan and use this result instead */
  scanResult?: ScanResult;
  /** If provided, record outcomes for cross-run learning */
  learningStore?: LearningStore;
  /** Use score-optimized prioritization instead of severity-based (default: false) */
  scoreOptimized?: boolean;
  /** Filter sweep to a specific issue category or subcategory (e.g. 'line-length', 'console-cleanup') */
  category?: string;
  /** Enable adaptive escalation to cross-file sweep on stall (default: true) */
  escalate?: boolean;
  /** Auto-escalate to architect mode when smart stop detects architect-only issues remain (default: true) */
  architectEscalation?: boolean;
  /** Offset added to click numbering (used when architect engine is called mid-run) */
  clickOffset?: number;
  /** Run a read-only planning click 0 before execution clicks (default: false) */
  planFirst?: boolean;
}

const TEST_FILE_PATTERNS = [
  /\.test\.[a-z]+$/i,
  /\.spec\.[a-z]+$/i,
  /^test_.*\.[a-z]+$/i,
  /.*_test\.[a-z]+$/i,
];

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache']);

function countTestFiles(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          count += countTestFiles(join(dir, entry.name));
        }
      } else if (TEST_FILE_PATTERNS.some((p) => p.test(entry.name))) {
        count++;
      }
    }
  } catch {
    // ignore permission errors
  }
  return count;
}

/**
 * Resolve click guards for a run.
 * Priority: config.guards (set by CLI) > target.guards > mode defaults.
 * Returns null for atomic (no limits).
 */
function resolveGuards(
  target: Target,
  config: RatchetConfig,
  mode: 'normal' | 'sweep' | 'architect',
): ClickGuards | null {
  // config.guards is set by CLI (highest priority)
  const source = config.guards ?? target.guards;
  if (source !== undefined) {
    if (typeof source === 'string') return GUARD_PROFILES[source];
    return source;
  }
  // Mode defaults
  if (mode === 'architect') return GUARD_PROFILES.broad;
  if (mode === 'sweep') return GUARD_PROFILES.refactor;
  return GUARD_PROFILES.tight;
}

/**
 * The Click Loop Engine.
 * Runs N clicks sequentially on a target, applying the Pawl (rollback on failure).
 *
 * Scan-driven: at the start, runs a scan to get the current score and build an issue backlog.
 * Each click is given specific issues to fix (compound click). After each successful click,
 * re-scans to measure progress and update the backlog.
 */
export async function runEngine(options: EngineRunOptions): Promise<RatchetRun> {
  const { clicks, config, cwd, agent, createBranch = true, hardenMode = false, adversarial = false, callbacks = {}, scanResult: providedScan, learningStore, scoreOptimized = false, escalate: escalateEnabled = true, architectEscalation: architectEscalationEnabled = true, planFirst = false } = options;
  let target = options.target;

  const run: RatchetRun = {
    id: randomUUID(),
    target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  // Guard: detached HEAD means the user checked out a commit hash or tag directly.
  // Ratchet can still run, but it's likely unintentional — emit a clear error.
  if (await git.isDetachedHead(cwd)) {
    throw new Error(
      'Git repository is in detached HEAD state.\n' +
        '  Ratchet requires a named branch to track changes safely.\n' +
        '  Fix: git checkout -b my-branch',
    );
  }

  // Create a ratchet branch
  if (createBranch) {
    const branch = git.branchName(target.name);
    await git.createBranch(branch, cwd);
  }

  // --- Scan-driven: get initial scan and build issue backlog ---
  let currentScan: ScanResult | undefined = providedScan;
  let backlogGroups: IssueTask[][] = [];
  let previousTotal = 0;

  if (!currentScan) {
    try {
      currentScan = await runScan(cwd);
    } catch {
      // Non-fatal — fall back to blind-click mode
    }
  }

  // Clear GitNexus cache at the start of each run for fresh data
  clearGitNexusCache();

  // Incremental scanner — used for re-scans after each successful click
  const incrementalScanner = new IncrementalScanner(cwd);

  if (currentScan) {
    await callbacks.onScanComplete?.(currentScan);
    previousTotal = currentScan.total;
    const backlog = scoreOptimized
      ? buildScoreOptimizedBacklog(currentScan)
      : buildBacklog(currentScan);
    // Enrich backlog with blast-radius risk scores from GitNexus
    enrichBacklogWithRisk(backlog, cwd);
    backlogGroups = groupBacklogBySubcategory(backlog);
  }

  // Harden mode: track initial test file count to detect when tests are written
  let initialTestFileCount = 0;
  let phaseTransitioned = false;

  if (hardenMode) {
    initialTestFileCount = countTestFiles(cwd);
  }

  // Stall detection for adaptive escalation
  let consecutiveRollbacks = 0;
  let totalLanded = 0;
  let totalRolled = 0;
  let scoreAtMidpoint: number | undefined;
  let escalated = false;

  // --- Plan-first: click 0 — read-only planning before execution clicks ---
  if (planFirst) {
    await callbacks.onPlanStart?.();
    try {
      const scanSummary = currentScan
        ? `Score: ${currentScan.total}/${currentScan.maxTotal}, ${currentScan.totalIssuesFound} issues found`
        : '';
      const planPrompt = buildPlanPrompt(scanSummary, target.path, target.description);
      const agentWithDirect = agent as { runDirect?: (p: string, cwd: string) => Promise<string> };
      const planOutput = agentWithDirect.runDirect
        ? await agentWithDirect.runDirect(planPrompt, cwd)
        : '';

      if (planOutput) {
        // Extract JSON from agent output (may be wrapped in markdown code fences)
        const jsonMatch = planOutput.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Omit<PlanResult, 'generatedAt'>;
          const planResult: PlanResult = { ...parsed, generatedAt: new Date() };
          run.planResult = planResult;

          // Save plan to .ratchet/plans/<timestamp>-<target>.json
          const plansDir = join(cwd, '.ratchet', 'plans');
          await mkdir(plansDir, { recursive: true });
          const planFileName = `${Date.now()}-${target.name}.json`;
          await writeFile(join(plansDir, planFileName), JSON.stringify(planResult, null, 2), 'utf-8');

          await callbacks.onPlanComplete?.(planResult);
        }
      }
    } catch {
      // Non-fatal — if plan generation fails, continue without plan
      console.error('[ratchet] Plan generation failed — continuing without plan');
    }
  }

  try {
    for (let i = 1; i <= clicks; i++) {
      // Determine harden phase for this click
      let hardenPhase: HardenPhase | undefined;
      if (hardenMode) {
        if (!phaseTransitioned && i <= 3) {
          hardenPhase = 'harden:tests';
        } else {
          hardenPhase = 'improve';
        }
      }

      await callbacks.onClickStart?.(i, clicks, hardenPhase);

      // Pop the next group of issues from the backlog
      // In harden mode, don't use backlog (focus on test writing)
      let clickIssues: IssueTask[] | undefined;
      if (!hardenMode && backlogGroups.length > 0) {
        clickIssues = backlogGroups.shift();
      }

      try {
        const clickStartMs = Date.now();

        let click: Click;
        let rolled_back: boolean;

        if (config.swarm?.enabled) {
          // Swarm mode: run N agents in parallel worktrees, pick best
          const swarm = new SwarmExecutor(config.swarm, learningStore ?? options.learningStore);
          const clickCtx = {
            clickNumber: i,
            target,
            config,
            agent,
            cwd,
            hardenPhase,
            resolvedGuards: resolveGuards(target, config, escalated ? 'sweep' : 'normal'),
            issues: clickIssues,
            planContext: run.planResult ? JSON.stringify(run.planResult, null, 2) : undefined,
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, i)
              : undefined,
          };
          const swarmResult = await swarm.execute(clickCtx, cwd);

          if (swarmResult.winner) {
            click = swarmResult.winner.click;
            rolled_back = swarmResult.winner.rolled_back;
            // Attach winning specialization metadata
            const winnerAgent = swarmResult.allResults.find(
              r => !r.outcome.rolled_back && r.outcome.click.testsPassed,
            );
            if (winnerAgent) {
              click.swarmSpecialization = winnerAgent.specialization;
            }
          } else {
            // All agents failed — create a dummy failed click
            click = {
              number: i,
              target: target.name,
              analysis: '',
              proposal: 'swarm: all agents failed',
              filesModified: [],
              testsPassed: false,
              timestamp: new Date(),
            };
            rolled_back = true;
          }
        } else {
          // Normal single-agent mode
          const result = await executeClick({
            clickNumber: i,
            target,
            config,
            agent,
            cwd,
            hardenPhase,
            adversarial,
            sweepMode: escalated,
            resolvedGuards: resolveGuards(target, config, escalated ? 'sweep' : 'normal'),
            issues: clickIssues,
            planContext: run.planResult ? JSON.stringify(run.planResult, null, 2) : undefined,
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, i)
              : undefined,
          });

          // Risk gate escalation: if single-agent was blocked, retry with swarm
          if (result.requiresSwarm) {
            console.error(`[ratchet] Escalating click ${i} to swarm mode (risk gate triggered)`);
            const swarm = new SwarmExecutor({ agentCount: 3, parallel: true }, learningStore);
            const swarmResult = await swarm.execute({
              clickNumber: i, target, config, agent, cwd, hardenPhase,
              issues: clickIssues,
              planContext: run.planResult ? JSON.stringify(run.planResult, null, 2) : undefined,
              onPhase: callbacks.onClickPhase
                ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, i)
                : undefined,
            }, cwd);

            if (swarmResult.winner) {
              click = swarmResult.winner.click;
              rolled_back = swarmResult.winner.rolled_back;
              click.riskScore = result.click.riskScore;
            } else {
              click = result.click;
              rolled_back = true;
            }
          } else {
            click = result.click;
            rolled_back = result.rolled_back;
          }
        }

        const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);

        const prevConsecutiveRollbacks = consecutiveRollbacks;
        if (rolled_back) {
          console.error(`[ratchet] click ${i} ROLLED BACK (${elapsedSec}s) — tests failed or build errored`);
          consecutiveRollbacks++;
          totalRolled++;
        } else {
          console.error(`[ratchet] click ${i} LANDED (${elapsedSec}s)${click.commitHash ? ` — commit ${click.commitHash.slice(0, 7)}` : ''}`);
          consecutiveRollbacks = 0;
          totalLanded++;
        }

        // After a successful click, re-scan for live scoring (incremental for speed)
        if (click.testsPassed && !rolled_back && currentScan) {
          try {
            const newScan = await incrementalScanner.incrementalScan(currentScan);
            const newTotal = newScan.total;
            const delta = newTotal - previousTotal;

            // Score regression guard: if score dropped, revert the commit
            if (newTotal < previousTotal && click.commitHash) {
              const regressionDelta = previousTotal - newTotal;
              console.error(`[ratchet] click ${i} ROLLED BACK — score regression: ${previousTotal} → ${newTotal} (-${regressionDelta}pts)`);
              await git.revertLastCommit(cwd).catch(() => {});
              click.testsPassed = false;
              click.rollbackReason = `score regression: ${previousTotal} → ${newTotal} (-${regressionDelta}pts)`;
              click.commitHash = undefined;
              rolled_back = true;
              // Restore consecutive count from before the "landed" reset, then add this one
              consecutiveRollbacks = prevConsecutiveRollbacks + 1;
              totalLanded--;
              totalRolled++;
            } else {
              // Count how many issues were resolved
              const prevIssueCount = currentScan.totalIssuesFound;
              const newIssueCount = newScan.totalIssuesFound;
              const issuesFixedCount = Math.max(0, prevIssueCount - newIssueCount);

              click.scoreAfterClick = newTotal;
              click.issuesFixedCount = issuesFixedCount;

              // Compute and attach per-category breakdown
              const categoryDeltas = diffCategories(currentScan, newScan);
              click.categoryDeltas = categoryDeltas;

              // Print per-category breakdown for non-zero or wasted-effort categories
              for (const cd of categoryDeltas) {
                if (cd.delta !== 0) {
                  const sign = cd.delta > 0 ? '+' : '';
                  console.error(`   ${cd.category}: ${cd.before}/${cd.max} → ${cd.after}/${cd.max} (${sign}${cd.delta})${cd.issuesFixed > 0 ? ` — ${cd.issuesFixed} issues fixed` : ''}`);
                } else if (cd.wastedEffort) {
                  console.error(`   ⚠ ${cd.category}: ${cd.before}/${cd.max} → ${cd.after}/${cd.max} — ${cd.issuesFixed} issues fixed but category already maxed`);
                }
              }

              await callbacks.onClickScoreUpdate?.(i, previousTotal, newTotal, delta);

              // Update backlog from fresh scan
              previousTotal = newTotal;
              currentScan = newScan;
              const newBacklog = scoreOptimized
                ? buildScoreOptimizedBacklog(newScan)
                : buildBacklog(newScan);
              backlogGroups = groupBacklogBySubcategory(newBacklog);
            }
          } catch {
            // Non-fatal — skip live scoring for this click
          }
        }

        // Capture midpoint score for stall detection
        if (i === Math.floor(clicks / 2) && scoreAtMidpoint === undefined) {
          scoreAtMidpoint = previousTotal;
        }

        // Adaptive escalation: switch to cross-file sweep when stalled
        if (escalateEnabled && !escalated && !hardenMode && currentScan) {
          const rollbackRate = i > 0 ? totalRolled / i : 0;
          const scoreDelta = scoreAtMidpoint !== undefined ? previousTotal - scoreAtMidpoint : undefined;
          const backlogExhausted = backlogGroups.length === 0;

          let escalateReason: string | undefined;
          if (consecutiveRollbacks >= 3) {
            escalateReason = '3 consecutive rollbacks';
          } else if (i >= Math.floor(clicks / 2) && scoreDelta === 0 && rollbackRate > 0.4) {
            escalateReason = 'no score progress at midpoint';
          } else if (backlogExhausted && i < clicks) {
            escalateReason = 'backlog exhausted';
          }

          if (escalateReason) {
            console.error('[ratchet] 🔄 Stall detected — escalating to cross-file sweep mode');
            await callbacks.onEscalate?.(escalateReason);

            const fullBacklog = buildScoreOptimizedBacklog(currentScan);
            const sweepableBacklog = fullBacklog.filter((task) => !task.architectPrompt);
            if (sweepableBacklog.length > 0) {
              backlogGroups = groupBacklogBySubcategory(sweepableBacklog);
              target = { name: 'sweep', path: '.', description: 'auto-escalated cross-file sweep' };
              escalated = true;
            }
          }
        }

        run.clicks.push(click);
        await callbacks.onClickComplete?.(click, rolled_back);

        // Smart early stop: if stalled with only architect-mode issues remaining
        if (consecutiveRollbacks >= 2 && totalLanded > 0 && backlogGroups.length > 0) {
          const allArchitect = backlogGroups.every(group => group.every(task => !!task.architectPrompt));
          if (allArchitect) {
            const remainingClicks = clicks - i;
            if (architectEscalationEnabled && remainingClicks > 0) {
              console.error(`[ratchet] 🏗️ Escalating to architect mode — ${remainingClicks} clicks remaining`);
              const architectRun = await runArchitectEngine({
                ...options,
                clicks: remainingClicks,
                createBranch: false,
                scanResult: currentScan,
                clickOffset: i,
              });
              run.clicks.push(...architectRun.clicks);
              run.architectEscalated = true;
            } else {
              run.earlyStopReason = 'remaining issues need architect mode';
              console.error(`[ratchet] ⏹ Smart stop — remaining issues need architect mode. ${totalLanded} cycles used, ${clicks - i} returned.`);
            }
            break;
          }
        }

        // Practical smart stop: sweepable items that keep rolling back are effectively unsweepable
        if (!run.earlyStopReason && consecutiveRollbacks >= 3 && totalLanded > 0) {
          const totalAttempted = totalLanded + totalRolled;
          const rollbackRate = totalAttempted > 0 ? totalRolled / totalAttempted : 0;
          if (rollbackRate > 0.6) {
            const ratePct = Math.round(rollbackRate * 100);
            run.earlyStopReason = `high rollback rate (${ratePct}%) — remaining issues may need manual intervention`;
            console.error(`[ratchet] ⏹ Smart stop — ${run.earlyStopReason}. ${totalLanded} cycles used, ${clicks - i} returned.`);
            break;
          }
        }

        // Cross-run learning: record the outcome for future recommendations
        if (learningStore && clickIssues && clickIssues.length > 0) {
          const elapsedMs = Date.now() - clickStartMs;
          const scoreDelta = click.scoreAfterClick != null ? click.scoreAfterClick - previousTotal : 0;
          const specName = config.swarm?.enabled
            ? (config.swarm.specializations?.[0] ?? 'default')
            : 'default';
          await Promise.all(
            clickIssues.flatMap((issue) =>
              (issue.sweepFiles ?? click.filesModified).map((file) =>
                learningStore.recordOutcome({
                  issueType: issue.subcategory || issue.category,
                  filePath: file,
                  specialization: specName,
                  success: click.testsPassed && !rolled_back,
                  fixTimeMs: elapsedMs,
                  scoreDelta,
                  failureReason: rolled_back ? 'click rolled back' : undefined,
                }).catch(() => {
                  // Non-fatal — don't let learning failures break the engine
                }),
              ),
            ),
          );
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        await callbacks.onError?.(error, i);
        // Continue with next click rather than aborting the whole run
      }

      // Harden mode: check after click 2 whether test files appeared.
      // If yes, transition to improve phase. After click 3, always transition.
      if (hardenMode && !phaseTransitioned) {
        if (i === 2) {
          const currentCount = countTestFiles(cwd);
          if (currentCount > initialTestFileCount) {
            phaseTransitioned = true;
          }
        } else if (i === 3) {
          // Force transition after 3rd test-writing click regardless of outcome
          phaseTransitioned = true;
        }
      }
    }

    run.status = 'completed';

    // Diagnostic: if every click rolled back, surface a hint
    if (run.clicks.length > 0 && run.clicks.every((c) => !c.testsPassed)) {
      console.error(
        '[ratchet] All clicks rolled back. Possible causes:\n' +
        '  • Tests are failing before ratchet starts — run the test command manually to check\n' +
        '  • The agent is not making changes (check build output above)\n' +
        '  • Test suite is flaky or has a long timeout — check test output for details',
      );
    }
  } catch (err: unknown) {
    run.status = 'failed';
    throw err;
  } finally {
    run.finishedAt = new Date();
    await callbacks.onRunComplete?.(run);
  }

  return run;
}

/**
 * Architect engine: make high-leverage structural improvements that eliminate many issues at once.
 * Unlike sweep (one issue type, many files) or normal (surgical per-file), architect mode
 * targets cross-cutting concerns — extracting shared modules, consolidating duplicated logic,
 * splitting god files — with relaxed guards (up to 20 files / 500 lines per click).
 *
 * Re-scans after each successful click to measure impact and refresh the prompt.
 */
export async function runArchitectEngine(options: EngineRunOptions): Promise<RatchetRun> {
  const { clicks, config, cwd, agent, callbacks = {}, createBranch = true, learningStore } = options;

  const run: RatchetRun = {
    id: randomUUID(),
    target: options.target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  try {
    // 1. Create branch (if requested)
    if (createBranch) {
      if (await git.isDetachedHead(cwd)) {
        throw new Error('Git repository is in detached HEAD state. Ratchet requires a named branch.');
      }
      const branch = git.branchName(options.target.name + '-architect');
      await git.createBranch(branch, cwd);
    }

    // 2. Run scan (or use provided)
    const scanResult = options.scanResult ?? await runScan(cwd);
    await callbacks.onScanComplete?.(scanResult);

    // Clear GitNexus cache for fresh data
    clearGitNexusCache();

    let currentScan = scanResult;
    let previousTotal = scanResult.total;
    let architectPrompt = buildArchitectPrompt(currentScan, cwd);

    const clickOffset = options.clickOffset ?? 0;

    for (let i = 1; i <= clicks; i++) {
      const clickNumber = i + clickOffset;
      await callbacks.onClickStart?.(clickNumber, clicks + clickOffset);

      // Synthetic architect task — carries the pre-built prompt verbatim
      const architectTask: IssueTask = {
        category: 'architecture',
        subcategory: 'structural',
        description: 'High-leverage architectural refactoring',
        count: currentScan.totalIssuesFound,
        severity: 'high',
        priority: 100,
        architectPrompt,
      };

      try {
        const clickStartMs = Date.now();

        const result = await executeClick({
          clickNumber,
          target: options.target,
          config,
          agent,
          cwd,
          architectMode: true,
          resolvedGuards: resolveGuards(options.target, config, 'architect'),
          adversarial: options.adversarial,
          issues: [architectTask],
          onPhase: callbacks.onClickPhase
            ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, clickNumber)
            : undefined,
        });

        const { click } = result;
        let rolled_back = result.rolled_back;
        const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);

        if (rolled_back) {
          console.error(`[ratchet] architect click ${clickNumber} ROLLED BACK (${elapsedSec}s)`);
        } else {
          console.error(`[ratchet] architect click ${clickNumber} LANDED (${elapsedSec}s)${click.commitHash ? ` — commit ${click.commitHash.slice(0, 7)}` : ''}`);
        }

        // Re-scan after successful click to measure impact and refresh the prompt
        if (click.testsPassed && !rolled_back) {
          try {
            const newScan = await runScan(cwd);
            const newTotal = newScan.total;

            // Score regression guard: if score dropped, revert the commit
            if (newTotal < previousTotal && click.commitHash) {
              const regressionDelta = previousTotal - newTotal;
              console.error(`[ratchet] architect click ${clickNumber} ROLLED BACK — score regression: ${previousTotal} → ${newTotal} (-${regressionDelta}pts)`);
              await git.revertLastCommit(cwd).catch(() => {});
              click.testsPassed = false;
              click.rollbackReason = `score regression: ${previousTotal} → ${newTotal} (-${regressionDelta}pts)`;
              click.commitHash = undefined;
              rolled_back = true;
            } else {
              const delta = newTotal - previousTotal;
              click.scoreAfterClick = newTotal;
              click.issuesFixedCount = Math.max(0, currentScan.totalIssuesFound - newScan.totalIssuesFound);
              await callbacks.onClickScoreUpdate?.(clickNumber, previousTotal, newTotal, delta);
              previousTotal = newTotal;
              currentScan = newScan;
              // Rebuild prompt with fresh scan data for the next click
              architectPrompt = buildArchitectPrompt(currentScan, cwd);
            }
          } catch {
            // Non-fatal
          }
        }

        run.clicks.push(click);
        await callbacks.onClickComplete?.(click, rolled_back);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        await callbacks.onError?.(error, clickNumber);
      }
    }

    run.status = 'completed';
  } catch (err: unknown) {
    run.status = 'failed';
    throw err;
  } finally {
    run.finishedAt = new Date();
    await callbacks.onRunComplete?.(run);
  }

  return run;
}

export function summarizeRun(run: RatchetRun): RunSummary {
  const passed = run.clicks.filter((c) => c.testsPassed).length;
  const failed = run.clicks.filter((c) => !c.testsPassed).length;
  const duration = run.finishedAt
    ? run.finishedAt.getTime() - run.startedAt.getTime()
    : 0;

  return {
    id: run.id,
    target: run.target.name,
    totalClicks: run.clicks.length,
    passed,
    failed,
    commits: run.clicks.filter((c) => c.commitHash).map((c) => c.commitHash!),
    duration,
    status: run.status,
  };
}

export interface RunSummary {
  id: string;
  target: string;
  totalClicks: number;
  passed: number;
  failed: number;
  commits: string[];
  duration: number;
  status: RatchetRun['status'];
}

/**
 * Split an array into chunks of a given size.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Sweep engine: fix one issue type across the entire codebase in batches.
 * Finds the highest-priority sweepable issue and runs clicks against each batch of files.
 */
export async function runSweepEngine(options: EngineRunOptions): Promise<RatchetRun> {
  const { clicks, config, cwd, agent, callbacks = {}, createBranch = true, learningStore } = options;

  const run: RatchetRun = {
    id: randomUUID(),
    target: options.target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  try {
    // Create branch only if requested (when combined with architect phase, branch already exists)
    if (createBranch) {
      if (await git.isDetachedHead(cwd)) {
        throw new Error('Git repository is in detached HEAD state. Ratchet requires a named branch.');
      }
      const branch = git.branchName(options.target.name);
      await git.createBranch(branch, cwd);
    }

    // 1. Run scan
    const scanResult = options.scanResult ?? await runScan(cwd);
    await callbacks.onScanComplete?.(scanResult);

    // Clear GitNexus cache for fresh data
    clearGitNexusCache();

    // 2. Build backlog and enrich with risk scores.
    // Sweep always uses score-optimized ordering to pick the highest-ROI subcategory first.
    const backlog = buildScoreOptimizedBacklog(scanResult);
    enrichBacklogWithRisk(backlog, cwd);

    // 3. Filter to sweepable tasks, then optionally narrow by --category
    let sweepable = backlog.filter(t => t.sweepFiles && t.sweepFiles.length > 0);

    if (options.category) {
      const cat = options.category.toLowerCase();
      const filtered = sweepable.filter(
        t => t.subcategory?.toLowerCase() === cat || t.category?.toLowerCase() === cat,
      );
      if (filtered.length > 0) {
        sweepable = filtered;
      } else {
        console.error(`[ratchet] --category "${options.category}" matched no sweepable issues — running without category filter`);
      }
    }

    if (sweepable.length === 0) {
      console.error('[ratchet] No sweepable issues found');
      run.status = 'completed';
      run.finishedAt = new Date();
      await callbacks.onRunComplete?.(run);
      return run;
    }

    // 4. Take top priority sweepable task
    const task = sweepable[0]!;
    console.error(`[ratchet] Sweep target: ${task.description} (${task.sweepFiles!.length} files)`);

    // 5. Group files by dependency cluster (tightly-coupled files together),
    // falling back to plain chunking if GitNexus is not available
    const batches = groupByDependencyCluster(task.sweepFiles!, cwd, 6);
    const clicksToRun = Math.min(clicks, batches.length);

    for (let i = 0; i < clicksToRun; i++) {
      const clickNumber = i + 1;
      const batch = batches[i]!;

      await callbacks.onClickStart?.(clickNumber, clicksToRun);

      // Create a modified task with only the current batch of files
      const batchTask = { ...task, sweepFiles: batch };

      try {
        const clickStartMs = Date.now();

        let click: Click;
        let rolled_back: boolean;

        if (config.swarm?.enabled) {
          // Swarm mode: run N agents in parallel worktrees, pick best
          const swarm = new SwarmExecutor(config.swarm, learningStore ?? options.learningStore);
          const clickCtx = {
            clickNumber,
            target: options.target,
            config,
            agent,
            cwd,
            sweepMode: true,
            resolvedGuards: resolveGuards(options.target, config, 'sweep'),
            issues: [batchTask],
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, clickNumber)
              : undefined,
          };
          const swarmResult = await swarm.execute(clickCtx, cwd);

          if (swarmResult.winner) {
            click = swarmResult.winner.click;
            rolled_back = swarmResult.winner.rolled_back;
            // Attach winning specialization metadata
            const winnerAgent = swarmResult.allResults.find(
              r => !r.outcome.rolled_back && r.outcome.click.testsPassed,
            );
            if (winnerAgent) {
              click.swarmSpecialization = winnerAgent.specialization;
            }
          } else {
            click = {
              number: clickNumber,
              target: options.target.name,
              analysis: '',
              proposal: 'swarm: all agents failed',
              filesModified: [],
              testsPassed: false,
              timestamp: new Date(),
            };
            rolled_back = true;
          }
        } else {
          // Normal single-agent mode
          const result = await executeClick({
            clickNumber,
            target: options.target,
            config,
            agent,
            cwd,
            sweepMode: true,
            resolvedGuards: resolveGuards(options.target, config, 'sweep'),
            adversarial: options.adversarial,
            issues: [batchTask],
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, clickNumber)
              : undefined,
          });
          click = result.click;
          rolled_back = result.rolled_back;
        }

        const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);
        if (rolled_back) {
          console.error(`[ratchet] sweep click ${clickNumber} ROLLED BACK (${elapsedSec}s)`);
        } else {
          console.error(`[ratchet] sweep click ${clickNumber} LANDED (${elapsedSec}s)`);
        }

        run.clicks.push(click);
        await callbacks.onClickComplete?.(click, rolled_back);

        // Cross-run learning: record sweep outcome
        if (options.learningStore) {
          const elapsedMs = Date.now() - clickStartMs;
          const specName = click.swarmSpecialization ?? 'default';
          await Promise.all(
            batch.map((file) =>
              options.learningStore!.recordOutcome({
                issueType: task.subcategory || task.category,
                filePath: file,
                specialization: specName,
                success: click.testsPassed && !rolled_back,
                fixTimeMs: elapsedMs,
                scoreDelta: 0,
                failureReason: rolled_back ? 'sweep click rolled back' : undefined,
              }).catch(() => {
                // Non-fatal
              }),
            ),
          );
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        await callbacks.onError?.(error, clickNumber);
      }
    }

    run.status = 'completed';
  } catch (err: unknown) {
    run.status = 'failed';
    throw err;
  } finally {
    run.finishedAt = new Date();
    await callbacks.onRunComplete?.(run);
  }

  return run;
}
