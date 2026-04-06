import { describe, it, expect } from 'vitest';
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
import type { CategoryResult, IssueType } from '../core/scanner';

describe('scoreCoverageRatio', () => {
  it('returns 0 when no test files and no test script', () => {
    const r = scoreCoverageRatio(0, 10, false);
    expect(r.score).toBe(0);
    expect(r.issues).toBe(10);
  });

  it('returns 0 when no test files but has test script', () => {
    const r = scoreCoverageRatio(0, 10, true);
    expect(r.score).toBe(0);
    expect(r.issues).toBe(10);
    expect(r.summary).toContain('no test files');
  });

  it('awards score 8 when ratio >= 50%', () => {
    const r = scoreCoverageRatio(50, 100, true);
    expect(r.score).toBe(8);
  });

  it('awards score 7.5 when ratio >= 35%', () => {
    const r = scoreCoverageRatio(35, 100, true);
    expect(r.score).toBe(7.5);
  });

  it('awards score 6 when ratio >= 22%', () => {
    const r = scoreCoverageRatio(22, 100, true);
    expect(r.score).toBe(6);
  });

  it('awards score 4 when ratio >= 12%', () => {
    const r = scoreCoverageRatio(12, 100, true);
    expect(r.score).toBe(4);
  });

  it('awards score 2 when ratio >= 5%', () => {
    const r = scoreCoverageRatio(5, 100, true);
    expect(r.score).toBe(2);
  });

  it('awards score 0 when ratio < 5%', () => {
    const r = scoreCoverageRatio(4, 100, true);
    expect(r.score).toBe(0);
  });

  it('handles zero source count gracefully', () => {
    const r = scoreCoverageRatio(0, 0, false);
    expect(r.score).toBe(0);
  });

  it('reports issues only when ratio < 50%', () => {
    const r = scoreCoverageRatio(60, 100, true);
    expect(r.issues).toBe(0); // ratio >= 50% → no issues counted
  });
});

describe('scoreEdgeCases', () => {
  it('score 9 for >= 50 edge cases', () => {
    const r = scoreEdgeCases(50);
    expect(r.score).toBe(9);
  });

  it('score 7 for >= 20 edge cases', () => {
    expect(scoreEdgeCases(20).score).toBe(7);
    expect(scoreEdgeCases(49).score).toBe(7);
  });

  it('score 5 for >= 10 edge cases', () => {
    expect(scoreEdgeCases(10).score).toBe(5);
    expect(scoreEdgeCases(19).score).toBe(5);
  });

  it('score 3 for >= 3 edge cases', () => {
    expect(scoreEdgeCases(3).score).toBe(3);
    expect(scoreEdgeCases(9).score).toBe(3);
  });

  it('score 1 for exactly 1 or 2 edge cases', () => {
    expect(scoreEdgeCases(1).score).toBe(1);
    expect(scoreEdgeCases(2).score).toBe(1);
  });

  it('score 0 for 0 edge cases', () => {
    const r = scoreEdgeCases(0);
    expect(r.score).toBe(0);
    expect(r.summary).toContain('no edge case');
  });
});

describe('scoreTestQuality', () => {
  it('score 8 for >= 50 tests with >= 2 asserts each and describe', () => {
    const r = scoreTestQuality(50, 100, true);
    expect(r.score).toBe(8);
  });

  it('score 6 for >= 10 tests with >= 1.5 asserts and describe', () => {
    expect(scoreTestQuality(10, 15, true).score).toBe(6);
    expect(scoreTestQuality(10, 15, false).score).toBe(4); // no describe → score 4
  });

  it('score 4 for >= 5 tests with >= 1 assert', () => {
    expect(scoreTestQuality(5, 5, false).score).toBe(4);
  });

  it('score 2 for tests with low assertion density', () => {
    expect(scoreTestQuality(5, 1, false).score).toBe(2);
  });

  it('score 0 when no test cases', () => {
    const r = scoreTestQuality(0, 0, false);
    expect(r.score).toBe(0);
    expect(r.summary).toContain('no test cases');
  });
});

describe('scoreSecrets', () => {
  it('score 3 for no secrets with env vars', () => {
    const r = scoreSecrets(0, true);
    expect(r.score).toBe(3);
  });

  it('score 2 for no secrets and no env vars', () => {
    const r = scoreSecrets(0, false);
    expect(r.score).toBe(2);
  });

  it('score 0 when secrets found', () => {
    expect(scoreSecrets(1, false).score).toBe(0);
    expect(scoreSecrets(5, true).score).toBe(0);
  });
});

