/**
 * ClassicEngine — fast, deterministic heuristic scoring.
 *
 * All scoring logic that previously lived in src/commands/scan.ts is extracted
 * here so that scan.ts becomes a thin CLI shell. The public API is:
 *
 *   const engine = new ClassicEngine();
 *   const result = await engine.analyze('/path/to/project', options);
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ScanEngine, ScanEngineOptions } from '../scan-engine.js';
import type { ScanResult, CategoryResult } from '../../commands/scan.js';
import type { Finding } from '../normalize.js';
import { getRuleBySubcategory } from '../finding-rules.js';
import {
  LOOP_DB_API_PATTERN,
  SECRET_PATTERNS,
  SEVERITY_MAP,
  isTestFile,
  findSourceFiles,
  readContents,
  scoreByThresholds,
  countMatches,
  countMatchesWithFiles,
  countMatchesWithLocations,
  anyFileHasMatch,
  DUP_SCORE_THRESHOLDS,
  scoreStrictConfig,
  scorePythonTypeConfig,
} from '../scan-constants.js';
import type { SupportedLanguage } from '../language-rules.js';
import {
  isLangTestFile,
  LANG_TEST_CASE_PATTERNS,
  LANG_ASSERTION_PATTERNS,
  LANG_DESCRIBE_PATTERNS,
  LANG_EDGE_CASE_PATTERNS,
  LANG_DEBUG_OUTPUT_PATTERNS,
  LANG_LOGGING_GUARD_PATTERNS,
  LANG_TRY_CATCH_PATTERNS,
  LANG_EMPTY_CATCH_PATTERNS,
  LANG_ASYNC_PATTERNS,
  LANG_STRUCTURED_LOG_PATTERNS,
  LANG_CONSOLE_ERROR_PATTERNS,
  LANG_ENV_VAR_PATTERNS,
  LANG_VALIDATION_PATTERNS,
  LANG_ROUTE_PATTERNS,
} from '../language-rules.js';
import { classifyFiles, filterByClass } from '../file-classifier.js';
import { confirmWithAST, type ASTRule } from '../ast-confirm.js';
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
} from '../scan-scorers.js';
import { logger } from '../../lib/logger.js';
import { detectProjectLanguage } from '../detect-language.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function astConfirmedCount(files: string[], contents: Map<string, string>, rule: ASTRule): number {
  let total = 0;
  for (const file of files) {
    const content = contents.get(file) ?? '';
    const astCount = confirmWithAST(content, rule);
    if (astCount >= 0) total += astCount;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

// Testing (25 points)
// ├─ Coverage ratio ......... /8
// ├─ Edge case depth ........ /9
// └─ Test quality ........... /8
function scoreTests(
  files: string[],
  contents: Map<string, string>,
  cwd: string,
  lang: SupportedLanguage,
): CategoryResult {
  const isAnyTestFile = (f: string) => isTestFile(f) || isLangTestFile(f, lang);
  const testFiles = files.filter(isAnyTestFile);
  const sourceFiles = files.filter(f => !isAnyTestFile(f));

  // For Rust: embedded tests (#[cfg(test)]) make source files dual-purpose —
  // supplement testFiles with source files that contain a test module.
  const rustTestPattern = /#\[cfg\s*\(\s*test\s*\)\]/g;
  const rustTestFiles = [...testFiles, ...sourceFiles.filter(f => anyFileHasMatch([f], contents, rustTestPattern))];
  const effectiveTestFiles = lang === 'rust'
    ? [...new Set(rustTestFiles)]
    : testFiles;

  // Check for test script (package.json for JS/TS; Makefile/cargo test for others)
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
  if (!hasTestScript && lang !== 'ts' && lang !== 'js') {
    hasTestScript = existsSync(join(cwd, 'Makefile')) ||
      existsSync(join(cwd, 'Cargo.toml')) ||
      existsSync(join(cwd, 'pytest.ini')) ||
      existsSync(join(cwd, 'setup.cfg'));
  }

  // UI component weighting: files in components/, pages/, app/ that export React components
  // are harder to unit-test by convention, so they count 0.5x in the coverage denominator.
  // This prevents penalizing repos that have UI-heavy architectures (e.g. Next.js).
  const UI_PATH_PATTERN = /(?:^|\/)(?:components|pages|app)\//;
  const REACT_COMPONENT_PATTERN = /export\s+default\s+function\s+\w+|export\s+const\s+\w+\s*(?:=\s*React\.FC|:\s*React\.FC)/;
  let weightedSourceCount = 0;
  for (const f of sourceFiles) {
    const norm = f.replace(/\\/g, '/');
    const isUiComponent = UI_PATH_PATTERN.test(norm) &&
      REACT_COMPONENT_PATTERN.test(contents.get(f) ?? '');
    weightedSourceCount += isUiComponent ? 0.5 : 1;
  }
  const effectiveSourceCount = Math.round(weightedSourceCount);

  const { score: coverageScore, summary: coverageSummary, issues: coverageIssues } =
    scoreCoverageRatio(effectiveTestFiles.length, effectiveSourceCount, hasTestScript);

  const edgeCasePattern = LANG_EDGE_CASE_PATTERNS[lang];
  const edgeCaseCount = countMatches(effectiveTestFiles, contents, edgeCasePattern, false);
  const { score: edgeCaseScore, summary: edgeCaseSummary } = scoreEdgeCases(edgeCaseCount);

  let totalTestCases: number;
  let assertCount: number;
  let hasDescribe: boolean;

  if (lang === 'ts' || lang === 'js') {
    const totalTestCasesRegex = countMatches(effectiveTestFiles, contents, LANG_TEST_CASE_PATTERNS[lang]);
    const astTestCount = astConfirmedCount(effectiveTestFiles, contents, 'test-assertion');
    totalTestCases = astTestCount >= 0 ? astTestCount : totalTestCasesRegex;
    assertCount = countMatches(effectiveTestFiles, contents, LANG_ASSERTION_PATTERNS[lang]);
    const describeCount = countMatches(effectiveTestFiles, contents, /\bdescribe\s*[.(]/g);
    hasDescribe = describeCount > 0;
  } else {
    totalTestCases = countMatches(effectiveTestFiles, contents, LANG_TEST_CASE_PATTERNS[lang]);
    assertCount = countMatches(effectiveTestFiles, contents, LANG_ASSERTION_PATTERNS[lang]);
    const describePattern = LANG_DESCRIBE_PATTERNS[lang];
    hasDescribe = describePattern !== null
      ? countMatches(effectiveTestFiles, contents, describePattern) > 0
      : false;
  }

  const { score: testQualityScore, summary: testQualitySummary } =
    scoreTestQuality(totalTestCases, assertCount, hasDescribe);

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
function scoreSecurity(files: string[], contents: Map<string, string>, lang: SupportedLanguage): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f) && !isLangTestFile(f, lang));

  let secretCount = 0;
  for (const pattern of SECRET_PATTERNS) {
    secretCount += countMatches(srcFiles, contents, pattern, false);
  }
  if (lang === 'ts' || lang === 'js') {
    const astSecretCount = astConfirmedCount(srcFiles, contents, 'hardcoded-secret');
    if (astSecretCount >= 0) secretCount = astSecretCount;
  }
  const usesEnvVars = anyFileHasMatch(srcFiles, contents, LANG_ENV_VAR_PATTERNS[lang]);
  const { score: secretsScore, summary: secretsSummary } = scoreSecrets(secretCount, usesEnvVars);

  const validationPattern = LANG_VALIDATION_PATTERNS[lang];
  const routePattern = LANG_ROUTE_PATTERNS[lang];
  let validationFileCount = 0;
  let routeFileCount = 0;

  // Custom validator detection: files in paths like lib/validate.ts, utils/validator.ts
  // that export validation functions are considered validation files.
  const customValidatorFiles = new Set<string>(
    (lang === 'ts' || lang === 'js')
      ? srcFiles.filter(f => /(?:lib|utils|helpers)\/(?:validate|validator|validation)[^/]*\.[jt]sx?$/.test(f.replace(/\\/g, '/')))
      : [],
  );

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    const normalizedPath = file.replace(/\\/g, '/');
    const hasValidation = validationPattern.test(content);
    const hasExtraValidation = (lang === 'ts' || lang === 'js') && (
      /\buuid\b.*\bvalidate\b|\bvalidate.*uuid\b|isUUID|uuidv[1-5]/i.test(content) ||
      /(?:req\.params|req\.body|req\.query).*(?:typeof|instanceof|\.match|\.test|\.validate|schema\.parse)/i
        .test(content)
    );
    // Custom validator: function imported from a validate/ path, or file returns 400 on error
    const hasCustomValidator = (lang === 'ts' || lang === 'js') && (
      /from\s+['"][^'"]*(?:validate|validator|validation)[^'"]*['"]/i.test(content) ||
      /(?:status|statusCode)\s*(?::|=|[(])\s*400\b/.test(content) ||
      /\.status\s*\(\s*400\s*\)/.test(content) ||
      /NextResponse\.json\s*\([^)]*[,\s](?:\{[^}]*status\s*:\s*400|\s*400\s*)\)/.test(content)
    );
    const isRouteFile = routePattern.test(content);
    if (isRouteFile) routeFileCount++;
    // Custom validator files count regardless of having a route pattern
    if (customValidatorFiles.has(normalizedPath)) validationFileCount++;
    else if (hasValidation || hasExtraValidation || hasCustomValidator) validationFileCount++;
  }
  const { score: inputValScore, summary: inputValSummary, issues: inputValIssues } =
    scoreInputValidation(validationFileCount, routeFileCount);

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
function scoreTypes(
  files: string[],
  cwd: string,
  contents: Map<string, string>,
  lang: SupportedLanguage,
): CategoryResult {
  if (lang === 'rust') {
    return {
      name: 'Type Safety',
      emoji: '📝',
      score: 15,
      max: 15,
      summary: 'Rust type system — compile-time safety guaranteed',
      subcategories: [
        { name: 'Strict config', score: 7, max: 7, summary: 'Rust compiler enforces strict types', issuesFound: 0 },
        { name: 'Any type count', score: 8, max: 8, summary: 'no any types', issuesFound: 0 },
      ],
    };
  }

  if (lang === 'go') {
    const goSrcFiles = files.filter(f => f.endsWith('.go') && !isTestFile(f) && !isLangTestFile(f, lang));
    const { count: interfaceAnyCount } = countMatchesWithFiles(
      goSrcFiles, contents, /\binterface\s*\{\s*\}|\bany\b/g,
    );
    const { locations: anyTypeFiles } = countMatchesWithLocations(
      goSrcFiles, contents, /\binterface\s*\{\s*\}|\bany\b/g,
    );
    let totalLines = 0;
    for (const file of goSrcFiles) totalLines += (contents.get(file) ?? '').split('\n').length;
    const { score: anyScore, summary: anySummary } = scoreAnyTypeDensity(interfaceAnyCount, totalLines);
    return {
      name: 'Type Safety',
      emoji: '📝',
      score: Math.min(7 + anyScore, 15),
      max: 15,
      summary: ['Go type system', anySummary].filter(Boolean).join(', '),
      subcategories: [
        { name: 'Strict config', score: 7, max: 7, summary: 'Go compiler enforces types', issuesFound: 0 },
        {
          name: 'Any type count', score: anyScore, max: 8, summary: anySummary,
          issuesFound: interfaceAnyCount,
          issuesDescription: 'interface{} or any usage',
          locations: anyTypeFiles,
        },
      ],
    };
  }

  if (lang === 'python') {
    const { score: strictScore, summary: strictSummary } = scorePythonTypeConfig(cwd);
    const pySrcFiles = files.filter(f => f.endsWith('.py') && !isTestFile(f) && !isLangTestFile(f, lang));
    const { count: anyCount } = countMatchesWithFiles(pySrcFiles, contents, /\bAny\b/g);
    const { locations: anyTypeFiles } = countMatchesWithLocations(pySrcFiles, contents, /\bAny\b/g);
    let totalLines = 0;
    for (const file of pySrcFiles) totalLines += (contents.get(file) ?? '').split('\n').length;
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
          issuesFound: strictScore < 7 ? 1 : 0, issuesDescription: 'missing Python type checker configuration',
        },
        {
          name: 'Any type count', score: anyScore, max: 8, summary: anySummary,
          issuesFound: anyCount, issuesDescription: 'Any type usage', locations: anyTypeFiles,
        },
      ],
    };
  }

  const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
  if (lang === 'js' || tsFiles.length === 0) {
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

  const { score: strictScore, summary: strictSummary } = scoreStrictConfig(cwd);
  const srcTsFiles = tsFiles.filter(f => !isTestFile(f) && !f.endsWith('.d.ts'));
  const { count: anyCountRegex } = countMatchesWithFiles(
    srcTsFiles, contents, /:\s*any\b|<any>|\bas\s+any\b/g,
  );
  const { locations: anyTypeFiles } = countMatchesWithLocations(
    srcTsFiles, contents, /:\s*any\b|<any>|\bas\s+any\b/g,
  );
  const astAnyCount = astConfirmedCount(srcTsFiles, contents, 'type-any');
  const anyCount = astAnyCount >= 0 ? astAnyCount : anyCountRegex;
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
function scoreErrorHandling(
  files: string[],
  prodFiles: string[],
  contents: Map<string, string>,
  lang: SupportedLanguage,
): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f) && !isLangTestFile(f, lang));
  const prodAppFilesForLogging = prodFiles.filter(f => {
    const norm = f.replace(/\\/g, '/');
    return !norm.includes('/scripts/') && !norm.includes('/training-data/');
  });

  if (lang === 'python') {
    const tryCatchTotal = countMatches(srcFiles, contents, LANG_TRY_CATCH_PATTERNS.python);
    const { count: emptyCatchTotal, matchedFiles: emptyCatchFiles } = countMatchesWithFiles(
      prodFiles, contents, LANG_EMPTY_CATCH_PATTERNS.python,
    );

    let asyncTotal = 0;
    const asyncNoHandlerFiles: string[] = [];
    for (const file of srcFiles) {
      const content = contents.get(file) ?? '';
      const fileAsync = (content.match(LANG_ASYNC_PATTERNS.python) ?? []).length;
      asyncTotal += fileAsync;
      if (fileAsync > 0 && (content.match(/\btry\s*:/g) ?? []).length === 0) asyncNoHandlerFiles.push(file);
    }

    const structuredLogCount = countMatches(prodAppFilesForLogging, contents, LANG_STRUCTURED_LOG_PATTERNS.python);
    const hasLoggingImport = anyFileHasMatch(prodAppFilesForLogging, contents, LANG_LOGGING_GUARD_PATTERNS.python!);
    const consoleLikeCount = hasLoggingImport
      ? 0
      : countMatches(prodAppFilesForLogging, contents, LANG_CONSOLE_ERROR_PATTERNS.python);
    const effectiveStructuredLog = hasLoggingImport ? Math.max(structuredLogCount, 1) : structuredLogCount;

    const { score: coverageScore, summary: coverageSummary } = scoreEhCoverage(tryCatchTotal, asyncTotal);
    const { score: emptyCatchScore, summary: emptyCatchSummary } = scoreEmptyCatches(emptyCatchTotal);
    const { score: loggingScore, summary: loggingSummary } = scoreStructuredLogging(
      effectiveStructuredLog, consoleLikeCount,
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
          issuesFound: emptyCatchTotal, issuesDescription: 'bare except clauses', locations: emptyCatchFiles,
        },
        {
          name: 'Structured logging', score: loggingScore, max: 7, summary: loggingSummary,
          issuesFound: effectiveStructuredLog === 0 ? 1 : 0, issuesDescription: 'no structured logger',
        },
      ],
    };
  }

  if (lang === 'go') {
    const errNilTotal = countMatches(srcFiles, contents, LANG_TRY_CATCH_PATTERNS.go);
    const { count: ignoredErrTotal, matchedFiles: ignoredErrFiles } = countMatchesWithFiles(
      prodFiles, contents, LANG_EMPTY_CATCH_PATTERNS.go,
    );
    const funcTotal = countMatches(srcFiles, contents, /\bfunc\s+[A-Z]\w+\s*\(/g);

    const structuredLogCount = countMatches(prodAppFilesForLogging, contents, LANG_STRUCTURED_LOG_PATTERNS.go);
    const hasLoggerImport = anyFileHasMatch(prodAppFilesForLogging, contents, LANG_LOGGING_GUARD_PATTERNS.go!);
    const consoleLikeCount = hasLoggerImport
      ? 0
      : countMatches(prodAppFilesForLogging, contents, LANG_CONSOLE_ERROR_PATTERNS.go);
    const effectiveStructuredLog = hasLoggerImport ? Math.max(structuredLogCount, 1) : structuredLogCount;

    const { score: coverageScore, summary: coverageSummary } = scoreEhCoverage(errNilTotal, funcTotal);
    const { score: emptyCatchScore, summary: emptyCatchSummary } = scoreEmptyCatches(ignoredErrTotal);
    const { score: loggingScore, summary: loggingSummary } = scoreStructuredLogging(
      effectiveStructuredLog, consoleLikeCount,
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
          issuesFound: Math.max(0, funcTotal - errNilTotal),
          issuesDescription: 'exported functions without if err != nil checks',
        },
        {
          name: 'Empty catches', score: emptyCatchScore, max: 5, summary: emptyCatchSummary,
          issuesFound: ignoredErrTotal, issuesDescription: 'ignored errors (_ = func())',
          locations: ignoredErrFiles,
        },
        {
          name: 'Structured logging', score: loggingScore, max: 7, summary: loggingSummary,
          issuesFound: effectiveStructuredLog === 0 ? 1 : 0, issuesDescription: 'no structured logger',
        },
      ],
    };
  }

  if (lang === 'rust') {
    const resultUsage = countMatches(srcFiles, contents, LANG_TRY_CATCH_PATTERNS.rust);
    const questionOpUsage = countMatches(srcFiles, contents, /\?\s*[;,)\]]/g);
    const { count: unwrapCount, matchedFiles: unwrapFiles } = countMatchesWithFiles(
      prodFiles, contents, LANG_EMPTY_CATCH_PATTERNS.rust,
    );

    const hasResultUsage = resultUsage > 0 || questionOpUsage > 0;
    const rawCoverageScore = hasResultUsage
      ? Math.max(5, 8 - Math.floor(unwrapCount / 5))
      : 2;
    const coverageSummary = hasResultUsage
      ? `Result<> type + ? operator (${resultUsage + questionOpUsage} uses)`
      : 'limited Result<> usage detected';

    const structuredLogCount = countMatches(prodAppFilesForLogging, contents, LANG_STRUCTURED_LOG_PATTERNS.rust);
    const hasTracingImport = anyFileHasMatch(prodAppFilesForLogging, contents, LANG_LOGGING_GUARD_PATTERNS.rust!);
    const consoleLikeCount = hasTracingImport
      ? 0
      : countMatches(prodAppFilesForLogging, contents, LANG_CONSOLE_ERROR_PATTERNS.rust);
    const effectiveStructuredLog = hasTracingImport ? Math.max(structuredLogCount, 1) : structuredLogCount;

    const { score: emptyCatchScore, summary: emptyCatchSummary } = scoreEmptyCatches(Math.floor(unwrapCount / 3));
    const { score: loggingScore, summary: loggingSummary } = scoreStructuredLogging(
      effectiveStructuredLog, consoleLikeCount,
    );
    return {
      name: 'Error Handling',
      emoji: '⚠️ ',
      score: Math.min(rawCoverageScore + emptyCatchScore + loggingScore, 20),
      max: 20,
      summary: [coverageSummary, emptyCatchSummary].filter(Boolean).join(', '),
      subcategories: [
        {
          name: 'Coverage', score: Math.min(rawCoverageScore, 8), max: 8, summary: coverageSummary,
          issuesFound: unwrapCount, issuesDescription: 'unwrap()/expect() calls that can panic',
        },
        {
          name: 'Empty catches', score: emptyCatchScore, max: 5, summary: emptyCatchSummary,
          issuesFound: unwrapCount, issuesDescription: 'unwrap()/expect() (panic on error)',
          locations: unwrapFiles,
        },
        {
          name: 'Structured logging', score: loggingScore, max: 7, summary: loggingSummary,
          issuesFound: effectiveStructuredLog === 0 ? 1 : 0, issuesDescription: 'no structured logger',
        },
      ],
    };
  }

  // TypeScript / JavaScript
  const tryCatchTotal = countMatches(srcFiles, contents, /\btry\s*\{/g);
  // Use countMatchesWithLocations to get file:line for each empty catch (fix 5)
  const { count: emptyCatchRegex, locations: emptyCatchLocations } =
    countMatchesWithLocations(prodFiles, contents, /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g);
  // Extract unique file list from locations (format: "file:line") for AST confirmation
  const emptyCatchFiles = [...new Set(emptyCatchLocations.map(loc => {
    const lastColon = loc.lastIndexOf(':');
    return lastColon > 0 ? loc.slice(0, lastColon) : loc;
  }))];
  const emptyCatchAst = astConfirmedCount(emptyCatchFiles, contents, 'empty-catch');
  const emptyCatchTotal = emptyCatchAst >= 0 ? emptyCatchAst : emptyCatchRegex;
  const { matchedFiles: consoleErrorFiles, count: consoleErrorRegex } = countMatchesWithFiles(
    prodAppFilesForLogging, contents, /\bconsole\.(?:error|warn|log)\s*\(/g,
  );
  const consoleErrorAst = astConfirmedCount(consoleErrorFiles, contents, 'console-usage');
  const consoleErrorCount = consoleErrorAst >= 0 ? consoleErrorAst : consoleErrorRegex;

  // Detect custom loggers: files at lib/logger.ts, utils/logger.ts, lib/log.ts, etc.
  // that export an object with .error/.warn/.info methods count as structured logging.
  // The presence of the logger FILE itself counts as 1 usage (it was intentionally created).
  const customLoggerFile = prodAppFilesForLogging.find(f => {
    const norm = f.replace(/\\/g, '/');
    return /(?:lib|utils|helpers)\/(?:logger|log)\.[jt]sx?$/.test(norm);
  });
  const hasCustomLoggerFile = customLoggerFile !== undefined;
  // Validate: the logger file must actually export error/warn/info to count
  const customLoggerFileExportsLogger = hasCustomLoggerFile && (() => {
    const content = contents.get(customLoggerFile!) ?? '';
    return /export\s+(?:const|function|default)\s+\w*[Ll]og(?:ger)?|\bexport\s+\{.*\blog(?:ger)?\b/.test(content) &&
      /\b(?:error|warn|info|debug)\s*(?::|=|\()/.test(content);
  })();
  // Count calls like logger.error/warn/info in files that import custom logger
  const customLoggerCallCount = hasCustomLoggerFile
    ? countMatches(prodAppFilesForLogging, contents, /\blogger\s*\.\s*(?:error|warn|info|debug)\s*\(/g)
    : 0;
  // Count import statements referencing the custom logger file
  const customLoggerImportCount = hasCustomLoggerFile
    ? countMatches(
        prodAppFilesForLogging, contents,
        /from\s+['"][^'"]*(?:lib|utils|helpers)\/(?:logger|log)['"]/g,
      )
    : 0;
  // The logger file itself counts as 1 even if not imported elsewhere — it shows intentionality
  const customLoggerBonus = customLoggerFileExportsLogger ? 1 : 0;

  const structuredLogCount = countMatches(
    prodAppFilesForLogging, contents, /\b(?:logger|winston|pino|bunyan|log4js)\./g,
  ) + customLoggerCallCount + customLoggerImportCount + customLoggerBonus;

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
        issuesFound: emptyCatchTotal, issuesDescription: 'empty catch blocks',
        // Use file:line locations so the report pinpoints exactly where each empty catch is
        locations: emptyCatchLocations.length > 0 ? emptyCatchLocations : emptyCatchFiles,
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
function scorePerformance(
  files: string[],
  prodFiles: string[],
  contents: Map<string, string>,
  lang: SupportedLanguage,
): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f) && !isLangTestFile(f, lang));
  const appFiles = srcFiles.filter(f => !f.replace(/\\/g, '/').includes('/scripts/'));
  const prodAppFiles = prodFiles.filter(f => !f.replace(/\\/g, '/').includes('/scripts/'));

  let consoleLogCount: number;
  let consoleLogLocations: string[];

  if (lang === 'ts' || lang === 'js') {
    const { count: consoleLogRegex, matchedFiles: consoleLogMatchedFiles } = countMatchesWithFiles(
      prodAppFiles, contents, /\bconsole\.log\s*\(/g,
    );
    const { locations } = countMatchesWithLocations(prodAppFiles, contents, /\bconsole\.log\s*\(/g);
    const consoleLogAst = astConfirmedCount(consoleLogMatchedFiles, contents, 'console-usage');
    consoleLogCount = consoleLogAst >= 0 ? consoleLogAst : consoleLogRegex;
    consoleLogLocations = locations;
  } else {
    const guardPattern = LANG_LOGGING_GUARD_PATTERNS[lang];
    const hasProperLogging = guardPattern !== null
      ? anyFileHasMatch(prodAppFiles, contents, guardPattern)
      : false;
    if (hasProperLogging) {
      consoleLogCount = 0;
      consoleLogLocations = [];
    } else {
      const { count, locations } = countMatchesWithLocations(
        prodAppFiles, contents, LANG_DEBUG_OUTPUT_PATTERNS[lang],
      );
      consoleLogCount = count;
      consoleLogLocations = locations;
    }
  }

  let awaitInLoopCount = 0;
  if (lang === 'ts' || lang === 'js') {
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
  }

  let importIssues = 0;
  if (lang === 'ts' || lang === 'js') {
    for (const file of appFiles) {
      const content = contents.get(file) ?? '';
      const basename = file.replace(/\\/g, '/').split('/').pop()?.replace(/\.tsx?$/, '') ?? '';
      if (basename && new RegExp(`from ['"].*/${basename}['"]`).test(content)) importIssues++;
      if ((content.match(/export \* from/g) ?? []).length > 5) importIssues++;
    }
  }

  const { score: asyncScore, summary: asyncSummary } = scoreAwaitInLoop(awaitInLoopCount);
  const { score: consoleScore, summary: consoleSummary } = scoreConsoleLog(consoleLogCount);
  const { score: importScore, summary: importHygieneSummary } = scoreImportHygiene(importIssues);

  const debugOutputLabel = lang === 'python' ? 'print() calls'
    : lang === 'go' ? 'fmt.Print* calls'
    : lang === 'rust' ? 'println!/print! macros'
    : 'console.log call';

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
        issuesFound: consoleLogCount, issuesDescription: debugOutputLabel, locations: consoleLogLocations,
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

    for (let li = 0; li < lines.length; li++) {
      if ((lines[li] ?? '').length > 120) {
        longLineCount++;
        longLineFiles.push(`${file}:${li + 1}`);
      }
    }

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

  const astTodoCount = astConfirmedCount(srcFiles, contents, 'todo-fixme');
  if (astTodoCount >= 0) todoCount = astTodoCount;

  const astComplexCount = astConfirmedCount(srcFiles, contents, 'complex-function');
  if (astComplexCount > longFnCount) longFnCount = astComplexCount;

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
        issuesFound: longFnCount, issuesDescription: 'functions >50 lines or high complexity', locations: longFuncFiles,
      },
      {
        name: 'Line length', score: Math.min(lineLenScore, 4), max: 4, summary: lineLenSummary,
        issuesFound: longLineCount, issuesDescription: 'line >120 chars', locations: longLineFiles,
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

// ---------------------------------------------------------------------------
// ClassicEngine
// ---------------------------------------------------------------------------

export class ClassicEngine implements ScanEngine {
  readonly name = 'ClassicEngine';
  readonly mode = 'classic' as const;

  async analyze(cwd: string, options: ScanEngineOptions = {}): Promise<ScanResult> {
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

    const includeNonProduction = options.includeNonProduction ?? false;
    const allFiles = options.files ?? findSourceFiles(cwd, {
      scanProductionOnly: false,
      includeNonProduction,
    });
    const scoringFiles = options.includeTests
      ? allFiles
      : allFiles.filter(f => !isTestFile(f));
    const contents = readContents(allFiles);
    const fileClassifications = classifyFiles(scoringFiles);
    const prodFiles = filterByClass(scoringFiles, fileClassifications, 'production');

    const lang: SupportedLanguage = options.lang ?? detectProjectLanguage(cwd);

    const categories: CategoryResult[] = [
      scoreTests(allFiles, contents, cwd, lang),
      scoreSecurity(scoringFiles, contents, lang),
      scoreTypes(scoringFiles, cwd, contents, lang),
      scoreErrorHandling(scoringFiles, prodFiles, contents, lang),
      scorePerformance(scoringFiles, prodFiles, contents, lang),
      scoreCodeQuality(scoringFiles, contents),
    ];

    const total = categories.reduce((sum, c) => sum + c.score, 0);
    const maxTotal = categories.reduce((sum, c) => sum + c.max, 0);
    const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(categories);

    return { projectName, total, maxTotal, categories, totalIssuesFound, issuesByType };
  }

  /**
   * Run the classic analysis pipeline and ALSO produce a flat Finding[] alongside
   * the ScanResult. The existing analyze() return value is unchanged.
   *
   * Each Finding:
   *   - source: 'classic'
   *   - confidence: 1.0 (deterministic heuristics)
   *   - ruleId: looked up from RULE_REGISTRY via category + subcategory
   *   - file / line: first location from the subcategory's locations array (if any)
   */
  async analyzeWithFindings(
    cwd: string,
    options: ScanEngineOptions = {},
  ): Promise<{ result: ScanResult; findings: Finding[] }> {
    const result = await this.analyze(cwd, options);
    const findings: Finding[] = [];

    for (const cat of result.categories) {
      for (const sub of cat.subcategories) {
        if (sub.issuesFound === 0) continue;

        const rule = getRuleBySubcategory(cat.name, sub.name);
        const severityMap = SEVERITY_MAP[cat.name]?.[sub.name] ?? 'low';
        // Map 3-level severity to Finding severity.
        const severity: Finding['severity'] =
          severityMap === 'high' ? 'high' : severityMap === 'medium' ? 'medium' : 'low';

        const locations = sub.locations ?? [];

        if (locations.length > 0) {
          // One finding per location.
          for (const loc of locations) {
            const { file, line } = parseLocation(loc);
            findings.push({
              category: cat.name,
              subcategory: sub.name,
              severity,
              file,
              line,
              message: sub.issuesDescription ?? sub.summary,
              confidence: 1.0,
              source: 'classic',
              ruleId: rule?.id,
            });
          }
        } else {
          // One aggregate finding (no specific file/line).
          findings.push({
            category: cat.name,
            subcategory: sub.name,
            severity,
            message: sub.issuesDescription ?? sub.summary,
            confidence: 1.0,
            source: 'classic',
            ruleId: rule?.id,
          });
        }
      }
    }

    return { result, findings };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseLocation(loc: string): { file: string; line?: number } {
  // Location can be "path/to/file" or "path/to/file:123".
  const lastColon = loc.lastIndexOf(':');
  if (lastColon > 0) {
    const potentialLine = parseInt(loc.slice(lastColon + 1), 10);
    if (!isNaN(potentialLine) && potentialLine > 0) {
      return { file: loc.slice(0, lastColon), line: potentialLine };
    }
  }
  return { file: loc };
}
