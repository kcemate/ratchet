import { SUBCATEGORY_TIERS } from "./score-optimizer.js";
import { isBlacklisted } from "./feedback.js";
import { logger } from "../lib/logger.js";
import type { IssueTask } from "./issue-backlog.js";

export interface FixabilityScore {
  issueId: string;
  impactScore: number; // 0-1, how much fixing this moves the score
  fixabilityScore: number; // 0-1, can a bounded single/few-file edit solve this?
  recommendation: "api-agent" | "shell-agent" | "architect" | "skip";
  reason: string;
}

const EFFORT_SCORE: Record<number, number> = {
  1: 1.0,
  2: 0.8,
  3: 0.6,
  4: 0.4,
  5: 0.2,
};

function computeFileSpreadScore(fileCount: number): number {
  if (fileCount <= 1) return 1.0;
  if (fileCount <= 3) return 0.8;
  if (fileCount <= 10) return 0.5;
  return 0.2;
}

function computeFixModeScore(fixMode: IssueTask["fixMode"]): number {
  switch (fixMode) {
    case "torque":
      return 1.0;
    case "sweep":
      return 0.6;
    case "architect":
      return 0.3;
    default:
      return 0.6; // unknown → treat as sweep
  }
}

function computeRecommendation(score: number): FixabilityScore["recommendation"] {
  if (score >= 0.8) return "api-agent";
  if (score >= 0.5) return "shell-agent";
  if (score >= 0.3) return "architect";
  return "skip";
}

/**
 * Score a single issue for fixability before routing it to an agent.
 *
 * Signals:
 * 1. File spread (sweepFiles.length)
 * 2. Fix mode (torque > sweep > architect)
 * 3. Effort per fix (from SUBCATEGORY_TIERS)
 * 4. Cross-cutting penalty (if fileCount > 10)
 * 5. Feedback loop blacklist (if 3+ prior failures in .ratchet/feedback.json)
 */
export function classifyFixability(task: IssueTask, repoFileCount: number, cwd?: string): FixabilityScore {
  const issueId = task.subcategory;
  const fileCount = task.sweepFiles?.length ?? 0;

  // Signal 1: file spread
  const spreadScore = computeFileSpreadScore(fileCount);

  // Signal 2: fix mode
  const modeScore = computeFixModeScore(task.fixMode);

  // Signal 3: effort per fix from tier metadata
  const tier = SUBCATEGORY_TIERS.find(t => t.name === task.subcategory);
  const effort = tier?.effortPerFix ?? 3;
  const effortScore = EFFORT_SCORE[effort] ?? 0.6;

  // Weighted combination (file spread is the strongest signal)
  const baseScore = spreadScore * 0.4 + modeScore * 0.3 + effortScore * 0.3;

  // Signal 4: cross-cutting penalty — if already penalised (>10 files), reduce further
  const crossCuttingPenalty = fileCount > 10 ? 10 / fileCount : 1.0;
  const afterPenalty = crossCuttingPenalty < 1.0 ? baseScore * crossCuttingPenalty : baseScore;

  // Signal 5: feedback loop — zero out if this issue+strategy has failed >= 3 times
  const strategy = task.fixMode ?? "torque";
  let fixabilityScore = afterPenalty;
  let feedbackBlacklisted = false;

  if (cwd !== undefined) {
    try {
      feedbackBlacklisted = isBlacklisted(cwd, issueId, strategy);
    } catch (err) {
      logger.debug({ err, issueId }, "fixability: failed to read feedback store");
    }
  }

  if (feedbackBlacklisted) {
    fixabilityScore = 0.0;
  }

  // Clamp to [0, 1]
  fixabilityScore = Math.max(0, Math.min(1, fixabilityScore));

  // Impact score: normalised from task priority (most ROI-based priorities are 0–100)
  const impactScore = Math.min(1, Math.max(0, task.priority / 100));

  const recommendation = computeRecommendation(fixabilityScore);

  const reasons: string[] = [];
  if (feedbackBlacklisted) {
    reasons.push(`blacklisted: 3+ failed attempts for ${issueId}+${strategy}`);
  } else {
    if (fileCount > 10) reasons.push(`${fileCount} files (cross-cutting)`);
    if (task.fixMode === "architect") reasons.push("architect-mode issue");
    if (effort >= 4) reasons.push(`high effort (${effort}/5)`);
  }
  const reason =
    reasons.length > 0
      ? reasons.join("; ")
      : `fixable — spread=${spreadScore.toFixed(2)}, mode=${modeScore.toFixed(2)}, effort=${effortScore.toFixed(2)}`;

  logger.debug({ issueId, fixabilityScore, recommendation, reason }, "fixability: classified");

  return { issueId, impactScore, fixabilityScore, recommendation, reason };
}

/**
 * Split a task list into actionable (fixabilityScore >= threshold) and deferred.
 * Default threshold 0.3 keeps api-agent, shell-agent, and architect candidates;
 * callers can raise to 0.8 to restrict to api-agent-only.
 */
export function filterByFixability(
  tasks: IssueTask[],
  repoFileCount: number,
  threshold = 0.3,
  cwd?: string
): { actionable: IssueTask[]; deferred: IssueTask[] } {
  const actionable: IssueTask[] = [];
  const deferred: IssueTask[] = [];

  for (const task of tasks) {
    const score = classifyFixability(task, repoFileCount, cwd);
    if (score.fixabilityScore >= threshold) {
      actionable.push(task);
    } else {
      deferred.push(task);
    }
  }

  return { actionable, deferred };
}
