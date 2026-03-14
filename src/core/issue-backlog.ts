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
 * Priority = severity_weight * count * gap_ratio
 * where gap_ratio = (max - score) / max for the parent subcategory.
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
    const priority = severityWeight * issue.count * gapRatio;

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
 */
export function groupBacklogBySubcategory(tasks: IssueTask[]): IssueTask[][] {
  const groups = new Map<string, IssueTask[]>();

  for (const task of tasks) {
    const key = `${task.category}::${task.subcategory}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(task);
  }

  // Return as array of groups, preserving the priority order of the first task in each group
  return Array.from(groups.values());
}

/**
 * Format a list of issues for display in prompts.
 */
export function formatIssuesForPrompt(issues: IssueTask[]): string {
  return issues
    .map((t) => `- [${t.severity.toUpperCase()}] ${t.count} ${t.description} (${t.category} > ${t.subcategory})`)
    .join('\n');
}
