import type { HighRiskChange } from "../types.js";
import { detectChanges } from "./gitnexus.js";
import { logger } from "../lib/logger.js";

// ── Scoring algorithms and validation ────────────────────────────────────

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

// ── GitNexus confidence gating ────────────────────────────────────────────

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
