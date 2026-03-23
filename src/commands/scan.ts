import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { IssueSubcategory, IssueCategoryName } from '../core/taxonomy.js';
import { printHeader, severityColor, scoreColor } from '../lib/cli.js';
import { logger } from '../lib/logger.js';
import { classifyIssues, summarizeClassifications } from '../core/cross-cutting.js';
import { getExplanation } from '../core/explanations.js';
import type { ClickGuards } from '../types.js';

// --- Quality Gate Types ---

export interface CategoryThreshold {
  categoryName: string;
  threshold: number;
  max: number;
}

export interface GateResult {
  passed: boolean;
  failedCategories: Array<{ name: string; score: number; threshold: number }>;
  totalScore: number;
  totalThreshold: number | null;
}

function parseCategoryThreshold(raw: string): CategoryThreshold {
  const eqIndex = raw.indexOf('=');
  if (eqIndex === -1) {
    throw new Error(
      `Invalid --fail-on-category format: "${raw}". Expected "CategoryName=Score" (e.g., Security=12).`,
    );
  }
  const name = raw.slice(0, eqIndex).trim();
  const scoreStr = raw.slice(eqIndex + 1).trim();
  const score = parseInt(scoreStr, 10);
  if (isNaN(score) || score < 0) {
    throw new Error(
      `Invalid threshold score in --fail-on-category "${raw}". Score must be a non-negative integer.`,
    );
  }
  return { categoryName: name, threshold: score, max: 0 };
}

function evaluateGates(
  result: ScanResult,
  totalThreshold: number | null,
  categoryThresholds: CategoryThreshold[],
): GateResult {
  const failedCategories: GateResult['failedCategories'] = [];

  const resolvedThresholds = categoryThresholds.map((ct) => {
    const cat = result.categories.find(
      (c) => c.name.toLowerCase() === ct.categoryName.toLowerCase(),
    );
    if (!cat) {
      throw new Error(
        `Category "${ct.categoryName}" not found. Available: ${result.categories.map((c) => c.name).join(', ')}.`,
      );
    }
    return { ...ct, score: cat.score, max: cat.max };
  });

  for (const ct of resolvedThresholds) {
    if (ct.score < ct.threshold) {
      failedCategories.push({ name: ct.categoryName, score: ct.score, threshold: ct.threshold });
    }
  }

  const totalPassed = totalThreshold === null || result.total >= totalThreshold;

  return {
    passed: totalPassed && failedCategories.length === 0,
    failedCategories,
    totalScore: result.total,
    totalThreshold,
  };
}

function exitWithGateFailure(gate: GateResult): never {
  process.stdout.write('\n');
  process.stdout.write(chalk.red.bold('❌ Quality Gate Failed\n\n'));

  if (gate.totalThreshold !== null && gate.totalScore < gate.totalThreshold) {
    process.stdout.write(
      `  ${chalk.red('✗')} Overall score ${chalk.red(`${gate.totalScore}`)} ` +
        `below required threshold of ${gate.totalThreshold}\n`,
    );
  }

  if (gate.failedCategories.length > 0) {
    process.stdout.write('\n  Failed category thresholds:\n');
    for (const fc of gate.failedCategories) {
      process.stdout.write(
        `    ${chalk.red('✗')} ${fc.name}: ${chalk.red(String(fc.score))} — required ≥${fc.threshold}\n`,
      );
    }
  }

  process.stdout.write('\n');
  process.exit(1);
}
import {
  LOOP_DB_API_PATTERN,
  SECRET_PATTERNS,
  isTestFile,
  findSourceFiles,
  readContents,
  scoreByThresholds,
  countMatches,
  countMatchesWithFiles,
  anyFileHasMatch,
  DUP_SCORE_THRESHOLDS,
  scoreStrictConfig,
} from '../core/scan-constants.js';
import { classifyFiles, filterByClass } from '../core/file-classifier.js';
import { confirmWithAST, type ASTRule } from '../core/ast-confirm.js';

