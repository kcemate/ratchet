import { randomUUID } from 'crypto';
import { join, isAbsolute, resolve } from 'path';
import type {
  RatchetRun, Target, RatchetConfig, Click, HardenPhase, CategoryDelta, ClickEconomics, ClickGuards,
} from '../types.js';
import { loadStrategy, initStrategy, evolveStrategy, buildStrategyContext } from './strategy.js';
import type { ShellAgent } from './agents/shell.js';
import type { Agent } from './agents/base.js';
import type { IssueTask } from './issue-backlog.js';
import {
  buildBacklog, groupBacklogBySubcategory, enrichBacklogWithRisk, groupByDependencyCluster,
} from './issue-backlog.js';
import { buildScoreOptimizedBacklog } from './score-optimizer.js';
import { executeClick } from './click.js';
import { SwarmExecutor } from './swarm.js';
import * as git from './git.js';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';
import type { LearningStore } from './learning.js';
import { clearCache as clearGitNexusCache, detectChanges, reindex } from './gitnexus.js';
import type { HighRiskChange } from '../types.js';
import { IncrementalScanner } from './scan-cache.js';
import { resolveGuards, nextGuardProfile, isGuardRejection } from './engine-guards.js';
import { validateScope } from './scope.js';
import { captureBaseline } from './test-isolation.js';
import { runPlanFirst } from './engine-plan.js';
import { runArchitectEngine } from './engine-architect.js';
import { countTestFiles } from './detect.js';
import { logger } from '../lib/logger.js';

// Re-export public API from sub-modules
export { nextGuardProfile, isGuardRejection } from './engine-guards.js';
export { runArchitectEngine } from './engine-architect.js';
export { runSweepEngine, chunk } from './engine-sweep.js';

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

export interface RunEconomics {
  totalWallTimeMs: number;
  /** Sum of wall time for landed clicks only */
  effectiveTimeMs: number;
  /** Sum of wall time for rolled-back clicks */
  wastedTimeMs: number;
  /** effectiveTimeMs / totalWallTimeMs (0–1) */
  efficiency: number;
  totalCost: number;
  landed: number;
  rolledBack: number;
  timedOut: number;
  rollbackRate: number;
  timeoutRate: number;
  scoreDelta: number;
  issuesFixed: number;
  clicks: ClickEconomics[];
  recommendations: string[];
}

/** Generate strategy recommendations from per-click economics. */
export function generateRecommendations(clicks: ClickEconomics[]): string[] {
  if (clicks.length === 0) return [];
  const total = clicks.length;
  const rolledBack = clicks.filter(c => c.outcome !== 'landed').length;
  const timedOut = clicks.filter(c => c.outcome === 'timeout').length;
  const rollbackRate = rolledBack / total;
  const timeoutRate = timedOut / total;
  const scoreDelta = clicks.reduce((sum, c) => sum + c.scoreDelta, 0);

  const recs: string[] = [];

  if (rollbackRate > 0.30) {
    recs.push(`${rolledBack}/${total} clicks rolled back — consider --plan-first to reduce wasted iterations`);
  }
  if (timeoutRate > 0.15) {
    recs.push(`${timedOut} timeout(s) detected — consider --timeout 900 for complex refactors`);
  }
  if (scoreDelta === 0 && total > 0) {
    recs.push('Score delta is zero — consider --architect --guards refactor for structural improvements');
  }

  return recs;
}

/** Aggregate per-click economics into a run-level summary. */
export function computeRunEconomics(clicks: ClickEconomics[], totalWallTimeMs: number): RunEconomics {
  const landed = clicks.filter(c => c.outcome === 'landed');
  const rolledBack = clicks.filter(c => c.outcome !== 'landed');
  const timedOut = clicks.filter(c => c.outcome === 'timeout');

  const effectiveTimeMs = landed.reduce((sum, c) => sum + c.wallTimeMs, 0);
  const wastedTimeMs = rolledBack.reduce((sum, c) => sum + c.wallTimeMs, 0);
  const efficiency = totalWallTimeMs > 0 ? effectiveTimeMs / totalWallTimeMs : 0;
  const totalCost = clicks.reduce((sum, c) => sum + c.estimatedCost, 0);
  const scoreDelta = clicks.reduce((sum, c) => sum + c.scoreDelta, 0);
  const issuesFixed = clicks.reduce((sum, c) => sum + c.issuesFixed, 0);
  const total = clicks.length;

  return {
    totalWallTimeMs,
    effectiveTimeMs,
    wastedTimeMs,
    efficiency,
    totalCost,
    landed: landed.length,
    rolledBack: rolledBack.length,
    timedOut: timedOut.length,
    rollbackRate: total > 0 ? rolledBack.length / total : 0,
    timeoutRate: total > 0 ? timedOut.length / total : 0,
    scoreDelta,
    issuesFixed,
    clicks,
    recommendations: generateRecommendations(clicks),
  };
}

