import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative, resolve } from 'path';
import { stripCommentsAndStrings } from './code-context.js';

// ---------------------------------------------------------------------------
// Shared constants for file discovery and analysis
// Used by both scan.ts and scan-cache.ts to avoid duplication
// ---------------------------------------------------------------------------

export const IGNORE_DIRS = new Set([
  'node_modules', 'dist', '.git', '.next', 'build', 'coverage',
  '__pycache__', '.cache', 'vendor', 'out', '.ratchet',
]);

/**
 * Non-production directories excluded from code quality scoring by default.
 * These directories contain scripts, test data, or support files that are not
 * representative of production code quality. Pass includeNonProduction: true
 * to FindSourceFilesOptions to scan them.
 */
export const NON_PROD_DIRS = new Set([
  'scripts', 'migrations', 'seed', 'seeds', 'fixtures', 'examples',
  'docs', '__fixtures__', '__mocks__',
]);
export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs']);
export const TEST_PATTERNS = ['.test.', '.spec.', '_test.', '_spec.', '/test/', '/tests/', '/spec/'];

export const LOOP_DB_API_PATTERN = new RegExp(
  /\.(find|findOne|findAll|findBy|query|save|update|insert|select|exec|execute|search)\s*[(<]/.source +
  /|\.(get|post|put|delete|patch|request)\s*\(|\bfetch\s*\(|\baxios\s*[.(]/.source,
);

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

/** Load .ratchetignore patterns from the project root (dir). Returns normalized path prefixes. */
function loadRatchetIgnore(dir: string): string[] {
  const ignorePath = join(dir, '.ratchetignore');
  if (!existsSync(ignorePath)) return [];
  try {
    return readFileSync(ignorePath, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => resolve(dir, l.replace(/\/$/, ''))); // normalize to absolute, strip trailing slash
  } catch {
    return [];
  }
}

export interface FindSourceFilesOptions {
  scanProductionOnly?: boolean; // default: true — excludes test files
  includeNonProduction?: boolean; // default: false — excludes NON_PROD_DIRS
}

export function findSourceFiles(dir: string, options: FindSourceFilesOptions = {}): string[] {
  const { scanProductionOnly = true, includeNonProduction = false } = options;
  const results: string[] = [];
  const ignoredPaths = loadRatchetIgnore(dir);

  function isIgnored(fullPath: string): boolean {
    return ignoredPaths.some(p => fullPath === p || fullPath.startsWith(p + '/'));
  }

  function walk(current: string): void {
    if (isIgnored(current)) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue;
      if (!includeNonProduction && NON_PROD_DIRS.has(entry)) continue;
      const fullPath = join(current, entry);
      if (isIgnored(fullPath)) continue;
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (CODE_EXTENSIONS.has(extname(entry))) {
        if (scanProductionOnly && isTestFile(fullPath)) continue;
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

/**
 * Per-scan cache of stripped content. Keyed by original content string so
 * the same file content is never stripped twice within a scan run.
 * Use clearStrippedCache() at the start of a new scan if needed.
 */
const strippedCache = new Map<string, string>();

export function clearStrippedCache(): void {
  strippedCache.clear();
}

function getStripped(content: string): string {
  let stripped = strippedCache.get(content);
  if (stripped === undefined) {
    stripped = stripCommentsAndStrings(content);
    strippedCache.set(content, stripped);
  }
  return stripped;
}

/** Sum all regex matches across a set of files. */
export function countMatches(
  files: string[],
  contents: Map<string, string>,
  pattern: RegExp,
  contextAware = true,
): number {
  let total = 0;
  for (const file of files) {
    const raw = contents.get(file) ?? '';
    const src = contextAware ? getStripped(raw) : raw;
    total += (src.match(pattern) ?? []).length;
  }
  return total;
}

/** Sum matches and record which files had at least one match. */
export function countMatchesWithFiles(
  files: string[],
  contents: Map<string, string>,
  pattern: RegExp,
  contextAware = true,
): { count: number; matchedFiles: string[] } {
  let count = 0;
  const matchedFiles: string[] = [];
  for (const file of files) {
    const raw = contents.get(file) ?? '';
    const src = contextAware ? getStripped(raw) : raw;
    const n = (src.match(pattern) ?? []).length;
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
  contextAware = true,
): boolean {
  return files.some(file => {
    const raw = contents.get(file) ?? '';
    const src = contextAware ? getStripped(raw) : raw;
    pattern.lastIndex = 0;
    return pattern.test(src);
  });
}

// ---------------------------------------------------------------------------
// Severity map — used by both scan.ts and scan-cache.ts for issue aggregation
// ---------------------------------------------------------------------------

export const SEVERITY_MAP: Record<string, Record<string, 'low' | 'medium' | 'high'>> = {
  'Testing': { 'Coverage ratio': 'high', 'Edge case depth': 'medium', 'Test quality': 'low' },
  'Security': { 'Secrets & env vars': 'high', 'Input validation': 'high', 'Auth & rate limiting': 'medium' },
  'Type Safety': { 'Strict config': 'medium', 'Any type count': 'medium' },
  'Error Handling': { 'Coverage': 'high', 'Empty catches': 'high', 'Structured logging': 'low' },
  'Performance': { 'Async patterns': 'medium', 'Console cleanup': 'low', 'Import hygiene': 'low' },
  'Code Quality': { 'Function length': 'medium', 'Line length': 'low', 'Dead code': 'low', 'Duplication': 'medium' },
};

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

export const DUP_SCORE_THRESHOLDS: Threshold[] = [
  { min: 701, score: 0, summary: (n) => `${n} repeated lines (excessive)` },
  { min: 301, score: 1, summary: (n) => `${n} repeated lines (high duplication)` },
  { min: 101, score: 2, summary: (n) => `${n} repeated lines` },
  { min: 31,  score: 3, summary: (n) => `${n} repeated lines` },
  { min: 11,  score: 4, summary: (n) => `${n} repeated lines` },
  { min: 1,   score: 5, summary: (n) => `${n} repeated lines` },
  { min: 0,   score: 6, summary: 'no significant duplication' },
];

export function scoreStrictConfig(cwd: string): { score: number; summary: string } {
  const tsconfigPath = join(cwd, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return { score: 1, summary: 'TypeScript, no tsconfig found' };
  try {
    type TsConfig = { compilerOptions?: { strict?: boolean; noImplicitAny?: boolean; strictNullChecks?: boolean } };
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8')) as TsConfig;
    if (tsconfig.compilerOptions?.strict) return { score: 7, summary: 'strict mode enabled' };
    if (tsconfig.compilerOptions?.noImplicitAny && tsconfig.compilerOptions?.strictNullChecks)
      return { score: 5, summary: 'noImplicitAny + strictNullChecks' };
    if (tsconfig.compilerOptions?.noImplicitAny) return { score: 3, summary: 'noImplicitAny' };
    return { score: 1, summary: 'TypeScript, no strict flags' };
  } catch {
    return { score: 1, summary: 'TypeScript (tsconfig parse error)' };
  }
}
