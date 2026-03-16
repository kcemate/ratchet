import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// ---------------------------------------------------------------------------
// Shared constants for file discovery and analysis
// Used by both scan.ts and scan-cache.ts to avoid duplication
// ---------------------------------------------------------------------------

export const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage', '__pycache__', '.cache', 'vendor', 'out']);
export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs']);
export const TEST_PATTERNS = ['.test.', '.spec.', '_test.', '_spec.', '/test/', '/tests/', '/spec/'];

export const LOOP_DB_API_PATTERN = /\.(find|findOne|findAll|findBy|query|save|update|insert|select|exec|execute|search)\s*[(<]|\.(get|post|put|delete|patch|request)\s*\(|\bfetch\s*\(|\baxios\s*[.(]/;

export const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey|secret|password|passwd|token)\s*=\s*['"][^'"]{8,}['"]/gi,
  /(?:sk-|pk-live_|ghp_|gho_|ghs_|AKIA)[A-Za-z0-9]{16,}/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
];

// ---------------------------------------------------------------------------
// File utilities
// ---------------------------------------------------------------------------

export function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some(p => filePath.includes(p));
}

export function findSourceFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue;
      const fullPath = join(current, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (CODE_EXTENSIONS.has(extname(entry))) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

export function readContents(files: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    try {
      map.set(file, readFileSync(file, 'utf-8'));
    } catch {
      map.set(file, '');
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// File-scanning utilities — eliminate repeated for-loop boilerplate
// ---------------------------------------------------------------------------

/** Sum all regex matches across a set of files. */
export function countMatches(
  files: string[],
  contents: Map<string, string>,
  pattern: RegExp,
): number {
  let total = 0;
  for (const file of files) {
    total += (contents.get(file)?.match(pattern) ?? []).length;
  }
  return total;
}

/** Sum matches and record which files had at least one match. */
export function countMatchesWithFiles(
  files: string[],
  contents: Map<string, string>,
  pattern: RegExp,
): { count: number; matchedFiles: string[] } {
  let count = 0;
  const matchedFiles: string[] = [];
  for (const file of files) {
    const n = (contents.get(file)?.match(pattern) ?? []).length;
    count += n;
    if (n > 0) matchedFiles.push(file);
  }
  return { count, matchedFiles };
}

/** Return true if at least one file contains the pattern. */
export function anyFileHasMatch(
  files: string[],
  contents: Map<string, string>,
  pattern: RegExp,
): boolean {
  return files.some(file => pattern.test(contents.get(file) ?? ''));
}

// ---------------------------------------------------------------------------
// Threshold scoring utility
// ---------------------------------------------------------------------------

export interface Threshold {
  min: number;          // value must be >= this (use -Infinity for fallback)
  score: number;
  summary: string | ((value: number) => string);
}

/**
 * Map a numeric value to a score + summary using a threshold table.
 * Thresholds are checked top-down; first match wins.
 */
export function scoreByThresholds(value: number, thresholds: Threshold[]): { score: number; summary: string } {
  for (const t of thresholds) {
    if (value >= t.min) {
      const summary = typeof t.summary === 'function' ? t.summary(value) : t.summary;
      return { score: t.score, summary };
    }
  }
  // Fallback (shouldn't be reached if thresholds cover all cases)
  const last = thresholds[thresholds.length - 1]!;
  const summary = typeof last.summary === 'function' ? last.summary(value) : last.summary;
  return { score: last.score, summary };
}
