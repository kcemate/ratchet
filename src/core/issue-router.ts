/**
 * Smart Issue Router — filters the issue backlog based on agent capability.
 *
 * APIAgent (free tier, 1 file / 20 lines) can only handle:
 *   - torque-mode issues (single file)
 *   - effort ≤ 2 (trivial/easy)
 *   - issues with specific file locations (not project-wide)
 *   - never coverage/test-related issues
 *   - estimated work fits within budget (≤ APIAGENT_MAX_FILES files, ≤ APIAGENT_MAX_LINES lines)
 *
 * ShellAgent (pro tier) handles everything.
 */

import type { IssueTask } from "./issue-backlog.js";
import { SUBCATEGORY_TIERS } from "./score-optimizer.js";
import { transformRegistry } from "./transforms/registry.js";

// ---------------------------------------------------------------------------
// Budget constants
// ---------------------------------------------------------------------------

/** APIAgent maximum files per click */
const APIAGENT_MAX_FILES = 1;
/** APIAgent maximum lines per click */
const APIAGENT_MAX_LINES = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeasibilityResult {
  eligible: IssueTask[];
  skipped: IssueTask[];
  reasons: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Subcategory/category patterns that indicate test-related issues APIAgent can't fix */
const TEST_PATTERNS = ["test", "coverage", "spec", "assertion", "mock", "stub", "e2e", "integration test"];

function isTestRelated(issue: IssueTask): boolean {
  const cat = issue.category.toLowerCase();
  const sub = issue.subcategory.toLowerCase();
  if (cat === "testing") return true;
  return TEST_PATTERNS.some(p => sub.includes(p));
}

/** Look up effortPerFix for a subcategory from SUBCATEGORY_TIERS (default: 3 = moderate). */
function getEffortPerFix(issue: IssueTask): number {
  const tier = SUBCATEGORY_TIERS.find(t => t.name === issue.subcategory);
  return tier?.effortPerFix ?? 3;
}

/**
 * Estimate the total work for this issue.
 * linesNeeded  ≈ effortPerFix × count  (each occurrence takes ~effortPerFix lines)
 * filesNeeded  ≈ number of distinct files (sweepFiles.length, min 1)
 */
export function estimateEffort(issue: IssueTask): { filesNeeded: number; linesNeeded: number } {
  const effortPerFix = getEffortPerFix(issue);
  const count = issue.count ?? 1;
  const filesNeeded = Math.max(issue.sweepFiles?.length ?? 1, 1);
  const linesNeeded = effortPerFix * count;
  return { filesNeeded, linesNeeded };
}

/** Returns true if any registered AST transform matches this issue's subcategory or message. */
export function hasASTTransformMatch(issue: IssueTask): boolean {
  for (const transform of transformRegistry.values()) {
    const matched = transform.matchesFindings.some(
      pattern =>
        issue.subcategory.toLowerCase().includes(pattern.toLowerCase()) ||
        issue.description.toLowerCase().includes(pattern.toLowerCase())
    );
    if (matched) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the given issue can be fixed by the specified agent type.
 *
 * APIAgent constraints:
 *   - fixMode must be 'torque' (single-file edits only)
 *   - effortPerFix ≤ 2 (trivial/easy — fits in 20 lines)
 *   - must have specific file locations (no project-wide issues)
 *   - must not be test/coverage-related
 */
export function canFixWithAgent(issue: IssueTask, agentType: "api" | "shell"): boolean {
  if (agentType === "shell") return true;

  // APIAgent hard constraints
  if (isTestRelated(issue)) return false;
  if (issue.fixMode !== "torque") return false;
  if (getEffortPerFix(issue) > 2) return false;
  if ((issue.sweepFiles?.length ?? 0) === 0) return false;

  return true;
}

/**
 * Filter and sort the backlog for the given agent type.
 *
 * - For 'shell': returns all issues as eligible, none skipped.
 * - For 'api': removes ineligible issues, estimates effort, marks as SKIP_FREE if
 *   estimated work exceeds the APIAgent budget (APIAGENT_MAX_FILES files, APIAGENT_MAX_LINES lines),
 *   and sorts AST-matchable issues first (deterministic, guaranteed to land).
 *
 * Returns a FeasibilityResult with eligible, skipped, and per-issue skip reasons.
 */
export function routeIssues(backlog: IssueTask[], agentType: "api" | "shell"): FeasibilityResult {
  if (agentType === "shell") {
    return { eligible: [...backlog], skipped: [], reasons: new Map() };
  }

  const eligible: IssueTask[] = [];
  const skipped: IssueTask[] = [];
  const reasons = new Map<string, string>();

  const issueKey = (issue: IssueTask) => `${issue.category}::${issue.subcategory}`;

  for (const issue of backlog) {
    // Hard capability filter
    if (!canFixWithAgent(issue, agentType)) {
      skipped.push(issue);
      const reason = isTestRelated(issue)
        ? "test-related issue"
        : issue.fixMode !== "torque"
          ? `fixMode=${issue.fixMode} requires shell agent`
          : (issue.sweepFiles?.length ?? 0) === 0
            ? "no file locations"
            : "effort too high";
      reasons.set(issueKey(issue), `SKIP_FREE: ${reason}`);
      continue;
    }

    // Effort estimation gate: skip if estimated work exceeds APIAgent budget
    const { filesNeeded, linesNeeded } = estimateEffort(issue);
    if (filesNeeded > APIAGENT_MAX_FILES || linesNeeded > APIAGENT_MAX_LINES) {
      skipped.push(issue);
      reasons.set(
        issueKey(issue),
        `SKIP_FREE: estimated effort too large (${filesNeeded} files, ${linesNeeded} lines > budget ${APIAGENT_MAX_FILES}/${APIAGENT_MAX_LINES})`
      );
      continue;
    }

    eligible.push(issue);
  }

  // Sort: AST-transform-matchable issues first (guaranteed fix), then by priority
  eligible.sort((a, b) => {
    const aAst = hasASTTransformMatch(a) ? 1 : 0;
    const bAst = hasASTTransformMatch(b) ? 1 : 0;
    if (bAst !== aAst) return bAst - aAst;
    return b.priority - a.priority;
  });

  return { eligible, skipped, reasons };
}