export interface EngineCallbacks {
  onClickStart?: (clickNumber: number, total: number, hardenPhase?: HardenPhase) => Promise<void> | void;
  onClickPhase?: (phase: ClickPhase, clickNumber: number) => Promise<void> | void;
  onClickComplete?: (click: Click, rolledBack: boolean) => Promise<void> | void;
  onRunComplete?: (run: RatchetRun) => Promise<void> | void;
  onError?: (err: Error, clickNumber: number) => Promise<void> | void;
  onScanComplete?: (scan: ScanResult) => Promise<void> | void;
  onClickScoreUpdate?: (
    clickNumber: number, scoreBefore: number, scoreAfter: number, delta: number,
  ) => Promise<void> | void;
  onEscalate?: (reason: string) => Promise<void> | void;
  onPlanStart?: () => Promise<void> | void;
  onPlanComplete?: (plan: import('../types.js').PlanResult) => Promise<void> | void;
  onRunEconomics?: (economics: RunEconomics) => Promise<void> | void;
  /** Fires immediately after the run object is created, before any clicks run. */
  onRunInit?: (run: RatchetRun) => void;
  /** Fires after each successfully landed click (tests passed, committed). */
  onCheckpoint?: (run: RatchetRun) => Promise<void> | void;
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
  /** Auto-bump guard profile after consecutive guard-rejection rollbacks (default: true) */
  guardEscalation?: boolean;
  /** Offset added to click numbering (used when architect engine is called mid-run) */
  clickOffset?: number;
  /** Run a read-only planning click 0 before execution clicks (default: false) */
  planFirst?: boolean;
  /** Resolved scope file paths (absolute). When provided, clicks touching files outside this list are rolled back. */
  scope?: string[];
  /** Raw --scope argument for display purposes. */
  scopeArg?: string;
  /** Enable context pruning — inject focused issue context into agent prompts for faster clicks */
  contextPruning?: boolean;
  /** Stop the run if wall time exceeds this many milliseconds (checked between clicks). */
  timeoutMs?: number;
  /** Stop the run before the next click if cumulative estimated cost >= this value (USD). */
  budgetUsd?: number;
  /** Stop immediately when a score regression is detected (the regressing click is still rolled back). */
  stopOnRegression?: boolean;
  /** If true, skip loading and evolving strategy for this run */
  noStrategy?: boolean;
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

// ── Run state

/** Mutable state threaded through per-click helpers. */
interface RunState {
  currentScan: ScanResult | undefined;
  backlogGroups: IssueTask[][];
  previousTotal: number;
  consecutiveRollbacks: number;
  /** Snapshot of consecutiveRollbacks taken before processClickOutcome; used by postClickRescan. */
  prevConsecutiveRollbacks: number;
  consecutiveGuardRejections: number;
  totalLanded: number;
  totalRolled: number;
  scoreAtMidpoint: number | undefined;
  escalated: boolean;
  currentGuards: ClickGuards;
  currentGuardProfileName: string;
  allEconomics: ClickEconomics[];
  target: Target;
  /** Tracks consecutive clicks with zero score delta for plateau detection. */
  consecutiveZeroDeltaClicks: number;
  /** Running total of estimated cost across all clicks (USD). */
  cumulativeCost: number;
}

// ── Helpers

/**
 * Format a consistent rollback message for logger.error output.
 */
function formatRollbackMessage(
  clickNumber: number,
  reason: string | undefined,
  elapsedSec?: string,
  detail?: string,
): string {
  const timeStr = elapsedSec ? ` (${elapsedSec}s)` : '';
  const reasonStr = reason ? ` — ${reason}` : ' — tests failed or build errored';
  const detailStr = detail ? `\n  ${detail}` : '';
  return `[ratchet] click ${clickNumber} ROLLED BACK${timeStr}${reasonStr}${detailStr}`;
}

/**
 * Initialize a run: create RatchetRun, check detached HEAD, create branch,
 * run initial scan, build backlog, and capture baseline failures.
 */
async function initializeRun(options: EngineRunOptions): Promise<{
  run: RatchetRun;
  state: RunState;
  incrementalScanner: IncrementalScanner;
  baselineFailures: string[];
}> {
  const { config, cwd, createBranch = true, scoreOptimized = true, scope: scopeFiles = [], scopeArg } = options;
  const callbacks = options.callbacks ?? {};

  const run: RatchetRun = {
    id: randomUUID(),
    target: options.target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
    ...(scopeFiles.length > 0 && { scope: scopeFiles, scopeArg }),
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
    const branch = git.branchName(options.target.name);
    await git.createBranch(branch, cwd);
  }

  // --- Scan-driven: get initial scan and build issue backlog ---
  let currentScan: ScanResult | undefined = options.scanResult;
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

  // Smart guard escalation: mutable guards that can be bumped mid-run
  const currentGuards = resolveGuards(options.target, config, 'normal');
  const currentGuardProfileName: string = (() => {
    const source = config.guards ?? options.target.guards;
    if (typeof source === 'string') return source;
    return 'tight';
  })();

  // --- Baseline test capture: record pre-existing failures to exempt them from rollback ---
  let baselineFailures: string[] = [];
  if (config.defaults.baselineTests) {
    try {
      const baseline = await captureBaseline(config.defaults.testCommand, cwd);
      baselineFailures = baseline.failedTests;
    } catch {
      // Non-fatal — proceed without baseline
    }
  }

  const state: RunState = {
    currentScan,
    backlogGroups,
    previousTotal,
    consecutiveRollbacks: 0,
    prevConsecutiveRollbacks: 0,
    consecutiveGuardRejections: 0,
    totalLanded: 0,
    totalRolled: 0,
    scoreAtMidpoint: undefined,
    escalated: false,
    currentGuards,
    currentGuardProfileName,
    allEconomics: [],
    target: options.target,
    consecutiveZeroDeltaClicks: 0,
    cumulativeCost: 0,
  };

  return { run, state, incrementalScanner, baselineFailures };
}

/**
 * Handle the outcome of a click: log the result, update consecutive counters,
 * and trigger guard escalation if needed. Mutates state in place.
 */
async function processClickOutcome(
  clickNumber: number,
  click: Click,
  rolled_back: boolean,
  elapsedSec: string,
  state: RunState,
  guardEscalationEnabled: boolean,
  callbacks: EngineCallbacks,
): Promise<void> {
  state.prevConsecutiveRollbacks = state.consecutiveRollbacks;

  if (rolled_back) {
    logger.error(
      { clickNumber, elapsedSec, reason: click.rollbackReason },
      formatRollbackMessage(clickNumber, click.rollbackReason, elapsedSec),
    );
    state.consecutiveRollbacks++;
    state.totalRolled++;

    // Track guard-rejection rollbacks separately for smart guard escalation
    if (isGuardRejection(click.rollbackReason)) {
      state.consecutiveGuardRejections++;
    } else {
      state.consecutiveGuardRejections = 0;
    }

    // Smart guard escalation: auto-bump to next profile after 2+ guard rejections
    if (guardEscalationEnabled && !state.escalated && state.consecutiveGuardRejections >= 2) {
      const next = nextGuardProfile(state.currentGuards);
      if (next) {
        const prevName = state.currentGuardProfileName;
        state.currentGuards = next.guards;
        state.currentGuardProfileName = next.name;
        state.consecutiveGuardRejections = 0;
        logger.info({ from: prevName, to: next.name }, 'Guard escalation');
        await callbacks.onEscalate?.(`guard escalation: ${prevName} → ${next.name}`);
      }
    }
  } else {
    logger.info({ clickNumber, elapsedSec, commitHash: click.commitHash?.slice(0, 7) }, 'click LANDED');
    state.consecutiveRollbacks = 0;
    state.consecutiveGuardRejections = 0;
    state.totalLanded++;
  }
}

/**
 * Re-scan after a successful click, detect score regression, compute category deltas,
 * and update the backlog. Returns the (possibly updated) rolled_back flag.
 */
async function postClickRescan(
  clickNumber: number,
  click: Click,
  rolled_back: boolean,
  clickEconomics: ClickEconomics | undefined,
  state: RunState,
  scoreOptimized: boolean,
  cwd: string,
  incrementalScanner: IncrementalScanner,
  callbacks: EngineCallbacks,
): Promise<{ rolled_back: boolean; regressionDetected: boolean }> {
  if (!click.testsPassed || rolled_back || !state.currentScan) {
    return { rolled_back, regressionDetected: false };
  }

  try {
    const newScan = await incrementalScanner.incrementalScan(state.currentScan);
    const newTotal = newScan.total;
    const delta = newTotal - state.previousTotal;

    // Score regression guard: if score dropped, revert the commit
    if (newTotal < state.previousTotal && click.commitHash) {
      const regressionDelta = state.previousTotal - newTotal;
      logger.error({ clickNumber, before: state.previousTotal, after: newTotal }, 'Score regression rollback');
      await git.revertLastCommit(cwd).catch(() => {});
      click.testsPassed = false;
      click.rollbackReason = `score regression: ${state.previousTotal} → ${newTotal} (-${regressionDelta}pts)`;
      click.commitHash = undefined;
      // Restore consecutive count from before the "landed" reset, then add this one
      state.consecutiveRollbacks = state.prevConsecutiveRollbacks + 1;
      state.totalLanded--;
      state.totalRolled++;
      return { rolled_back: true, regressionDetected: true };
    } else {
      // Count how many issues were resolved
      const prevIssueCount = state.currentScan.totalIssuesFound;
      const newIssueCount = newScan.totalIssuesFound;
      const issuesFixedCount = Math.max(0, prevIssueCount - newIssueCount);

      click.scoreAfterClick = newTotal;
      click.issuesFixedCount = issuesFixedCount;

      // Update economics with post-scan data
      if (clickEconomics) {
        clickEconomics.issuesFixed = issuesFixedCount;
        clickEconomics.scoreDelta = delta;
      }

      // Compute and attach per-category breakdown
      const categoryDeltas = diffCategories(state.currentScan, newScan);
      click.categoryDeltas = categoryDeltas;

      // Print per-category breakdown for non-zero or wasted-effort categories
      for (const cd of categoryDeltas) {
        if (cd.delta !== 0) {
          logger.info({ category: cd.category, before: cd.before, after: cd.after, delta: cd.delta }, 'Category delta');
        } else if (cd.wastedEffort) {
          logger.warn(
            { category: cd.category, before: cd.before, after: cd.after, issuesFixed: cd.issuesFixed },
            'Category already maxed',
          );
        }
      }

      await callbacks.onClickScoreUpdate?.(clickNumber, state.previousTotal, newTotal, delta);

      // Update backlog from fresh scan
      state.previousTotal = newTotal;
      state.currentScan = newScan;
      const newBacklog = scoreOptimized
        ? buildScoreOptimizedBacklog(newScan)
        : buildBacklog(newScan);
      state.backlogGroups = groupBacklogBySubcategory(newBacklog);
    }
  } catch {
    // Non-fatal — skip live scoring for this click
  }

  return { rolled_back, regressionDetected: false };
}

/**
 * Check for stall conditions and escalate to cross-file sweep mode if needed.
 * Also captures the midpoint score for stall detection. Mutates state in place.
 */
async function checkStallAndEscalate(
  clickNumber: number,
  clicks: number,
  state: RunState,
  hardenMode: boolean,
  escalateEnabled: boolean,
  callbacks: EngineCallbacks,
): Promise<void> {
  // Capture midpoint score for stall detection
  if (clickNumber === Math.floor(clicks / 2) && state.scoreAtMidpoint === undefined) {
    state.scoreAtMidpoint = state.previousTotal;
  }

  if (!escalateEnabled || state.escalated || hardenMode || !state.currentScan) return;

  const rollbackRate = clickNumber > 0 ? state.totalRolled / clickNumber : 0;
  const scoreDelta = state.scoreAtMidpoint !== undefined ? state.previousTotal - state.scoreAtMidpoint : undefined;
  const backlogExhausted = state.backlogGroups.length === 0;

  let escalateReason: string | undefined;
  if (state.consecutiveRollbacks >= 3) {
    escalateReason = '3 consecutive rollbacks';
  } else if (clickNumber >= Math.floor(clicks / 2) && scoreDelta === 0 && rollbackRate > 0.4) {
    escalateReason = 'no score progress at midpoint';
  } else if (backlogExhausted && clickNumber < clicks) {
    escalateReason = 'backlog exhausted';
  }

  if (escalateReason) {
    logger.warn('Stall detected — escalating to cross-file sweep mode');
    await callbacks.onEscalate?.(escalateReason);

    const fullBacklog = buildScoreOptimizedBacklog(state.currentScan);
    const sweepableBacklog = fullBacklog.filter((task) => !task.architectPrompt);
    if (sweepableBacklog.length > 0) {
      state.backlogGroups = groupBacklogBySubcategory(sweepableBacklog);
      state.target = { name: 'sweep', path: '.', description: 'auto-escalated cross-file sweep' };
      state.escalated = true;
    }
  }
}

/**
 * Check for smart stop conditions: architect-only backlog or high rollback rate.
 * May trigger architect engine escalation. Returns whether the run loop should stop.
 */
async function checkSmartStop(
  clickNumber: number,
  run: RatchetRun,
  state: RunState,
  options: EngineRunOptions,
): Promise<{ shouldStop: boolean }> {
  const { clicks, architectEscalation: architectEscalationEnabled = true } = options;

  // Smart early stop: if stalled with only architect-mode issues remaining
  if (state.consecutiveRollbacks >= 2 && state.totalLanded > 0 && state.backlogGroups.length > 0) {
    const allArchitect = state.backlogGroups.every(group => group.every(task => !!task.architectPrompt));
    if (allArchitect) {
      const remainingClicks = clicks - clickNumber;
      if (architectEscalationEnabled && remainingClicks > 0) {
        logger.info({ remainingClicks }, 'Escalating to architect mode');
        const architectRun = await runArchitectEngine({
          ...options,
          clicks: remainingClicks,
          createBranch: false,
          scanResult: state.currentScan,
          clickOffset: clickNumber,
        });
        run.clicks.push(...architectRun.clicks);
        run.architectEscalated = true;
      } else {
        run.earlyStopReason = 'remaining issues need architect mode';
        logger.info(
          { landed: state.totalLanded, returned: clicks - clickNumber },
          'Smart stop: remaining issues need architect mode',
        );
      }
      return { shouldStop: true };
    }
  }

  // Practical smart stop: sweepable items that keep rolling back are effectively unsweepable
  if (!run.earlyStopReason && state.consecutiveRollbacks >= 3 && state.totalLanded > 0) {
    const totalAttempted = state.totalLanded + state.totalRolled;
    const rollbackRate = totalAttempted > 0 ? state.totalRolled / totalAttempted : 0;
    if (rollbackRate > 0.6) {
      const ratePct = Math.round(rollbackRate * 100);
      run.earlyStopReason = `high rollback rate (${ratePct}%) — remaining issues may need manual intervention`;
      logger.info(
        { reason: run.earlyStopReason, landed: state.totalLanded, returned: clicks - clickNumber },
        'Smart stop',
      );
      return { shouldStop: true };
    }
  }

  return { shouldStop: false };
}

// ── Stop-condition helpers (exported for testing) ──────

/** Returns stop=true when wall time has exceeded the configured timeout. */
export function checkTimeoutStop(
  startedAt: Date,
  timeoutMs: number,
  clickNumber: number,
): { stop: boolean; earlyStopReason?: string } {
  const elapsed = Date.now() - startedAt.getTime();
  if (elapsed > timeoutMs) {
    const elapsedMin = Math.round(elapsed / 60000);
    return { stop: true, earlyStopReason: `Timeout reached (${elapsedMin}m)` };
  }
  return { stop: false };
}

/** Returns stop=true when cumulative cost has reached or exceeded the budget. */
export function checkBudgetStop(
  cumulativeCost: number,
  budgetUsd: number,
): { stop: boolean; earlyStopReason?: string } {
  if (cumulativeCost >= budgetUsd) {
    return { stop: true, earlyStopReason: `Budget limit reached ($${cumulativeCost.toFixed(2)})` };
  }
  return { stop: false };
}

/** Returns stop=true when N consecutive clicks all had zero score delta (plateau). */
export function checkPlateauStop(
  consecutiveZeroDeltaClicks: number,
  totalClicks: number,
): { stop: boolean; earlyStopReason?: string } {
  if (totalClicks > 3 && consecutiveZeroDeltaClicks >= 3) {
    return { stop: true, earlyStopReason: 'Score plateau detected (3 consecutive zero-delta clicks)' };
  }
  return { stop: false };
}

/** Returns stop=true when a score regression was detected and --stop-on-regression is active. */
export function checkRegressionStop(
  regressionDetected: boolean,
  rollbackReason?: string,
): { stop: boolean; earlyStopReason?: string } {
  if (!regressionDetected) return { stop: false };
  const match = rollbackReason?.match(/(\d+) → (\d+)/);
  const detail = match ? `${match[1]} → ${match[2]}` : '';
  return { stop: true, earlyStopReason: `Score regression detected (${detail})` };
}

// ── GitNexus confidence gating

/**
 * HIGH_RISK_LEVELS — these risk levels trigger confidence gating.
 * If confidence > CONFIDENCE_THRESHOLD, the click is flagged for warning/rollback.
 */
const HIGH_RISK_LEVELS = new Set(['HIGH', 'CRITICAL', 'high', 'critical']);
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Run confidence-based risk gating on modified files after a click lands.
 * Returns high-risk changes that exceed the confidence threshold.
 * Non-blocking async — called before committing.
 */
export async function runConfidenceGating(
  filesModified: string[],
  cwd: string,
): Promise<HighRiskChange[]> {
  if (filesModified.length === 0) return [];

  try {
    const impacts = await detectChanges(filesModified, cwd);
    const highRisk: HighRiskChange[] = [];

    for (const impact of impacts) {
      if (HIGH_RISK_LEVELS.has(impact.riskLevel) && impact.confidence > CONFIDENCE_THRESHOLD) {
        highRisk.push({
          file: impact.target,
          symbol: impact.target,
          risk: impact.riskLevel,
          confidence: impact.confidence,
        });
      }
    }

    return highRisk;
  } catch {
    // Non-fatal — if confidence gating fails, allow the click
    return [];
  }
}

// ── Engine

/**
 * The Click Loop Engine.
 * Runs N clicks sequentially on a target, applying the Pawl (rollback on failure).
 *
 * Scan-driven: at the start, runs a scan to get the current score and build an issue backlog.
 * Each click is given specific issues to fix (compound click). After each successful click,
 * re-scans to measure progress and update the backlog.
 */
export async function runEngine(options: EngineRunOptions): Promise<RatchetRun> {
  const {
    clicks, config, cwd, agent,
    hardenMode = false, adversarial = false,
    callbacks = {},
    learningStore,
    scoreOptimized = false,
    escalate: escalateEnabled = true,
    guardEscalation: guardEscalationEnabled = true,
    planFirst = false,
    scope: scopeFiles = [],
    noStrategy = false,
  } = options;

  const { run, state, incrementalScanner, baselineFailures } = await initializeRun(options);

  // Expose the live run object to the caller (e.g. for signal handler checkpointing)
  callbacks.onRunInit?.(run);

  // --- Strategy: load or init on first run, inject context into agent ---
  const scanForStrategy = state.currentScan;
  if (!noStrategy) {
    try {
      let strategy = await loadStrategy(cwd);
      if (!strategy && scanForStrategy) {
        strategy = initStrategy(cwd, scanForStrategy);
        logger.info({ project: strategy.profile.name }, 'Strategy initialized for first run');
      }
      if (strategy) {
        const ctx = buildStrategyContext(strategy);
        if (ctx && 'strategyContext' in agent) {
          (agent as ShellAgent).strategyContext = ctx;
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load/init strategy — continuing without it');
    }
  }

  // Harden mode: track initial test file count to detect when tests are written
  let initialTestFileCount = 0;
  let phaseTransitioned = false;
  if (hardenMode) {
    initialTestFileCount = countTestFiles(cwd);
  }

  // --- Plan-first: click 0 — read-only planning before execution clicks ---
  if (planFirst) {
    await runPlanFirst(run, state.target, state.currentScan, agent, cwd, {
      onPlanStart: callbacks.onPlanStart,
      onPlanComplete: callbacks.onPlanComplete,
    });
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
      if (!hardenMode && state.backlogGroups.length > 0) {
        clickIssues = state.backlogGroups.shift();
      }

      try {
        const clickStartMs = Date.now();

        let click: Click;
        let rolled_back: boolean;
        let clickEconomics: ClickEconomics | undefined;

        if (config.swarm?.enabled) {
          // Swarm mode: run N agents in parallel worktrees, pick best
          const swarm = new SwarmExecutor(config.swarm, learningStore ?? options.learningStore);
          const clickCtx = {
            clickNumber: i,
            target: state.target,
            config,
            agent,
            cwd,
            hardenPhase,
            resolvedGuards: state.escalated ? resolveGuards(state.target, config, 'sweep') : state.currentGuards,
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
              target: state.target.name,
              analysis: '',
              proposal: 'swarm: all agents failed',
              filesModified: [],
              testsPassed: false,
              timestamp: new Date(),
            };
            rolled_back = true;
          }
          // Synthetic economics for swarm clicks (swarm executor doesn't return per-click timing)
          clickEconomics = {
            clickIndex: i,
            wallTimeMs: Date.now() - clickStartMs,
            agentTimeMs: Date.now() - clickStartMs,
            testTimeMs: 0,
            estimatedCost: 0,
            outcome: rolled_back ? 'rolled-back' : 'landed',
            issuesFixed: 0,
            scoreDelta: 0,
          };
        } else {
          // Normal single-agent mode
          const result = await executeClick({
            clickNumber: i,
            target: state.target,
            config,
            agent,
            cwd,
            hardenPhase,
            adversarial,
            sweepMode: state.escalated,
            resolvedGuards: state.escalated ? resolveGuards(state.target, config, 'sweep') : state.currentGuards,
            issues: clickIssues,
            baselineFailures,
            planContext: run.planResult ? JSON.stringify(run.planResult, null, 2) : undefined,
            contextPruning: options.contextPruning,
            scanResult: state.currentScan,
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, i)
              : undefined,
          });

          // Risk gate escalation: if single-agent was blocked, retry with swarm
          if (result.requiresSwarm) {
            logger.info({ click: i }, 'Escalating to swarm mode');
            const swarm = new SwarmExecutor({ agentCount: 3, parallel: true }, learningStore);
            const swarmResult = await swarm.execute({
              clickNumber: i, target: state.target, config, agent, cwd, hardenPhase,
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
          clickEconomics = result.economics;
        }

        // Scope guard: if scope was specified, roll back any click that touched out-of-scope files
        if (scopeFiles.length > 0 && !rolled_back) {
          const scopeValidation = validateScope(click.filesModified, scopeFiles, cwd);
          if (!scopeValidation.valid) {
            logger.error(
              `click ${i} ROLLED BACK — scope violation: ${scopeValidation.scopeViolations.join(', ')}`,
            );
            if (click.commitHash) {
              await git.revertLastCommit(cwd).catch(() => {});
            }
            click.testsPassed = false;
            click.rollbackReason = `scope-exceeded: ${scopeValidation.scopeViolations.join(', ')}`;
            click.commitHash = undefined;
            rolled_back = true;
          }
        }

        const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);

        await processClickOutcome(i, click, rolled_back, elapsedSec, state, guardEscalationEnabled, callbacks);

        // Confidence gating: detect high-risk changes on landed clicks before they're committed
        if (!rolled_back && click.testsPassed && click.filesModified.length > 0) {
          const highRiskChanges = await runConfidenceGating(click.filesModified, cwd);
          if (highRiskChanges.length > 0) {
            click.highRiskChanges = highRiskChanges;
            const riskSummary = highRiskChanges
              .map(r => `${r.file} (${r.risk}, ${(r.confidence * 100).toFixed(0)}%)`)
              .join(', ');
            logger.warn({ highRiskChanges }, `[ratchet] ⚠ High-risk changes detected: ${riskSummary}`);
          }
        }

        let regressionDetected: boolean;
        ({ rolled_back, regressionDetected } = await postClickRescan(
          i, click, rolled_back, clickEconomics, state, scoreOptimized, cwd, incrementalScanner, callbacks,
        ));

        await checkStallAndEscalate(i, clicks, state, hardenMode, escalateEnabled, callbacks);

        // Post-click async reindex: keep GitNexus graph fresh for subsequent clicks
        if (!rolled_back && click.testsPassed) {
          const hasFileCreationsOrDeletions = false; // heuristic: assume modify-only for now
          reindex(cwd, hasFileCreationsOrDeletions).catch(() => {
            // Non-fatal — don't let reindex errors break the engine
          });
        }

        run.clicks.push(click);
        if (clickEconomics) state.allEconomics.push(clickEconomics);

        // Track cumulative cost and consecutive zero-delta clicks for stop conditions
        if (clickEconomics) {
          state.cumulativeCost += clickEconomics.estimatedCost;
        }
        const clickDelta = (click.testsPassed && !rolled_back && clickEconomics) ? clickEconomics.scoreDelta : 0;
        if (clickDelta !== 0) {
          state.consecutiveZeroDeltaClicks = 0;
        } else {
          state.consecutiveZeroDeltaClicks++;
        }

        // Auto-checkpoint: after a landed click, persist resume state
        if (!rolled_back && click.testsPassed) {
          run.resumeState = {
            completedClicks: run.clicks.filter(c => c.testsPassed).length,
            totalClicks: clicks,
            target: state.target.name,
            interruptedAt: new Date().toISOString(),
          };
          await callbacks.onCheckpoint?.(run);
        }

        await callbacks.onClickComplete?.(click, rolled_back);

        const { shouldStop } = await checkSmartStop(i, run, state, options);
        if (shouldStop) break;

        // ── Stop-condition checks (between clicks)

        // Stop-on-regression: the click was already rolled back — stop the run
        if (options.stopOnRegression) {
          const regressionStop = checkRegressionStop(regressionDetected, click.rollbackReason);
          if (regressionStop.stop) {
            run.earlyStopReason = regressionStop.earlyStopReason;
            logger.info({ reason: regressionStop.earlyStopReason }, 'Stop-on-regression');
            break;
          }
        }

        // Plateau detection: active in normal mode
        // (skipped in harden mode, which intentionally has many zero-delta clicks)
        if (!hardenMode) {
          const plateauStop = checkPlateauStop(state.consecutiveZeroDeltaClicks, clicks);
          if (plateauStop.stop) {
            run.earlyStopReason = plateauStop.earlyStopReason;
            logger.info({ reason: plateauStop.earlyStopReason }, 'Plateau detected');
            break;
          }
        }

        // Timeout check (between clicks)
        if (options.timeoutMs) {
          const timeoutStop = checkTimeoutStop(run.startedAt, options.timeoutMs, i);
          if (timeoutStop.stop) {
            run.earlyStopReason = timeoutStop.earlyStopReason;
            run.timeoutReached = true;
            process.stdout.write(`  ⏱ ${timeoutStop.earlyStopReason} — stopping after click ${i}\n`);
            logger.info({ reason: timeoutStop.earlyStopReason }, 'Timeout stop');
            break;
          }
        }

        // Budget check (between clicks)
        if (options.budgetUsd) {
          const budgetStop = checkBudgetStop(state.cumulativeCost, options.budgetUsd);
          if (budgetStop.stop) {
            run.earlyStopReason = budgetStop.earlyStopReason;
            run.budgetReached = true;
            logger.info({ reason: budgetStop.earlyStopReason }, 'Budget stop');
            break;
          }
        }

        // Cross-run learning: record the outcome for future recommendations
        if (learningStore && clickIssues && clickIssues.length > 0) {
          const elapsedMs = Date.now() - clickStartMs;
          const scoreDelta = click.scoreAfterClick != null ? click.scoreAfterClick - state.previousTotal : 0;
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
      logger.error(
        'All clicks rolled back. Possible causes: tests failing before ratchet starts, ' +
        'agent not making changes, or flaky test suite',
      );
    }
  } catch (err: unknown) {
    run.status = 'failed';
    throw err;
  } finally {
    run.finishedAt = new Date();
    // Compute and emit run-level economics before onRunComplete
    if (state.allEconomics.length > 0 && callbacks.onRunEconomics) {
      const totalWallTimeMs = run.finishedAt.getTime() - run.startedAt.getTime();
      const economics = computeRunEconomics(state.allEconomics, totalWallTimeMs);
      await Promise.resolve(callbacks.onRunEconomics(economics)).catch(() => {});
    }
    await callbacks.onRunComplete?.(run);

    // --- Strategy: evolve after run completes ---
    if (!noStrategy && run.clicks.length > 0) {
      try {
        const finalScan = state.currentScan;
        await evolveStrategy(cwd, run, scanForStrategy, finalScan);
      } catch (err) {
        logger.warn({ err }, 'Failed to evolve strategy — non-fatal');
      }
    }
  }

  return run;
}
