/**
 * Smart Issue Router — filters the issue backlog based on agent capability.
 *
 * APIAgent (free tier, 1 file / 20 lines) can only handle:
 *   - torque-mode issues (single file)
 *   - effort ≤ 2 (trivial/easy)
 *   - issues with specific file locations (not project-wide)
 *   - never coverage/test-related issues
 *
 * ShellAgent (pro tier) handles everything.
 */

import type { IssueTask } from './issue-backlog.js';
import { SUBCATEGORY_TIERS } from './score-optimizer.js';
import { transformRegistry } from './transforms/registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Subcategory/category patterns that indicate test-related issues APIAgent can't fix */
const TEST_PATTERNS = [
  'test', 'coverage', 'spec', 'assertion', 'mock', 'stub', 'e2e', 'integration test',
];

function isTestRelated(issue: IssueTask): boolean {
  const cat = issue.category.toLowerCase();
  const sub = issue.subcategory.toLowerCase();
  if (cat === 'testing') return true;
  return TEST_PATTERNS.some(p => sub.includes(p));
}

/** Look up effortPerFix for a subcategory from SUBCATEGORY_TIERS (default: 3 = moderate). */
function getEffortPerFix(issue: IssueTask): number {
  const tier = SUBCATEGORY_TIERS.find(t => t.name === issue.subcategory);
  return tier?.effortPerFix ?? 3;
}

/** Returns true if any registered AST transform matches this issue's subcategory or message. */
export function hasASTTransformMatch(issue: IssueTask): boolean {
  for (const transform of transformRegistry.values()) {
    const matched = transform.matchesFindings.some(
      pattern =>
        issue.subcategory.toLowerCase().includes(pattern.toLowerCase()) ||
        issue.description.toLowerCase().includes(pattern.toLowerCase()),
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
export function canFixWithAgent(issue: IssueTask, agentType: 'api' | 'shell'): boolean {
  if (agentType === 'shell') return true;

  // APIAgent hard constraints
  if (isTestRelated(issue)) return false;
  if (issue.fixMode !== 'torque') return false;
  if (getEffortPerFix(issue) > 2) return false;
  if ((issue.sweepFiles?.length ?? 0) === 0) return false;

  return true;
}

/**
 * Filter and sort the backlog for the given agent type.
 *
 * - For 'shell': returns the full backlog unchanged.
 * - For 'api': removes ineligible issues and sorts AST-matchable issues first
 *   (those have guaranteed fixes without requiring the LLM).
 */
export function routeIssues(backlog: IssueTask[], agentType: 'api' | 'shell'): IssueTask[] {
  if (agentType === 'shell') return backlog;

  const eligible = backlog.filter(issue => canFixWithAgent(issue, agentType));

  // Sort: AST-transform-matchable issues first (guaranteed fix), then by priority
  eligible.sort((a, b) => {
    const aAst = hasASTTransformMatch(a) ? 1 : 0;
    const bAst = hasASTTransformMatch(b) ? 1 : 0;
    if (bAst !== aAst) return bAst - aAst;
    return b.priority - a.priority;
  });

  return eligible;
}
