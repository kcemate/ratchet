/**
 * Pure scoring functions shared between scan.ts (full scan) and
 * scan-cache.ts (incremental rebuild from per-file metrics).
 *
 * Each function takes already-aggregated numbers and returns { score, summary }.
 * No file I/O — purely computational, easily testable.
 */

import { scoreByThresholds, SEVERITY_MAP } from './scan-constants.js';
import type { CategoryResult, IssueType } from '../commands/scan.js';

// ── Testing
export function scoreCoverageRatio(
  testCount: number,
  sourceCount: number,
  hasTestScript: boolean,
): { score: number; summary: string; issues: number } {
  if (testCount === 0) {
    return {
      score: 0,
      summary: hasTestScript ? 'test script configured, no test files' : 'no test files',
      issues: sourceCount,
    };
  }
  const ratio = sourceCount > 0 ? testCount / sourceCount : 0;
  const pct = ratio * 100;
  let score = 0;
  if (pct >= 50) score = 8;
  else if (pct >= 35) score = 7.5;
  else if (pct >= 22) score = 6;
  else if (pct >= 12) score = 4;
  else if (pct >= 5) score = 2;
  const issues = pct < 50 ? Math.floor(sourceCount * (1 - ratio)) : 0;
  return { score, summary: `${testCount} test files, ${Math.round(pct)}% ratio`, issues };
}

export function scoreEdgeCases(count: number): { score: number; summary: string } {
  return scoreByThresholds(count, [
    { min: 50,       score: 9, summary: (n) => `${n} edge/error test cases` },
    { min: 20,       score: 7, summary: (n) => `${n} edge/error test cases` },
    { min: 10,       score: 5, summary: (n) => `${n} edge/error test cases` },
    { min: 3,        score: 3, summary: (n) => `${n} edge/error test cases` },
    { min: 1,        score: 1, summary: (n) => `${n} edge/error test case${n !== 1 ? 's' : ''}` },
    { min: -Infinity, score: 0, summary: 'no edge case tests detected' },
  ]);
}

export function scoreTestQuality(
  testCaseCount: number,
  assertCount: number,
  hasDescribe: boolean,
): { score: number; summary: string } {
  const assertsPerTest = testCaseCount > 0 ? assertCount / testCaseCount : 0;
  if (testCaseCount >= 50 && assertsPerTest >= 2 && hasDescribe)
    return { score: 8, summary: `${assertsPerTest.toFixed(1)} assertions per test` };
  if (testCaseCount >= 10 && assertsPerTest >= 1.5 && hasDescribe)
    return { score: 6, summary: `${assertsPerTest.toFixed(1)} assertions per test` };
  if (testCaseCount >= 5 && assertsPerTest >= 1)
    return { score: 4, summary: `${assertsPerTest.toFixed(1)} assertions per test` };
  if (testCaseCount > 0)
    return { score: 2, summary: `${testCaseCount} test case${testCaseCount !== 1 ? 's' : ''}, low assertion density` };
  return { score: 0, summary: 'no test cases found' };
}

// ── Security
export function scoreSecrets(secretCount: number, usesEnvVars: boolean): { score: number; summary: string } {
  if (secretCount === 0 && usesEnvVars) return { score: 3, summary: 'no hardcoded secrets, uses env vars' };
  if (secretCount === 0) return { score: 2, summary: 'no hardcoded secrets' };
  return { score: 0, summary: `${secretCount} potential secret${secretCount !== 1 ? 's' : ''}` };
}

export function scoreInputValidation(
  validationFileCount: number,
  routeFileCount: number,
): { score: number; summary: string; issues: number } {
  const totalCheckable = Math.max(routeFileCount, validationFileCount, 1);
  const ratio = validationFileCount / totalCheckable;
  if (validationFileCount >= 3 && ratio >= 0.6)
    return { score: 6, summary: `validation on ${validationFileCount} files`, issues: 0 };
  if (validationFileCount >= 2) {
    const issues = routeFileCount > validationFileCount ? routeFileCount - validationFileCount : 0;
    return { score: 4, summary: `Zod/validation on ${validationFileCount} files`, issues };
  }
  if (validationFileCount === 1)
    return { score: 2, summary: 'minimal input validation detected', issues: Math.max(0, routeFileCount - 1) };
  return { score: 0, summary: 'no input validation detected', issues: routeFileCount };
}

