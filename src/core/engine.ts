import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join, isAbsolute, resolve } from 'path';
import type { RatchetRun, Target, RatchetConfig, Click, HardenPhase, CategoryDelta, ClickEconomics, ClickGuards } from '../types.js';
import type { Agent } from './agents/base.js';
import type { IssueTask } from './issue-backlog.js';
import { buildBacklog, groupBacklogBySubcategory, enrichBacklogWithRisk, groupByDependencyCluster } from './issue-backlog.js';
import { buildScoreOptimizedBacklog } from './score-optimizer.js';
import { executeClick } from './click.js';
import { SwarmExecutor } from './swarm.js';
import * as git from './git.js';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';
import type { LearningStore } from './learning.js';
import { clearCache as clearGitNexusCache } from './gitnexus.js';
import { IncrementalScanner } from './scan-cache.js';
import { resolveGuards, nextGuardProfile, isGuardRejection } from './engine-guards.js';
import { validateScope } from './scope.js';
import { captureBaseline } from './test-isolation.js';
import { runPlanFirst } from './engine-plan.js';
import { runArchitectEngine } from './engine-architect.js';

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
  onClickScoreUpdate?: (clickNumber: number, scoreBefore: number, scoreAfter: number, delta: number) => Promise<void> | void;
  onEscalate?: (reason: string) => Promise<void> | void;
  onPlanStart?: () => Promise<void> | void;
  onPlanComplete?: (plan: import('../types.js').PlanResult) => Promise<void> | void;
  onRunEconomics?: (economics: RunEconomics) => Promise<void> | void;
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

// ── Run state ──────────────────────────────────────────

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
}

// ── Helpers ────────────────────────────────────────────

/**
 * Format a consistent rollback message for console.error output.
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
  const { config, cwd, createBranch = true, scoreOptimized = false, scope: scopeFiles = [], scopeArg } = options;
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
    console.error(formatRollbackMessage(clickNumber, click.rollbackReason, elapsedSec));
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
        console.error(`[ratchet] 🛡 Guard escalation: ${prevName} → ${next.name} (${state.consecutiveGuardRejections + 2} consecutive guard rejections)`);
        await callbacks.onEscalate?.(`guard escalation: ${prevName} → ${next.name}`);
      }
    }
  } else {
    console.error(`[ratchet] click ${clickNumber} LANDED (${elapsedSec}s)${click.commitHash ? ` — commit ${click.commitHash.slice(0, 7)}` : ''}`);
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
): Promise<{ rolled_back: boolean }> {
  if (!click.testsPassed || rolled_back || !state.currentScan) {
    return { rolled_back };
  }

  try {
    const newScan = await incrementalScanner.incrementalScan(state.currentScan);
    const newTotal = newScan.total;
    const delta = newTotal - state.previousTotal;

    // Score regression guard: if score dropped, revert the commit
    if (newTotal < state.previousTotal && click.commitHash) {
      const regressionDelta = state.previousTotal - newTotal;
      console.error(formatRollbackMessage(clickNumber, `score regression: ${state.previousTotal} → ${newTotal} (-${regressionDelta}pts)`));
      await git.revertLastCommit(cwd).catch(() => {});
      click.testsPassed = false;
      click.rollbackReason = `score regression: ${state.previousTotal} → ${newTotal} (-${regressionDelta}pts)`;
      click.commitHash = undefined;
      // Restore consecutive count from before the "landed" reset, then add this one
      state.consecutiveRollbacks = state.prevConsecutiveRollbacks + 1;
      state.totalLanded--;
      state.totalRolled++;
      return { rolled_back: true };
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
          const sign = cd.delta > 0 ? '+' : '';
          console.error(`   ${cd.category}: ${cd.before}/${cd.max} → ${cd.after}/${cd.max} (${sign}${cd.delta})${cd.issuesFixed > 0 ? ` — ${cd.issuesFixed} issues fixed` : ''}`);
        } else if (cd.wastedEffort) {
          console.error(`   ⚠ ${cd.category}: ${cd.before}/${cd.max} → ${cd.after}/${cd.max} — ${cd.issuesFixed} issues fixed but category already maxed`);
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

  return { rolled_back };
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
    console.error('[ratchet] 🔄 Stall detected — escalating to cross-file sweep mode');
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
        console.error(`[ratchet] 🏗️ Escalating to architect mode — ${remainingClicks} clicks remaining`);
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
        console.error(`[ratchet] ⏹ Smart stop — remaining issues need architect mode. ${state.totalLanded} cycles used, ${clicks - clickNumber} returned.`);
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
      console.error(`[ratchet] ⏹ Smart stop — ${run.earlyStopReason}. ${state.totalLanded} cycles used, ${clicks - clickNumber} returned.`);
      return { shouldStop: true };
    }
  }

  return { shouldStop: false };
}

// ── Engine ─────────────────────────────────────────────

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
  } = options;

  const { run, state, incrementalScanner, baselineFailures } = await initializeRun(options);

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
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, i)
              : undefined,
          });

          // Risk gate escalation: if single-agent was blocked, retry with swarm
          if (result.requiresSwarm) {
            console.error(`[ratchet] Escalating click ${i} to swarm mode (risk gate triggered)`);
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
            console.error(
              `[ratchet] click ${i} ROLLED BACK — scope violation: ${scopeValidation.scopeViolations.join(', ')}`,
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

        ({ rolled_back } = await postClickRescan(i, click, rolled_back, clickEconomics, state, scoreOptimized, cwd, incrementalScanner, callbacks));

        await checkStallAndEscalate(i, clicks, state, hardenMode, escalateEnabled, callbacks);

        run.clicks.push(click);
        if (clickEconomics) state.allEconomics.push(clickEconomics);
        await callbacks.onClickComplete?.(click, rolled_back);

        const { shouldStop } = await checkSmartStop(i, run, state, options);
        if (shouldStop) break;

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
      console.error(
        '[ratchet] All clicks rolled back. Possible causes:\n' +
        '  • Tests are failing before ratchet starts — run the test command manually to check\n' +
        '  • The agent is not making changes (check build output above)\n' +
        '  • Test suite is flaky or has a long timeout — check test output for details\n' +
        '  Tip: run ratchet scan --explain to understand what issues ratchet is trying to fix',
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
      await callbacks.onRunEconomics(economics).catch(() => {});
    }
    await callbacks.onRunComplete?.(run);
  }

  return run;
}