describe('scoreInputValidation', () => {
  it('score 6 when >= 3 validation files and ratio >= 0.6', () => {
    const r = scoreInputValidation(3, 5);
    expect(r.score).toBe(6);
    expect(r.issues).toBe(0);
  });

  it('score 4 when >= 2 validation files', () => {
    const r = scoreInputValidation(2, 10);
    expect(r.score).toBe(4);
    expect(r.issues).toBeGreaterThan(0);
  });

  it('score 2 when exactly 1 validation file', () => {
    const r = scoreInputValidation(1, 5);
    expect(r.score).toBe(2);
  });

  it('score 0 when no validation files', () => {
    const r = scoreInputValidation(0, 5);
    expect(r.score).toBe(0);
    expect(r.issues).toBe(5);
  });
});

describe('scoreAuthChecks', () => {
  it('score 6 when all three checks present', () => {
    const r = scoreAuthChecks(true, true, true);
    expect(r.score).toBe(6);
    expect(r.issues).toBe(0);
  });

  it('score 4 when exactly 2 checks present', () => {
    const r = scoreAuthChecks(true, true, false);
    expect(r.score).toBe(4);
    expect(r.issues).toBe(1);
  });

  it('score 2 when exactly 1 check present', () => {
    expect(scoreAuthChecks(true, false, false).score).toBe(2);
    expect(scoreAuthChecks(false, true, false).score).toBe(2);
    expect(scoreAuthChecks(false, false, true).score).toBe(2);
  });

  it('score 0 when no checks present', () => {
    const r = scoreAuthChecks(false, false, false);
    expect(r.score).toBe(0);
    expect(r.issues).toBe(3);
  });

  it('deducts score for overly broad middleware', () => {
    const r = scoreAuthChecks(true, true, true, 2);
    expect(r.score).toBe(4); // 6 - 2
    expect(r.issues).toBe(2);
    expect(r.summary).toContain('overly broad');
  });
});

describe('scoreAnyTypeDensity', () => {
  it('score 8 when zero any types', () => {
    const r = scoreAnyTypeDensity(0, 1000);
    expect(r.score).toBe(8);
    expect(r.summary).toContain('zero');
  });

  it('score 7 for low density (< 2 per 1000 lines)', () => {
    const r = scoreAnyTypeDensity(1, 1000);
    expect(r.score).toBe(7);
  });

  it('score 6 for density < 4', () => {
    expect(scoreAnyTypeDensity(3, 1000).score).toBe(6);
  });

  it('score 5 for density < 7', () => {
    expect(scoreAnyTypeDensity(5, 1000).score).toBe(5);
  });

  it('score 4 for density < 12', () => {
    expect(scoreAnyTypeDensity(10, 1000).score).toBe(4);
  });

  it('score 2 for density < 20', () => {
    expect(scoreAnyTypeDensity(15, 1000).score).toBe(2);
  });

  it('score 0 for density >= 20', () => {
    expect(scoreAnyTypeDensity(20, 1000).score).toBe(0);
  });

  it('returns score 8 when totalLines is 0 (density defaults to 0, which is < 1)', () => {
    // density = 0 when totalLines is 0, and 0 < 1 → score 8
    const r = scoreAnyTypeDensity(5, 0);
    expect(r.score).toBe(8);
  });
});

describe('scoreEhCoverage', () => {
  it('score 0 when no try/catch', () => {
    const r = scoreEhCoverage(0, 10);
    expect(r.score).toBe(0);
  });

  it('score 8 when try/catch >= asyncCount', () => {
    const r = scoreEhCoverage(10, 10);
    expect(r.score).toBe(8);
  });

  it('score 8 when try/catch >= 60% of asyncCount', () => {
    const r = scoreEhCoverage(6, 10);
    expect(r.score).toBe(8);
  });

  it('partial coverage returns lower score', () => {
    const r = scoreEhCoverage(3, 10);
    const pct = Math.round((3 / 10) * 100);
    expect(r.score).toBe(Math.round((pct / 100) * 8));
  });

  it('handles zero asyncCount gracefully', () => {
    const r = scoreEhCoverage(5, 0);
    expect(r.score).toBe(8);
  });
});

describe('scoreEmptyCatches', () => {
  it('score 5 for 0 empty catches', () => {
    const r = scoreEmptyCatches(0);
    expect(r.score).toBe(5);
  });

  it('score 4.5 for exactly 1 empty catch', () => {
    const r = scoreEmptyCatches(1);
    expect(r.score).toBe(4.5);
  });

  it('score 4 for exactly 2 empty catches', () => {
    const r = scoreEmptyCatches(2);
    expect(r.score).toBe(4);
  });

  it('score 3 for >= 3 and <= 4 empty catches', () => {
    expect(scoreEmptyCatches(3).score).toBe(3);
    expect(scoreEmptyCatches(4).score).toBe(3);
  });

  it('score 2 for 5–7 empty catches', () => {
    expect(scoreEmptyCatches(5).score).toBe(2);
    expect(scoreEmptyCatches(7).score).toBe(2);
  });

  it('score 1 for 8–12 empty catches', () => {
    expect(scoreEmptyCatches(8).score).toBe(1);
    expect(scoreEmptyCatches(12).score).toBe(1);
  });

  it('score 0 for >= 13 empty catches', () => {
    expect(scoreEmptyCatches(13).score).toBe(0);
    expect(scoreEmptyCatches(100).score).toBe(0);
  });
});

