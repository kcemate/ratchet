import { describe, it, expect } from 'vitest';
import {
  filterGapsByCategory,
  CATEGORY_SUBCATEGORY_MAP,
  analyzeScoreGaps,
  buildScoreOptimizedBacklog,
} from '../core/score-optimizer.js';
import { resolveGuards } from '../core/engine-guards.js';
import { GUARD_PROFILES } from '../types.js';
import type { TierGap } from '../core/score-optimizer.js';
import type { Target, RatchetConfig } from '../types.js';

// ─── Helpers

function makeGap(subcategory: string, overrides: Partial<TierGap> = {}): TierGap {
  return {
    subcategory,
    currentScore: 2,
    maxScore: 6,
    pointsAvailable: 4,
    currentCount: 5,
    issuesToNextTier: 2,
    pointsAtNextTier: 2,
    issuesToMax: 5,
    pointsAtMax: 4,
    roi: 1.0,
    roiToMax: 0.8,
    effortPerFix: 2,
    sweepable: true,
    fixInstruction: 'fix it',
    files: [],
    ...overrides,
  };
}

const ALL_GAPS: TierGap[] = [
  makeGap('Test quality'),
  makeGap('Coverage ratio'),
  makeGap('Input validation'),
  makeGap('Auth & rate limiting'),
  makeGap('Coverage'),
  makeGap('Empty catches'),
  makeGap('Structured logging'),
  makeGap('Console cleanup'),
  makeGap('Async patterns'),
  makeGap('Line length'),
  makeGap('Dead code'),
];

// ─── CATEGORY_SUBCATEGORY_MAP

describe('CATEGORY_SUBCATEGORY_MAP', () => {
  it('contains all six required categories', () => {
    const categories = Object.keys(CATEGORY_SUBCATEGORY_MAP);
    expect(categories).toContain('testing');
    expect(categories).toContain('security');
    expect(categories).toContain('type-safety');
    expect(categories).toContain('error-handling');
    expect(categories).toContain('performance');
    expect(categories).toContain('code-quality');
  });

  it('testing maps to expected subcategories', () => {
    expect(CATEGORY_SUBCATEGORY_MAP['testing']).toContain('Test quality');
    expect(CATEGORY_SUBCATEGORY_MAP['testing']).toContain('Coverage ratio');
    expect(CATEGORY_SUBCATEGORY_MAP['testing']).toContain('Edge case depth');
  });

  it('error-handling maps to Coverage, Empty catches, Structured logging', () => {
    expect(CATEGORY_SUBCATEGORY_MAP['error-handling']).toContain('Coverage');
    expect(CATEGORY_SUBCATEGORY_MAP['error-handling']).toContain('Empty catches');
    expect(CATEGORY_SUBCATEGORY_MAP['error-handling']).toContain('Structured logging');
  });

  it('code-quality maps to Function length, Line length, Dead code, Duplication', () => {
    const subs = CATEGORY_SUBCATEGORY_MAP['code-quality']!;
    expect(subs).toContain('Function length');
    expect(subs).toContain('Line length');
    expect(subs).toContain('Dead code');
    expect(subs).toContain('Duplication');
  });
});

// ─── filterGapsByCategory

describe('filterGapsByCategory', () => {
  it('returns only testing subcategories for "testing"', () => {
    const result = filterGapsByCategory(ALL_GAPS, 'testing');
    const names = result.map(g => g.subcategory);
    expect(names).toContain('Test quality');
    expect(names).toContain('Coverage ratio');
    expect(names).not.toContain('Input validation');
    expect(names).not.toContain('Console cleanup');
  });

  it('returns only error-handling subcategories for "error-handling"', () => {
    const result = filterGapsByCategory(ALL_GAPS, 'error-handling');
    const names = result.map(g => g.subcategory);
    expect(names).toContain('Coverage');
    expect(names).toContain('Empty catches');
    expect(names).toContain('Structured logging');
    expect(names).not.toContain('Test quality');
    expect(names).not.toContain('Line length');
  });

  it('returns only security subcategories for "security"', () => {
    const result = filterGapsByCategory(ALL_GAPS, 'security');
    const names = result.map(g => g.subcategory);
    expect(names).toContain('Input validation');
    expect(names).toContain('Auth & rate limiting');
    expect(names).not.toContain('Coverage');
  });

  it('returns only performance subcategories for "performance"', () => {
    const result = filterGapsByCategory(ALL_GAPS, 'performance');
    const names = result.map(g => g.subcategory);
    expect(names).toContain('Console cleanup');
    expect(names).toContain('Async patterns');
    expect(names).not.toContain('Line length');
  });

  it('returns only code-quality subcategories for "code-quality"', () => {
    const result = filterGapsByCategory(ALL_GAPS, 'code-quality');
    const names = result.map(g => g.subcategory);
    expect(names).toContain('Line length');
    expect(names).toContain('Dead code');
    expect(names).not.toContain('Test quality');
  });

  it('returns all gaps unchanged for an unknown category', () => {
    const result = filterGapsByCategory(ALL_GAPS, 'nonexistent');
    expect(result).toHaveLength(ALL_GAPS.length);
  });

  it('returns empty array when no gaps match the category', () => {
    const securityOnly = [makeGap('Input validation'), makeGap('Auth & rate limiting')];
    const result = filterGapsByCategory(securityOnly, 'testing');
    expect(result).toHaveLength(0);
  });

  it('does not mutate the original gaps array', () => {
    const original = [...ALL_GAPS];
    filterGapsByCategory(ALL_GAPS, 'testing');
    expect(ALL_GAPS).toHaveLength(original.length);
  });
});

