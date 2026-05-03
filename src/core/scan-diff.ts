import type { ScanResult, IssueType } from "../core/scanner";

export interface ScanDiff {
  /** Issues that are new in the after scan (not in before) */
  newIssues: IssueType[];
  /** Issues that exist in both scans (persisting) */
  persistingIssues: IssueType[];
  /** Issues that were in before but gone in after (fixed) */
  fixedIssues: IssueType[];
  /** Net change in total issue count */
  issueCountDelta: number;
}

/**
 * Diff two scan results to find what changed.
 * Keyed by category::subcategory for stable comparison.
 */
export function diffScans(before: ScanResult, after: ScanResult): ScanDiff {
  const beforeMap = new Map<string, IssueType>();
  for (const issue of before.issuesByType) {
    beforeMap.set(`${issue.category}::${issue.subcategory}`, issue);
  }

  const afterMap = new Map<string, IssueType>();
  for (const issue of after.issuesByType) {
    afterMap.set(`${issue.category}::${issue.subcategory}`, issue);
  }

  const newIssues: IssueType[] = [];
  const persistingIssues: IssueType[] = [];
  const fixedIssues: IssueType[] = [];

  // Find new and persisting issues
  for (const [key, afterIssue] of afterMap) {
    if (!beforeMap.has(key)) {
      newIssues.push(afterIssue);
    } else {
      persistingIssues.push(afterIssue);
    }
  }

  // Find fixed issues
  for (const [key, beforeIssue] of beforeMap) {
    if (!afterMap.has(key)) {
      fixedIssues.push(beforeIssue);
    }
  }

  return {
    newIssues,
    persistingIssues,
    fixedIssues,
    issueCountDelta: after.totalIssuesFound - before.totalIssuesFound,
  };
}

/**
 * Get incremental issues: net-new issues and persisting issues from after scan.
 * Use this between clicks to feed only remaining work to the next click.
 */
export function getIncrementalIssues(previousScan: ScanResult, currentScan: ScanResult): IssueType[] {
  const diff = diffScans(previousScan, currentScan);
  // Return persisting issues + any newly detected issues
  return [...diff.persistingIssues, ...diff.newIssues];
}
