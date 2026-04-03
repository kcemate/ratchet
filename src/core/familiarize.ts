/**
 * Repo familiarization — runs before the first torque click to generate
 * a structured context block injected into agent prompts.
 *
 * Addresses the 0% fix rate on external repos by giving agents the context
 * they need: code style, import patterns, error handling, test patterns.
 * NO LLM calls — pure file reading + heuristics. Target: <500ms.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import type { RepoProfile } from './repo-probe.js';
import type { ScanResult } from './scanner/index.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoContext {
  /** Import style detected from source files */
  importStyle: 'esm' | 'cjs' | 'mixed' | 'unknown';
  /** Indentation style */
  indentation: 'tabs' | '2-space' | '4-space' | 'unknown';
  /** Quote style */
  quoteStyle: 'single' | 'double' | 'mixed' | 'unknown';
  /** Whether semicolons are used (null = couldn't determine) */
  semicolons: boolean | null;
  /** Error handling pattern */
  errorHandling: 'try-catch' | 'result-class' | 'error-class' | 'mixed' | 'unknown';
  /** Test organisation pattern */
  testPattern: 'describe-it' | 'test-fn' | 'mixed' | 'unknown';
  /** Test directory (relative, with trailing slash) */
  testDir: string | null;
  /** Test runner name from RepoProfile (e.g. 'vitest', 'jest') */
  testRunnerName: string | null;
  /** Source directories from RepoProfile */
  sourceDirs: string[];
  /** Main entry point (relative path) */
  entryPoint: string | null;
  /** Top most-changed files from git log */
  hotFiles: string[];
  /** ISO timestamp when this was computed */
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_FILE = '.ratchet/repo-context.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Cache helpers (same pattern as repo-probe.ts)
// ---------------------------------------------------------------------------

function cachePath(cwd: string): string {
  return join(cwd, CACHE_FILE);
}

function loadContextCache(cwd: string): RepoContext | null {
  const p = cachePath(cwd);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as RepoContext;
    if (!parsed.detectedAt) return null;
    const age = Date.now() - new Date(parsed.detectedAt).getTime();
    if (age > CACHE_TTL_MS) {
      logger.debug({ age, cwd }, 'repo-context cache expired');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.debug({ err, cwd }, 'Failed to read repo-context cache');
    return null;
  }
}

function saveContextCache(cwd: string, ctx: RepoContext): void {
  const dir = dirname(cachePath(cwd));
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(cwd), JSON.stringify(ctx, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ err, cwd }, 'Failed to write repo-context cache');
  }
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