describe('scoreStructuredLogging', () => {
  it('score 7 for structured logger only', () => {
    const r = scoreStructuredLogging(10, 0);
    expect(r.score).toBe(7);
  });

  it('score 5 for structured logger + <= 5 console errors', () => {
    expect(scoreStructuredLogging(5, 5).score).toBe(5);
    expect(scoreStructuredLogging(5, 0).score).toBe(7); // edge case
  });

  it('score 3 for structured logger + > 5 console errors', () => {
    const r = scoreStructuredLogging(3, 10);
    expect(r.score).toBe(3);
  });

  it('score 1 for console.error calls only', () => {
    const r = scoreStructuredLogging(0, 3);
    expect(r.score).toBe(1);
  });

  it('score 0 when no logging at all', () => {
    const r = scoreStructuredLogging(0, 0);
    expect(r.score).toBe(0);
  });
});

describe('scoreAwaitInLoop', () => {
  it('score 5 for 0 await-in-loop', () => {
    const r = scoreAwaitInLoop(0);
    expect(r.score).toBe(5);
  });

  it('score 4 for 1 await-in-loop', () => {
    expect(scoreAwaitInLoop(1).score).toBe(4);
  });

  it('score 3 for 2–3 await-in-loop', () => {
    expect(scoreAwaitInLoop(2).score).toBe(3);
    expect(scoreAwaitInLoop(3).score).toBe(3);
  });

  it('score 2 for 4–6 await-in-loop', () => {
    expect(scoreAwaitInLoop(4).score).toBe(2);
    expect(scoreAwaitInLoop(6).score).toBe(2);
  });

  it('score 1 for > 6 await-in-loop', () => {
    expect(scoreAwaitInLoop(7).score).toBe(1);
    expect(scoreAwaitInLoop(100).score).toBe(1);
  });
});

describe('scoreConsoleLog', () => {
  it('score 5 for 0 console.log', () => {
    expect(scoreConsoleLog(0).score).toBe(5);
  });

  it('score 4 for 1–3 console.log', () => {
    expect(scoreConsoleLog(1).score).toBe(4);
    expect(scoreConsoleLog(3).score).toBe(4);
  });

  it('score 3 for 4–10 console.log', () => {
    expect(scoreConsoleLog(4).score).toBe(3);
    expect(scoreConsoleLog(10).score).toBe(3);
  });

  it('score 2 for 11–25 console.log', () => {
    expect(scoreConsoleLog(11).score).toBe(2);
    expect(scoreConsoleLog(25).score).toBe(2);
  });

  it('score 1 for 26–75 console.log', () => {
    expect(scoreConsoleLog(26).score).toBe(1);
    expect(scoreConsoleLog(75).score).toBe(1);
  });

  it('score 0 for > 75 console.log', () => {
    expect(scoreConsoleLog(76).score).toBe(0);
  });
});

describe('scoreImportHygiene', () => {
  it('score 4 for 0 issues', () => {
    expect(scoreImportHygiene(0).score).toBe(4);
  });

  it('score 2 for 1–2 issues', () => {
    expect(scoreImportHygiene(1).score).toBe(2);
    expect(scoreImportHygiene(2).score).toBe(2);
  });

  it('score 0 for > 2 issues', () => {
    expect(scoreImportHygiene(3).score).toBe(0);
    expect(scoreImportHygiene(10).score).toBe(0);
  });
});

describe('scoreFunctionLength', () => {
  it('score 6 for no functions (avgLen irrelevant)', () => {
    expect(scoreFunctionLength(100, 0).score).toBe(6);
  });

  it('score 6 for avgLen <= 20', () => {
    expect(scoreFunctionLength(0, 5).score).toBe(6);
    expect(scoreFunctionLength(20, 5).score).toBe(6);
  });

  it('score 5 for avgLen 31–40', () => {
    expect(scoreFunctionLength(35, 5).score).toBe(5);
  });

  it('score 4 for avgLen 41–50', () => {
    expect(scoreFunctionLength(45, 5).score).toBe(4);
  });

  it('score 3 for avgLen 51–65', () => {
    expect(scoreFunctionLength(60, 5).score).toBe(3);
  });

  it('score 2 for avgLen 66–80', () => {
    expect(scoreFunctionLength(75, 5).score).toBe(2);
  });

  it('score 1 for avgLen > 80', () => {
    expect(scoreFunctionLength(100, 5).score).toBe(1);
    expect(scoreFunctionLength(200, 5).score).toBe(1);
  });
});