export function scoreAuthChecks(
  hasAuth: boolean,
  hasRate: boolean,
  hasCors: boolean,
  broadMiddlewareCount = 0,
): { score: number; summary: string; issues: number } {
  const checks = [hasAuth, hasRate, hasCors].filter(Boolean).length;
  let score = 0;
  let summary = '';
  let issues = 0;

  if (checks >= 3) {
    score = 6; summary = 'auth middleware, rate limiting, CORS configured';
  } else if (checks === 2) {
    score = 4;
    const found: string[] = [];
    if (hasAuth) found.push('auth middleware');
    if (hasRate) found.push('rate limiting');
    if (hasCors) found.push('CORS');
    summary = found.join(', ');
    issues = 3 - checks;
  } else if (checks === 1) {
    score = 2;
    summary = hasAuth ? 'auth middleware only' : hasRate ? 'rate limiting only' : 'CORS only';
    issues = 3 - checks;
  } else {
    summary = 'no auth/rate-limit/CORS detected';
    issues = 3;
  }

  if (broadMiddlewareCount > 0) {
    score = Math.max(0, score - Math.min(broadMiddlewareCount, 3));
    issues += broadMiddlewareCount;
    summary += ` (${broadMiddlewareCount} overly broad rate limiter${broadMiddlewareCount > 1 ? 's' : ''}` +
      ` — use app.post/get instead of app.use on sub-paths)`;
  }

  return { score, summary, issues };
}

// ── Type Safety
export function scoreAnyTypeDensity(anyCount: number, totalLines: number): { score: number; summary: string } {
  const density = totalLines > 0 ? anyCount / (totalLines / 1000) : 0;
  if (anyCount === 0 || density < 1) {
    const summary = anyCount === 0
      ? 'zero any types'
      : `${anyCount} any type${anyCount !== 1 ? 's' : ''} (very low density)`;
    return { score: 8, summary };
  }
  if (density < 2) return { score: 7, summary: `${anyCount} any type${anyCount !== 1 ? 's' : ''} (low density)` };
  if (density < 4) return { score: 6, summary: `${anyCount} any types (low density)` };
  if (density < 7) return { score: 5, summary: `${anyCount} any types (moderate)` };
  if (density < 12) return { score: 4, summary: `${anyCount} any types (moderate-high)` };
  if (density < 20) return { score: 2, summary: `${anyCount} any types (high)` };
  return { score: 0, summary: `${anyCount} any types (very high density)` };
}

// ── Error Handling
export function scoreEhCoverage(tryCatchCount: number, asyncCount: number): { score: number; summary: string } {
  if (tryCatchCount === 0) return { score: 0, summary: 'no try/catch found' };
  if (asyncCount === 0 || tryCatchCount >= asyncCount * 0.6)
    return { score: 8, summary: `${tryCatchCount} try/catch block${tryCatchCount !== 1 ? 's' : ''}` };
  const pct = Math.round((tryCatchCount / asyncCount) * 100);
  return { score: Math.round((pct / 100) * 8), summary: `${tryCatchCount} try/catch (${pct}% async coverage)` };
}

export function scoreEmptyCatches(count: number): { score: number; summary: string } {
  return scoreByThresholds(count, [
    { min: 13,       score: 0,   summary: (n) => `${n} empty catches` },
    { min: 8,        score: 1,   summary: (n) => `${n} empty catches` },
    { min: 5,        score: 2,   summary: (n) => `${n} empty catches` },
    { min: 3,        score: 3,   summary: (n) => `${n} empty catches` },
    { min: 2,        score: 4,   summary: '2 empty catches' },
    { min: 1,        score: 4.5, summary: '1 empty catch' },
    { min: -Infinity, score: 5,  summary: 'no empty catch blocks' },
  ]);
}

export function scoreStructuredLogging(
  structuredLogCount: number,
  consoleErrorCount: number,
): { score: number; summary: string } {
  if (structuredLogCount > 0 && consoleErrorCount === 0)
    return { score: 7, summary: `structured logger only (${structuredLogCount} calls)` };
  if (structuredLogCount > 0 && consoleErrorCount <= 5)
    return { score: 5, summary: `structured logger + ${consoleErrorCount} console calls` };
  if (structuredLogCount > 0)
    return { score: 3, summary: `logger (${structuredLogCount}) + console (${consoleErrorCount})` };
  if (consoleErrorCount > 0)
    return { score: 1, summary: `${consoleErrorCount} console.error/warn calls (no structured logger)` };
  return { score: 0, summary: 'no error logging detected' };
}

