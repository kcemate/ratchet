import { randomUUID } from 'crypto';
import { join, isAbsolute, resolve } from 'path';
import type {
  RatchetRun, Target, RatchetConfig, Click, HardenPhase, CategoryDelta, ClickEconomics, ClickGuards,
} from '../types.js';
import { loadStrategy, initStrategy, evolveStrategy, buildStrategyContext } from './strategy.js';
import type { Agent } from './agents/base.js';
import type { IssueTask } from './issue-backlog.js';
import {
  buildBacklog, groupBacklogBySubcategory, enrichBacklogWithRisk, groupByDependencyCluster,
  filterBacklogByMode,
} from './issue-backlog.js';
import { buildScoreOptimizedBacklog, isSweepable } from './score-optimizer.js';
import { routeIssues } from './issue-router.js';
import { executeClick } from './click.js';
import { SwarmExecutor } from './swarm.js';
import * as git from './git.js';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';
import type { LearningStore } from './learning.js';
import { clearCache as clearGitNexusCache, detectChanges, reindex } from './gitnexus.js';
import { mergeResults, removeResolvedFindings } from './normalize.js';
import type { HighRiskChange } from '../types.js';
import { IncrementalScanner } from './scan-cache.js';
import { resolveGuards, nextGuardProfile, isGuardRejection } from './engine-guards.js';
import { validateScope } from './scope.js';
import { captureBaseline } from './test-isolation.js';
import { runPlanFirst } from './engine-plan.js';
import { runArchitectEngine } from './engine-architect.js';
import { runSweepEngine } from './engine-sweep.js';
import { runDeepAnalyze } from './analyze-react.js';
import type { ReactAnalysis } from './analyze-react.js';
import { countTestFiles } from './detect.js';
import { logger } from '../lib/logger.js';
import { prevalidateIssues } from './issue-prevalidation.js';
import { familiarize, buildFamiliarizationContext } from './familiarize.js';
import { probeRepo } from './repo-probe.js';
import { runTests } from './runner.js';
import { scanForProtectedPaths, logSafetyEvent } from './safety.js';

// Re-export public API from sub-modules
export { nextGuardProfile, isGuardRejection } from './engine-guards.js';
export { runArchitectEngine } from './engine-architect.js';
export { runSweepEngine, chunk } from './engine-sweep.js';

/**
 * Returns true when a subcategory should be soft-skipped in the click loop
 * (2+ zero-delta lands for the same subcategory) — try alternatives first,
 * but do NOT blacklist yet. Blacklist threshold is 3 zero-delta lands.
 */
export function shouldSoftSkipSubcategory(zeroDeltaLands: number): boolean {
  return zeroDeltaLands >= 2;
}

/**
 * Returns true when the total zero-delta lands across ALL subcategories
 * has reached the sweep-escalation threshold (3).
 * At this point, if the top remaining issue is sweepable, escalate to sweep mode.
 */
export function shouldEscalateOnTotalZeroDelta(totalZeroDeltaLands: number): boolean {
  return totalZeroDeltaLands >= 3;
}

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

function partitionClicks(clicks: ClickEconomics[]) {
  const landed = clicks.filter(c => c.outcome === 'landed');
  const rolledBack = clicks.filter(c => c.outcome !== 'landed');
  const timedOut = clicks.filter(c => c.outcome === 'timeout');
  return { landed, rolledBack, timedOut };
}

/** Generate strategy recommendations from per-click economics. */
export function generateRecommendations(clicks: ClickEconomics[]): string[] {
  if (clicks.length === 0) return [];
  const total = clicks.length;
  const { rolledBack, timedOut } = partitionClicks(clicks);
  const rollbackRate = rolledBack.length / total;
  const timeoutRate = timedOut.length / total;
  const scoreDelta = clicks.reduce((sum, c) => sum + c.scoreDelta, 0);

  const recs: string[] = [];

  if (rollbackRate > 0.30) {
    recs.push(`${rolledBack.length}/${total} clicks rolled back — consider --plan-first to reduce wasted iterations`);
  }
  if (timeoutRate > 0.15) {
    recs.push(`${timedOut.length} timeout(s) detected — consider --timeout 900 for complex refactors`);
  }
  if (scoreDelta === 0 && total > 0) {
    recs.push('Score delta is zero — consider --architect --guards refactor for structural improvements');
  }

  return recs;
}

