import type { ScanResult } from '../commands/scan.js';
import { assessFileRisk, getDependencyClusters } from './gitnexus.js';
import { SEVERITY_WEIGHT } from './taxonomy.js';

export interface IssueTask {
  category: string;
  subcategory: string;
  description: string;
  count: number;
  severity: 'low' | 'medium' | 'high';
  priority: number; // computed: severity_weight * count * gap_ratio
  sweepFiles?: string[];
  riskScore?: number; // 0–1 blast radius risk from GitNexus
  /** If set, this task carries a pre-built architect prompt to use verbatim */
  architectPrompt?: string;
}

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
      sweepFiles: issue.locations ?? [],
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
 * Enrich backlog tasks with blast-radius risk scores from GitNexus.
 * High-impact files (many dependents) get LOWER priority for risky changes
 * and HIGHER priority for test coverage fixes.
 * Gracefully no-ops if GitNexus is not indexed.
 */
export function enrichBacklogWithRisk(tasks: IssueTask[], cwd: string): IssueTask[] {
  for (const task of tasks) {
    if (!task.sweepFiles || task.sweepFiles.length === 0) continue;

    // Average risk across sweep files (sample first 5 to avoid slowness)
    const sample = task.sweepFiles.slice(0, 5);
    let totalRisk = 0;
    for (const file of sample) {
      totalRisk += assessFileRisk(file, cwd);
    }
    const avgRisk = sample.length > 0 ? totalRisk / sample.length : 0;
    task.riskScore = avgRisk;

    // Adjust priority: high-risk files should be deprioritized for structural changes
    // but prioritized for test coverage (safety-first)
    const isTestCoverage = task.subcategory.toLowerCase().includes('test') ||
      task.subcategory.toLowerCase().includes('coverage');

    if (isTestCoverage) {
      // High-impact code NEEDS tests more — boost priority
      task.priority *= (1 + avgRisk);
    } else {
      // High-impact code is RISKIER to change — reduce priority
      task.priority *= (1 - avgRisk * 0.5);
    }
  }

  // Re-sort after risk adjustment
  tasks.sort((a, b) => b.priority - a.priority);
  return tasks;
}

/**
 * Group sweep files into dependency clusters using GitNexus.
 * Tightly-coupled files (shared imports) are grouped together so a sweep click
 * can fix related files in the same pass. Falls back to chunking if GitNexus is unavailable.
 */
export function groupByDependencyCluster(
  files: string[],
  cwd: string,
  maxPerCluster = 6,
): string[][] {
  const clusters = getDependencyClusters(files, cwd);

  // Split large clusters into chunks of maxPerCluster
  const result: string[][] = [];
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.length; i += maxPerCluster) {
      result.push(cluster.slice(i, i + maxPerCluster));
    }
  }
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