// ── Performance
export function scoreAwaitInLoop(count: number): { score: number; summary: string } {
  if (count === 0) return { score: 5, summary: 'no await-in-loop' };
  if (count === 1) return { score: 4, summary: '1 await-in-loop pattern' };
  if (count <= 3) return { score: 3, summary: `${count} await-in-loop patterns` };
  if (count <= 6) return { score: 2, summary: `${count} await-in-loop patterns` };
  return { score: 1, summary: `${count} await-in-loop patterns` };
}

export function scoreConsoleLog(count: number): { score: number; summary: string } {
  if (count === 0) return { score: 5, summary: 'no console.log in src' };
  if (count <= 3) return { score: 4, summary: `${count} console.log` };
  if (count <= 10) return { score: 3, summary: `${count} console.log calls` };
  if (count <= 25) return { score: 2, summary: `${count} console.log calls` };
  if (count <= 75) return { score: 1, summary: `${count} console.log calls` };
  return { score: 0, summary: `${count} console.log calls (excessive)` };
}

export function scoreImportHygiene(issues: number): { score: number; summary: string } {
  if (issues === 0) return { score: 4, summary: 'clean imports' };
  if (issues <= 2) return { score: 2, summary: `${issues} import issue${issues !== 1 ? 's' : ''} detected` };
  return { score: 0, summary: `${issues} import issues detected` };
}

// ── Code Quality
export function scoreFunctionLength(avgLen: number, fnCount: number): { score: number; summary: string } {
  if (fnCount === 0 || avgLen <= 20)
    return { score: 6, summary: fnCount === 0 ? 'no functions detected' : 'short functions' };
  if (avgLen <= 30) return { score: 6, summary: `avg ${Math.round(avgLen)}-line functions` };
  if (avgLen <= 40) return { score: 5, summary: `avg ${Math.round(avgLen)}-line functions` };
  if (avgLen <= 50) return { score: 4, summary: `avg ${Math.round(avgLen)}-line functions` };
  if (avgLen <= 65) return { score: 3, summary: `avg ${Math.round(avgLen)}-line functions` };
  if (avgLen <= 80) return { score: 2, summary: `avg ${Math.round(avgLen)}-line functions` };
  return { score: 1, summary: `long avg (${Math.round(avgLen)} lines)` };
}

export function scoreLineLength(longLineCount: number): { score: number; summary: string } {
  if (longLineCount === 0) return { score: 6, summary: 'no long lines' };
  if (longLineCount <= 5) return { score: 5, summary: `${longLineCount} long line${longLineCount !== 1 ? 's' : ''}` };
  if (longLineCount <= 15) return { score: 4, summary: `${longLineCount} long lines` };
  if (longLineCount <= 50) return { score: 3, summary: `${longLineCount} long lines` };
  if (longLineCount <= 150) return { score: 2, summary: `${longLineCount} long lines` };
  if (longLineCount <= 500) return { score: 1, summary: `${longLineCount} long lines` };
  return { score: 0, summary: `${longLineCount} long lines (excessive)` };
}

export function scoreDeadCode(commentedCount: number, todoCount: number): { score: number; summary: string } {
  const total = commentedCount + todoCount;
  if (total === 0) return { score: 6, summary: 'no dead code detected' };
  if (commentedCount === 0 && todoCount <= 3)
    return { score: 5, summary: `${todoCount} TODO${todoCount !== 1 ? 's' : ''}` };
  if (commentedCount <= 3 && todoCount <= 5)
    return { score: 4, summary: `${commentedCount} commented-out, ${todoCount} TODOs` };
  if (commentedCount <= 10) return { score: 2, summary: `${commentedCount} commented-out lines, ${todoCount} TODOs` };
  return { score: 0, summary: `${commentedCount} commented-out lines, ${todoCount} TODOs` };
}

// ── Issue aggregation
export function aggregateAndSortIssues(
  categories: CategoryResult[],
): { totalIssuesFound: number; issuesByType: IssueType[] } {
  const issuesByType: IssueType[] = [];
  let totalIssuesFound = 0;

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

  const severityOrder = { high: 0, medium: 1, low: 2 };
  issuesByType.sort((a, b) => {
    const d = severityOrder[a.severity] - severityOrder[b.severity];
    return d !== 0 ? d : b.count - a.count;
  });

  return { totalIssuesFound, issuesByType };
}
