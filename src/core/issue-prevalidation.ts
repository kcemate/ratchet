import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, relative, basename } from 'path';
import type { IssueTask } from './issue-backlog.js';
import { logger } from '../lib/logger.js';
import { stripCommentsAndStrings } from './code-context.js';

export interface PrevalidationResult {
  validIssues: IssueTask[];
  falsePositives: IssueTask[];
  skippedFiles: string[];
}

// File path patterns that indicate documentation / example code
const DOC_FILE_PATTERNS = [
  /\bexplanations\.[tj]sx?$/,
  /\.example\.[tj]sx?$/,
  /(?:^|[\\/])docs[\\/]/,
  /\.md$/,
  /\.mdx$/,
];

function isDocFile(absPath: string, cwd: string): boolean {
  const rel = relative(cwd, absPath);
  return DOC_FILE_PATTERNS.some(p => p.test(rel) || p.test(basename(absPath)));
}

export { stripCommentsAndStrings } from './code-context.js';

/**
 * Issue description / subcategory → regex that, when matched against
 * stripped source, confirms a real (non-comment, non-string) occurrence.
 *
 * Only issues whose patterns commonly appear in comments / doc strings need
 * an entry here. Issues without an entry are treated as always valid.
 */
const VALIDATION_PATTERNS: Array<{
  /** Matches against `"${subcategory} ${description}"` */
  match: RegExp;
  pattern: RegExp;
}> = [
  {
    match: /console\.?log|debug.?log/i,
    pattern: /\bconsole\.log\s*\(/g,
  },
  {
    match: /empty.?catch|empty catch/i,
    pattern: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
  },
  {
    match: /secret|api.?key|token|password/i,
    pattern: /(?:sk-[a-zA-Z0-9]{20,}|apikey\s*=\s*[^\s;,)]+|api_key\s*=\s*[^\s;,)]+)/gi,
  },
  {
    match: /\btest\b.*\bmatch\b|\bmatch\b.*\btest\b|test.*pattern/i,
    pattern: /\b(?:it|test)\s*[.(]/g,
  },
];

function getValidationPattern(issue: IssueTask): RegExp | null {
  const text = `${issue.subcategory} ${issue.description}`;
  for (const { match, pattern } of VALIDATION_PATTERNS) {
    if (match.test(text)) {
      // Return a fresh copy so lastIndex state doesn't leak between calls
      return new RegExp(pattern.source, pattern.flags);
    }
  }
  return null;
}

async function fileHasRealOccurrences(absPath: string, pattern: RegExp): Promise<boolean> {
  try {
    const source = await readFile(absPath, 'utf8');
    const stripped = stripCommentsAndStrings(source);
    pattern.lastIndex = 0;
    return pattern.test(stripped);
  } catch {
    // Unreadable file → assume real (don't filter it out)
    return true;
  }
}

/**
 * Pre-validate a click's issue group before spawning an agent.
 *
 * For each issue that has a known false-positive-prone pattern:
 *   1. Skip files that are documentation / example files.
 *   2. Strip comments and string literals from remaining files.
 *   3. If no real occurrences remain → mark the issue as a false positive.
 *
 * Issues without a validation pattern are always treated as valid (we don't
 * know how to check them, so we err on the side of running the agent).
 */
export async function prevalidateIssues(
  issues: IssueTask[],
  cwd: string,
): Promise<PrevalidationResult> {
  const validIssues: IssueTask[] = [];
  const falsePositives: IssueTask[] = [];
  const skippedFilesSet = new Set<string>();

  for (const issue of issues) {
    const pattern = getValidationPattern(issue);

    // No validation pattern → can't check → treat as valid
    if (!pattern) {
      validIssues.push(issue);
      continue;
    }

    const sweepFiles = issue.sweepFiles ?? [];

    // No file list → can't check → treat as valid
    if (sweepFiles.length === 0) {
      validIssues.push(issue);
      continue;
    }

    let hasRealOccurrence = false;

    for (const file of sweepFiles) {
      const absPath = resolve(cwd, file);

      if (isDocFile(absPath, cwd)) {
        skippedFilesSet.add(file);
        continue;
      }

      if (!existsSync(absPath)) {
        skippedFilesSet.add(file);
        continue;
      }

      if (await fileHasRealOccurrences(absPath, pattern)) {
        hasRealOccurrence = true;
        break;
      }
    }

    if (hasRealOccurrence) {
      validIssues.push(issue);
    } else {
      falsePositives.push(issue);
      logger.debug(
        `[prevalidation] "${issue.description}" (${issue.subcategory}) — ` +
        `no real occurrences after filtering comments/strings/docs → false positive`,
      );
    }
  }

  return {
    validIssues,
    falsePositives,
    skippedFiles: [...skippedFilesSet],
  };
}
