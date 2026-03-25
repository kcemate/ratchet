import { describe, it, expect } from 'vitest';
import { scanCommand, type ScanResult, type CategoryThreshold } from '../commands/scan.js';
import { getExplanation, EXPLANATIONS } from '../core/explanations.js';

function mockScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test-project',
    total: 75,
    maxTotal: 100,
    totalIssuesFound: 12,
    issuesByType: [],
    categories: [
      { name: 'Testing', emoji: '🧪', score: 20, max: 25, summary: '', subcategories: [
        { name: 'Coverage ratio', score: 6, max: 8, summary: '', issuesFound: 2 },
        { name: 'Edge case depth', score: 7, max: 9, summary: '', issuesFound: 0 },
        { name: 'Test quality', score: 7, max: 8, summary: '', issuesFound: 0 },
      ]},
      { name: 'Security', emoji: '🔒', score: 10, max: 15, summary: '', subcategories: [
        { name: 'Secrets & env vars', score: 2, max: 3, summary: '', issuesFound: 0 },
        { name: 'Input validation', score: 4, max: 6, summary: '', issuesFound: 2 },
        { name: 'Auth & rate limiting', score: 4, max: 6, summary: '', issuesFound: 0 },
      ]},
      { name: 'Type Safety', emoji: '📝', score: 15, max: 15, summary: '', subcategories: [
        { name: 'Strict config', score: 7, max: 7, summary: '', issuesFound: 0 },
        { name: 'Any type count', score: 8, max: 8, summary: '', issuesFound: 0 },
      ]},
      { name: 'Error Handling', emoji: '⚠️ ', score: 15, max: 20, summary: '', subcategories: [
        { name: 'Coverage', score: 6, max: 8, summary: '', issuesFound: 1 },
        { name: 'Empty catches', score: 4, max: 5, summary: '', issuesFound: 2 },
        { name: 'Structured logging', score: 5, max: 7, summary: '', issuesFound: 0 },
      ]},
      { name: 'Performance', emoji: '⚡', score: 8, max: 10, summary: '', subcategories: [
        { name: 'Async patterns', score: 2, max: 3, summary: '', issuesFound: 1 },
        { name: 'Console cleanup', score: 4, max: 5, summary: '', issuesFound: 2 },
        { name: 'Import hygiene', score: 2, max: 2, summary: '', issuesFound: 0 },
      ]},
      { name: 'Code Quality', emoji: '📖', score: 7, max: 15, summary: '', subcategories: [
        { name: 'Function length', score: 2, max: 4, summary: '', issuesFound: 5 },
        { name: 'Line length', score: 2, max: 4, summary: '', issuesFound: 10 },
        { name: 'Dead code', score: 1, max: 4, summary: '', issuesFound: 3 },
        { name: 'Duplication', score: 2, max: 3, summary: '', issuesFound: 4 },
      ]},
    ],
    ...overrides,
  };
}

function evaluateGates(
  result: ScanResult,
  totalThreshold: number | null,
  categoryThresholds: CategoryThreshold[],
): { passed: boolean; failedCategories: Array<{ name: string; score: number; threshold: number }> } {
  const failedCategories: Array<{ name: string; score: number; threshold: number }> = [];
  const resolved = categoryThresholds.map((ct) => {
    const cat = result.categories.find((c) => c.name.toLowerCase() === ct.categoryName.toLowerCase());
    if (!cat) throw new Error(`Category "${ct.categoryName}" not found`);
    return { ...ct, score: cat.score };
  });
  for (const ct of resolved) {
    if (ct.score < ct.threshold)
      failedCategories.push({ name: ct.categoryName, score: ct.score, threshold: ct.threshold });
  }
  const totalPassed = totalThreshold === null || result.total >= totalThreshold;
  return { passed: totalPassed && failedCategories.length === 0, failedCategories };
}