function astConfirmedCount(files: string[], contents: Map<string, string>, rule: ASTRule): number {
  let total = 0;
  for (const file of files) {
    const content = contents.get(file) ?? '';
    const astCount = confirmWithAST(content, rule);
    if (astCount >= 0) total += astCount;
  }
  return total;
}
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
} from '../core/scan-scorers.js';

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

// --- Scorers ---

// Testing (25 points)
// ├─ Coverage ratio ......... /8
// ├─ Edge case depth ........ /9
// └─ Test quality ........... /8
function scoreTests(files: string[], contents: Map<string, string>, cwd: string): CategoryResult {
  const testFiles = files.filter(isTestFile);
  const sourceFiles = files.filter(f => !isTestFile(f));

  // Check for test script in package.json
  let hasTestScript = false;
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
      const testScript = pkg.scripts?.test ?? '';
      if (testScript && !testScript.includes('no test') && !testScript.includes('echo "Error')) {
        hasTestScript = true;
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to read package.json for test script detection');
    }
  }

  const { score: coverageScore, summary: coverageSummary, issues: coverageIssues } =
    scoreCoverageRatio(testFiles.length, sourceFiles.length, hasTestScript);

  const edgePatterns =
    /\b(?:it|test)\s*[.(]['"`][^'"`]*(?:error|invalid|edge|boundary|fail|reject|throw|null|undefined|empty|missing|exceed)[^'"`]*['"`]/gi;
  // contextAware=false: this pattern intentionally matches inside test description strings
  const edgeCaseCount = countMatches(testFiles, contents, edgePatterns, false);
  const { score: edgeCaseScore, summary: edgeCaseSummary } = scoreEdgeCases(edgeCaseCount);

  const totalTestCases = countMatches(testFiles, contents, /\b(?:it|test)\s*[.(]/g);
  const assertCount = countMatches(testFiles, contents, /\b(?:expect|assert)\s*[.(]/g);
  const describeCount = countMatches(testFiles, contents, /\bdescribe\s*[.(]/g);
  const { score: testQualityScore, summary: testQualitySummary } =
    scoreTestQuality(totalTestCases, assertCount, describeCount > 0);

  const coverageLocations: string[] = coverageIssues > 0 ? sourceFiles : [];

  return {
    name: 'Testing',
    emoji: '🧪',
    score: Math.min(coverageScore + edgeCaseScore + testQualityScore, 25),
    max: 25,
    summary: [coverageSummary, edgeCaseSummary].filter(Boolean).join(', '),
    subcategories: [
      {
        name: 'Coverage ratio', score: coverageScore, max: 8, summary: coverageSummary,
        issuesFound: coverageIssues, issuesDescription: 'source files without tests', locations: coverageLocations,
      },
      {
        name: 'Edge case depth', score: edgeCaseScore, max: 9, summary: edgeCaseSummary,
        issuesFound: edgeCaseCount === 0 ? 1 : 0, issuesDescription: 'no edge case tests',
      },
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

  // --- Secrets & env vars /3 ---
  let secretCount = 0;
  for (const pattern of SECRET_PATTERNS) {
    // contextAware=false: secret patterns match inside string literals by design
    secretCount += countMatches(srcFiles, contents, pattern, false);
  }
  // AST confirmation: use AST count to eliminate false positives from regex
  const astSecretCount = astConfirmedCount(srcFiles, contents, 'hardcoded-secret');
  if (astSecretCount >= 0) secretCount = astSecretCount;
  const usesEnvVars = anyFileHasMatch(srcFiles, contents, /\bprocess\.env\b|\bos\.environ\b|\bos\.getenv\b/);
  const { score: secretsScore, summary: secretsSummary } = scoreSecrets(secretCount, usesEnvVars);

  // --- Input validation /6 ---
  let validationFileCount = 0;
  let routeFileCount = 0;
  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    const hasZodJoi =
      /\b(?:zod|joi|yup|valibot)\b|z\.object\s*\(|Joi\.object\s*\(|z\.string\s*\(|z\.number\s*\(/i.test(content);
    const hasUuidValidation = /\buuid\b.*\bvalidate\b|\bvalidate.*uuid\b|isUUID|uuidv[1-5]/i.test(content);
    const hasParamValidation =
      /(?:req\.params|req\.body|req\.query).*(?:typeof|instanceof|\.match|\.test|\.validate|schema\.parse)/i.test(content);
    const isRouteFile = /(?:router\.|app\.(?:get|post|put|patch|delete)|@(?:Get|Post|Put|Patch|Delete))/i.test(content);
    if (isRouteFile) routeFileCount++;
    if (hasZodJoi || hasUuidValidation || hasParamValidation) validationFileCount++;
  }
  const { score: inputValScore, summary: inputValSummary, issues: inputValIssues } =
    scoreInputValidation(validationFileCount, routeFileCount);

  // --- Auth & rate limiting /6 ---
  const hasAuthMiddleware = anyFileHasMatch(
    srcFiles, contents,
    new RegExp(
      /\b(?:authenticate|authorize|isAuthenticated|requireAuth|authMiddleware|verifyToken)/.source +
      /|passport\.authenticate|jwt\.verify|bearer|middleware.*auth\b/.source,
      'i',
    ),
  );
  const hasRateLimit = anyFileHasMatch(
    srcFiles, contents,
    /\b(?:rateLimit|rate[-_]limit|express-rate-limit|throttle|limiter)\b/i,
  );
  const hasCors = anyFileHasMatch(srcFiles, contents, /\b(?:cors\s*\(|cors\s*\{|helmet\s*\(|'cors'|"cors")\b/i);

  // Detect overly broad middleware scope (app.use on specific sub-paths instead of app.post/get)
  const GLOBAL_API_PATH = /^['"`]\/api['"`]$/;
  let broadMiddlewareCount = 0;
  const broadMiddlewareLocations: string[] = [];
  for (const filePath of srcFiles) {
    const content = contents.get(filePath);
    if (!content) continue;
    const lines = content.split('\n');
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const match = lines[lineIdx]!.match(
        /app\.use\s*\(\s*(['"`]\/api\/[a-zA-Z0-9/_-][^'"`]*['"`])\s*,\s*\w*[Ll]imit\w*/,
      );
      if (match && !GLOBAL_API_PATH.test(match[1]!)) {
        broadMiddlewareCount++;
        broadMiddlewareLocations.push(`${filePath}:${lineIdx + 1}`);
      }
    }
  }

  const { score: authScore, summary: authSummary, issues: authIssues } =
    scoreAuthChecks(hasAuthMiddleware, hasRateLimit, hasCors, broadMiddlewareCount);

  return {
    name: 'Security',
    emoji: '🔒',
    score: Math.min(secretsScore + inputValScore + authScore, 15),
    max: 15,
    summary: [secretsSummary, inputValSummary].filter(Boolean).join(', '),
    subcategories: [
      {
        name: 'Secrets & env vars', score: secretsScore, max: 3, summary: secretsSummary,
        issuesFound: secretCount, issuesDescription: 'hardcoded secrets',
      },
      {
        name: 'Input validation', score: inputValScore, max: 6, summary: inputValSummary,
        issuesFound: inputValIssues, issuesDescription: 'route files without validation',
      },
      {
        name: 'Auth & rate limiting', score: authScore, max: 6, summary: authSummary,
        issuesFound: authIssues,
        issuesDescription: broadMiddlewareCount > 0
          ? `missing auth/security controls + ${broadMiddlewareCount} overly broad rate limiter scope(s)`
          : 'missing auth/security controls',
        locations: broadMiddlewareLocations.length > 0 ? broadMiddlewareLocations : undefined,
      },
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
        {
          name: 'Strict config', score: 0, max: 7, summary: 'JavaScript only',
          issuesFound: 1, issuesDescription: 'no TypeScript',
        },
        { name: 'Any type count', score: 0, max: 8, summary: 'JavaScript only', issuesFound: 0 },
      ],
    };
  }

  // --- Strict config /7 ---
  const { score: strictScore, summary: strictSummary } = scoreStrictConfig(cwd);

  // --- Any type count /8 ---
  const srcTsFiles = tsFiles.filter(f => !isTestFile(f) && !f.endsWith('.d.ts'));
  const { count: anyCount, matchedFiles: anyTypeFiles } = countMatchesWithFiles(
    srcTsFiles, contents, /:\s*any\b|<any>|\bas\s+any\b/g,
  );
  let totalLines = 0;
  for (const file of srcTsFiles) totalLines += (contents.get(file) ?? '').split('\n').length;

  const { score: anyScore, summary: anySummary } = scoreAnyTypeDensity(anyCount, totalLines);

  return {
    name: 'Type Safety',
    emoji: '📝',
    score: Math.min(strictScore + anyScore, 15),
    max: 15,
    summary: [strictSummary, anySummary].filter(Boolean).join(', '),
    subcategories: [
      {
        name: 'Strict config', score: strictScore, max: 7, summary: strictSummary,
        issuesFound: strictScore < 7 ? 1 : 0, issuesDescription: 'missing strict TypeScript config',
      },
      {
        name: 'Any type count', score: anyScore, max: 8, summary: anySummary,
        issuesFound: anyCount, issuesDescription: 'any types', locations: anyTypeFiles,
      },
    ],
  };
}

// Error Handling (20 points)
// ├─ Coverage ............... /8
// ├─ Empty catches .......... /5
// └─ Structured logging ..... /7
function scoreErrorHandling(files: string[], prodFiles: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));

  const tryCatchTotal = countMatches(srcFiles, contents, /\btry\s*\{/g);
  const { count: emptyCatchRegex, matchedFiles: emptyCatchFiles } = countMatchesWithFiles(
    prodFiles, contents, /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
  );
  const emptyCatchAst = astConfirmedCount(emptyCatchFiles, contents, 'empty-catch');
  const emptyCatchTotal = emptyCatchAst >= 0 ? emptyCatchAst : emptyCatchRegex;
  const consoleErrorCount = countMatches(prodFiles, contents, /\bconsole\.(?:error|warn|log)\s*\(/g);
  const structuredLogCount = countMatches(prodFiles, contents, /\b(?:logger|winston|pino|bunyan|log4js)\./g);

  let asyncTotal = 0;
  const asyncNoHandlerFiles: string[] = [];
  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    const fileAsync = (content.match(/\basync\s+function\b|\basync\s*\(/g) ?? []).length;
    asyncTotal += fileAsync;
    if (fileAsync > 0 && (content.match(/\btry\s*\{/g) ?? []).length === 0) asyncNoHandlerFiles.push(file);
  }

  const { score: coverageScore, summary: coverageSummary } = scoreEhCoverage(tryCatchTotal, asyncTotal);
  const { score: emptyCatchScore, summary: emptyCatchSummary } = scoreEmptyCatches(emptyCatchTotal);
  const { score: loggingScore, summary: loggingSummary } = scoreStructuredLogging(
    structuredLogCount, consoleErrorCount,
  );

  return {
    name: 'Error Handling',
    emoji: '⚠️ ',
    score: Math.min(coverageScore + emptyCatchScore + loggingScore, 20),
    max: 20,
    summary: [coverageSummary, emptyCatchSummary].filter(Boolean).join(', '),
    subcategories: [
      {
        name: 'Coverage', score: coverageScore, max: 8, summary: coverageSummary,
        issuesFound: Math.max(0, asyncTotal - tryCatchTotal),
        issuesDescription: 'async functions without error handling', locations: asyncNoHandlerFiles,
      },
      {
        name: 'Empty catches', score: emptyCatchScore, max: 5, summary: emptyCatchSummary,
        issuesFound: emptyCatchTotal, issuesDescription: 'empty catch blocks', locations: emptyCatchFiles,
      },
      {
        name: 'Structured logging', score: loggingScore, max: 7, summary: loggingSummary,
        issuesFound: structuredLogCount === 0 ? 1 : 0, issuesDescription: 'no structured logger',
      },
    ],
  };
}

// Performance (10 points)
// ├─ Async patterns ......... /3
// ├─ Console cleanup ........ /5
// └─ Import hygiene ......... /2
function scorePerformance(files: string[], prodFiles: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));
  const appFiles = srcFiles.filter(f => !f.replace(/\\/g, '/').includes('/scripts/'));
  const prodAppFiles = prodFiles.filter(f => !f.replace(/\\/g, '/').includes('/scripts/'));

  const { count: consoleLogRegex, matchedFiles: consoleLogFiles } = countMatchesWithFiles(
    prodAppFiles, contents, /\bconsole\.log\s*\(/g,
  );
  const consoleLogAst = astConfirmedCount(consoleLogFiles, contents, 'console-usage');
  const consoleLogCount = consoleLogAst >= 0 ? consoleLogAst : consoleLogRegex;

  let awaitInLoopCount = 0;
  for (const file of appFiles) {
    const content = contents.get(file) ?? '';
    const lines = content.split('\n');
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
        if (/\bawait\s+/.test(stripped) && LOOP_DB_API_PATTERN.test(stripped)) awaitInLoopCount++;
      }
    }
  }

  let importIssues = 0;
  for (const file of appFiles) {
    const content = contents.get(file) ?? '';
    const basename = file.replace(/\\/g, '/').split('/').pop()?.replace(/\.tsx?$/, '') ?? '';
    if (basename && new RegExp(`from ['"].*/${basename}['"]`).test(content)) importIssues++;
    if ((content.match(/export \* from/g) ?? []).length > 5) importIssues++;
  }

  const { score: asyncScore, summary: asyncSummary } = scoreAwaitInLoop(awaitInLoopCount);
  const { score: consoleScore, summary: consoleSummary } = scoreConsoleLog(consoleLogCount);
  const { score: importScore, summary: importHygieneSummary } = scoreImportHygiene(importIssues);

  return {
    name: 'Performance',
    emoji: '⚡',
    score: Math.min(asyncScore + consoleScore + importScore, 10),
    max: 10,
    summary: [asyncSummary, consoleSummary].filter(Boolean).join(', '),
    subcategories: [
      {
        name: 'Async patterns', score: Math.min(asyncScore, 3), max: 3, summary: asyncSummary,
        issuesFound: awaitInLoopCount, issuesDescription: 'await-in-loop patterns',
      },
      {
        name: 'Console cleanup', score: Math.min(consoleScore, 5), max: 5, summary: consoleSummary,
        issuesFound: consoleLogCount, issuesDescription: 'console.log calls in src', locations: consoleLogFiles,
      },
      {
        name: 'Import hygiene', score: Math.min(importScore, 2), max: 2, summary: importHygieneSummary,
        issuesFound: importIssues, issuesDescription: 'import issues',
      },
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
  const lineFrequency = new Map<string, number>();

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    const lines = content.split('\n');

    const fileLongLines = lines.filter(l => l.length > 120).length;
    longLineCount += fileLongLines;
    if (fileLongLines > 0) longLineFiles.push(file);

    commentedCodeCount += lines.filter(l =>
      /^\s*\/\/\s*(?:const|let|var|function|return|if\s*\(|for\s*\(|while\s*\(|import|export)\b/.test(l),
    ).length;
    todoCount += lines.filter(l => /\b(?:TODO|FIXME|HACK|XXX)\b/.test(l)).length;

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
          if (fnLen > 50) { longFnCount++; if (!longFuncFiles.includes(file)) longFuncFiles.push(file); }
          fnStart = -1; depth = 0;
        }
      }

      const stripped = line.trim();
      if (stripped.length > 10 && !stripped.startsWith('//') && !stripped.startsWith('*')) {
        lineFrequency.set(stripped, (lineFrequency.get(stripped) ?? 0) + 1);
      }
    }
  }

  let duplicatedLines = 0;
  for (const [, count] of lineFrequency) { if (count >= 3) duplicatedLines++; }

  const avgLen = fnCount > 0 ? totalFnLength / fnCount : 0;
  const { score: fnLenScore, summary: fnLenSummary } = scoreFunctionLength(avgLen, fnCount);
  const { score: lineLenScore, summary: lineLenSummary } = scoreLineLength(longLineCount);
  const { score: deadCodeScore, summary: deadCodeSummary } = scoreDeadCode(commentedCodeCount, todoCount);
  const { score: dupScore, summary: dupSummary } = scoreByThresholds(duplicatedLines, DUP_SCORE_THRESHOLDS);

  return {
    name: 'Code Quality',
    emoji: '📖',
    score: Math.min(fnLenScore + lineLenScore + deadCodeScore + dupScore, 15),
    max: 15,
    summary: [fnLenSummary, lineLenSummary].filter(Boolean).join(', '),
    subcategories: [
      {
        name: 'Function length', score: Math.min(fnLenScore, 4), max: 4, summary: fnLenSummary,
        issuesFound: longFnCount, issuesDescription: 'functions >50 lines', locations: longFuncFiles,
      },
      {
        name: 'Line length', score: Math.min(lineLenScore, 4), max: 4, summary: lineLenSummary,
        issuesFound: longLineCount, issuesDescription: 'lines >120 chars', locations: longLineFiles,
      },
      {
        name: 'Dead code', score: Math.min(deadCodeScore, 4), max: 4, summary: deadCodeSummary,
        issuesFound: commentedCodeCount + todoCount,
        issuesDescription: 'dead code indicators (TODO, commented code)',
      },
      {
        name: 'Duplication', score: Math.min(dupScore, 3), max: 3, summary: dupSummary,
        issuesFound: duplicatedLines, issuesDescription: 'repeated code lines',
      },
    ],
  };
}

// --- Main scan logic ---

export interface RunScanOptions {
  includeTests?: boolean;
}

export async function runScan(cwd: string, options: RunScanOptions = {}): Promise<ScanResult> {
  let projectName = cwd.split('/').pop() ?? 'unknown';
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
      if (pkg.name) projectName = pkg.name;
    } catch (err) {
      logger.debug({ err }, 'Failed to read package.json for project name');
    }
  }

  // Always include test files for the Testing scorer (needs them for coverage ratio).
  // When scanProductionOnly is on, exclude test files from all other scorers.
  const allFiles = findSourceFiles(cwd, { scanProductionOnly: false });
  const scoringFiles = options.includeTests
    ? allFiles
    : allFiles.filter(f => !isTestFile(f));
  const contents = readContents(allFiles);
  const fileClassifications = classifyFiles(scoringFiles);
  const prodFiles = filterByClass(scoringFiles, fileClassifications, 'production');

  const categories: CategoryResult[] = [
    scoreTests(allFiles, contents, cwd),
    scoreSecurity(scoringFiles, contents),
    scoreTypes(scoringFiles, cwd, contents),
    scoreErrorHandling(scoringFiles, prodFiles, contents),
    scorePerformance(scoringFiles, prodFiles, contents),
    scoreCodeQuality(scoringFiles, contents),
  ];

  const total = categories.reduce((sum, c) => sum + c.score, 0);
  const maxTotal = categories.reduce((sum, c) => sum + c.max, 0);
  const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(categories);

  return { projectName, total, maxTotal, categories, totalIssuesFound, issuesByType };
}

function renderScan(result: ScanResult, opts?: { explain?: boolean }): void {
  const showExplain = opts?.explain ?? false;
  printHeader('🔧 Ratchet Scan — Production Readiness');
  process.stdout.write(`Your app: ${chalk.cyan(result.projectName)}\n`);

  const totalColor = scoreColor(result.total, result.maxTotal);
  const issuesStr = result.totalIssuesFound > 0
    ? chalk.dim(`  |  Issues: ${result.totalIssuesFound} found`)
    : '';
  process.stdout.write(`Score:    ${totalColor.bold(`${result.total}/${result.maxTotal}`)}${issuesStr}\n`);
  process.stdout.write('\n');

  for (const cat of result.categories) {
    const color = scoreColor(cat.score, cat.max);
    const label = `${cat.emoji} ${cat.name}`.padEnd(22);
    process.stdout.write(`  ${label} ${color.bold(`${cat.score}/${cat.max}`)}\n`);

    for (const sub of cat.subcategories) {
      const subColor = scoreColor(sub.score, sub.max);
      const subLabel = sub.name.padEnd(24);
      const subScore = `${sub.score}/${sub.max}`.padEnd(6);
      process.stdout.write(`     ${chalk.dim(subLabel)} ${subColor(`${subScore}`)}  ${chalk.dim(sub.summary)}\n`);

      if (showExplain) {
        const explanation = getExplanation(sub.name);
        if (explanation) {
          process.stdout.write(`       ${chalk.cyan('Why?')} ${explanation.why}\n`);
          process.stdout.write(`       ${chalk.green('Fix:')} ${explanation.fix}\n`);
          if (explanation.example) {
            for (const line of explanation.example.split('\n')) {
              process.stdout.write(`       ${chalk.dim(line)}\n`);
            }
          }
        }
      }
    }
  }

  if (result.issuesByType.length > 0) {
    process.stdout.write('\n');
    process.stdout.write(`  ${chalk.bold(`📋 Issues Found: ${result.totalIssuesFound}`)}\n`);
    const topIssues = result.issuesByType.slice(0, 8);
    for (const issue of topIssues) {
      const sevColor = severityColor(issue.severity);
      process.stdout.write(`     ${issue.count} ${issue.description} ${sevColor(`(${issue.severity})`)}\n`);
    }
    if (result.issuesByType.length > 8) {
      const remaining = result.issuesByType.length - 8;
      process.stdout.write(chalk.dim(`     ... and ${remaining} more issue type${remaining !== 1 ? 's' : ''}`) + '\n');
    }
  }

  // Cross-cutting classification
  const defaultGuards: ClickGuards = { maxFilesChanged: 3, maxLinesChanged: 40 };
  const classifications = classifyIssues(result, defaultGuards);
  if (classifications.length > 0) {
    const summary = summarizeClassifications(classifications);
    const crossAndArch = [...summary.crossCutting, ...summary.architectural];
    if (crossAndArch.length > 0) {
      process.stdout.write('\n');
      process.stdout.write(chalk.yellow('  ⚠ Cross-cutting issues detected:') + '\n');
      for (const c of crossAndArch) {
        const hits = `${c.hitCount} hits across ${c.fileCount} file${c.fileCount !== 1 ? 's' : ''}`;
        const rec = c.recommendation ? ` — ${c.recommendation}` : '';
        process.stdout.write(`     ${c.subcategory} (${hits})${rec}\n`);
      }
    }
    if (summary.singleFile.length > 0) {
      process.stdout.write('\n');
      process.stdout.write(chalk.green('  ✅ Single-file issues (fixable with normal torque):') + '\n');
      for (const c of summary.singleFile) {
        process.stdout.write(`     ${c.subcategory} (${c.hitCount} in individual files)\n`);
      }
    }
    if (summary.hasAnyCrossCutting) {
      process.stdout.write('\n');
      process.stdout.write(chalk.cyan(`  💡 Recommended: ${summary.recommendedCommand}`) + '\n');
    }
  }

  process.stdout.write('\n');
  process.stdout.write(chalk.dim("Run 'npx ratchet fix' to improve your score.") + '\n');
  process.stdout.write('\n');
}

// --- Language detection ---

type Language = 'ts' | 'js' | 'python' | 'go' | 'rust' | 'auto';

const NON_TSJS_WARNING = (lang: string) =>
  `Note: Ratchet scoring is optimized for TypeScript/JavaScript projects. ` +
  `Some rules (console.log, any types, tsconfig) may not apply to ${lang} projects. ` +
  `Language-specific scoring is coming soon.`;

function detectLanguage(cwd: string): { language: 'ts' | 'js' | 'python' | 'go' | 'rust'; detected: boolean } {
  if (existsSync(join(cwd, 'tsconfig.json'))) return { language: 'ts', detected: true };
  if (existsSync(join(cwd, 'package.json'))) return { language: 'js', detected: true };
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py'))) return { language: 'python', detected: true };
  if (existsSync(join(cwd, 'go.mod'))) return { language: 'go', detected: true };
  if (existsSync(join(cwd, 'Cargo.toml'))) return { language: 'rust', detected: true };
  return { language: 'ts', detected: false };
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
    .option(
      '--fail-on <score>',
      'Exit with code 1 if the overall score is below this threshold (0-100).',
      (value) => {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 0 || n > 100) throw new Error('--fail-on must be an integer between 0 and 100');
        return n;
      },
    )
    .option(
      '--fail-on-category <name=score>',
      'Exit with code 1 if a category score is below its threshold. Repeatable.',
      (value, prev: string[]) => [...(prev ?? []), value],
      [] as string[],
    )
    .option('--output-json', 'Output the full scan result as JSON for CI/CD integration.')
    .option('--explain', "Show human-readable explanations for each subcategory's issues.")
    .option('--include-tests', 'Include test files in the scan (by default, test files are excluded).')
    .option(
      '--language <lang>',
      'Language to scan: ts, js, python, go, rust, auto (default: auto — detected from project files).',
      'auto',
    )
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet scan\n' +
      '  $ ratchet scan ./my-project\n' +
      '  $ ratchet scan --fail-on 80\n' +
      '  $ ratchet scan --fail-on 80 --fail-on-category Security=12\n' +
      '  $ ratchet scan --output-json > scan-result.json\n' +
      '  $ ratchet scan --explain\n' +
      '  $ ratchet scan --include-tests\n' +
      '  $ ratchet scan --language python\n',
    )
    .action(async (dir: string, options: Record<string, unknown>) => {
      const { resolve } = await import('path');
      const cwd = resolve(dir);

      const { trackEvent } = await import('../core/telemetry.js');
      trackEvent('scan');

      // Language detection / warning
      const langOpt = (options['language'] as Language | undefined) ?? 'auto';
      const validLanguages: Language[] = ['ts', 'js', 'python', 'go', 'rust', 'auto'];
      if (!validLanguages.includes(langOpt)) {
        process.stderr.write(chalk.red(`Invalid --language value: "${langOpt}". Valid values: ts, js, python, go, rust, auto.\n`));
        process.exit(1);
      }

      let resolvedLang: 'ts' | 'js' | 'python' | 'go' | 'rust';
      if (langOpt === 'auto') {
        const { language, detected } = detectLanguage(cwd);
        resolvedLang = language;
        if (!detected) {
          process.stdout.write(chalk.yellow(NON_TSJS_WARNING('this')) + '\n\n');
        } else if (language !== 'ts' && language !== 'js') {
          process.stdout.write(chalk.yellow(NON_TSJS_WARNING(language)) + '\n\n');
        }
      } else {
        resolvedLang = langOpt as 'ts' | 'js' | 'python' | 'go' | 'rust';
        if (resolvedLang !== 'ts' && resolvedLang !== 'js') {
          process.stdout.write(chalk.yellow(NON_TSJS_WARNING(resolvedLang)) + '\n\n');
        }
      }
      void resolvedLang; // available for future language-aware scoring

      const result = await runScan(cwd, { includeTests: options['includeTests'] as boolean | undefined });

      if (options['outputJson']) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }

      renderScan(result, { explain: options['explain'] as boolean | undefined });

      const failOn = options['failOn'] as number | undefined;
      const failOnCategory = (options['failOnCategory'] as string[] | undefined) ?? [];

      if (failOn !== undefined || failOnCategory.length > 0) {
        const categoryThresholds = failOnCategory.map(parseCategoryThreshold);
        const gate = evaluateGates(result, failOn ?? null, categoryThresholds);
        if (!gate.passed) exitWithGateFailure(gate);
        process.stdout.write(chalk.green('  ✔ Quality gates passed\n\n'));
      }
    });

  return cmd;
}
