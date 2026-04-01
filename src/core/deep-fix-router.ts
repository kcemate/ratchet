/**
 * Deep fix routing — classify findings and route to the right model tier.
 *
 * Mechanical fixes (formatting, imports, console.log) are cheap and should
 * use the sweep model tier (Haiku). Semantic fixes (logic bugs, security
 * vulnerabilities, error handling) require deeper reasoning and should use
 * the architect tier (Opus).
 */

import type { IssueType } from '../commands/scan.js';
import type { Provider } from './providers/base.js';
import { routeTask } from './providers/router.js';

/** Subcategories that are mechanical/formatting — cheap model is sufficient. */
export const MECHANICAL_SUBCATEGORIES = new Set([
  'Line length',
  'Import hygiene',
  'Console cleanup',
  'Dead code',
  'Function length',
  'Duplication',
]);

/** Classify a finding subcategory as mechanical or semantic. */
export function classifyFinding(subcategory: string): 'mechanical' | 'semantic' {
  return MECHANICAL_SUBCATEGORIES.has(subcategory) ? 'mechanical' : 'semantic';
}

/**
 * Given Deep findings, select the appropriate model tier for fix generation.
 *
 * - Any high-severity semantic issue → architect tier (best model)
 * - All high-severity issues are mechanical → sweep tier (cheapest model)
 * - No high-severity issues found → architect tier (safe default)
 */
export function routeDeepFix(
  issues: IssueType[],
  provider: Provider,
): { model: string | undefined; taskType: 'sweep' | 'architect' } {
  const highSeverity = issues.filter(i => i.severity === 'high');
  const hasSemantic = highSeverity.some(i => classifyFinding(i.subcategory) === 'semantic');
  // Default to architect when no high issues (conservative) or when semantic found
  const taskType = (highSeverity.length > 0 && !hasSemantic) ? 'sweep' : 'architect';
  return { model: routeTask(taskType, provider).model, taskType };
}
