import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger } from '../lib/logger.js';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';
import {
  TEST_PATTERNS,
  LOOP_DB_API_PATTERN,
  SECRET_PATTERNS,
  isTestFile,
  findSourceFiles,
  scoreByThresholds,
  DUP_SCORE_THRESHOLDS,
  scoreStrictConfig,
} from './scan-constants.js';
import {
  scoreCoverageRatio,
  scoreEdgeCases,
  scoreTestQuality,
  scoreSecrets,
  scoreInputValidation,
  scoreAuthChecks,
  scoreAnyTypeDensity,
  scoreEhCoverage,
  scoreEmptyCatches,
  scoreStructuredLogging,
  scoreAwaitInLoop,
  scoreConsoleLog,
  scoreImportHygiene,
  scoreFunctionLength,
  scoreLineLength,
  scoreDeadCode,
  aggregateAndSortIssues,
} from './scan-scorers.js';

// ---------------------------------------------------------------------------
// Per-file metrics for delta-based incremental updates
// ---------------------------------------------------------------------------

export interface PerFileMetrics {
  isTestFile: boolean;
  lineCount: number;
  consoleLogCount: number;
  anyTypeCount: number;
  longLineCount: number;
  emptyCatchCount: number;
  longFunctionCount: number;
  functionCount: number;
  totalFunctionLength: number;
  tryCatchCount: number;
  asyncFunctionCount: number;
  awaitInLoopCount: number;
  commentedCodeCount: number;
  todoCount: number;
  secretCount: number;
  hasEnvVars: boolean;
  edgeCaseTestCount: number;
  testCaseCount: number;
  assertCount: number;
  describeCount: number;
  hasValidation: boolean;
  isRouteFile: boolean;
  hasAuthMiddleware: boolean;
  hasRateLimit: boolean;
  hasCors: boolean;
  importIssueCount: number;
  significantLines: string[];
}

export interface ScanCache {
  /** Hash of each file (git blob hash) keyed by absolute file path */
  fileHashes: Record<string, string>;
  /** Last full scan result */
  lastFullScan: ScanResult;
  /** Per-file metrics for delta updates */
  fileMetrics: Record<string, PerFileMetrics>;
  /** Timestamp of last scan (ms since epoch) */
  lastScanAt: number;
}

const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const FULL_SCAN_THRESHOLD = 0.30; // force full scan if >30% of files changed

function ratchetDir(cwd: string): string {
  return join(cwd, '.ratchet');
}

function cachePath(cwd: string): string {
  return join(ratchetDir(cwd), 'scan-cache.json');
}