describe('overall score gates', () => {
  it('passes with no thresholds', () =>
    expect(evaluateGates(mockScanResult({ total: 50 }), null, []).passed).toBe(true));
  it('passes at exact threshold', () => expect(evaluateGates(mockScanResult({ total: 80 }), 80, []).passed).toBe(true));
  it('passes above threshold', () => expect(evaluateGates(mockScanResult({ total: 90 }), 80, []).passed).toBe(true));
  it('fails below threshold', () => expect(evaluateGates(mockScanResult({ total: 75 }), 80, []).passed).toBe(false));
  it('fails at threshold - 1', () => expect(evaluateGates(mockScanResult({ total: 79 }), 80, []).passed).toBe(false));
});

describe('category gates', () => {
  it('passes when category meets threshold', () => {
    expect(evaluateGates(
      mockScanResult(), null, [{ categoryName: 'Security', threshold: 10, max: 15 }],
    ).passed).toBe(true);
  });
  it('fails when category below threshold', () => {
    const r = evaluateGates(
      mockScanResult(), null, [{ categoryName: 'Security', threshold: 12, max: 15 }],
    );
    expect(r.passed).toBe(false);
    expect(r.failedCategories).toContainEqual({ name: 'Security', score: 10, threshold: 12 });
  });
  it('fails multiple categories', () => {
    const r = evaluateGates(mockScanResult(), null, [
      { categoryName: 'Security', threshold: 12, max: 15 },
      { categoryName: 'Code Quality', threshold: 10, max: 15 },
    ]);
    expect(r.failedCategories).toHaveLength(2);
  });
  it('is case-insensitive', () => {
    expect(evaluateGates(
      mockScanResult(), null, [{ categoryName: 'security', threshold: 12, max: 15 }],
    ).passed).toBe(false);
  });
  it('throws for unknown category', () => {
    expect(() =>
      evaluateGates(mockScanResult(), null, [{ categoryName: 'Nonexistent', threshold: 5, max: 10 }]),
    ).toThrow('not found');
  });
  it('passes when category at max', () => {
    expect(evaluateGates(
      mockScanResult(), null, [{ categoryName: 'Type Safety', threshold: 15, max: 15 }],
    ).passed).toBe(true);
  });
});

describe('combined gates', () => {
  it('fails when total fails but category passes', () => {
    expect(evaluateGates(
      mockScanResult({ total: 70 }), 80, [{ categoryName: 'Type Safety', threshold: 15, max: 15 }],
    ).passed).toBe(false);
  });
  it('fails when category fails but total passes', () => {
    expect(evaluateGates(
      mockScanResult({ total: 90 }), 80, [{ categoryName: 'Security', threshold: 12, max: 15 }],
    ).passed).toBe(false);
  });
});

describe('explanations', () => {
  const subcategories = [
    'Coverage ratio', 'Edge case depth', 'Test quality',
    'Secrets & env vars', 'Input validation', 'Auth & rate limiting',
    'Strict config', 'Any type count', 'Coverage', 'Empty catches',
    'Structured logging', 'Async patterns', 'Console cleanup',
    'Import hygiene', 'Function length', 'Line length', 'Dead code', 'Duplication',
  ];

  it.each(subcategories)('"%s" has why + fix', (name) => {
    const exp = getExplanation(name);
    expect(exp).toBeDefined();
    expect(exp!.why.length).toBeGreaterThan(10);
    expect(exp!.fix.length).toBeGreaterThan(10);
  });

  it('returns undefined for unknown name', () => {
    expect(getExplanation('Not a subcategory')).toBeUndefined();
  });

  it('covers all 18 subcategories', () => {
    for (const name of subcategories) expect(Object.keys(EXPLANATIONS)).toContain(name);
  });
});

describe('scanCommand options', () => {
  it('registers --fail-on', () => expect(scanCommand().options.find((o) => o.long === '--fail-on')).toBeDefined());
  it('registers --fail-on-category', () =>
    expect(scanCommand().options.find((o) => o.long === '--fail-on-category')).toBeDefined());
  it('registers --output-json', () =>
    expect(scanCommand().options.find((o) => o.long === '--output-json')).toBeDefined());
  it('registers --explain', () => expect(scanCommand().options.find((o) => o.long === '--explain')).toBeDefined());
  it('is named scan', () => expect(scanCommand().name()).toBe('scan'));
});