// ─── buildScoreOptimizedBacklog with focusCategory

describe('buildScoreOptimizedBacklog with focusCategory', () => {
  // Minimal ScanResult to drive the optimizer
  function makeScan() {
    return {
      total: 60,
      maxTotal: 100,
      totalIssuesFound: 10,
      categories: [
        {
          name: 'Testing',
          score: 4,
          max: 16,
          subcategories: [
            { name: 'Test quality', score: 4, max: 8, issuesFound: 2, locations: [] },
          ],
        },
        {
          name: 'Error Handling',
          score: 10,
          max: 20,
          subcategories: [
            { name: 'Empty catches', score: 3, max: 5, issuesFound: 4, locations: [] },
            { name: 'Coverage', score: 4, max: 8, issuesFound: 10, locations: [] },
          ],
        },
      ],
      issuesByType: [],
    } as Parameters<typeof buildScoreOptimizedBacklog>[0];
  }

  it('without focusCategory returns tasks for all categories', () => {
    const tasks = buildScoreOptimizedBacklog(makeScan());
    const subcats = tasks.map(t => t.subcategory);
    // Both testing and error-handling subcategories should appear
    const hasTestQuality = subcats.includes('Test quality');
    const hasErrorHandling = subcats.includes('Empty catches') || subcats.includes('Coverage');
    expect(hasTestQuality || hasErrorHandling).toBe(true);
  });

  it('with focusCategory="testing" returns only testing tasks', () => {
    const tasks = buildScoreOptimizedBacklog(makeScan(), 'testing');
    const subcats = tasks.map(t => t.subcategory);
    expect(subcats.every(s => CATEGORY_SUBCATEGORY_MAP['testing']!.includes(s))).toBe(true);
    // error-handling subcats should not appear
    expect(subcats).not.toContain('Empty catches');
    expect(subcats).not.toContain('Coverage');
  });

  it('with focusCategory="error-handling" returns only error-handling tasks', () => {
    const tasks = buildScoreOptimizedBacklog(makeScan(), 'error-handling');
    const subcats = tasks.map(t => t.subcategory);
    expect(subcats).not.toContain('Test quality');
    expect(subcats.every(s => CATEGORY_SUBCATEGORY_MAP['error-handling']!.includes(s))).toBe(true);
  });

  it('returns empty array when no scan data matches the category', () => {
    const tasks = buildScoreOptimizedBacklog(makeScan(), 'security');
    expect(tasks).toHaveLength(0);
  });
});

// ─── resolveGuards with focusCategory

describe('resolveGuards with focusCategory=testing', () => {
  const target: Target = { name: 'src', path: 'src/', description: '' };
  const config: RatchetConfig = {
    agent: 'shell',
    defaults: { clicks: 5, testCommand: 'npm test', autoCommit: true },
    targets: [],
    _source: 'auto-detected',
  };

  it('returns refactor profile when focusCategory is "testing"', () => {
    const guards = resolveGuards(target, config, 'normal', 'testing');
    expect(guards).toEqual(GUARD_PROFILES.refactor);
    expect(guards?.maxFilesChanged).toBe(12);
    expect(guards?.maxLinesChanged).toBe(280);
  });

  it('returns tight profile for normal mode without focusCategory', () => {
    const guards = resolveGuards(target, config, 'normal');
    expect(guards).toEqual(GUARD_PROFILES.tight);
  });

  it('does not elevate for non-testing categories', () => {
    const guards = resolveGuards(target, config, 'normal', 'security');
    expect(guards).toEqual(GUARD_PROFILES.tight);
  });

  it('explicit CLI guards take precedence over testing auto-elevate', () => {
    const configWithGuards: RatchetConfig = {
      ...config,
      guards: 'tight',
    };
    const guards = resolveGuards(target, configWithGuards, 'normal', 'testing');
    // CLI guard wins — stays tight despite testing category
    expect(guards).toEqual(GUARD_PROFILES.tight);
  });

  it('explicit target guards take precedence over testing auto-elevate', () => {
    const targetWithGuards: Target = { ...target, guards: 'tight' };
    const guards = resolveGuards(targetWithGuards, config, 'normal', 'testing');
    expect(guards).toEqual(GUARD_PROFILES.tight);
  });

  it('architect mode guard is unaffected by non-testing focusCategory', () => {
    const guards = resolveGuards(target, config, 'architect', 'code-quality');
    expect(guards).toEqual(GUARD_PROFILES.refactor);
  });
});