describe('scoreLineLength', () => {
  it('score 6 for 0 long lines', () => {
    expect(scoreLineLength(0).score).toBe(6);
  });

  it('score 5 for 1–5 long lines', () => {
    expect(scoreLineLength(1).score).toBe(5);
    expect(scoreLineLength(5).score).toBe(5);
  });

  it('score 4 for 6–15 long lines', () => {
    expect(scoreLineLength(6).score).toBe(4);
    expect(scoreLineLength(15).score).toBe(4);
  });

  it('score 3 for 16–50 long lines', () => {
    expect(scoreLineLength(16).score).toBe(3);
    expect(scoreLineLength(50).score).toBe(3);
  });

  it('score 2 for 51–150 long lines', () => {
    expect(scoreLineLength(51).score).toBe(2);
    expect(scoreLineLength(150).score).toBe(2);
  });

  it('score 1 for 151–500 long lines', () => {
    expect(scoreLineLength(151).score).toBe(1);
    expect(scoreLineLength(500).score).toBe(1);
  });

  it('score 0 for > 500 long lines', () => {
    expect(scoreLineLength(501).score).toBe(0);
  });
});

describe('scoreDeadCode', () => {
  it('score 6 for no dead code', () => {
    const r = scoreDeadCode(0, 0);
    expect(r.score).toBe(6);
    expect(r.summary).toContain('no dead code');
  });

  it('score 5 for 0 commented and <= 3 TODOs', () => {
    expect(scoreDeadCode(0, 1).score).toBe(5);
    expect(scoreDeadCode(0, 3).score).toBe(5);
  });

  it('score 4 for <= 3 commented and <= 5 TODOs', () => {
    expect(scoreDeadCode(3, 5).score).toBe(4);
  });

  it('score 2 for <= 10 commented', () => {
    expect(scoreDeadCode(5, 10).score).toBe(2);
  });

  it('score 0 for > 10 commented', () => {
    expect(scoreDeadCode(11, 0).score).toBe(0);
    expect(scoreDeadCode(11, 11).score).toBe(0);
  });
});

describe('aggregateAndSortIssues', () => {
  const makeCategory = (
    name: string,
    subcategories: Array<{ name: string; found: number; desc: string; locations?: string[] }>,
  ): CategoryResult => ({
    name,
    emoji: '',
    summary: '',
    score: 0,
    max: 10,
    subcategories: subcategories.map(s => ({
      name: s.name,
      summary: '',
      score: 0,
      max: 10,
      issuesFound: s.found,
      issuesDescription: s.found > 0 ? s.desc : undefined,
      locations: s.locations ?? [],
    })),
  });

  it('returns zero when no categories have issues', () => {
    const cats = [makeCategory('Testing', [{ name: 'Coverage', found: 0, desc: '' }])];
    const result = aggregateAndSortIssues(cats);
    expect(result.totalIssuesFound).toBe(0);
    expect(result.issuesByType).toHaveLength(0);
  });

  it('aggregates issues from multiple categories', () => {
    const cats = [
      makeCategory('Testing', [{ name: 'Coverage', found: 5, desc: 'low coverage', locations: ['src/a.ts'] }]),
      makeCategory('Security', [{ name: 'Secrets', found: 2, desc: 'hardcoded secret', locations: ['src/b.ts'] }]),
    ];
    const result = aggregateAndSortIssues(cats);
    expect(result.totalIssuesFound).toBe(7);
    expect(result.issuesByType).toHaveLength(2);
  });

  it('sorts by severity then count', () => {
    const cats = [
      makeCategory('Testing', [{ name: 'Coverage', found: 2, desc: 'low', locations: ['a.ts'] }]),
      makeCategory('Security', [{ name: 'Secrets', found: 10, desc: 'secrets', locations: ['b.ts'] }]),
    ];
    const result = aggregateAndSortIssues(cats);
    // Security should come before Testing (high before medium/low)
    expect(result.issuesByType[0].category).toBe('Security');
  });

  it('only includes subcategories with issuesFound > 0', () => {
    const cats = [makeCategory('Testing', [
      { name: 'Coverage', found: 3, desc: 'bad', locations: ['a.ts'] },
      { name: 'Edge case depth', found: 0, desc: '', locations: [] },
    ])];
    const result = aggregateAndSortIssues(cats);
    expect(result.issuesByType).toHaveLength(1);
    expect(result.issuesByType[0].subcategory).toBe('Coverage');
  });

  it('extracts locations from issue records', () => {
    const cats = [makeCategory('Testing', [
      { name: 'Coverage', found: 2, desc: 'low', locations: ['src/a.ts', 'src/b.ts'] },
    ])];
    const result = aggregateAndSortIssues(cats);
    expect(result.issuesByType[0].locations).toContain('src/a.ts');
  });
});
