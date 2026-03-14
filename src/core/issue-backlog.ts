import type { ScanResult } from '../commands/scan.js';

export interface IssueTask {
  category: string;
  subcategory: string;
  description: string;
  count: number;
  severity: 'low' | 'medium' | 'high';
  priority: number; // computed: severity_weight * count * gap_ratio
}

const SEVERITY_WEIGHT: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Build a prioritized backlog of issues from a scan result.
 * Priority = severity_weight * capped_count * gap_ratio
 * where gap_ratio = (max - score) / max for the parent subcategory.
 *
 * Count is log-capped so massive issue counts (e.g. 117 files without tests)
 * don't monopolize every click over smaller but more fixable issues.
 * log2(117) ≈ 6.9 vs log2(7) ≈ 2.8 — still prefers larger issues but not 17x more.
 */
export function buildBacklog(scan: ScanResult): IssueTask[] {
  const tasks: IssueTask[] = [];

  for (const issue of scan.issuesByType) {
    // Find the parent subcategory score to compute gap ratio
    let gapRatio = 1; // default: full gap if we can't find it

    for (const cat of scan.categories) {
      if (cat.name === issue.category) {
        for (const sub of cat.subcategories) {
          if (sub.name === issue.subcategory) {
            const maxScore = sub.max;
            if (maxScore > 0) {
              gapRatio = (maxScore - sub.score) / maxScore;
            }
            break;
          }
        }
        break;
      }
    }

    const severityWeight = SEVERITY_WEIGHT[issue.severity] ?? 1;
    // Cap count influence: log2(count+1) so 117→6.9, 7→3.0, 1→1.0
    const cappedCount = Math.log2(issue.count + 1);
    const priority = severityWeight * cappedCount * gapRatio;

    tasks.push({
      category: issue.category,
      subcategory: issue.subcategory,
      description: issue.description,
      count: issue.count,
      severity: issue.severity,
      priority,
    });
  }

  // Sort highest priority first
  tasks.sort((a, b) => b.priority - a.priority);

  return tasks;
}

/**
 * Group tasks by subcategory. Returns groups in priority order (highest first).
 * Groups are capped at maxPerGroup issues to keep clicks focused and passable.
 * Overflow spills into additional groups so nothing is lost.
 */
export function groupBacklogBySubcategory(tasks: IssueTask[], maxPerGroup = 3): IssueTask[][] {
  const grouped = new Map<string, IssueTask[]>();

  for (const task of tasks) {
    const key = `${task.category}::${task.subcategory}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(task);
  }

  // Chunk each group into maxPerGroup-sized batches
  const result: IssueTask[][] = [];
  for (const group of grouped.values()) {
    for (let i = 0; i < group.length; i += maxPerGroup) {
      result.push(group.slice(i, i + maxPerGroup));
    }
  }

  // Sort batches by highest priority of first task
  result.sort((a, b) => (b[0]?.priority ?? 0) - (a[0]?.priority ?? 0));

  return result;
}

/**
 * Format a list of issues for display in prompts.
 */
export function formatIssuesForPrompt(issues: IssueTask[]): string {
  return issues
    .map((t) => `- [${t.severity.toUpperCase()}] ${t.count} ${t.description} (${t.category} > ${t.subcategory})`)
    .join('\n');
}
