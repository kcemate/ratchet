import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import type { IssueSubcategory, IssueCategoryName } from '../core/taxonomy.js';
import { printHeader, severityColor } from '../lib/cli.js';

// --- Types ---

export interface SubCategory {
  name: string;
  score: number;
  max: number;
  summary: string;
  issuesFound: number;   // discrete countable issues (e.g., "7 empty catches")
  issuesDescription?: string; // e.g., "empty catch blocks"
  locations?: string[];  // file paths where this issue was found
}

export interface CategoryResult {
  name: string;
  emoji: string;
  score: number;
  max: number;
  summary: string;
  subcategories: SubCategory[];
}

export interface IssueType {
  category: string;
  subcategory: string;
  count: number;
  description: string;  // e.g., "empty catch blocks", "any types", "functions >50 lines"
  severity: 'low' | 'medium' | 'high';
  locations?: string[];  // file paths where this issue was found
}

export interface ScanResult {
  projectName: string;
  total: number;
  maxTotal: number;
  categories: CategoryResult[];
  // Aggregate issues metric
  totalIssuesFound: number;
  issuesByType: IssueType[];
}

// --- File discovery ---

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage', '__pycache__', '.cache', 'vendor', 'out']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs']);
const TEST_PATTERNS = ['.test.', '.spec.', '_test.', '_spec.', '/test/', '/tests/', '/spec/'];

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some(p => filePath.includes(p));
}