function readFull(cwd: string, relPath: string): string | null {
  try {
    return readFileSync(join(cwd, relPath), 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Git hot files
// ---------------------------------------------------------------------------

export function getHotFiles(cwd: string, n = 3): string[] {
  try {
    const out = execSync(
      'git log --pretty=format: --name-only | grep -v "^$" | sort | uniq -c | sort -rn | head -20',
      { cwd, timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const files: string[] = [];
    for (const line of out.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match?.[2]) {
        const file = match[2].trim();
        // Skip lock files, snapshots, minified files
        if (!/\.(lock|sum|snap)$/.test(file) && !file.includes('package-lock')) {
          files.push(file);
        }
      }
      if (files.length >= n) break;
    }
    return files;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Code style detection
// ---------------------------------------------------------------------------

export function detectIndentation(content: string): RepoContext['indentation'] {
  const lines = content.split('\n').slice(0, 200);
  let tabs = 0, twoSpace = 0, fourSpace = 0;
  for (const line of lines) {
    if (line.startsWith('\t')) tabs++;
    else if (line.startsWith('    ')) fourSpace++;
    else if (line.startsWith('  ') && !line.startsWith('   ')) twoSpace++;
  }
  const max = Math.max(tabs, twoSpace, fourSpace);
  if (max === 0) return 'unknown';
  if (tabs === max) return 'tabs';
  if (twoSpace === max) return '2-space';
  return '4-space';
}

export function detectQuoteStyle(content: string): RepoContext['quoteStyle'] {
  const singleMatches = (content.match(/(?<!\\)'[^'\n\\]{0,80}'/g) ?? []).length;
  const doubleMatches = (content.match(/(?<!\\)"[^"\n\\]{0,80}"/g) ?? []).length;
  if (singleMatches === 0 && doubleMatches === 0) return 'unknown';
  const total = singleMatches + doubleMatches;
  const ratio = singleMatches / total;
  if (ratio > 0.7) return 'single';
  if (ratio < 0.3) return 'double';
  return 'mixed';
}

export function detectSemicolons(content: string): boolean | null {
  const lines = content.split('\n').filter(l => {
    const t = l.trim();
    return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  });
  let withSemi = 0, withoutSemi = 0;
  for (const line of lines.slice(0, 150)) {
    const trimmed = line.trimEnd();
    if (/;$/.test(trimmed)) {
      withSemi++;
    } else if (/[a-zA-Z0-9"'`\])}]$/.test(trimmed)) {
      // Likely a statement end — but skip lines ending in open braces, parens, etc.
      if (!/[{([,]$/.test(trimmed)) {
        withoutSemi++;
      }
    }
  }
  if (withSemi === 0 && withoutSemi === 0) return null;
  return withSemi >= withoutSemi;
}

export function detectImportStyle(content: string): RepoContext['importStyle'] {
  const hasEsm = /^import\s+/m.test(content) || /^export\s+(default|const|function|class)/m.test(content);
  const hasCjs = /\brequire\s*\(/.test(content) || /module\.exports/.test(content);
  if (hasEsm && hasCjs) return 'mixed';
  if (hasEsm) return 'esm';
  if (hasCjs) return 'cjs';
  return 'unknown';
}

export function detectErrorHandling(content: string): RepoContext['errorHandling'] {
  const hasTryCatch = /try\s*\{/.test(content);
  const hasCustomError = /class\s+\w*Error\s+extends/.test(content);
  const hasResultType = /:\s*Result[<\s]/.test(content) || /\.ok\s*\(/.test(content) || /\.err\s*\(/.test(content);
  if (hasResultType && hasTryCatch) return 'mixed';
  if (hasResultType) return 'result-class';
  if (hasCustomError) return 'error-class';
  if (hasTryCatch) return 'try-catch';
  return 'unknown';
}

export function detectTestPattern(content: string): RepoContext['testPattern'] {
  const hasDescribeIt = /describe\s*\(/.test(content) && /\bit\s*\(['"`]/.test(content);
  const hasTestFn = /^test\s*\(/m.test(content) || /\btest\s*\(['"`]/.test(content);
  if (hasDescribeIt && hasTestFn) return 'mixed';
  if (hasDescribeIt) return 'describe-it';
  if (hasTestFn) return 'test-fn';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Entry point detection
// ---------------------------------------------------------------------------

export function detectEntryPoint(cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    if (pkg['exports'] && typeof pkg['exports'] === 'object') {
      const exports = pkg['exports'] as Record<string, unknown>;
      const dot = exports['.'];
      if (typeof dot === 'string') return dot;
      if (dot && typeof dot === 'object') {
        const dotEntry = dot as Record<string, unknown>;
        const entry = dotEntry['import'] ?? dotEntry['require'] ?? dotEntry['default'];
        if (typeof entry === 'string') return entry;
      }
    }
    if (typeof pkg['main'] === 'string') return pkg['main'];
  } catch {
    // no package.json or parse error
  }
  for (const candidate of ['src/index.ts', 'src/index.js', 'index.ts', 'index.js', 'main.go', 'main.rs']) {
    if (existsSync(join(cwd, candidate))) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test dir detection
// ---------------------------------------------------------------------------

export function detectTestDir(cwd: string): string | null {
  const candidates = [
    ['__tests__', '__tests__/'],
    ['test', 'test/'],
    ['tests', 'tests/'],
    ['spec', 'spec/'],
    ['src/__tests__', 'src/__tests__/'],
    ['src/test', 'src/test/'],
  ] as const;
  for (const [rel, label] of candidates) {
    if (existsSync(join(cwd, rel))) return label;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sample file finders
// ---------------------------------------------------------------------------

function findSampleSourceFile(cwd: string, hotFiles: string[], profile: RepoProfile): string | null {
  for (const f of hotFiles) {
    if (/\.(ts|tsx|js|jsx|go|rs|py)$/.test(f) && existsSync(join(cwd, f))) return f;
  }
  const entry = detectEntryPoint(cwd);
  if (entry && existsSync(join(cwd, entry))) return entry;
  for (const root of profile.sourceRoots) {
    const rootDir = root.replace(/\/$/, '');
    try {
      const files = readdirSync(join(cwd, rootDir));
      for (const f of files) {
        if (/\.(ts|tsx|js|jsx)$/.test(f)) return rootDir + '/' + f;
      }
    } catch {
      // continue
    }
  }
  return null;
}

function findSampleTestFile(cwd: string): string | null {
  const dirs = ['__tests__', 'test', 'tests', 'src/__tests__', 'src/test'];
  for (const dir of dirs) {
    const fullDir = join(cwd, dir);
    if (!existsSync(fullDir)) continue;
    try {
      const files = readdirSync(fullDir).filter(f => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f));
      if (files.length > 0) return dir + '/' + files[0];
    } catch {
      // continue
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Familiarize the agent with the target repo by reading key files and
 * extracting code style/convention heuristics. Results cached for 24h.
 */
export async function familiarize(
  cwd: string,
  profile: RepoProfile,
  _scanResult: ScanResult | undefined,
  options?: { force?: boolean },
): Promise<RepoContext> {
  if (!options?.force) {
    const cached = loadContextCache(cwd);
    if (cached) {
      logger.debug({ cwd }, 'returning cached repo-context');
      return cached;
    }
  }

  const hotFiles = getHotFiles(cwd);
  const entryPoint = detectEntryPoint(cwd);
  const testDir = detectTestDir(cwd);

  const sampleFile = findSampleSourceFile(cwd, hotFiles, profile);
  const sampleContent = sampleFile ? (readFull(cwd, sampleFile) ?? '') : '';

  const testFile = findSampleTestFile(cwd);
  const testContent = testFile ? (readFull(cwd, testFile) ?? '') : '';

  const combinedContent = sampleContent + '\n' + testContent;

  const ctx: RepoContext = {
    importStyle: detectImportStyle(combinedContent),
    indentation: detectIndentation(combinedContent),
    quoteStyle: detectQuoteStyle(sampleContent),
    semicolons: detectSemicolons(sampleContent),
    errorHandling: detectErrorHandling(sampleContent),
    testPattern: detectTestPattern(testContent || combinedContent),
    testDir,
    testRunnerName: profile.testRunner?.name ?? null,
    sourceDirs: profile.sourceRoots,
    entryPoint,
    hotFiles,
    detectedAt: new Date().toISOString(),
  };

  saveContextCache(cwd, ctx);
  logger.debug({ cwd, importStyle: ctx.importStyle }, 'repo-context detected and cached');
  return ctx;
}

/**
 * Converts a RepoContext into a concise string block for injection into agent prompts.
 * ~500 chars max, structured for easy LLM parsing.
 *
 * Example output:
 *   REPO CONTEXT (auto-detected):
 *   Style: ESM imports, single quotes, no semicolons, 2-space indent
 *   Tests: vitest (describe/it pattern), fixtures in __tests__/
 *   Errors: try/catch pattern
 *   Structure: src/
 *   Entry: src/index.ts
 *   Hot files: src/router.ts, src/context.ts
 */
export function buildFamiliarizationContext(ctx: RepoContext): string {
  const parts: string[] = ['REPO CONTEXT (auto-detected):'];

  // Style line
  const styleItems: string[] = [];
  if (ctx.importStyle !== 'unknown') styleItems.push(`${ctx.importStyle} imports`);
  if (ctx.quoteStyle !== 'unknown') styleItems.push(`${ctx.quoteStyle} quotes`);
  if (ctx.semicolons !== null) styleItems.push(ctx.semicolons ? 'semicolons' : 'no semicolons');
  if (ctx.indentation !== 'unknown') styleItems.push(`${ctx.indentation} indent`);
  if (styleItems.length > 0) parts.push(`Style: ${styleItems.join(', ')}`);

  // Tests line
  const testItems: string[] = [];
  if (ctx.testRunnerName) testItems.push(ctx.testRunnerName);
  if (ctx.testPattern !== 'unknown') {
    const patternLabel = ctx.testPattern === 'describe-it' ? 'describe/it pattern' : 'test() pattern';
    testItems.push(patternLabel);
  }
  if (ctx.testDir) testItems.push(`fixtures in ${ctx.testDir}`);
  if (testItems.length > 0) parts.push(`Tests: ${testItems.join(', ')}`);

  // Error handling
  if (ctx.errorHandling !== 'unknown') {
    const errMap: Record<string, string> = {
      'try-catch': 'try/catch pattern',
      'result-class': 'Result type pattern',
      'error-class': 'custom error classes',
      'mixed': 'mixed error handling',
    };
    parts.push(`Errors: ${errMap[ctx.errorHandling] ?? ctx.errorHandling}`);
  }

  // Structure
  if (ctx.sourceDirs.length > 0) {
    parts.push(`Structure: ${ctx.sourceDirs.join(', ')}`);
  }

  // Entry point
  if (ctx.entryPoint) {
    parts.push(`Entry: ${ctx.entryPoint}`);
  }

  // Hot files
  if (ctx.hotFiles.length > 0) {
    parts.push(`Hot files: ${ctx.hotFiles.join(', ')}`);
  }

  return parts.join('\n');
}
