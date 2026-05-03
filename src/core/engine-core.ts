import { join } from "path";
import type { ScanResult } from "./scanner/index.js";
import type { CategoryDelta, Click, ClickEconomics, HighRiskChange, RatchetRun, HardenPhase } from "../types.js";
import { isSweepable } from "./score-optimizer.js";
import { detectChanges } from "./gitnexus.js";
import { logger } from "../lib/logger.js";

/** Circuit breaker tracks consecutive / total failures and current strategy. */
export interface CircuitBreakerState {
  consecutiveFailures: number;
  currentStrategy: "standard" | "architect" | "sweep";
  strategiesExhausted: string[];
  totalFailures: number;
  maxTotalFailures: number;
}

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
  const landed = clicks.filter(c => c.outcome === "landed");
  const rolledBack = clicks.filter(c => c.outcome !== "landed");
  const timedOut = clicks.filter(c => c.outcome === "timeout");
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

  if (rollbackRate > 0.3) {
    recs.push(`${rolledBack.length}/${total} clicks rolled back — consider --plan-first to reduce wasted iterations`);
  }
  if (timeoutRate > 0.15) {
    recs.push(`${timedOut.length} timeout(s) detected — consider --timeout 900 for complex refactors`);
  }
  if (scoreDelta === 0 && total > 0) {
    recs.push("Score delta is zero — consider --architect --guards refactor for structural improvements");
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

export interface RunSummary {
  id: string;
  target: string;
  totalClicks: number;
  passed: number;
  failed: number;
  commits: string[];
  duration: number;
  status: RatchetRun["status"];
}

export function summarizeRun(run: RatchetRun): RunSummary {
  const passed = run.clicks.filter(c => c.testsPassed).length;
  const failed = run.clicks.filter(c => !c.testsPassed).length;
  const duration = run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : 0;

  return {
    id: run.id,
    target: run.target.name,
    totalClicks: run.clicks.length,
    passed,
    failed,
    commits: run.clicks.filter(c => c.commitHash).map(c => c.commitHash!),
    duration,
    status: run.status,
  };
}

export type ClickPhase = "analyzing" | "proposing" | "building" | "testing" | "committing";
export type { HardenPhase };

// ── Stop-condition helpers (exported for testing) ──────────────────────────

/**
 * Given the top backlog issue's subcategory, decide whether a stall should escalate
 * to sweep mode or architect mode.
 * Pure function — no side effects.
 *
 * Returns 'sweep' when the subcategory is marked sweepable in SUBCATEGORY_TIERS,
 * otherwise returns 'architect'.
 */
export function resolveEscalationMode(topTaskSubcategory: string | undefined): "sweep" | "architect" {
  if (topTaskSubcategory && isSweepable(topTaskSubcategory)) return "sweep";
  return "architect";
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
  enabled: boolean
): { shouldEscalate: boolean; reason?: string } {
  if (!enabled) return { shouldEscalate: false };
  if (consecutiveRollbacks >= 3) {
    return { shouldEscalate: true, reason: "3 consecutive rollbacks" };
  }
  if (totalLanded === 0 && totalRolled >= 3) {
    return { shouldEscalate: true, reason: "all clicks stalled with 0 landed" };
  }
  // 50% rollback rate guard: if at least half of all attempts have been rolled back
  // and the last click also rolled back, the run is clearly stalling.
  const totalAttempted = totalLanded + totalRolled;
  if (totalAttempted >= 3 && consecutiveRollbacks >= 1 && totalRolled / totalAttempted >= 0.5) {
    return { shouldEscalate: true, reason: "50% rollback rate" };
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
  prevTotal: number
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
  clickNumber: number
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
  budgetUsd: number
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
  totalClicks: number
): { stop: boolean; earlyStopReason?: string } {
  if (totalClicks < 3) return { stop: false };
  if (recentScoreDeltas.length < 3) return { stop: false };
  const lastThree = recentScoreDeltas.slice(-3);
  if (lastThree.every(d => d === 0)) {
    return {
      stop: true,
      earlyStopReason: "diminishing returns — 3 consecutive zero-delta clicks",
    };
  }
  return { stop: false };
}

/** Returns stop=true when N consecutive clicks all had zero score delta (plateau). */
export function checkPlateauStop(
  consecutiveZeroDeltaClicks: number,
  totalClicks: number
): { stop: boolean; earlyStopReason?: string } {
  if (totalClicks > 3 && consecutiveZeroDeltaClicks >= 3) {
    return { stop: true, earlyStopReason: "Score plateau detected (3 consecutive zero-delta clicks)" };
  }
  return { stop: false };
}

/** Returns stop=true when a score regression was detected and --stop-on-regression is active. */
export function checkRegressionStop(
  regressionDetected: boolean,
  rollbackReason?: string
): { stop: boolean; earlyStopReason?: string } {
  if (!regressionDetected) return { stop: false };
  const match = rollbackReason?.match(/(\d+) → (\d+)/);
  const detail = match ? `${match[1]} → ${match[2]}` : "";
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
  nextStrategy?: "architect" | "sweep";
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

  if (state.currentStrategy === "standard") {
    return {
      shouldEscalate: true,
      nextStrategy: "architect",
      shouldStop: false,
      reason: "circuit breaker: standard → architect (3 consecutive rollbacks)",
    };
  }

  if (state.currentStrategy === "architect") {
    return {
      shouldEscalate: true,
      nextStrategy: "sweep",
      shouldStop: false,
      reason: "circuit breaker: architect → sweep (3 consecutive rollbacks)",
    };
  }

  // currentStrategy === 'sweep'
  return {
    shouldEscalate: false,
    shouldStop: true,
    reason: "exhausted all strategies: standard → architect → sweep all failed with 3 consecutive rollbacks",
  };
}

/**
 * Log a circuit breaker strategy switch event to .ratchet/run-state.json.
 * Non-fatal — errors are swallowed.
 */
export async function logCircuitBreakerEvent(
  cwd: string,
  event: {
    from: string;
    to: string;
    reason: string;
    clickNumber: number;
    totalFailures: number;
    timestamp: string;
  }
): Promise<void> {
  try {
    const { writeFile, mkdir, readFile } = await import("fs/promises");
    const ratchetDir = join(cwd, ".ratchet");
    await mkdir(ratchetDir, { recursive: true });
    const statePath = join(ratchetDir, "run-state.json");

    let existing: Record<string, unknown> = {};
    try {
      const raw = await readFile(statePath, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      // File doesn't exist yet — start fresh
    }

    const events = (existing.circuitBreakerEvents as unknown[]) ?? [];
    events.push(event);
    existing.circuitBreakerEvents = events;
    existing.lastCircuitBreakerSwitch = event;
    await writeFile(statePath, JSON.stringify(existing, null, 2), "utf-8");
  } catch (err) {
    logger.debug({ err }, "[circuit-breaker] Failed to write run-state.json (non-fatal)");
  }
}

// ── GitNexus confidence gating ──────────────────────────────────────────────

/**
 * HIGH_RISK_LEVELS — these risk levels trigger confidence gating.
 * If confidence > CONFIDENCE_THRESHOLD, the click is flagged for warning/rollback.
 */
const HIGH_RISK_LEVELS = new Set(["HIGH", "CRITICAL", "high", "critical"]);
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Run confidence-based risk gating on modified files after a click lands.
 * Returns high-risk changes that exceed the confidence threshold.
 * Non-blocking async — called before committing.
 */
export async function runConfidenceGating(filesModified: string[], cwd: string): Promise<HighRiskChange[]> {
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
