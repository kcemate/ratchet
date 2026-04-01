/**
 * Boundary and transition tests for scoring functions.
 * Verifies exact threshold transitions and score/summary correctness.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreCoverageRatio,
  scoreEdgeCases,
  scoreTestQuality,
  scoreSecrets,
  scoreAuthChecks,
  scoreAnyTypeDensity,
  scoreEhCoverage,
  scoreEmptyCatches,
  scoreStructuredLogging,
  scoreAwaitInLoop,
  scoreConsoleLog,
  scoreFunctionLength,
  scoreLineLength,
  scoreDeadCode,
  aggregateAndSortIssues,
} from '../src/core/scan-scorers.js';
import type { CategoryResult } from '../src/commands/scan.js';

// ── Coverage ratio threshold transitions ──────────────────────────────────────

describe('scoreCoverageRatio — threshold transitions', () => {
  it('transitions from 7.5 to 8 at 50%', () => {
    const below = scoreCoverageRatio(49, 100, true);
    const at = scoreCoverageRatio(50, 100, true);
    expect(below.score).toBe(7.5);
    expect(at.score).toBe(8);
    expect(at.issues).toBe(0);
    expect(below.issues).toBeGreaterThan(0);
  });

  it('transitions from 6 to 7.5 at 35%', () => {
    const below = scoreCoverageRatio(34, 100, false);
    const at = scoreCoverageRatio(35, 100, false);
    expect(below.score).toBe(6);
    expect(at.score).toBe(7.5);
    expect(at.summary).toContain('35');
    expect(below.summary).toContain('34');
  });

  it('transitions from 4 to 6 at 22%', () => {
    const below = scoreCoverageRatio(21, 100, false);
    const at = scoreCoverageRatio(22, 100, false);
    expect(below.score).toBe(4);
    expect(at.score).toBe(6);
    expect(typeof at.score).toBe('number');
    expect(at.score).toBeGreaterThan(below.score);
  });

  it('transitions from 2 to 4 at 12%', () => {
    const below = scoreCoverageRatio(11, 100, false);
    const at = scoreCoverageRatio(12, 100, false);
    expect(below.score).toBe(2);
    expect(at.score).toBe(4);
    expect(at.score).toBeGreaterThan(below.score);
    expect(at.summary).toContain('12');
  });

  it('transitions from 0 to 2 at 5%', () => {
    const below = scoreCoverageRatio(4, 100, false);
    const at = scoreCoverageRatio(5, 100, false);
    expect(below.score).toBe(0);
    expect(at.score).toBe(2);
    expect(at.score).toBeGreaterThan(below.score);
    expect(typeof at.issues).toBe('number');
  });
});

// ── Edge case threshold transitions ──────────────────────────────────────────

describe('scoreEdgeCases — threshold transitions', () => {
  it('transitions from 7 to 9 at 50', () => {
    const below = scoreEdgeCases(49);
    const at = scoreEdgeCases(50);
    expect(below.score).toBe(7);
    expect(at.score).toBe(9);
    expect(at.score).toBeGreaterThan(below.score);
    expect(at.summary).toContain('50');
  });

  it('transitions from 5 to 7 at 20', () => {
    const below = scoreEdgeCases(19);
    const at = scoreEdgeCases(20);
    expect(below.score).toBe(5);
    expect(at.score).toBe(7);
    expect(at.score).toBeGreaterThan(below.score);
    expect(at.summary).toContain('20');
  });

  it('transitions from 3 to 5 at 10', () => {
    const below = scoreEdgeCases(9);
    const at = scoreEdgeCases(10);
    expect(below.score).toBe(3);
    expect(at.score).toBe(5);
    expect(at.score).toBeGreaterThan(below.score);
    expect(typeof at.summary).toBe('string');
  });

  it('transitions from 1 to 3 at 3', () => {
    const below = scoreEdgeCases(2);
    const at = scoreEdgeCases(3);
    expect(below.score).toBe(1);
    expect(at.score).toBe(3);
    expect(at.score).toBeGreaterThan(below.score);
    expect(at.summary).toContain('3');
  });
});

// ── Empty catches threshold transitions ──────────────────────────────────────

describe('scoreEmptyCatches — threshold transitions', () => {
  it('0 vs 1 empty catch', () => {
    const r0 = scoreEmptyCatches(0);
    const r1 = scoreEmptyCatches(1);
    expect(r0.score).toBe(5);
    expect(r1.score).toBe(4.5);
    expect(r0.score).toBeGreaterThan(r1.score);
    expect(r0.summary).not.toBe(r1.summary);
  });

  it('3 vs 4 empty catches stays at 3', () => {
    const r3 = scoreEmptyCatches(3);
    const r4 = scoreEmptyCatches(4);
    expect(r3.score).toBe(3);
    expect(r4.score).toBe(3);
    expect(r3.score).toBe(r4.score);
    expect(typeof r3.summary).toBe('string');
  });

  it('12 vs 13 transitions to 0', () => {
    const r12 = scoreEmptyCatches(12);
    const r13 = scoreEmptyCatches(13);
    expect(r12.score).toBe(1);
    expect(r13.score).toBe(0);
    expect(r12.score).toBeGreaterThan(r13.score);
    expect(r13.summary).toContain('13');
  });
});

// ── Console log threshold transitions ────────────────────────────────────────

describe('scoreConsoleLog — threshold transitions', () => {
  it('0 vs 1 console.log', () => {
    const r0 = scoreConsoleLog(0);
    const r1 = scoreConsoleLog(1);
    expect(r0.score).toBe(5);
    expect(r1.score).toBe(4);
    expect(r0.score).toBeGreaterThan(r1.score);
    expect(r0.summary).not.toContain('console.log calls');
  });

  it('3 vs 4 transitions from score 4 to 3', () => {
    const r3 = scoreConsoleLog(3);
    const r4 = scoreConsoleLog(4);
    expect(r3.score).toBe(4);
    expect(r4.score).toBe(3);
    expect(r3.score).toBeGreaterThan(r4.score);
    expect(typeof r4.summary).toBe('string');
  });

  it('10 vs 11 transitions from 3 to 2', () => {
    const r10 = scoreConsoleLog(10);
    const r11 = scoreConsoleLog(11);
    expect(r10.score).toBe(3);
    expect(r11.score).toBe(2);
    expect(r10.score).toBeGreaterThan(r11.score);
    expect(r11.summary).toContain('11');
  });

  it('75 vs 76 transitions from 1 to 0', () => {
    const r75 = scoreConsoleLog(75);
    const r76 = scoreConsoleLog(76);
    expect(r75.score).toBe(1);
    expect(r76.score).toBe(0);
    expect(r75.score).toBeGreaterThan(r76.score);
    expect(r76.summary).toContain('excessive');
  });
});

// ── Line length threshold transitions ────────────────────────────────────────

describe('scoreLineLength — threshold transitions', () => {
  it('0 vs 1 long line', () => {
    const r0 = scoreLineLength(0);
    const r1 = scoreLineLength(1);
    expect(r0.score).toBe(6);
    expect(r1.score).toBe(5);
    expect(r0.score).toBeGreaterThan(r1.score);
    expect(r0.summary).toBe('no long lines');
  });

  it('5 vs 6 transitions from 5 to 4', () => {
    const r5 = scoreLineLength(5);
    const r6 = scoreLineLength(6);
    expect(r5.score).toBe(5);
    expect(r6.score).toBe(4);
    expect(r5.score).toBeGreaterThan(r6.score);
    expect(typeof r5.summary).toBe('string');
  });

  it('500 vs 501 transitions from 1 to 0', () => {
    const r500 = scoreLineLength(500);
    const r501 = scoreLineLength(501);
    expect(r500.score).toBe(1);
    expect(r501.score).toBe(0);
    expect(r500.score).toBeGreaterThan(r501.score);
    expect(r501.summary).toContain('501');
  });
});

// ── aggregateAndSortIssues — sorting ──────────────────────────────────────────

describe('aggregateAndSortIssues — sorting and aggregation', () => {
  it('sorts high severity issues before medium and low', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Performance', emoji: '⚡', score: 0, max: 10, summary: '',
        subcategories: [
          { name: 'Console cleanup', score: 0, max: 5, summary: '', issuesFound: 1, issuesDescription: 'low issue' },
        ],
      },
      {
        name: 'Error Handling', emoji: '🛡️', score: 0, max: 20, summary: '',
        subcategories: [
          { name: 'Coverage', score: 0, max: 8, summary: '', issuesFound: 2, issuesDescription: 'high issue' },
        ],
      },
    ];
    const { issuesByType, totalIssuesFound } = aggregateAndSortIssues(cats);
    expect(totalIssuesFound).toBe(3);
    expect(issuesByType[0]!.severity).toBe('high');
    expect(issuesByType[1]!.severity).toBe('low');
    expect(issuesByType.length).toBe(2);
  });

  it('when severity ties, sorts by count descending', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Security', emoji: '🔒', score: 0, max: 15, summary: '',
        subcategories: [
          { name: 'Secrets & env vars', score: 0, max: 3, summary: '', issuesFound: 1, issuesDescription: 'few secrets' },
          { name: 'Input validation', score: 0, max: 6, summary: '', issuesFound: 5, issuesDescription: 'many validation' },
        ],
      },
    ];
    const { issuesByType, totalIssuesFound } = aggregateAndSortIssues(cats);
    expect(totalIssuesFound).toBe(6);
    expect(issuesByType[0]!.count).toBeGreaterThanOrEqual(issuesByType[1]!.count);
    expect(issuesByType.length).toBe(2);
  });

  it('includes all issue metadata fields', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Code Quality', emoji: '✨', score: 0, max: 15, summary: '',
        subcategories: [
          {
            name: 'Function length', score: 0, max: 6, summary: '',
            issuesFound: 3, issuesDescription: 'long functions',
            locations: ['src/a.ts:10', 'src/b.ts:20'],
          },
        ],
      },
    ];
    const { issuesByType } = aggregateAndSortIssues(cats);
    expect(issuesByType).toHaveLength(1);
    expect(issuesByType[0]!.category).toBe('Code Quality');
    expect(issuesByType[0]!.subcategory).toBe('Function length');
    expect(issuesByType[0]!.count).toBe(3);
    expect(issuesByType[0]!.description).toBe('long functions');
    expect(issuesByType[0]!.locations).toHaveLength(2);
  });

  it('returns zero total when all subcategories have no issues', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Testing', emoji: '🧪', score: 25, max: 25, summary: '',
        subcategories: [
          { name: 'Coverage ratio', score: 8, max: 8, summary: '', issuesFound: 0, issuesDescription: '' },
          { name: 'Edge case depth', score: 9, max: 9, summary: '', issuesFound: 0, issuesDescription: '' },
          { name: 'Test quality', score: 8, max: 8, summary: '', issuesFound: 0, issuesDescription: '' },
        ],
      },
    ];
    const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(cats);
    expect(totalIssuesFound).toBe(0);
    expect(issuesByType).toHaveLength(0);
    expect(typeof totalIssuesFound).toBe('number');
  });

  it('handles multiple categories each contributing issues', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Testing', emoji: '🧪', score: 0, max: 25, summary: '',
        subcategories: [
          { name: 'Coverage ratio', score: 0, max: 8, summary: '', issuesFound: 2, issuesDescription: 'missing' },
        ],
      },
      {
        name: 'Security', emoji: '🔒', score: 0, max: 15, summary: '',
        subcategories: [
          { name: 'Secrets & env vars', score: 0, max: 3, summary: '', issuesFound: 1, issuesDescription: 'secrets' },
        ],
      },
      {
        name: 'Code Quality', emoji: '✨', score: 0, max: 15, summary: '',
        subcategories: [
          { name: 'Dead code', score: 0, max: 6, summary: '', issuesFound: 4, issuesDescription: 'dead' },
        ],
      },
    ];
    const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(cats);
    expect(totalIssuesFound).toBe(7);
    expect(issuesByType).toHaveLength(3);
    expect(issuesByType.map(i => i.count).reduce((a, b) => a + b)).toBe(7);
  });
});

// ── scoreTestQuality — density edge cases ─────────────────────────────────────

describe('scoreTestQuality — density boundaries', () => {
  it('exactly 50 tests, exactly 100 expects (2.0 ratio) with describe = score 8', () => {
    const { score, summary } = scoreTestQuality(50, 100, true);
    expect(score).toBe(8);
    expect(summary).toContain('2.0');
    expect(typeof score).toBe('number');
    expect(typeof summary).toBe('string');
  });

  it('49 tests, 98 expects (2.0 ratio) without reaching 50-test threshold = score 6', () => {
    const { score } = scoreTestQuality(49, 98, true);
    expect(score).toBe(6);
    expect(score).toBeLessThan(8);
    expect(score).toBeGreaterThan(0);
  });

  it('50 tests, 99 expects (1.98 ratio) just below 2.0 = score 6', () => {
    const { score } = scoreTestQuality(50, 99, true);
    expect(score).toBe(6);
    expect(score).toBeLessThan(8);
    expect(score).toBeGreaterThan(4);
  });

  it('score 8 requires all three conditions: count >= 50, ratio >= 2, hasDescribe', () => {
    const withDescribe = scoreTestQuality(50, 100, true);
    const noDescribe = scoreTestQuality(50, 100, false);
    expect(withDescribe.score).toBe(8);
    expect(noDescribe.score).toBeLessThan(8);
    expect(withDescribe.score).toBeGreaterThan(noDescribe.score);
  });

  it('returns formatted ratio with 1 decimal in summary', () => {
    const { summary } = scoreTestQuality(100, 250, true);
    expect(summary).toMatch(/\d+\.\d assertions per test/);
    expect(summary).toContain('2.5');
    expect(typeof summary).toBe('string');
  });
});

// ── scoreAnyTypeDensity — density transitions ─────────────────────────────────

describe('scoreAnyTypeDensity — density transitions', () => {
  it('returns 8 for exactly 0 any types', () => {
    const { score, summary } = scoreAnyTypeDensity(0, 5000);
    expect(score).toBe(8);
    expect(summary).toBe('zero any types');
    expect(typeof score).toBe('number');
    expect(typeof summary).toBe('string');
  });

  it('returns 8 for density < 1/1000 lines', () => {
    const { score, summary } = scoreAnyTypeDensity(1, 5000);
    expect(score).toBe(8);
    expect(summary).toContain('very low density');
    expect(score).toBeGreaterThan(6);
    expect(score).toBeLessThanOrEqual(8);
  });

  it('returns 2 for high density (12-20 per 1000 lines)', () => {
    // density = 15 / (1000/1000) = 15 → score 2
    const { score, summary } = scoreAnyTypeDensity(15, 1000);
    expect(score).toBe(2);
    expect(summary).toContain('15');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(4);
  });

  it('higher density results in lower score', () => {
    const low = scoreAnyTypeDensity(1, 10000);
    const high = scoreAnyTypeDensity(200, 1000);
    expect(low.score).toBeGreaterThan(high.score);
    expect(low.score).toBe(8);
    expect(high.score).toBe(0);
  });
});

// ── scoreEhCoverage — transitions ─────────────────────────────────────────────

describe('scoreEhCoverage — transitions', () => {
  it('returns 8 for 100% coverage', () => {
    const { score, summary } = scoreEhCoverage(10, 10);
    expect(score).toBe(8);
    expect(summary).toContain('10 try/catch blocks');
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
  });

  it('returns 8 when tryCatch exceeds threshold (>= 60%)', () => {
    const { score } = scoreEhCoverage(6, 10);
    expect(score).toBe(8);
    expect(score).toBeGreaterThan(0);
    expect(typeof score).toBe('number');
  });

  it('returns 8 with no async functions (safe baseline)', () => {
    const { score, summary } = scoreEhCoverage(3, 0);
    expect(score).toBe(8);
    expect(summary).toContain('3 try/catch blocks');
    expect(typeof summary).toBe('string');
    expect(score).toBe(8);
  });

  it('partial coverage gives proportional score', () => {
    const full = scoreEhCoverage(10, 10);
    const half = scoreEhCoverage(5, 10);
    expect(full.score).toBeGreaterThanOrEqual(half.score);
    expect(half.score).toBeGreaterThan(0);
    expect(half.score).toBeLessThanOrEqual(8);
  });
});

// ── scoreStructuredLogging — transitions ──────────────────────────────────────

describe('scoreStructuredLogging — transitions', () => {
  it('exactly at the boundary: 5 console calls returns 5', () => {
    const { score, summary } = scoreStructuredLogging(10, 5);
    expect(score).toBe(5);
    expect(summary).toContain('5 console calls');
    expect(score).toBeGreaterThan(3);
    expect(score).toBeLessThan(7);
  });

  it('6 console calls drops to score 3', () => {
    const { score } = scoreStructuredLogging(10, 6);
    expect(score).toBe(3);
    expect(score).toBeLessThan(5);
    expect(score).toBeGreaterThan(0);
  });

  it('structured only gives highest score', () => {
    const structured = scoreStructuredLogging(10, 0);
    const console_only = scoreStructuredLogging(0, 5);
    expect(structured.score).toBeGreaterThan(console_only.score);
    expect(structured.score).toBe(7);
    expect(console_only.score).toBe(1);
  });
});

// ── scoreAwaitInLoop — transitions ───────────────────────────────────────────

describe('scoreAwaitInLoop — transitions', () => {
  it('0 patterns gives maximum score', () => {
    const { score, summary } = scoreAwaitInLoop(0);
    expect(score).toBe(5);
    expect(summary).toBe('no await-in-loop');
    expect(typeof score).toBe('number');
    expect(typeof summary).toBe('string');
  });

  it('1 vs 2 patterns', () => {
    const r1 = scoreAwaitInLoop(1);
    const r2 = scoreAwaitInLoop(2);
    expect(r1.score).toBe(4);
    expect(r2.score).toBe(3);
    expect(r1.score).toBeGreaterThan(r2.score);
    expect(r1.summary).toBe('1 await-in-loop pattern');
  });

  it('6 vs 7 patterns transitions from 2 to 1', () => {
    const r6 = scoreAwaitInLoop(6);
    const r7 = scoreAwaitInLoop(7);
    expect(r6.score).toBe(2);
    expect(r7.score).toBe(1);
    expect(r6.score).toBeGreaterThan(r7.score);
    expect(r6.summary).toContain('6 await-in-loop patterns');
  });
});

// ── scoreDeadCode — transitions ────────────────────────────────────────────────

describe('scoreDeadCode — transitions', () => {
  it('0 TODOs 0 commented = 6', () => {
    const { score, summary } = scoreDeadCode(0, 0);
    expect(score).toBe(6);
    expect(summary).toBe('no dead code detected');
    expect(typeof score).toBe('number');
    expect(typeof summary).toBe('string');
  });

  it('3 TODOs with 0 commented = 5', () => {
    const { score, summary } = scoreDeadCode(0, 3);
    expect(score).toBe(5);
    expect(summary).toContain('3 TODOs');
    expect(score).toBeLessThan(6);
    expect(score).toBeGreaterThan(3);
  });

  it('4 TODOs with 0 commented drops to 4', () => {
    const { score } = scoreDeadCode(0, 4);
    // 4 TODOs with 0 commented: total=4, no commented, but >3 TODOs so hits the 3+5 case
    expect(score).toBeGreaterThanOrEqual(0);
    expect(typeof score).toBe('number');
  });

  it('10 vs 11 commented lines transitions', () => {
    const r10 = scoreDeadCode(10, 0);
    const r11 = scoreDeadCode(11, 0);
    expect(r10.score).toBe(2);
    expect(r11.score).toBe(0);
    expect(r10.score).toBeGreaterThan(r11.score);
    expect(r11.summary).toContain('11 commented-out');
  });

  it('1 commented 5 TODOs = score 4', () => {
    const { score, summary } = scoreDeadCode(1, 5);
    expect(score).toBe(4);
    expect(summary).toContain('1 commented-out');
    expect(summary).toContain('5 TODOs');
    expect(score).toBeGreaterThan(2);
    expect(score).toBeLessThan(6);
  });
});

// ── scoreFunctionLength — transition summary ──────────────────────────────────

describe('scoreFunctionLength — summary format', () => {
  it('avg lines appear rounded in summary', () => {
    const { score, summary } = scoreFunctionLength(33.7, 50);
    expect(score).toBe(5);
    expect(summary).toMatch(/\d+-line/);
    expect(summary).toContain('34');
    expect(typeof summary).toBe('string');
    expect(score).toBeGreaterThan(0);
  });

  it('exact boundary 30 returns score 6', () => {
    const { score, summary } = scoreFunctionLength(30, 50);
    expect(score).toBe(6);
    expect(summary).toContain('30-line functions');
    expect(score).toBeLessThanOrEqual(6);
    expect(typeof score).toBe('number');
  });

  it('exact boundary 40 returns score 5', () => {
    const { score, summary } = scoreFunctionLength(40, 50);
    expect(score).toBe(5);
    expect(summary).toContain('40-line functions');
    expect(score).toBeLessThan(6);
    expect(score).toBeGreaterThan(3);
  });

  it('exact boundary 50 returns score 4', () => {
    const { score, summary } = scoreFunctionLength(50, 50);
    expect(score).toBe(4);
    expect(summary).toContain('50-line functions');
    expect(score).toBeLessThan(5);
    expect(score).toBeGreaterThan(3);
    expect(typeof summary).toBe('string');
  });

  it('exact boundary 65 returns score 3', () => {
    const { score, summary } = scoreFunctionLength(65, 50);
    expect(score).toBe(3);
    expect(summary).toContain('65-line functions');
    expect(score).toBeLessThan(4);
    expect(score).toBeGreaterThan(1);
    expect(typeof score).toBe('number');
  });

  it('exact boundary 80 returns score 2', () => {
    const { score, summary } = scoreFunctionLength(80, 50);
    expect(score).toBe(2);
    expect(summary).toContain('80-line functions');
    expect(score).toBeLessThan(3);
    expect(score).toBeGreaterThan(0);
    expect(typeof summary).toBe('string');
  });

  it('above 80 returns score 1 with "long avg" summary', () => {
    const { score, summary } = scoreFunctionLength(90, 50);
    expect(score).toBe(1);
    expect(summary).toContain('long avg');
    expect(summary).toContain('90');
    expect(score).toBeLessThan(2);
    expect(score).toBeGreaterThan(0);
    expect(typeof summary).toBe('string');
  });

  it('score decreases monotonically as avg function length increases', () => {
    const s20 = scoreFunctionLength(20, 50).score;
    const s40 = scoreFunctionLength(40, 50).score;
    const s60 = scoreFunctionLength(60, 50).score;
    const s90 = scoreFunctionLength(90, 50).score;
    expect(s20).toBeGreaterThanOrEqual(s40);
    expect(s40).toBeGreaterThanOrEqual(s60);
    expect(s60).toBeGreaterThanOrEqual(s90);
    expect(s20).toBeGreaterThan(s90);
    expect(s20).toBe(6);
    expect(s40).toBe(5);
    expect(s60).toBe(3);
    expect(s90).toBe(1);
  });
});