function findSourceFiles(dir: string): string[] {
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

function readContents(files: string[]): Map<string, string> {
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

// --- Threshold scoring utility ---

interface Threshold {
  min: number;          // value must be >= this (use -Infinity for fallback)
  score: number;
  summary: string | ((value: number) => string);
}

/**
 * Map a numeric value to a score + summary using a threshold table.
 * Thresholds are checked top-down; first match wins.
 */
function scoreByThresholds(value: number, thresholds: Threshold[]): { score: number; summary: string } {
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

// --- Scorers ---

// Testing (25 points)
// ├─ Coverage ratio ......... /8
// ├─ Edge case depth ........ /9
// └─ Test quality ........... /8
function scoreTests(files: string[], contents: Map<string, string>, cwd: string): CategoryResult {
  const testFiles = files.filter(isTestFile);
  const sourceFiles = files.filter(f => !isTestFile(f));

  // --- Coverage ratio /8 ---
  let coverageScore = 0;
  let coverageSummary = '';
  let coverageIssues = 0;

  const ratio = sourceFiles.length > 0 ? testFiles.length / sourceFiles.length : 0;
  const ratioStr = `${testFiles.length} test files, ${Math.round(ratio * 100)}% ratio`;

  // Also check for test script in package.json
  let hasTestScript = false;
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
      const testScript = pkg.scripts?.test ?? '';
      if (testScript && !testScript.includes('no test') && !testScript.includes('echo "Error')) {
        hasTestScript = true;
      }
    } catch { /* ignore */ }
  }

  // New thresholds: 0%→0, 5%→2, 12%→4, 22%→6, 35%→7.5, 50%+→8
  if (testFiles.length === 0) {
    coverageScore = 0;
    coverageSummary = hasTestScript ? 'test script configured, no test files' : 'no test files';
    coverageIssues = sourceFiles.length;
  } else {
    const pct = ratio * 100;
    if (pct >= 50) {
      coverageScore = 8;
    } else if (pct >= 35) {
      coverageScore = 7.5;
    } else if (pct >= 22) {
      coverageScore = 6;
    } else if (pct >= 12) {
      coverageScore = 4;
    } else if (pct >= 5) {
      coverageScore = 2;
    } else {
      coverageScore = 0;
    }
    coverageSummary = ratioStr;
    if (pct < 50) {
      coverageIssues = Math.floor(sourceFiles.length * (1 - ratio));
    }
  }

  // --- Edge case depth /6 ---
  let edgeCaseScore = 0;
  let edgeCaseSummary = '';
  const edgePatterns = /\b(?:it|test)\s*[.(]['"`][^'"`]*(?:error|invalid|edge|boundary|fail|reject|throw|null|undefined|empty|missing|exceed)[^'"`]*['"`]/gi;
  let edgeCaseCount = 0;
  let totalTestCases = 0;

  for (const file of testFiles) {
    const content = contents.get(file) ?? '';
    edgeCaseCount += (content.match(edgePatterns) ?? []).length;
    totalTestCases += (content.match(/\b(?:it|test)\s*[.(]/g) ?? []).length;
  }

  ({ score: edgeCaseScore, summary: edgeCaseSummary } = scoreByThresholds(edgeCaseCount, [
    { min: 50,  score: 9, summary: (n) => `${n} edge/error test cases` },
    { min: 20,  score: 7, summary: (n) => `${n} edge/error test cases` },
    { min: 10,  score: 5, summary: (n) => `${n} edge/error test cases` },
    { min: 3,   score: 3, summary: (n) => `${n} edge/error test cases` },
    { min: 1,   score: 1, summary: (n) => `${n} edge/error test case${n !== 1 ? 's' : ''}` },
    { min: -Infinity, score: 0, summary: 'no edge case tests detected' },
  ]));

  // --- Test quality /8 ---
  let testQualityScore = 0;
  let testQualitySummary = '';

  let assertCount = 0;
  let describeCount = 0;

  for (const file of testFiles) {
    const content = contents.get(file) ?? '';
    assertCount += (content.match(/\b(?:expect|assert)\s*[.(]/g) ?? []).length;
    describeCount += (content.match(/\bdescribe\s*[.(]/g) ?? []).length;
  }

  const assertsPerTest = totalTestCases > 0 ? assertCount / totalTestCases : 0;
  const hasDescribe = describeCount > 0;

  if (totalTestCases >= 50 && assertsPerTest >= 2 && hasDescribe) {
    testQualityScore = 8;
    testQualitySummary = `${assertsPerTest.toFixed(1)} assertions per test`;
  } else if (totalTestCases >= 10 && assertsPerTest >= 1.5 && hasDescribe) {
    testQualityScore = 6;
    testQualitySummary = `${assertsPerTest.toFixed(1)} assertions per test`;
  } else if (totalTestCases >= 5 && assertsPerTest >= 1) {
    testQualityScore = 4;
    testQualitySummary = `${assertsPerTest.toFixed(1)} assertions per test`;
  } else if (totalTestCases > 0) {
    testQualityScore = 2;
    testQualitySummary = `${totalTestCases} test case${totalTestCases !== 1 ? 's' : ''}, low assertion density`;
  } else {
    testQualityScore = 0;
    testQualitySummary = 'no test cases found';
  }

  const score = coverageScore + edgeCaseScore + testQualityScore;
  const summary = [coverageSummary, edgeCaseSummary].filter(Boolean).join(', ');

  // Source files with no test coverage — used for sweep mode targeting
  const coverageLocations: string[] = coverageIssues > 0 ? sourceFiles : [];

  return {
    name: 'Testing',
    emoji: '🧪',
    score: Math.min(score, 25),
    max: 25,
    summary,
    subcategories: [
      { name: 'Coverage ratio', score: coverageScore, max: 8, summary: coverageSummary, issuesFound: coverageIssues, issuesDescription: 'source files without tests', locations: coverageLocations },
      { name: 'Edge case depth', score: edgeCaseScore, max: 9, summary: edgeCaseSummary, issuesFound: edgeCaseCount === 0 ? 1 : 0, issuesDescription: 'no edge case tests' },
      { name: 'Test quality', score: testQualityScore, max: 8, summary: testQualitySummary, issuesFound: 0 },
    ],
  };
}

// Security (15 points)
// ├─ Secrets & env vars ..... /3
// ├─ Input validation ....... /6
// └─ Auth & rate limiting ... /6
function scoreSecurity(files: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));

  // --- Secrets & env vars /4 ---
  const SECRET_PATTERNS = [
    /(?:api[_-]?key|apikey|secret|password|passwd|token)\s*=\s*['"][^'"]{8,}['"]/gi,
    /(?:sk-|pk-live_|ghp_|gho_|ghs_|AKIA)[A-Za-z0-9]{16,}/g,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
  ];

  let secretCount = 0;
  let usesEnvVars = false;

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    for (const pattern of SECRET_PATTERNS) {
      secretCount += (content.match(pattern) ?? []).length;
    }
    if (/\bprocess\.env\b|\bos\.environ\b|\bos\.getenv\b/.test(content)) {
      usesEnvVars = true;
    }
  }

  let secretsScore = 0;
  let secretsSummary = '';
  if (secretCount === 0 && usesEnvVars) {
    secretsScore = 3;
    secretsSummary = 'no hardcoded secrets, uses env vars';
  } else if (secretCount === 0) {
    secretsScore = 2;
    secretsSummary = 'no hardcoded secrets';
  } else {
    secretsScore = 0;
    secretsSummary = `${secretCount} potential secret${secretCount !== 1 ? 's' : ''}`;
  }

  // --- Input validation /6 ---
  let inputValScore = 0;
  let inputValSummary = '';
  let inputValIssues = 0;

  let validationFileCount = 0;
  let routeFileCount = 0;

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    // Zod/Joi imports or usage
    const hasZodJoi = /\b(?:zod|joi|yup|valibot)\b|z\.object\s*\(|Joi\.object\s*\(|z\.string\s*\(|z\.number\s*\(/i.test(content);
    // UUID validation
    const hasUuidValidation = /\buuid\b.*\bvalidate\b|\bvalidate.*uuid\b|isUUID|uuidv[1-5]/i.test(content);
    // Param validation in route handlers
    const hasParamValidation = /(?:req\.params|req\.body|req\.query).*(?:typeof|instanceof|\.match|\.test|\.validate|schema\.parse)/i.test(content);
    // Route file detection
    const isRouteFile = /(?:router\.|app\.(?:get|post|put|patch|delete)|@(?:Get|Post|Put|Patch|Delete))/i.test(content);

    if (isRouteFile) routeFileCount++;
    if (hasZodJoi || hasUuidValidation || hasParamValidation) validationFileCount++;
  }

  const totalCheckableFiles = Math.max(routeFileCount, validationFileCount, 1);
  const validationRatio = validationFileCount / totalCheckableFiles;

  if (validationFileCount >= 3 && validationRatio >= 0.6) {
    inputValScore = 6;
    inputValSummary = `validation on ${validationFileCount} files`;
  } else if (validationFileCount >= 2) {
    inputValScore = 4;
    inputValSummary = `Zod/validation on ${validationFileCount} files`;
    inputValIssues = routeFileCount > validationFileCount ? routeFileCount - validationFileCount : 0;
  } else if (validationFileCount === 1) {
    inputValScore = 2;
    inputValSummary = 'minimal input validation detected';
    inputValIssues = Math.max(0, routeFileCount - 1);
  } else {
    inputValScore = 0;
    inputValSummary = 'no input validation detected';
    inputValIssues = routeFileCount;
  }

  // --- Auth & rate limiting /6 ---
  let authScore = 0;
  let authSummary = '';
  let authIssues = 0;

  let hasAuthMiddleware = false;
  let hasRateLimit = false;
  let hasCors = false;

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    if (/\b(?:authenticate|authorize|isAuthenticated|requireAuth|authMiddleware|verifyToken|passport\.authenticate|jwt\.verify|bearer|middleware.*auth)\b/i.test(content)) {
      hasAuthMiddleware = true;
    }
    if (/\b(?:rateLimit|rate[-_]limit|express-rate-limit|throttle|limiter)\b/i.test(content)) {
      hasRateLimit = true;
    }
    if (/\b(?:cors\s*\(|cors\s*\{|helmet\s*\(|'cors'|"cors")\b/i.test(content)) {
      hasCors = true;
    }
  }

  const authChecks = [hasAuthMiddleware, hasRateLimit, hasCors].filter(Boolean).length;
  if (authChecks >= 3) {
    authScore = 6;
    authSummary = 'auth middleware, rate limiting, CORS configured';
  } else if (authChecks === 2) {
    authScore = 4;
    const found: string[] = [];
    if (hasAuthMiddleware) found.push('auth middleware');
    if (hasRateLimit) found.push('rate limiting');
    if (hasCors) found.push('CORS');
    authSummary = found.join(', ');
    authIssues = 3 - authChecks;
  } else if (authChecks === 1) {
    authScore = 2;
    if (hasAuthMiddleware) authSummary = 'auth middleware only';
    else if (hasRateLimit) authSummary = 'rate limiting only';
    else authSummary = 'CORS only';
    authIssues = 3 - authChecks;
  } else {
    authScore = 0;
    authSummary = 'no auth/rate-limit/CORS detected';
    authIssues = 3;
  }

  const score = secretsScore + inputValScore + authScore;
  const summary = [secretsSummary, inputValSummary].filter(Boolean).join(', ');

  return {
    name: 'Security',
    emoji: '🔒',
    score: Math.min(score, 15),
    max: 15,
    summary,
    subcategories: [
      { name: 'Secrets & env vars', score: secretsScore, max: 3, summary: secretsSummary, issuesFound: secretCount, issuesDescription: 'hardcoded secrets' },
      { name: 'Input validation', score: inputValScore, max: 6, summary: inputValSummary, issuesFound: inputValIssues, issuesDescription: 'route files without validation' },
      { name: 'Auth & rate limiting', score: authScore, max: 6, summary: authSummary, issuesFound: authIssues, issuesDescription: 'missing auth/security controls' },
    ],
  };
}

// Type Safety (15 points)
// ├─ Strict config .......... /7
// └─ Any type count ......... /8
function scoreTypes(files: string[], cwd: string, contents: Map<string, string>): CategoryResult {
  const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

  if (tsFiles.length === 0) {
    return {
      name: 'Type Safety',
      emoji: '📝',
      score: 0,
      max: 15,
      summary: 'JavaScript only — no static types',
      subcategories: [
        { name: 'Strict config', score: 0, max: 7, summary: 'JavaScript only', issuesFound: 1, issuesDescription: 'no TypeScript' },
        { name: 'Any type count', score: 0, max: 8, summary: 'JavaScript only', issuesFound: 0 },
      ],
    };
  }

  // --- Strict config /7 ---
  let strictScore = 0;
  let strictSummary = 'TypeScript (no strict config)';
  const tsconfigPath = join(cwd, 'tsconfig.json');

  if (existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8')) as {
        compilerOptions?: { strict?: boolean; noImplicitAny?: boolean; strictNullChecks?: boolean };
      };
      if (tsconfig.compilerOptions?.strict) {
        strictScore = 7;
        strictSummary = 'strict mode enabled';
      } else if (tsconfig.compilerOptions?.noImplicitAny && tsconfig.compilerOptions?.strictNullChecks) {
        strictScore = 5;
        strictSummary = 'noImplicitAny + strictNullChecks';
      } else if (tsconfig.compilerOptions?.noImplicitAny) {
        strictScore = 3;
        strictSummary = 'noImplicitAny';
      } else {
        strictScore = 1;
        strictSummary = 'TypeScript, no strict flags';
      }
    } catch {
      strictScore = 1;
      strictSummary = 'TypeScript (tsconfig parse error)';
    }
  } else {
    strictScore = 1;
    strictSummary = 'TypeScript, no tsconfig found';
  }

  // --- Any type count /8 (scored by density per 1k LOC) ---
  const srcTsFiles = tsFiles.filter(f => !isTestFile(f) && !f.endsWith('.d.ts'));
  let anyCount = 0;
  let totalLines = 0;
  const anyTypeFiles: string[] = [];

  for (const file of srcTsFiles) {
    const content = contents.get(file) ?? '';
    const fileAnyCount = (content.match(/:\s*any\b|<any>|\bas\s+any\b/g) ?? []).length;
    anyCount += fileAnyCount;
    if (fileAnyCount > 0) anyTypeFiles.push(file);
    totalLines += content.split('\n').length;
  }

  // Density = anyCount / (totalLines / 1000)
  const density = totalLines > 0 ? anyCount / (totalLines / 1000) : 0;
  let anyScore = 0;
  let anySummary = '';

  // Thresholds: <1→8, <2→7, <4→6, <7→5, <12→4, <20→2, else→0
  if (anyCount === 0 || density < 1) {
    anyScore = 8;
    anySummary = anyCount === 0 ? 'zero any types' : `${anyCount} any type${anyCount !== 1 ? 's' : ''} (very low density)`;
  } else if (density < 2) {
    anyScore = 7;
    anySummary = `${anyCount} any type${anyCount !== 1 ? 's' : ''} (low density)`;
  } else if (density < 4) {
    anyScore = 6;
    anySummary = `${anyCount} any types (low density)`;
  } else if (density < 7) {
    anyScore = 5;
    anySummary = `${anyCount} any types (moderate)`;
  } else if (density < 12) {
    anyScore = 4;
    anySummary = `${anyCount} any types (moderate-high)`;
  } else if (density < 20) {
    anyScore = 2;
    anySummary = `${anyCount} any types (high)`;
  } else {
    anyScore = 0;
    anySummary = `${anyCount} any types (very high density)`;
  }

  const score = strictScore + anyScore;
  const summary = [strictSummary, anySummary].filter(Boolean).join(', ');

  return {
    name: 'Type Safety',
    emoji: '📝',
    score: Math.min(score, 15),
    max: 15,
    summary,
    subcategories: [
      { name: 'Strict config', score: strictScore, max: 7, summary: strictSummary, issuesFound: strictScore < 7 ? 1 : 0, issuesDescription: 'missing strict TypeScript config' },
      { name: 'Any type count', score: anyScore, max: 8, summary: anySummary, issuesFound: anyCount, issuesDescription: 'any types', locations: anyTypeFiles },
    ],
  };
}

// Error Handling (20 points)
// ├─ Coverage ............... /8
// ├─ Empty catches .......... /5
// └─ Structured logging ..... /7
function scoreErrorHandling(files: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));

  let tryCatchTotal = 0;
  let emptyCatchTotal = 0;
  let asyncTotal = 0;
  let consoleErrorCount = 0;
  let structuredLogCount = 0;
  const emptyCatchFiles: string[] = [];
  const asyncNoHandlerFiles: string[] = [];

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    tryCatchTotal += (content.match(/\btry\s*\{/g) ?? []).length;
    const fileCatches = (content.match(/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g) ?? []).length;
    emptyCatchTotal += fileCatches;
    if (fileCatches > 0) emptyCatchFiles.push(file);
    const fileAsync = (content.match(/\basync\s+function\b|\basync\s*\(/g) ?? []).length;
    const fileTryCatch = (content.match(/\btry\s*\{/g) ?? []).length;
    asyncTotal += fileAsync;
    if (fileAsync > 0 && fileTryCatch === 0) asyncNoHandlerFiles.push(file);
    consoleErrorCount += (content.match(/\bconsole\.(?:error|warn|log)\s*\(/g) ?? []).length;
    structuredLogCount += (content.match(/\b(?:logger|winston|pino|bunyan|log4js)\./g) ?? []).length;
  }

  // --- Coverage /8 ---
  let coverageScore = 0;
  let coverageSummary = '';

  if (tryCatchTotal === 0) {
    coverageScore = 0;
    coverageSummary = 'no try/catch found';
  } else if (asyncTotal === 0 || tryCatchTotal >= asyncTotal * 0.6) {
    coverageScore = 8;
    coverageSummary = `${tryCatchTotal} try/catch block${tryCatchTotal !== 1 ? 's' : ''}`;
  } else {
    const pct = Math.round((tryCatchTotal / asyncTotal) * 100);
    coverageScore = Math.round((pct / 100) * 8);
    coverageSummary = `${tryCatchTotal} try/catch (${pct}% async coverage)`;
  }

  // --- Empty catches /5 ---
  // Thresholds: 0→5, 1→4.5, 2→4, 3-4→3, 5-7→2, 8-12→1, else→0
  let emptyCatchScore = 0;
  let emptyCatchSummary = '';

  ({ score: emptyCatchScore, summary: emptyCatchSummary } = scoreByThresholds(emptyCatchTotal, [
    { min: 13, score: 0, summary: (n) => `${n} empty catches` },
    { min: 8,  score: 1, summary: (n) => `${n} empty catches` },
    { min: 5,  score: 2, summary: (n) => `${n} empty catches` },
    { min: 3,  score: 3, summary: (n) => `${n} empty catches` },
    { min: 2,  score: 4, summary: '2 empty catches' },
    { min: 1,  score: 4.5, summary: '1 empty catch' },
    { min: -Infinity, score: 5, summary: 'no empty catch blocks' },
  ]));

  // --- Structured logging /7 ---
  let loggingScore = 0;
  let loggingSummary = '';

  if (structuredLogCount > 0 && consoleErrorCount === 0) {
    loggingScore = 7;
    loggingSummary = `structured logger only (${structuredLogCount} calls)`;
  } else if (structuredLogCount > 0 && consoleErrorCount <= 5) {
    loggingScore = 5;
    loggingSummary = `structured logger + ${consoleErrorCount} console calls`;
  } else if (structuredLogCount > 0) {
    loggingScore = 3;
    loggingSummary = `logger (${structuredLogCount}) + console (${consoleErrorCount})`;
  } else if (consoleErrorCount > 0) {
    loggingScore = 1;
    loggingSummary = `${consoleErrorCount} console.error/warn calls (no structured logger)`;
  } else {
    loggingScore = 0;
    loggingSummary = 'no error logging detected';
  }

  const score = coverageScore + emptyCatchScore + loggingScore;
  const summary = [coverageSummary, emptyCatchSummary].filter(Boolean).join(', ');

  return {
    name: 'Error Handling',
    emoji: '⚠️ ',
    score: Math.min(score, 20),
    max: 20,
    summary,
    subcategories: [
      { name: 'Coverage', score: coverageScore, max: 8, summary: coverageSummary, issuesFound: Math.max(0, asyncTotal - tryCatchTotal), issuesDescription: 'async functions without error handling', locations: asyncNoHandlerFiles },
      { name: 'Empty catches', score: emptyCatchScore, max: 5, summary: emptyCatchSummary, issuesFound: emptyCatchTotal, issuesDescription: 'empty catch blocks', locations: emptyCatchFiles },
      { name: 'Structured logging', score: loggingScore, max: 7, summary: loggingSummary, issuesFound: structuredLogCount === 0 ? 1 : 0, issuesDescription: 'no structured logger' },
    ],
  };
}

// Patterns that indicate a real DB query or API call worth flagging in a loop
const LOOP_DB_API_PATTERN = /\.(find|findOne|findAll|findBy|query|save|update|insert|select|exec|execute|search)\s*[(<]|\.(get|post|put|delete|patch|request)\s*\(|\bfetch\s*\(|\baxios\s*[.(]/;

// Performance (10 points)
// ├─ Async patterns ......... /3
// ├─ Console cleanup ........ /5
// └─ Import hygiene ......... /2
function scorePerformance(files: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));
  // Exclude scripts/ directories from console.log check
  const appFiles = srcFiles.filter(f => {
    const normalized = f.replace(/\\/g, '/');
    return !normalized.includes('/scripts/');
  });

  let awaitInLoopCount = 0;
  let consoleLogCount = 0;
  const consoleLogFiles: string[] = [];

  for (const file of appFiles) {
    const content = contents.get(file) ?? '';
    const lines = content.split('\n');

    const fileConsoleCount = (content.match(/\bconsole\.log\s*\(/g) ?? []).length;
    consoleLogCount += fileConsoleCount;
    if (fileConsoleCount > 0) consoleLogFiles.push(file);

    // Detect await inside for/while loops — only flag DB/API patterns
    let loopDepth = 0;
    let braceStack: number[] = [];

    for (const line of lines) {
      const stripped = line.trim();
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
  }

  // --- Async patterns /5 ---
  let asyncScore = 0;
  let asyncSummary = '';

  if (awaitInLoopCount === 0) {
    asyncScore = 5;
    asyncSummary = 'no await-in-loop';
  } else if (awaitInLoopCount === 1) {
    asyncScore = 4;
    asyncSummary = '1 await-in-loop pattern';
  } else if (awaitInLoopCount <= 3) {
    asyncScore = 3;
    asyncSummary = `${awaitInLoopCount} await-in-loop patterns`;
  } else if (awaitInLoopCount <= 6) {
    asyncScore = 2;
    asyncSummary = `${awaitInLoopCount} await-in-loop patterns`;
  } else {
    asyncScore = 1;
    asyncSummary = `${awaitInLoopCount} await-in-loop patterns`;
  }

  // --- Console cleanup /5 ---
  let consoleScore = 0;
  let consoleSummary = '';

  if (consoleLogCount === 0) {
    consoleScore = 5;
    consoleSummary = 'no console.log in src';
  } else if (consoleLogCount <= 3) {
    consoleScore = 4;
    consoleSummary = `${consoleLogCount} console.log`;
  } else if (consoleLogCount <= 10) {
    consoleScore = 3;
    consoleSummary = `${consoleLogCount} console.log calls`;
  } else if (consoleLogCount <= 25) {
    consoleScore = 2;
    consoleSummary = `${consoleLogCount} console.log calls`;
  } else if (consoleLogCount <= 75) {
    consoleScore = 1;
    consoleSummary = `${consoleLogCount} console.log calls`;
  } else {
    consoleScore = 0;
    consoleSummary = `${consoleLogCount} console.log calls (excessive)`;
  }

  // --- Import hygiene /4 ---
  // Heuristic: check for self-imports and suspicious circular patterns
  let importIssues = 0;
  let importHygieneSummary = '';

  for (const file of appFiles) {
    const content = contents.get(file) ?? '';
    // Self-imports (importing from same file path)
    const basename = file.replace(/\\/g, '/').split('/').pop()?.replace(/\.tsx?$/, '') ?? '';
    if (basename && new RegExp(`from ['"].*/${basename}['"]`).test(content)) {
      importIssues++;
    }
    // Detect wildcard re-exports that might cause barrel file issues
    const wildcardExports = (content.match(/export \* from/g) ?? []).length;
    if (wildcardExports > 5) importIssues++;
  }

  let importScore = 0;
  if (importIssues === 0) {
    importScore = 4;
    importHygieneSummary = 'clean imports';
  } else if (importIssues <= 2) {
    importScore = 2;
    importHygieneSummary = `${importIssues} import issue${importIssues !== 1 ? 's' : ''} detected`;
  } else {
    importScore = 0;
    importHygieneSummary = `${importIssues} import issues detected`;
  }

  const score = asyncScore + consoleScore + importScore;
  const summary = [asyncSummary, consoleSummary].filter(Boolean).join(', ');

  return {
    name: 'Performance',
    emoji: '⚡',
    score: Math.min(score, 10),
    max: 10,
    summary,
    subcategories: [
      { name: 'Async patterns', score: Math.min(asyncScore, 3), max: 3, summary: asyncSummary, issuesFound: awaitInLoopCount, issuesDescription: 'await-in-loop patterns' },
      { name: 'Console cleanup', score: Math.min(consoleScore, 5), max: 5, summary: consoleSummary, issuesFound: consoleLogCount, issuesDescription: 'console.log calls in src', locations: consoleLogFiles },
      { name: 'Import hygiene', score: Math.min(importScore, 2), max: 2, summary: importHygieneSummary, issuesFound: importIssues, issuesDescription: 'import issues' },
    ],
  };
}

// Code Quality (15 points)
// ├─ Function length ........ /4
// ├─ Line length ............ /4
// ├─ Dead code .............. /4
// └─ Duplication ............ /3
function scoreCodeQuality(files: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));

  let totalFnLength = 0;
  let fnCount = 0;
  let longFnCount = 0;
  let longLineCount = 0;
  let commentedCodeCount = 0;
  let todoCount = 0;
  const longFuncFiles: string[] = [];
  const longLineFiles: string[] = [];

  // For duplication: collect all source lines
  const lineFrequency = new Map<string, number>();

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    const lines = content.split('\n');

    const fileLongLines = lines.filter(l => l.length > 120).length;
    longLineCount += fileLongLines;
    if (fileLongLines > 0) longLineFiles.push(file);

    // Count commented-out code (lines that look like code inside comments)
    commentedCodeCount += lines.filter(l =>
      /^\s*\/\/\s*(?:const|let|var|function|return|if\s*\(|for\s*\(|while\s*\(|import|export)\b/.test(l),
    ).length;

    // Count TODO/FIXME
    todoCount += lines.filter(l => /\b(?:TODO|FIXME|HACK|XXX)\b/.test(l)).length;

    // Estimate function lengths via brace tracking
    let fnStart = -1;
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
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
          fnCount++;
          totalFnLength += fnLen;
          if (fnLen > 50) {
            longFnCount++;
            if (!longFuncFiles.includes(file)) longFuncFiles.push(file);
          }
          fnStart = -1;
          depth = 0;
        }
      }

      // Track line frequency for duplication detection (ignore blank/comment lines)
      const stripped = line.trim();
      if (stripped.length > 10 && !stripped.startsWith('//') && !stripped.startsWith('*')) {
        lineFrequency.set(stripped, (lineFrequency.get(stripped) ?? 0) + 1);
      }
    }
  }

  // --- Function length /6 ---
  const avgLen = fnCount > 0 ? totalFnLength / fnCount : 0;
  let fnLenScore = 0;
  let fnLenSummary = '';

  if (fnCount === 0 || avgLen <= 20) {
    fnLenScore = 6;
    fnLenSummary = fnCount === 0 ? 'no functions detected' : 'short functions';
  } else if (avgLen <= 30) {
    fnLenScore = 6;
    fnLenSummary = `avg ${Math.round(avgLen)}-line functions`;
  } else if (avgLen <= 40) {
    fnLenScore = 5;
    fnLenSummary = `avg ${Math.round(avgLen)}-line functions`;
  } else if (avgLen <= 50) {
    fnLenScore = 4;
    fnLenSummary = `avg ${Math.round(avgLen)}-line functions`;
  } else if (avgLen <= 65) {
    fnLenScore = 3;
    fnLenSummary = `avg ${Math.round(avgLen)}-line functions`;
  } else if (avgLen <= 80) {
    fnLenScore = 2;
    fnLenSummary = `avg ${Math.round(avgLen)}-line functions`;
  } else {
    fnLenScore = 1;
    fnLenSummary = `long avg (${Math.round(avgLen)} lines)`;
  }

  // --- Line length /6 ---
  let lineLenScore = 0;
  let lineLenSummary = '';

  if (longLineCount === 0) {
    lineLenScore = 6;
    lineLenSummary = 'no long lines';
  } else if (longLineCount <= 5) {
    lineLenScore = 5;
    lineLenSummary = `${longLineCount} long line${longLineCount !== 1 ? 's' : ''}`;
  } else if (longLineCount <= 15) {
    lineLenScore = 4;
    lineLenSummary = `${longLineCount} long lines`;
  } else if (longLineCount <= 50) {
    lineLenScore = 3;
    lineLenSummary = `${longLineCount} long lines`;
  } else if (longLineCount <= 150) {
    lineLenScore = 2;
    lineLenSummary = `${longLineCount} long lines`;
  } else if (longLineCount <= 500) {
    lineLenScore = 1;
    lineLenSummary = `${longLineCount} long lines`;
  } else {
    lineLenScore = 0;
    lineLenSummary = `${longLineCount} long lines (excessive)`;
  }

  // --- Dead code /6 ---
  const deadCodeTotal = commentedCodeCount + todoCount;
  let deadCodeScore = 0;
  let deadCodeSummary = '';

  if (deadCodeTotal === 0) {
    deadCodeScore = 6;
    deadCodeSummary = 'no dead code detected';
  } else if (commentedCodeCount === 0 && todoCount <= 3) {
    deadCodeScore = 5;
    deadCodeSummary = `${todoCount} TODO${todoCount !== 1 ? 's' : ''}`;
  } else if (commentedCodeCount <= 3 && todoCount <= 5) {
    deadCodeScore = 4;
    deadCodeSummary = `${commentedCodeCount} commented-out, ${todoCount} TODOs`;
  } else if (commentedCodeCount <= 10) {
    deadCodeScore = 2;
    deadCodeSummary = `${commentedCodeCount} commented-out lines, ${todoCount} TODOs`;
  } else {
    deadCodeScore = 0;
    deadCodeSummary = `${commentedCodeCount} commented-out lines, ${todoCount} TODOs`;
  }

  // --- Duplication /6 ---
  // Count lines that appear 3+ times across the codebase
  let duplicatedLines = 0;
  for (const [, count] of lineFrequency) {
    if (count >= 3) duplicatedLines++;
  }

  let dupScore = 0;
  let dupSummary = '';

  if (duplicatedLines === 0) {
    dupScore = 6;
    dupSummary = 'no significant duplication';
  } else if (duplicatedLines <= 10) {
    dupScore = 5;
    dupSummary = `${duplicatedLines} repeated lines`;
  } else if (duplicatedLines <= 30) {
    dupScore = 4;
    dupSummary = `${duplicatedLines} repeated lines`;
  } else if (duplicatedLines <= 100) {
    dupScore = 3;
    dupSummary = `${duplicatedLines} repeated lines`;
  } else if (duplicatedLines <= 300) {
    dupScore = 2;
    dupSummary = `${duplicatedLines} repeated lines`;
  } else if (duplicatedLines <= 700) {
    dupScore = 1;
    dupSummary = `${duplicatedLines} repeated lines (high duplication)`;
  } else {
    dupScore = 0;
    dupSummary = `${duplicatedLines} repeated lines (excessive)`;
  }

  const score = fnLenScore + lineLenScore + deadCodeScore + dupScore;
  const summary = [fnLenSummary, lineLenSummary].filter(Boolean).join(', ');

  return {
    name: 'Code Quality',
    emoji: '📖',
    score: Math.min(score, 15),
    max: 15,
    summary,
    subcategories: [
      { name: 'Function length', score: Math.min(fnLenScore, 4), max: 4, summary: fnLenSummary, issuesFound: longFnCount, issuesDescription: 'functions >50 lines', locations: longFuncFiles },
      { name: 'Line length', score: Math.min(lineLenScore, 4), max: 4, summary: lineLenSummary, issuesFound: longLineCount, issuesDescription: 'lines >120 chars', locations: longLineFiles },
      { name: 'Dead code', score: Math.min(deadCodeScore, 4), max: 4, summary: deadCodeSummary, issuesFound: deadCodeTotal, issuesDescription: 'dead code indicators (TODO, commented code)' },
      { name: 'Duplication', score: Math.min(dupScore, 3), max: 3, summary: dupSummary, issuesFound: duplicatedLines, issuesDescription: 'repeated code lines' },
    ],
  };
}

// --- Aggregate issues from categories ---

function aggregateIssues(categories: CategoryResult[]): { totalIssuesFound: number; issuesByType: IssueType[] } {
  const issuesByType: IssueType[] = [];
  let totalIssuesFound = 0;

  const SEVERITY_MAP: Record<string, Record<string, 'low' | 'medium' | 'high'>> = {
    'Testing': {
      'Coverage ratio': 'high',
      'Edge case depth': 'medium',
      'Test quality': 'low',
    },
    'Security': {
      'Secrets & env vars': 'high',
      'Input validation': 'high',
      'Auth & rate limiting': 'medium',
    },
    'Type Safety': {
      'Strict config': 'medium',
      'Any type count': 'medium',
    },
    'Error Handling': {
      'Coverage': 'high',
      'Empty catches': 'high',
      'Structured logging': 'low',
    },
    'Performance': {
      'Async patterns': 'medium',
      'Console cleanup': 'low',
      'Import hygiene': 'low',
    },
    'Code Quality': {
      'Function length': 'medium',
      'Line length': 'low',
      'Dead code': 'low',
      'Duplication': 'medium',
    },
  };

  for (const cat of categories) {
    for (const sub of cat.subcategories) {
      if (sub.issuesFound > 0 && sub.issuesDescription) {
        const severity = SEVERITY_MAP[cat.name]?.[sub.name] ?? 'low';
        issuesByType.push({
          category: cat.name,
          subcategory: sub.name,
          count: sub.issuesFound,
          description: sub.issuesDescription,
          severity,
          locations: sub.locations,
        });
        totalIssuesFound += sub.issuesFound;
      }
    }
  }

  // Sort by severity then count
  const severityOrder = { high: 0, medium: 1, low: 2 };
  issuesByType.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.count - a.count;
  });

  return { totalIssuesFound, issuesByType };
}

// --- Main scan logic ---

export async function runScan(cwd: string): Promise<ScanResult> {
  // Resolve project name from package.json or directory name
  let projectName = cwd.split('/').pop() ?? 'unknown';
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
      if (pkg.name) projectName = pkg.name;
    } catch { /* ignore */ }
  }

  const files = findSourceFiles(cwd);
  const contents = readContents(files);

  const categories: CategoryResult[] = [
    scoreTests(files, contents, cwd),
    scoreSecurity(files, contents),
    scoreTypes(files, cwd, contents),
    scoreErrorHandling(files, contents),
    scorePerformance(files, contents),
    scoreCodeQuality(files, contents),
  ];

  const total = categories.reduce((sum, c) => sum + c.score, 0);
  const maxTotal = categories.reduce((sum, c) => sum + c.max, 0);

  const { totalIssuesFound, issuesByType } = aggregateIssues(categories);

  return { projectName, total, maxTotal, categories, totalIssuesFound, issuesByType };
}

function scoreColor(score: number, max: number): typeof chalk {
  const pct = score / max;
  if (pct >= 0.8) return chalk.green;
  if (pct >= 0.5) return chalk.yellow;
  return chalk.red;
}

function renderScan(result: ScanResult): void {
  printHeader('🔧 Ratchet Scan — Production Readiness');
  console.log(`Your app: ${chalk.cyan(result.projectName)}`);

  const pct = result.total / result.maxTotal;
  const totalColor = pct >= 0.8 ? chalk.green : pct >= 0.5 ? chalk.yellow : chalk.red;
  const issuesStr = result.totalIssuesFound > 0
    ? chalk.dim(`  |  Issues: ${result.totalIssuesFound} found`)
    : '';
  console.log(`Score:    ${totalColor.bold(`${result.total}/${result.maxTotal}`)}${issuesStr}`);
  process.stdout.write('\n');

  for (const cat of result.categories) {
    const color = scoreColor(cat.score, cat.max);
    const label = `${cat.emoji} ${cat.name}`.padEnd(22);
    const scoreStr = `${cat.score}/${cat.max}`;
    console.log(`  ${label} ${color.bold(scoreStr)}`);

    // Print subcategories
    for (const sub of cat.subcategories) {
      const subColor = scoreColor(sub.score, sub.max);
      const subLabel = sub.name.padEnd(24);
      const subScore = `${sub.score}/${sub.max}`.padEnd(6);
      console.log(`     ${chalk.dim(subLabel)} ${subColor(`${subScore}`)}  ${chalk.dim(sub.summary)}`);
    }
  }

  // Print issues section
  if (result.issuesByType.length > 0) {
    process.stdout.write('\n');
    console.log(`  ${chalk.bold(`📋 Issues Found: ${result.totalIssuesFound}`)}`);
    const topIssues = result.issuesByType.slice(0, 8);
    for (const issue of topIssues) {
      const sevColor = severityColor(issue.severity);
      const sev = sevColor(`(${issue.severity})`);
      console.log(`     ${issue.count} ${issue.description} ${sev}`);
    }
    if (result.issuesByType.length > 8) {
      console.log(chalk.dim(`     ... and ${result.issuesByType.length - 8} more issue type${result.issuesByType.length - 8 !== 1 ? 's' : ''}`));
    }
  }

  process.stdout.write('\n');
  console.log(chalk.dim("Run 'npx ratchet fix' to improve your score."));
  process.stdout.write('\n');
}

// --- Command ---

export function scanCommand(): Command {
  const cmd = new Command('scan');

  cmd
    .description(
      'Scan the project and generate a Production Readiness Score (0-100).\n' +
      'Analyzes testing, security, types, error handling, performance, and code quality.',
    )
    .argument('[dir]', 'Directory to scan (default: current directory)', '.')
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet scan\n' +
      '  $ ratchet scan ./my-project\n',
    )
    .action(async (dir: string) => {
      const { resolve } = await import('path');
      const cwd = resolve(dir);

      const result = await runScan(cwd);
      renderScan(result);
    });

  return cmd;
}