/** Aggregate per-click economics into a run-level summary. */
export function computeRunEconomics(clicks: ClickEconomics[], totalWallTimeMs: number): RunEconomics {
  const { landed, rolledBack, timedOut } = partitionClicks(clicks);

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
  onArchitectEscalate?: (reason: string) => Promise<void> | void;
  onSweepEscalate?: (reason: string, subcategory: string) => Promise<void> | void;
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
  /** Force torque to target only subcategories within this score category */
  focusCategory?: string;
  /**
   * Run a multi-turn ReACT analysis loop before the first click.
   * Reads files, queries GitNexus for blast radius, and produces a structured
   * analysis with confidence scores and risk assessment.
   */
  deepAnalyze?: boolean;
  /**
   * The Deep pre-scan result to persist across clicks.
   * When provided, postClickRescan will merge the incremental Classic rescan
   * with this result (filtered for resolved files) so Deep findings drive the
   * authoritative score throughout the run.
   */
  deepScanResult?: ScanResult;
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
  /** Score at the very beginning of this run (before any click). Used to detect net-negative runs. */
  initialTotalScore: number;
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
  /**
   * Global diminishing-returns detector: tracks score deltas for the last 3 clicks.
   * When all 3 are zero AND totalClicks >= 3, triggers smart-stop.
   */
  recentScoreDeltas: number[];
  /** Running total of estimated cost across all clicks (USD). */
  cumulativeCost: number;
  /**
   * When true, postClickRescan will roll back any click that causes the total
   * score to drop BELOW state.initialTotalScore (net-negative run guard).
   * Default: true.
   */
  netRegressionGuardEnabled: boolean;
  /**
   * Subcategories the engine has given up on (rolled back 2+ times or 3+
   * zero-delta lands). Groups whose tasks are all blacklisted are skipped in
   * the main click loop.
   */
  blacklistedSubcategories: Set<string>;
  /** Per-subcategory rollback / zero-delta-land counters for blacklist logic. */
  subcategoryStats: Map<string, { rollbacks: number; zeroDeltaLands: number }>;
  /**
   * Persistent Deep scan result (from DeepEngine pre-scan).
   * Present only when --deep is active. Used by postClickRescan to produce an
   * authoritative merged score after each click; findings for touched files are
   * progressively filtered out as the run advances.
   */
  deepScanResult?: ScanResult;
  /** Repo context string for injection into agent prompts. */
  repoContext?: string;
  /** Circuit breaker state — tracks consecutive failures per strategy for the escalation ladder. */
  circuitBreaker: CircuitBreakerState;
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
 * Pre-flight check: run the configured test command once before starting clicks.
 * If the command exits with "Missing script" or equivalent "no test script" errors,
 * throws an actionable error so the user knows to configure a test script first.
 */
export async function preflightTestCommand(testCommand: string, cwd: string): Promise<void> {
  const result = await runTests({ command: testCommand, cwd, timeout: 30_000 });
  if (!result.passed) {
    const output = (result.output ?? '') + (result.error ?? '');
    const isMissingScript =
      /Missing script[:\s]/i.test(output) ||
      /npm error Missing script/i.test(output) ||
      /no test specified/i.test(output) ||
      (result.error?.includes('Missing script') ?? false);
    if (isMissingScript) {
      throw new Error(
        `No working test command — add a test script to package.json before running torque.\n` +
        `  Current command: ${testCommand}\n` +
        `  Fix: add a "test" script to package.json (e.g. "vitest run" or "jest")`,
      );
    }
  }
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
  const {
    config, cwd, createBranch = true, scoreOptimized = true, scope: scopeFiles = [], scopeArg, focusCategory,
  } = options;
  const callbacks = options.callbacks ?? {};

  const run: RatchetRun = {
    id: randomUUID(),
    target: options.target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
    ...(scopeFiles.length > 0 && { scope: scopeFiles, scopeArg }),
  };

  // Pre-flight: verify test command works before doing anything else.
  // A missing test script causes all clicks to roll back uselessly.
  try {
    await preflightTestCommand(config.defaults.testCommand, cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Only abort for "missing script" errors — other failures (existing test failures) are OK
    if (msg.includes('No working test command')) throw err;
    // Otherwise non-fatal (e.g. existing test failures are handled by baseline capture)
  }

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
    const rawBacklog = scoreOptimized
      ? buildScoreOptimizedBacklog(currentScan, focusCategory)
      : buildBacklog(currentScan);
    // Enrich backlog with blast-radius risk scores from GitNexus
    enrichBacklogWithRisk(rawBacklog, cwd);
    // Route issues based on agent capability — APIAgent only receives torque/trivial issues
    const agentType: 'api' | 'shell' = 'clickGuards' in options.agent ? 'api' : 'shell';
    const backlog = routeIssues(rawBacklog, agentType);
    backlogGroups = groupBacklogBySubcategory(backlog);
  }

  // Smart guard escalation: mutable guards that can be bumped mid-run
  const currentGuards = resolveGuards(options.target, config, 'normal', focusCategory);
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

  // --- Familiarization: generate repo context for agent prompt injection ---
  let repoContext: string | undefined;
  try {
    const profile = probeRepo(cwd);
    const ctx = await familiarize(cwd, profile, currentScan);
    repoContext = buildFamiliarizationContext(ctx);
  } catch (err) {
    logger.warn({ err }, 'Repo familiarization failed — continuing without context');
  }

  const state: RunState = {
    currentScan,
    backlogGroups,
    previousTotal,
    initialTotalScore: previousTotal,
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
    recentScoreDeltas: [],
    cumulativeCost: 0,
    netRegressionGuardEnabled: true,
    blacklistedSubcategories: new Set(),
    subcategoryStats: new Map(),
    deepScanResult: options.deepScanResult,
    repoContext,
    circuitBreaker: {
      consecutiveFailures: 0,
      currentStrategy: 'standard',
      strategiesExhausted: [],
      totalFailures: 0,
      maxTotalFailures: 12,
    },
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
    // Successful click resets the circuit breaker's consecutive counter
    state.circuitBreaker.consecutiveFailures = 0;
  }

  // Keep circuit breaker in sync with the standard-mode consecutive rollback count
  if (rolled_back && state.circuitBreaker.currentStrategy === 'standard') {
    state.circuitBreaker.consecutiveFailures = state.consecutiveRollbacks;
    state.circuitBreaker.totalFailures++;
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
  focusCategory?: string,
): Promise<{ rolled_back: boolean; regressionDetected: boolean }> {
  if (!click.testsPassed || rolled_back || !state.currentScan) {
    return { rolled_back, regressionDetected: false };
  }

  try {
    const classicRescan = await incrementalScanner.incrementalScan(state.currentScan);

    // When Deep findings are available, merge the fresh Classic rescan with a
    // filtered copy of the persistent Deep result (findings for files touched
    // by this click are removed, since those files are now covered by Classic).
    let newScan = classicRescan;
    if (state.deepScanResult) {
      const updatedDeep = removeResolvedFindings(state.deepScanResult, click.filesModified);
      newScan = mergeResults(classicRescan, updatedDeep);
      // Persist the filtered Deep result so future clicks see a shrinking backlog.
      state.deepScanResult = updatedDeep;
      logger.debug(
        { filesModified: click.filesModified.length, deepTotal: updatedDeep.total, mergedTotal: newScan.total },
        'Deep merge after click',
      );
    }

    const newTotal = newScan.total;
    const delta = newTotal - state.previousTotal;

    // Score regression guard: if total score dropped, always roll back — no exceptions.
    // The total score must be monotonically non-decreasing across landed clicks.
    const regressionCheck = checkTotalScoreRegression(newTotal, state.previousTotal);
    if (regressionCheck.shouldRollback) {
      logger.error({ clickNumber, before: state.previousTotal, after: newTotal }, regressionCheck.reason!);
      if (click.commitHash) {
        await git.revertLastCommit(cwd).catch(() => {});
      }
      click.testsPassed = false;
      click.rollbackReason = regressionCheck.reason!;
      click.commitHash = undefined;
      // Restore consecutive count from before the "landed" reset, then add this one
      state.consecutiveRollbacks = state.prevConsecutiveRollbacks + 1;
      state.totalLanded--;
      state.totalRolled++;
      return { rolled_back: true, regressionDetected: true };
    }

    // Net regression guard: if total score has dropped BELOW where the run started,
    // roll back the click. This prevents "death by a thousand cuts" where each
    // per-click check passes but the cumulative drift is negative.
    if (state.netRegressionGuardEnabled && newTotal < state.initialTotalScore) {
      const reason = `net regression: score ${newTotal} is below run start ${state.initialTotalScore}`;
      logger.error({ clickNumber, initial: state.initialTotalScore, current: newTotal }, reason);
      if (click.commitHash) {
        await git.revertLastCommit(cwd).catch(() => {});
      }
      click.testsPassed = false;
      click.rollbackReason = reason;
      click.commitHash = undefined;
      state.consecutiveRollbacks = state.prevConsecutiveRollbacks + 1;
      state.totalLanded--;
      state.totalRolled++;
      return { rolled_back: true, regressionDetected: true };
    }

    {
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
      const rawNewBacklog = scoreOptimized
        ? buildScoreOptimizedBacklog(newScan, focusCategory)
        : buildBacklog(newScan);
      const agentTypeForUpdate: 'api' | 'shell' = 'clickGuards' in agent ? 'api' : 'shell';
      const newBacklog = routeIssues(rawNewBacklog, agentTypeForUpdate);
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
  focusCategory?: string,
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
    // Rebuild full backlog and find the best sweepable target
    const fullBacklog = buildScoreOptimizedBacklog(state.currentScan, focusCategory);
    const sweepableBacklog = fullBacklog.filter((task) => task.sweepFiles && task.sweepFiles.length > 0 && isSweepable(task.subcategory ?? ''));

    if (sweepableBacklog.length > 0) {
      // Sort by points available descending — target highest-impact sweepable category
      sweepableBacklog.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      const topSweepable = sweepableBacklog[0]!;
      logger.warn(
        { reason: escalateReason, category: topSweepable.subcategory, files: topSweepable.sweepFiles?.length },
        'Stall detected — escalating to cross-file sweep on sweepable category',
      );
      await callbacks.onEscalate?.(escalateReason);

      // Replace backlog with ONLY sweepable items so standard clicks target them
      state.backlogGroups = groupBacklogBySubcategory(sweepableBacklog);
      state.target = { name: 'sweep', path: '.', description: `auto-escalated sweep: ${topSweepable.subcategory}` };
      state.escalated = true;
      // Use sweep guards (50 files) instead of standard guards (3-6 files)
      state.currentGuards = resolveGuards(state.target, {} as any, 'sweep');
    } else {
      // No sweepable items — fall back to architect-filtered backlog
      logger.warn('Stall detected — no sweepable categories available, filtering to architect backlog');
      await callbacks.onEscalate?.(escalateReason);
      const architectBacklog = fullBacklog.filter((task) => !!task.architectPrompt);
      if (architectBacklog.length > 0) {
        state.backlogGroups = groupBacklogBySubcategory(architectBacklog);
        state.target = { name: 'architect', path: '.', description: 'auto-escalated architect mode' };
        state.escalated = true;
      }
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
  const remainingClicks = clicks - clickNumber;

  // Auto-escalate to architect/sweep mode when standard clicks stall
  if (!run.architectEscalated && !run.sweepEscalated && remainingClicks > 0) {
    const rollbackEscalation = checkRollbackEscalation(
      state.consecutiveRollbacks,
      state.totalLanded,
      state.totalRolled,
      architectEscalationEnabled,
    );
    if (rollbackEscalation.shouldEscalate) {
      const reason = rollbackEscalation.reason ?? 'stall detected';

      // Scan the FULL backlog for the best sweepable category — not just the top task.
      // The top task may be non-sweepable (e.g. auth) while sweepable items with more
      // files (e.g. line-length with 180 files) sit lower in priority order.
      const fullBacklog = state.currentScan
        ? buildScoreOptimizedBacklog(state.currentScan)
        : state.backlogGroups.flat();
      const bestSweepable = fullBacklog.find(
        (task) => task.subcategory && isSweepable(task.subcategory) && (task.sweepFiles?.length ?? 0) > 0,
      );

      if (bestSweepable?.subcategory) {
        const sweepCategory = bestSweepable.subcategory;
        logger.info(
          { remainingClicks, reason, subcategory: sweepCategory, files: bestSweepable.sweepFiles?.length },
          '⚡ Standard clicks stalled — escalating to sweep mode on best sweepable category',
        );
        await options.callbacks?.onSweepEscalate?.(reason, sweepCategory);
        const sweepRun = await runSweepEngine({
          ...options,
          clicks: remainingClicks,
          createBranch: false,
          scanResult: state.currentScan,
          clickOffset: clickNumber,
          category: sweepCategory,
        });
        run.clicks.push(...sweepRun.clicks);
        run.sweepEscalated = true;
        run.sweepEscalatedAtClick = clickNumber;
        run.sweepEscalatedCategory = sweepCategory;
        return { shouldStop: true };
      }

      // No sweepable categories available — fall through to architect
      logger.info({ remainingClicks, reason }, '⚡ Standard clicks stalled — escalating to architect mode');
      await options.callbacks?.onArchitectEscalate?.(reason);
      const architectRun = await runArchitectEngine({
        ...options,
        clicks: remainingClicks,
        createBranch: false,
        scanResult: state.currentScan,
        clickOffset: clickNumber,
      });
      run.clicks.push(...architectRun.clicks);
      run.architectEscalated = true;
      run.architectEscalatedAtClick = clickNumber;
      return { shouldStop: true };
    }
  }

  // Smart early stop: if stalled with only architect-mode issues remaining
  if (state.consecutiveRollbacks >= 2 && state.totalLanded > 0 && state.backlogGroups.length > 0) {
    const allArchitect = state.backlogGroups.every(group => group.every(task => !!task.architectPrompt));
    if (allArchitect) {
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
        run.architectEscalatedAtClick = clickNumber;
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

/**
 * Given the top backlog issue's subcategory, decide whether a stall should escalate
 * to sweep mode or architect mode.
 * Pure function — no side effects.
 *
 * Returns 'sweep' when the subcategory is marked sweepable in SUBCATEGORY_TIERS,
 * otherwise returns 'architect'.
 */
export function resolveEscalationMode(
  topTaskSubcategory: string | undefined,
): 'sweep' | 'architect' {
  if (topTaskSubcategory && isSweepable(topTaskSubcategory)) return 'sweep';
  return 'architect';
}

/**
 * Determine whether a rollback stall warrants auto-escalation to architect mode.
 * Pure function — no side effects.
 *
 * Escalates when:
 * - 3+ consecutive rollbacks (clicks are actively failing)
 * - 0 clicks landed after 3+ total attempts (nothing is sticking)
 */
export function checkRollbackEscalation(
  consecutiveRollbacks: number,
  totalLanded: number,
  totalRolled: number,
  enabled: boolean,
): { shouldEscalate: boolean; reason?: string } {
  if (!enabled) return { shouldEscalate: false };
  if (consecutiveRollbacks >= 3) {
    return { shouldEscalate: true, reason: '3 consecutive rollbacks' };
  }
  if (totalLanded === 0 && totalRolled >= 3) {
    return { shouldEscalate: true, reason: 'all clicks stalled with 0 landed' };
  }
  // 50% rollback rate guard: if at least half of all attempts have been rolled back
  // and the last click also rolled back, the run is clearly stalling.
  const totalAttempted = totalLanded + totalRolled;
  if (totalAttempted >= 3 && consecutiveRollbacks >= 1 && totalRolled / totalAttempted >= 0.5) {
    return { shouldEscalate: true, reason: '50% rollback rate' };
  }
  return { shouldEscalate: false };
}

/**
 * HARD guard: total score must be monotonically non-decreasing across landed clicks.
 * A click that improves a subcategory but tanks another must still be rolled back.
 * Pure function — no side effects.
 */
export function checkTotalScoreRegression(
  newTotal: number,
  prevTotal: number,
): { shouldRollback: boolean; reason?: string } {
  if (newTotal < prevTotal) {
    return {
      shouldRollback: true,
      reason: `Total score regression (${prevTotal} → ${newTotal}), rolling back`,
    };
  }
  return { shouldRollback: false };
}

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

/**
 * Global diminishing-returns detector: returns stop=true when the last 3 click
 * score deltas are ALL zero and at least 3 total clicks have been attempted.
 * This is a SUPPLEMENT to the per-subcategory plateau system — a simpler global
 * guard inspired by Claude Code's "3 continuations with <500 token delta → stop".
 */
export function checkDiminishingReturns(
  recentScoreDeltas: number[],
  totalClicks: number,
): { stop: boolean; earlyStopReason?: string } {
  if (totalClicks < 3) return { stop: false };
  if (recentScoreDeltas.length < 3) return { stop: false };
  const lastThree = recentScoreDeltas.slice(-3);
  if (lastThree.every((d) => d === 0)) {
    return {
      stop: true,
      earlyStopReason: 'diminishing returns — 3 consecutive zero-delta clicks',
    };
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

// ── Circuit breaker helpers (exported for testing) ──────────────────────────

/**
 * Given an array of clicks (from a sub-engine run), count the number of
 * consecutive rollbacks at the END of the sequence.
 * Pure function — no side effects.
 */
export function getConsecutiveTrailingRollbacks(clicks: Click[]): number {
  let count = 0;
  for (let i = clicks.length - 1; i >= 0; i--) {
    if (!clicks[i]!.testsPassed) count++;
    else break;
  }
  return count;
}

/**
 * Decide the next action for the circuit breaker given its current state.
 * Fires when consecutiveFailures >= 3 OR totalFailures >= maxTotalFailures.
 * Pure function — no side effects.
 */
export function checkCircuitBreaker(state: CircuitBreakerState): {
  shouldEscalate: boolean;
  nextStrategy?: 'architect' | 'sweep';
  shouldStop: boolean;
  reason?: string;
} {
  const hardLimitHit = state.totalFailures >= state.maxTotalFailures;
  const consecutiveLimitHit = state.consecutiveFailures >= 3;

  if (!hardLimitHit && !consecutiveLimitHit) {
    return { shouldEscalate: false, shouldStop: false };
  }

  if (hardLimitHit) {
    return {
      shouldEscalate: false,
      shouldStop: true,
      reason: `circuit breaker: hard limit reached (${state.totalFailures}/${state.maxTotalFailures} total failures)`,
    };
  }

  if (state.currentStrategy === 'standard') {
    return {
      shouldEscalate: true,
      nextStrategy: 'architect',
      shouldStop: false,
      reason: 'circuit breaker: standard → architect (3 consecutive rollbacks)',
    };
  }

  if (state.currentStrategy === 'architect') {
    return {
      shouldEscalate: true,
      nextStrategy: 'sweep',
      shouldStop: false,
      reason: 'circuit breaker: architect → sweep (3 consecutive rollbacks)',
    };
  }

  // currentStrategy === 'sweep'
  return {
    shouldEscalate: false,
    shouldStop: true,
    reason: 'exhausted all strategies: standard → architect → sweep all failed with 3 consecutive rollbacks',
  };
}

/**
 * Log a circuit breaker strategy switch event to .ratchet/run-state.json.
 * Non-fatal — errors are swallowed.
 */
async function logCircuitBreakerEvent(
  cwd: string,
  event: {
    from: string;
    to: string;
    reason: string;
    clickNumber: number;
    totalFailures: number;
    timestamp: string;
  },
): Promise<void> {
  try {
    const { writeFile, mkdir, readFile } = await import('fs/promises');
    const ratchetDir = join(cwd, '.ratchet');
    await mkdir(ratchetDir, { recursive: true });
    const statePath = join(ratchetDir, 'run-state.json');

    let existing: Record<string, unknown> = {};
    try {
      const raw = await readFile(statePath, 'utf-8');
      existing = JSON.parse(raw);
    } catch {
      // File doesn't exist yet — start fresh
    }

    const events = (existing.circuitBreakerEvents as unknown[]) ?? [];
    events.push(event);
    existing.circuitBreakerEvents = events;
    existing.lastCircuitBreakerSwitch = event;
    await writeFile(statePath, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (err) {
    logger.debug({ err }, '[circuit-breaker] Failed to write run-state.json (non-fatal)');
  }
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
    focusCategory,
    deepAnalyze = false,
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
          (agent as { strategyContext: string }).strategyContext = ctx;
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load/init strategy — continuing without it');
    }
  }

  // --- Repo context: inject familiarization context into agent prompts ---
  if (state.repoContext && 'repoContext' in agent) {
    (agent as { repoContext: string }).repoContext = state.repoContext;
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

  // --- Deep analysis (ReACT loop): multi-turn pre-click investigation ---
  let reactAnalysis: ReactAnalysis | undefined;
  if (deepAnalyze && state.currentScan) {
    try {
      reactAnalysis = await runDeepAnalyze(state.currentScan, state.target, cwd);
      run.reactAnalysis = reactAnalysis;
      logger.info(
        { confidence: reactAnalysis.confidence, risk: reactAnalysis.riskLevel },
        '[react] Deep analysis complete',
      );
    } catch (err) {
      logger.warn({ err }, '[react] Deep analysis failed — continuing without it');
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

      // Pop the next group of issues from the backlog
      // In harden mode, don't use backlog (focus on test writing)
      let clickIssues: IssueTask[] | undefined;
      if (!hardenMode && state.backlogGroups.length > 0) {
        // Skip blacklisted subcategories and architect-mode groups (in normal torque mode)
        while (state.backlogGroups.length > 0) {
          const nextGroup = state.backlogGroups[0]!;
          const subcat = nextGroup[0]?.subcategory ?? '';
          const allBlacklisted = nextGroup.every(t => state.blacklistedSubcategories.has(t.subcategory ?? ''));
          if (allBlacklisted) {
            logger.info({ subcategory: subcat }, 'Skipping blacklisted subcategory');
            state.backlogGroups.shift();
            continue;
          }
          // In normal torque mode (not sweep-escalated), skip architect-mode groups
          const isArchitectGroup = nextGroup.some(t => t.fixMode === 'architect');
          if (isArchitectGroup && !options.sweep && !state.escalated) {
            logger.info({ subcategory: subcat }, `⏭ Skipping ${subcat} — requires --architect mode`);
            state.backlogGroups.shift();
            continue;
          }
          break;
        }

        // Soft-skip: if front group has 2+ zero-delta lands, prefer a better alternative
        if (state.backlogGroups.length > 1) {
          const frontSubcat = state.backlogGroups[0]?.[0]?.subcategory ?? '';
          const frontZeroDelta = state.subcategoryStats.get(frontSubcat)?.zeroDeltaLands ?? 0;
          if (shouldSoftSkipSubcategory(frontZeroDelta)) {
            const betterIdx = state.backlogGroups.findIndex((g, idx) => {
              if (idx === 0) return false;
              const subcat = g[0]?.subcategory ?? '';
              if (g.every(t => state.blacklistedSubcategories.has(t.subcategory ?? ''))) return false;
              if (g.some(t => t.fixMode === 'architect') && !options.sweep && !state.escalated) return false;
              return (state.subcategoryStats.get(subcat)?.zeroDeltaLands ?? 0) < 2;
            });
            if (betterIdx !== -1) {
              const [betterGroup] = state.backlogGroups.splice(betterIdx, 1);
              state.backlogGroups.unshift(betterGroup!);
              logger.info(
                { from: frontSubcat, to: betterGroup![0]?.subcategory },
                `Soft-skipping ${frontSubcat} (2 zero-delta lands) — trying ${betterGroup![0]?.subcategory ?? 'alternative'} first`,
              );
            }
          }
        }

        if (state.backlogGroups.length > 0) {
          clickIssues = state.backlogGroups.shift();
        }
      }

      // Pre-validation gate: check for false positives before starting the click.
      // If all issues in this group are false positives (pattern only in comments/strings/docs),
      // skip without spending a click slot (decrement i so the loop counter doesn't advance).
      if (clickIssues && clickIssues.length > 0) {
        const prevalidation = await prevalidateIssues(clickIssues, cwd);
        if (prevalidation.falsePositives.length > 0) {
          run.falsePositivesFound = (run.falsePositivesFound ?? 0) + prevalidation.falsePositives.length;
          if (prevalidation.validIssues.length === 0) {
            run.skippedClicks = (run.skippedClicks ?? 0) + 1;
            const fpCount = prevalidation.falsePositives.length;
            logger.info(`[ratchet] ⏭ Click ${i} — skipped (${fpCount} false positive(s) filtered)`);
            i--;
            continue;
          }
          clickIssues = prevalidation.validIssues;
        }
      }

      await callbacks.onClickStart?.(i, clicks, hardenPhase);

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
          i, click, rolled_back, clickEconomics, state,
          scoreOptimized, cwd, incrementalScanner, callbacks, focusCategory,
        ));

        // APIAgent (non-Anthropic) can only do tight/atomic edits — never escalate to sweep/architect
        const isAPIAgent = 'clickGuards' in agent;
        await checkStallAndEscalate(i, clicks, state, hardenMode, escalateEnabled && !isAPIAgent, callbacks, focusCategory);

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

        // Global diminishing-returns detector: track last 3 click score deltas.
        // Supplement to the per-subcategory system above.
        state.recentScoreDeltas.push(clickDelta);
        if (state.recentScoreDeltas.length > 3) {
          state.recentScoreDeltas.shift();
        }

        // Subcategory blacklist tracking: accumulate per-subcategory rollback /
        // zero-delta-land stats and manage skip/blacklist behavior:
        //   - 2 zero-delta lands for SAME subcategory → soft-skip (try alternatives first)
        //   - 3 zero-delta lands for SAME subcategory → blacklist (skip permanently)
        //   - 2+ rollbacks for SAME subcategory → blacklist
        //   - 3+ total zero-delta lands across all subcategories → escalate to sweep
        const targetSubcategory = clickIssues?.[0]?.subcategory;
        if (targetSubcategory) {
          const stats = state.subcategoryStats.get(targetSubcategory) ?? { rollbacks: 0, zeroDeltaLands: 0 };
          if (rolled_back) {
            stats.rollbacks++;
          } else if (!rolled_back && click.testsPassed && clickEconomics && clickEconomics.scoreDelta === 0) {
            stats.zeroDeltaLands++;
          }
          state.subcategoryStats.set(targetSubcategory, stats);

          if (!state.blacklistedSubcategories.has(targetSubcategory)) {
            if (stats.rollbacks >= 2 || stats.zeroDeltaLands >= 3) {
              state.blacklistedSubcategories.add(targetSubcategory);
              logger.warn(
                { subcategory: targetSubcategory, rollbacks: stats.rollbacks, zeroDeltaLands: stats.zeroDeltaLands },
                'Subcategory blacklisted — skipping in future clicks',
              );
            } else if (stats.zeroDeltaLands === 2) {
              logger.info(
                { subcategory: targetSubcategory, zeroDeltaLands: stats.zeroDeltaLands },
                'Subcategory soft-skipped (2 zero-delta lands) — will try alternatives next click',
              );
            }
          }

          // If total zero-delta lands across all subcategories reaches threshold,
          // log a hint so the plateau detection can escalate to sweep mode.
          const totalZeroDeltaLands = [...state.subcategoryStats.values()].reduce(
            (sum, s) => sum + s.zeroDeltaLands, 0,
          );
          if (shouldEscalateOnTotalZeroDelta(totalZeroDeltaLands) && !rolled_back && !run.sweepEscalated) {
            logger.info(
              { totalZeroDeltaLands, subcategory: targetSubcategory },
              'Total zero-delta lands reached threshold — sweep escalation may trigger on next plateau check',
            );
          }
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

        // APIAgent cannot handle sweep/architect mode — skip smart escalation entirely
        const { shouldStop } = isAPIAgent
          ? { shouldStop: false }
          : await checkSmartStop(i, run, state, options);
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
            // Instead of just stopping, try to escalate to sweep mode first.
            // The current backlog item may be non-sweepable (e.g. auth) while sweepable
            // items with many files (line-length, console cleanup) exist lower in the backlog.
            const remainingClicks = clicks - i;
            if (!run.sweepEscalated && remainingClicks > 0 && state.currentScan) {
              const fullBacklog = buildScoreOptimizedBacklog(state.currentScan);
              const bestSweepable = fullBacklog.find(
                (task) => task.subcategory && isSweepable(task.subcategory) && (task.sweepFiles?.length ?? 0) > 0,
              );
              if (bestSweepable?.subcategory) {
                logger.info(
                  { reason: 'plateau → sweep', subcategory: bestSweepable.subcategory, files: bestSweepable.sweepFiles?.length, remainingClicks },
                  '⚡ Plateau detected — escalating to sweep mode on best sweepable category',
                );
                await options.callbacks?.onSweepEscalate?.('plateau', bestSweepable.subcategory);
                const sweepRun = await runSweepEngine({
                  ...options,
                  clicks: remainingClicks,
                  createBranch: false,
                  scanResult: state.currentScan,
                  clickOffset: i,
                  category: bestSweepable.subcategory,
                });
                run.clicks.push(...sweepRun.clicks);
                run.sweepEscalated = true;
                run.sweepEscalatedAtClick = i;
                run.sweepEscalatedCategory = bestSweepable.subcategory;
                break;
              }
            }
            // No sweepable categories — fall through to stop
            run.earlyStopReason = plateauStop.earlyStopReason;
            logger.info({ reason: plateauStop.earlyStopReason }, 'Plateau detected');
            break;
          }
        }

        // Global diminishing-returns detector (supplement to plateau detection above).
        // Fires when all 3 most-recent click deltas are zero — simpler global guard.
        if (!hardenMode) {
          const drStop = checkDiminishingReturns(state.recentScoreDeltas, i + 1);
          if (drStop.stop && !run.earlyStopReason) {
            run.earlyStopReason = drStop.earlyStopReason;
            logger.info({ reason: drStop.earlyStopReason, recentDeltas: state.recentScoreDeltas }, 'Diminishing returns stop');
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