/** Get the git blob hash for a file (fast, no file I/O) */
function gitBlobHash(filePath: string, cwd: string): string | null {
  try {
    const result = execSync(`git hash-object "${filePath}"`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch (err) {
    logger.debug({ err, filePath }, 'git hash-object failed, file may not be tracked');
    return null;
  }
}

/** Get changed files using git diff */
function getChangedFiles(cwd: string): string[] {
  try {
    const unstaged = execSync('git diff --name-only HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    const staged = execSync('git diff --name-only --cached', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    const all = new Set([...unstaged, ...staged]);
    return Array.from(all)
      .filter(f => f.length > 0)
      .map(f => join(cwd, f));
  } catch (err) {
    logger.debug({ err, cwd }, 'git diff failed, assuming no changed files');
    return [];
  }
}

function buildFileHashes(filePaths: string[], cwd: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const fp of filePaths) {
    const hash = gitBlobHash(fp, cwd);
    if (hash) hashes[fp] = hash;
  }
  return hashes;
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a single file and return per-file metrics.
 * This is the core building block for incremental scanning.
 */
export function analyzeFile(filePath: string, content: string): PerFileMetrics {
  const lines = content.split('\n');
  const isTest = isTestFile(filePath);
  const isScript = filePath.replace(/\\/g, '/').includes('/scripts/');

  let consoleLogCount = 0;
  let anyTypeCount = 0;
  let longLineCount = 0;
  let emptyCatchCount = 0;
  let longFunctionCount = 0;
  let functionCount = 0;
  let totalFunctionLength = 0;
  let tryCatchCount = 0;
  let asyncFunctionCount = 0;
  let awaitInLoopCount = 0;
  let commentedCodeCount = 0;
  let todoCount = 0;
  let secretCount = 0;
  let hasEnvVars = false;
  let edgeCaseTestCount = 0;
  let testCaseCount = 0;
  let assertCount = 0;
  let describeCount = 0;
  let importIssueCount = 0;

  // Console.log (only for non-test, non-script source files)
  if (!isTest && !isScript) {
    consoleLogCount = (content.match(/\bconsole\.log\s*\(/g) ?? []).length;
  }

  // Any types (only for non-test .ts/.tsx source files, not .d.ts)
  const isTsSource = !isTest && !filePath.endsWith('.d.ts') && (filePath.endsWith('.ts') || filePath.endsWith('.tsx'));
  if (isTsSource) {
    anyTypeCount = (content.match(/:\s*any\b|<any>|\bas\s+any\b/g) ?? []).length;
  }

  longLineCount = lines.filter(l => l.length > 120).length;
  tryCatchCount = (content.match(/\btry\s*\{/g) ?? []).length;
  emptyCatchCount = (content.match(/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g) ?? []).length;
  asyncFunctionCount = (content.match(/\basync\s+function\b|\basync\s*\(/g) ?? []).length;

  if (!isTest) {
    for (const pattern of SECRET_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      secretCount += (content.match(regex) ?? []).length;
    }
    hasEnvVars = /\bprocess\.env\b|\bos\.environ\b|\bos\.getenv\b/.test(content);
  }

  // Function length analysis + await-in-loop
  let fnStart = -1;
  let depth = 0;
  let loopDepth = 0;
  let braceStack: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const stripped = line.trim();

    if (!isTest) {
      const isFnDecl =
        /\bfunction\s+\w+\s*\(/.test(line) ||
        /\b(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\(/.test(line) ||
        /\b(?:const|let)\s+\w+\s*=\s*async\s+function/.test(line);

      if (isFnDecl && line.includes('{') && fnStart === -1) {
        fnStart = i;
        depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      } else if (fnStart !== -1) {
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (depth <= 0) {
          const fnLen = i - fnStart;
          functionCount++;
          totalFunctionLength += fnLen;
          if (fnLen > 50) longFunctionCount++;
          fnStart = -1;
          depth = 0;
        }
      }
    }

    if (!isTest && !isScript) {
      if (/^\s*(?:for|while)\s*\(/.test(line) || /^\s*for\s+\w+/.test(line)) {
        loopDepth++;
        braceStack.push(0);
      }
      if (loopDepth > 0) {
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        if (braceStack.length > 0) {
          braceStack[braceStack.length - 1] = (braceStack[braceStack.length - 1] ?? 0) + opens - closes;
          if ((braceStack[braceStack.length - 1] ?? 0) < 0) {
            braceStack.pop();
            loopDepth = Math.max(0, loopDepth - 1);
          }
        }
        if (/\bawait\s+/.test(stripped) && LOOP_DB_API_PATTERN.test(stripped)) {
          awaitInLoopCount++;
        }
      }
    }

    if (!isTest) {
      if (/^\s*\/\/\s*(?:const|let|var|function|return|if\s*\(|for\s*\(|while\s*\(|import|export)\b/.test(line)) {
        commentedCodeCount++;
      }
      if (/\b(?:TODO|FIXME|HACK|XXX)\b/.test(line)) {
        todoCount++;
      }
    }
  }

  if (isTest) {
    const edgePatterns =
      /\b(?:it|test)\s*[.(]['"`][^'"`]*(?:error|invalid|edge|boundary|fail|reject|throw|null|undefined|empty|missing|exceed)[^'"`]*['"`]/gi;
    edgeCaseTestCount = (content.match(edgePatterns) ?? []).length;
    testCaseCount = (content.match(/\b(?:it|test)\s*[.(]/g) ?? []).length;
    assertCount = (content.match(/\b(?:expect|assert)\s*[.(]/g) ?? []).length;
    describeCount = (content.match(/\bdescribe\s*[.(]/g) ?? []).length;
  }

  let hasValidation = false;
  let isRouteFile = false;
  let hasAuthMiddleware = false;
  let hasRateLimit = false;
  let hasCors = false;

  if (!isTest) {
    hasValidation =
      /\b(?:zod|joi|yup|valibot)\b|z\.object\s*\(|Joi\.object\s*\(|z\.string\s*\(|z\.number\s*\(/i.test(content)
      || /\buuid\b.*\bvalidate\b|\bvalidate.*uuid\b|isUUID|uuidv[1-5]/i.test(content)
      || /(?:req\.params|req\.body|req\.query).*(?:typeof|instanceof|\.match|\.test|\.validate|schema\.parse)/i.test(content);
    isRouteFile = /(?:router\.|app\.(?:get|post|put|patch|delete)|@(?:Get|Post|Put|Patch|Delete))/i.test(content);
    hasAuthMiddleware =
      /\b(?:authenticate|authorize|isAuthenticated|requireAuth|authMiddleware|verifyToken|passport\.authenticate|jwt\.verify|bearer|middleware.*auth)\b/i.test(content);
    hasRateLimit = /\b(?:rateLimit|rate[-_]limit|express-rate-limit|throttle|limiter)\b/i.test(content);
    hasCors = /\b(?:cors\s*\(|cors\s*\{|helmet\s*\(|'cors'|"cors")\b/i.test(content);

    const basename = filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.tsx?$/, '') ?? '';
    if (basename && new RegExp(`from ['"].*/${basename}['"]`).test(content)) {
      importIssueCount++;
    }
    const wildcardExports = (content.match(/export \* from/g) ?? []).length;
    if (wildcardExports > 5) importIssueCount++;
  }

  const significantLines: string[] = [];
  if (!isTest) {
    for (const line of lines) {
      const s = line.trim();
      if (s.length > 10 && !s.startsWith('//') && !s.startsWith('*')) {
        significantLines.push(s);
      }
    }
  }

  return {
    isTestFile: isTest,
    lineCount: lines.length,
    consoleLogCount,
    anyTypeCount,
    longLineCount,
    emptyCatchCount,
    longFunctionCount,
    functionCount,
    totalFunctionLength,
    tryCatchCount,
    asyncFunctionCount,
    awaitInLoopCount,
    commentedCodeCount,
    todoCount,
    secretCount,
    hasEnvVars,
    edgeCaseTestCount,
    testCaseCount,
    assertCount,
    describeCount,
    hasValidation,
    isRouteFile,
    hasAuthMiddleware,
    hasRateLimit,
    hasCors,
    importIssueCount,
    significantLines,
  };
}

/**
 * Rebuild a ScanResult from aggregated per-file metrics.
 * Pure aggregation — no file I/O for content.
 */
export function rebuildScanFromMetrics(
  allFileMetrics: Record<string, PerFileMetrics>,
  cwd: string,
): ScanResult {
  let projectName = cwd.split('/').pop() ?? 'unknown';
  let hasTestScript = false;
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string; scripts?: Record<string, string> };
      if (pkg.name) projectName = pkg.name;
      const ts = pkg.scripts?.test ?? '';
      if (ts && !ts.includes('no test') && !ts.includes('echo "Error')) hasTestScript = true;
    } catch (err) {
      logger.debug({ err }, 'Failed to read package.json for project metadata');
    }
  }

  const files = Object.keys(allFileMetrics);
  const testFiles = files.filter(f => allFileMetrics[f]!.isTestFile);
  const sourceFiles = files.filter(f => !allFileMetrics[f]!.isTestFile);

  // Aggregate all metrics
  let totalConsoleLog = 0, totalAnyType = 0, totalLongLines = 0, totalEmptyCatch = 0;
  let totalLongFunctions = 0, totalFunctionCount = 0, totalFunctionLength = 0;
  let totalTryCatch = 0, totalAsync = 0, totalAwaitInLoop = 0;
  let totalCommentedCode = 0, totalTodo = 0, totalSecrets = 0;
  let totalEdgeCases = 0, totalTestCases = 0, totalAsserts = 0, totalDescribes = 0;
  let validationFileCount = 0, routeFileCount = 0;
  let hasAuth = false, hasRate = false, hasCorsFlag = false, hasEnvVarsFlag = false;
  let totalImportIssues = 0;
  let srcTsLineCount = 0;

  const consoleLogFiles: string[] = [];
  const anyTypeFiles: string[] = [];
  const longLineFiles: string[] = [];
  const emptyCatchFiles: string[] = [];
  const longFuncFiles: string[] = [];
  const asyncNoHandlerFiles: string[] = [];
  const lineFrequency = new Map<string, number>();

  for (const [fp, m] of Object.entries(allFileMetrics)) {
    totalConsoleLog += m.consoleLogCount;
    if (m.consoleLogCount > 0) consoleLogFiles.push(fp);
    totalAnyType += m.anyTypeCount;
    if (m.anyTypeCount > 0) anyTypeFiles.push(fp);
    totalLongLines += m.longLineCount;
    if (m.longLineCount > 0) longLineFiles.push(fp);
    totalEmptyCatch += m.emptyCatchCount;
    if (m.emptyCatchCount > 0) emptyCatchFiles.push(fp);
    totalLongFunctions += m.longFunctionCount;
    if (m.longFunctionCount > 0 && !longFuncFiles.includes(fp)) longFuncFiles.push(fp);
    totalFunctionCount += m.functionCount;
    totalFunctionLength += m.totalFunctionLength;
    totalTryCatch += m.tryCatchCount;
    totalAsync += m.asyncFunctionCount;
    if (m.asyncFunctionCount > 0 && m.tryCatchCount === 0 && !m.isTestFile) asyncNoHandlerFiles.push(fp);
    totalAwaitInLoop += m.awaitInLoopCount;
    totalCommentedCode += m.commentedCodeCount;
    totalTodo += m.todoCount;
    totalSecrets += m.secretCount;
    if (m.hasEnvVars) hasEnvVarsFlag = true;
    totalEdgeCases += m.edgeCaseTestCount;
    totalTestCases += m.testCaseCount;
    totalAsserts += m.assertCount;
    totalDescribes += m.describeCount;
    if (m.hasValidation) validationFileCount++;
    if (m.isRouteFile) routeFileCount++;
    if (m.hasAuthMiddleware) hasAuth = true;
    if (m.hasRateLimit) hasRate = true;
    if (m.hasCors) hasCorsFlag = true;
    totalImportIssues += m.importIssueCount;
    if (!m.isTestFile && !fp.endsWith('.d.ts') && (fp.endsWith('.ts') || fp.endsWith('.tsx'))) {
      srcTsLineCount += m.lineCount;
    }
    for (const line of m.significantLines) {
      lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1);
    }
  }

  // ========== Testing (25 pts) ==========
  const { score: coverageScore, summary: coverageSummary, issues: coverageIssues } =
    scoreCoverageRatio(testFiles.length, sourceFiles.length, hasTestScript);
  const { score: edgeCaseScore, summary: edgeCaseSummary } = scoreEdgeCases(totalEdgeCases);
  const { score: testQualityScore, summary: testQualitySummary } =
    scoreTestQuality(totalTestCases, totalAsserts, totalDescribes > 0);

  const testingCategory = {
    name: 'Testing', emoji: '🧪',
    score: Math.min(coverageScore + edgeCaseScore + testQualityScore, 25), max: 25,
    summary: [coverageSummary, edgeCaseSummary].filter(Boolean).join(', '),
    subcategories: [
      { name: 'Coverage ratio', score: coverageScore, max: 8, summary: coverageSummary, issuesFound: coverageIssues, issuesDescription: 'source files without tests', locations: coverageIssues > 0 ? sourceFiles : [] },
      { name: 'Edge case depth', score: edgeCaseScore, max: 9, summary: edgeCaseSummary, issuesFound: totalEdgeCases === 0 ? 1 : 0, issuesDescription: 'no edge case tests' },
      { name: 'Test quality', score: testQualityScore, max: 8, summary: testQualitySummary, issuesFound: 0 },
    ],
  };

  // ========== Security (15 pts) ==========
  const { score: secretsScore, summary: secretsSummary } = scoreSecrets(totalSecrets, hasEnvVarsFlag);
  const { score: inputValScore, summary: inputValSummary, issues: inputValIssues } =
    scoreInputValidation(validationFileCount, routeFileCount);
  const { score: authScore, summary: authSummary, issues: authIssues } =
    scoreAuthChecks(hasAuth, hasRate, hasCorsFlag);

  const securityCategory = {
    name: 'Security', emoji: '🔒',
    score: Math.min(secretsScore + inputValScore + authScore, 15), max: 15,
    summary: [secretsSummary, inputValSummary].filter(Boolean).join(', '),
    subcategories: [
      { name: 'Secrets & env vars', score: secretsScore, max: 3, summary: secretsSummary, issuesFound: totalSecrets, issuesDescription: 'hardcoded secrets' },
      { name: 'Input validation', score: inputValScore, max: 6, summary: inputValSummary, issuesFound: inputValIssues, issuesDescription: 'route files without validation' },
      { name: 'Auth & rate limiting', score: authScore, max: 6, summary: authSummary, issuesFound: authIssues, issuesDescription: 'missing auth/security controls' },
    ],
  };

  // ========== Type Safety (15 pts) ==========
  const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
  let typeCategory;

  if (tsFiles.length === 0) {
    typeCategory = {
      name: 'Type Safety', emoji: '📝', score: 0, max: 15,
      summary: 'JavaScript only — no static types',
      subcategories: [
        { name: 'Strict config', score: 0, max: 7, summary: 'JavaScript only', issuesFound: 1, issuesDescription: 'no TypeScript' },
        { name: 'Any type count', score: 0, max: 8, summary: 'JavaScript only', issuesFound: 0 },
      ],
    };
  } else {
    const { score: strictScore, summary: strictSummary } = scoreStrictConfig(cwd);

    const { score: anyScore, summary: anySummary } = scoreAnyTypeDensity(totalAnyType, srcTsLineCount);

    typeCategory = {
      name: 'Type Safety', emoji: '📝',
      score: Math.min(strictScore + anyScore, 15), max: 15,
      summary: [strictSummary, anySummary].filter(Boolean).join(', '),
      subcategories: [
        { name: 'Strict config', score: strictScore, max: 7, summary: strictSummary, issuesFound: strictScore < 7 ? 1 : 0, issuesDescription: 'missing strict TypeScript config' },
        { name: 'Any type count', score: anyScore, max: 8, summary: anySummary, issuesFound: totalAnyType, issuesDescription: 'any types', locations: anyTypeFiles },
      ],
    };
  }

  // ========== Error Handling (20 pts) ==========
  const { score: ehCovScore, summary: ehCovSummary } = scoreEhCoverage(totalTryCatch, totalAsync);
  const { score: ecScore, summary: ecSummary } = scoreEmptyCatches(totalEmptyCatch);
  // Incremental doesn't track console.error separately — use simplified logging score
  const { score: loggingScore, summary: loggingSummary } = scoreStructuredLogging(0, 0);

  const errorHandlingCategory = {
    name: 'Error Handling', emoji: '⚠️ ',
    score: Math.min(ehCovScore + ecScore + loggingScore, 20), max: 20,
    summary: [ehCovSummary, ecSummary].filter(Boolean).join(', '),
    subcategories: [
      { name: 'Coverage', score: ehCovScore, max: 8, summary: ehCovSummary, issuesFound: Math.max(0, totalAsync - totalTryCatch), issuesDescription: 'async functions without error handling', locations: asyncNoHandlerFiles },
      { name: 'Empty catches', score: ecScore, max: 5, summary: ecSummary, issuesFound: totalEmptyCatch, issuesDescription: 'empty catch blocks', locations: emptyCatchFiles },
      { name: 'Structured logging', score: loggingScore, max: 7, summary: loggingSummary, issuesFound: 1, issuesDescription: 'no structured logger' },
    ],
  };

  // ========== Performance (10 pts) ==========
  const { score: asyncPScore, summary: asyncPSummary } = scoreAwaitInLoop(totalAwaitInLoop);
  const { score: consoleScore, summary: consoleSummary } = scoreConsoleLog(totalConsoleLog);
  const { score: importScore, summary: importSummary } = scoreImportHygiene(totalImportIssues);

  const perfCategory = {
    name: 'Performance', emoji: '⚡',
    score: Math.min(Math.min(asyncPScore, 3) + Math.min(consoleScore, 5) + Math.min(importScore, 2), 10), max: 10,
    summary: [asyncPSummary, consoleSummary].filter(Boolean).join(', '),
    subcategories: [
      { name: 'Async patterns', score: Math.min(asyncPScore, 3), max: 3, summary: asyncPSummary, issuesFound: totalAwaitInLoop, issuesDescription: 'await-in-loop patterns' },
      { name: 'Console cleanup', score: Math.min(consoleScore, 5), max: 5, summary: consoleSummary, issuesFound: totalConsoleLog, issuesDescription: 'console.log calls in src', locations: consoleLogFiles },
      { name: 'Import hygiene', score: Math.min(importScore, 2), max: 2, summary: importSummary, issuesFound: totalImportIssues, issuesDescription: 'import issues' },
    ],
  };

  // ========== Code Quality (15 pts) ==========
  const avgLen = totalFunctionCount > 0 ? totalFunctionLength / totalFunctionCount : 0;
  const { score: fnLenScore, summary: fnLenSummary } = scoreFunctionLength(avgLen, totalFunctionCount);
  const { score: lineLenScore, summary: lineLenSummary } = scoreLineLength(totalLongLines);
  const { score: deadCodeScore, summary: deadCodeSummary } = scoreDeadCode(totalCommentedCode, totalTodo);

  let duplicatedLines = 0;
  for (const [, count] of lineFrequency) { if (count >= 3) duplicatedLines++; }
  const { score: dupScore, summary: dupSummary } = scoreByThresholds(duplicatedLines, DUP_SCORE_THRESHOLDS);

  const codeQualityCategory = {
    name: 'Code Quality', emoji: '📖',
    score: Math.min(Math.min(fnLenScore, 4) + Math.min(lineLenScore, 4) + Math.min(deadCodeScore, 4) + Math.min(dupScore, 3), 15), max: 15,
    summary: [fnLenSummary, lineLenSummary].filter(Boolean).join(', '),
    subcategories: [
      { name: 'Function length', score: Math.min(fnLenScore, 4), max: 4, summary: fnLenSummary, issuesFound: totalLongFunctions, issuesDescription: 'functions >50 lines', locations: longFuncFiles },
      { name: 'Line length', score: Math.min(lineLenScore, 4), max: 4, summary: lineLenSummary, issuesFound: totalLongLines, issuesDescription: 'lines >120 chars', locations: longLineFiles },
      { name: 'Dead code', score: Math.min(deadCodeScore, 4), max: 4, summary: deadCodeSummary, issuesFound: totalCommentedCode + totalTodo, issuesDescription: 'dead code indicators (TODO, commented code)' },
      { name: 'Duplication', score: Math.min(dupScore, 3), max: 3, summary: dupSummary, issuesFound: duplicatedLines, issuesDescription: 'repeated code lines' },
    ],
  };

  const categories = [testingCategory, securityCategory, typeCategory, errorHandlingCategory, perfCategory, codeQualityCategory];
  const total = categories.reduce((sum, c) => sum + c.score, 0);
  const maxTotal = categories.reduce((sum, c) => sum + c.max, 0);
  const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(categories);

  return { projectName, total, maxTotal, categories, totalIssuesFound, issuesByType };
}


// ---------------------------------------------------------------------------
// IncrementalScanner
// ---------------------------------------------------------------------------

export class IncrementalScanner {
  private _needsFullScan: boolean | null = null;
  private cachedTimestamp: number | null = null;

  constructor(private cwd: string) {}

  async loadCache(): Promise<ScanCache | null> {
    const p = cachePath(this.cwd);
    if (!existsSync(p)) return null;
    try {
      const raw = readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as ScanCache;
      if (
        typeof parsed.lastScanAt !== 'number' ||
        !parsed.lastFullScan ||
        typeof parsed.fileHashes !== 'object'
      ) {
        return null;
      }
      if (!parsed.fileMetrics) parsed.fileMetrics = {};
      this.cachedTimestamp = parsed.lastScanAt;
      return parsed;
    } catch (err) {
      logger.warn({ err }, 'Failed to parse scan cache, will perform full scan');
      return null;
    }
  }

  async saveCache(cache: ScanCache): Promise<void> {
    const dir = ratchetDir(this.cwd);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(cachePath(this.cwd), JSON.stringify(cache, null, 2), 'utf-8');
    this.cachedTimestamp = cache.lastScanAt;
    this._needsFullScan = false;
  }

  needsFullScan(): boolean {
    if (this._needsFullScan !== null) return this._needsFullScan;
    const p = cachePath(this.cwd);
    if (!existsSync(p)) {
      this._needsFullScan = true;
      return true;
    }
    if (this.cachedTimestamp !== null) {
      const age = Date.now() - this.cachedTimestamp;
      this._needsFullScan = age > CACHE_MAX_AGE_MS;
      return this._needsFullScan;
    }
    try {
      const raw = readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as { lastScanAt?: number };
      if (typeof parsed.lastScanAt === 'number') {
        this.cachedTimestamp = parsed.lastScanAt;
        const age = Date.now() - parsed.lastScanAt;
        this._needsFullScan = age > CACHE_MAX_AGE_MS;
        return this._needsFullScan;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read scan cache timestamp, forcing full scan');
    }
    this._needsFullScan = true;
    return true;
  }

  /**
   * Run an incremental scan.
   * - If no cache or stale → full scan.
   * - If >30% files changed → full scan.
   * - Otherwise → re-analyze ONLY changed files, merge per-file metrics,
   *   rebuild ScanResult from aggregated metrics (never calls runScan).
   */
  async incrementalScan(lastScan: ScanResult): Promise<ScanResult> {
    const cache = await this.loadCache();

    if (!cache || this.needsFullScan()) {
      return this._fullScanAndCache(lastScan);
    }

    // Old cache without fileMetrics → full scan
    if (!cache.fileMetrics || Object.keys(cache.fileMetrics).length === 0) {
      return this._fullScanAndCache(lastScan);
    }

    const changedFiles = getChangedFiles(this.cwd);
    const allCachedFiles = Object.keys(cache.fileHashes);

    const staleFiles = changedFiles.filter(f => {
      const cached = cache.fileHashes[f];
      if (!cached) return true;
      const current = gitBlobHash(f, this.cwd);
      return current !== null && current !== cached;
    });

    const filesToRescan = Array.from(new Set([...changedFiles, ...staleFiles]));

    const totalTracked = Math.max(allCachedFiles.length, 1);
    const changeRatio = filesToRescan.length / totalTracked;

    if (changeRatio > FULL_SCAN_THRESHOLD) {
      return this._fullScanAndCache(lastScan);
    }

    if (filesToRescan.length === 0) {
      return cache.lastFullScan;
    }

    return this._incrementalRescan(cache, filesToRescan);
  }

  /** Re-analyze only changed files, update per-file metrics, rebuild result */
  private async _incrementalRescan(cache: ScanCache, changedFiles: string[]): Promise<ScanResult> {
    const updatedFileMetrics = { ...cache.fileMetrics };
    const updatedFileHashes = { ...cache.fileHashes };

    for (const filePath of changedFiles) {
      if (!existsSync(filePath)) {
        delete updatedFileMetrics[filePath];
        delete updatedFileHashes[filePath];
        continue;
      }

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch (err) {
        logger.debug({ err, filePath }, 'Failed to read file for incremental rescan');
        content = '';
      }

      updatedFileMetrics[filePath] = analyzeFile(filePath, content);

      const hash = gitBlobHash(filePath, this.cwd);
      if (hash) updatedFileHashes[filePath] = hash;
    }

    const result = rebuildScanFromMetrics(updatedFileMetrics, this.cwd);

    const newCache: ScanCache = {
      fileHashes: updatedFileHashes,
      lastFullScan: result,
      fileMetrics: updatedFileMetrics,
      lastScanAt: Date.now(),
    };
    await this.saveCache(newCache);

    return result;
  }

  /** Run a full scan, build per-file metrics, save to cache */
  private async _fullScanAndCache(_hint?: ScanResult): Promise<ScanResult> {
    const scan = await runScan(this.cwd);

    const files = findSourceFiles(this.cwd);
    const hashes = buildFileHashes(files, this.cwd);

    const fileMetrics: Record<string, PerFileMetrics> = {};
    for (const filePath of files) {
      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch (err) {
        logger.debug({ err, filePath }, 'Failed to read file for full scan');
        content = '';
      }
      fileMetrics[filePath] = analyzeFile(filePath, content);
    }

    const cache: ScanCache = {
      fileHashes: hashes,
      lastFullScan: scan,
      fileMetrics,
      lastScanAt: Date.now(),
    };
    await this.saveCache(cache);
    this._needsFullScan = false;

    return scan;
  }
}
