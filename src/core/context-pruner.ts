import type { ScanResult } from "./scanner/index.js";
import type { IssueTask } from "./issue-backlog.js";

export interface ClickContext {
  /** Focused markdown summary for the agent prompt */
  summary: string;
  /** Relevance score per file path (0–1) */
  fileRelevanceMap: Record<string, number>;
}

/**
 * Build a focused context string for a click, given the current scan result
 * and the specific issues the click should address.
 *
 * Instead of telling the agent "analyze the codebase", we give it exact file
 * paths, issue types, and line numbers so it can skip re-scanning.
 */
export function buildClickContext(scanResult: ScanResult, targetIssues: IssueTask[], cwd: string): ClickContext {
  const fileRelevanceMap: Record<string, number> = {};

  // Collect all files referenced by the target issues
  const issueFiles = new Set<string>();
  for (const issue of targetIssues) {
    if (issue.sweepFiles) {
      for (const f of issue.sweepFiles) {
        issueFiles.add(f);
      }
    }
  }

  // Also collect files from scan result categories for these issue types
  const issueSubcategories = new Set(targetIssues.map(i => i.subcategory));
  for (const cat of scanResult.categories) {
    for (const sub of cat.subcategories) {
      if (issueSubcategories.has(sub.name) && sub.locations) {
        for (const f of sub.locations) {
          issueFiles.add(f);
        }
      }
    }
  }

  // Also check issuesByType for matching subcategories
  for (const issueType of scanResult.issuesByType) {
    if (issueSubcategories.has(issueType.subcategory) && issueType.locations) {
      for (const f of issueType.locations) {
        issueFiles.add(f);
      }
    }
  }

  // Score file relevance: direct issue files get 1.0, others 0
  for (const f of issueFiles) {
    fileRelevanceMap[f] = 1.0;
  }

  // Build the compact markdown summary
  const lines: string[] = [];

  lines.push("## Context: Focused Issues for This Click");
  lines.push("");
  lines.push(`**Project score**: ${scanResult.total}/${scanResult.maxTotal}`);
  lines.push(`**Total issues**: ${scanResult.totalIssuesFound}`);
  lines.push("");

  lines.push("## Issues to Fix");
  lines.push("");
  for (const issue of targetIssues) {
    lines.push(`### ${issue.category} > ${issue.subcategory}`);
    lines.push(`- **Severity**: ${issue.severity.toUpperCase()}`);
    lines.push(`- **Count**: ${issue.count} ${issue.description}`);
    if (issue.sweepFiles && issue.sweepFiles.length > 0) {
      lines.push(`- **Files** (${issue.sweepFiles.length}):`);
      for (const f of issue.sweepFiles.slice(0, 10)) {
        lines.push(`  - \`${f}\``);
      }
      if (issue.sweepFiles.length > 10) {
        lines.push(`  - _(${issue.sweepFiles.length - 10} more files)_`);
      }
    }
    lines.push("");
  }

  if (issueFiles.size > 0) {
    lines.push("## Files to Edit");
    lines.push("");
    lines.push("Focus your changes on these files only:");
    for (const f of issueFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  lines.push("## Instructions");
  lines.push("");
  lines.push("Fix ONLY the issues listed above. Do not refactor other code or touch other files.");
  lines.push("Make surgical changes — one issue type per file where possible.");
  void cwd; // used by callers for path resolution if needed

  return {
    summary: lines.join("\n"),
    fileRelevanceMap,
  };
}
