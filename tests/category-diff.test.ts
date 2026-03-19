/**
 * Category Diff Tests
 *
 * Verifies the diffCategories utility that computes per-category score
 * deltas between two scan results.
 */
import { describe, it, expect } from 'vitest';
import { diffCategories } from '../src/core/engine.js';
import type { ScanResult } from '../src/commands/scan.js';

function makeScan(categories: Array<{ name: string; score: number; max: number; issuesFound?: number }>): ScanResult {
  return {
    projectName: 'test',
    total: categories.reduce((s, c) => s + c.score, 0),
    maxTotal: categories.reduce((s, c) => s + c.max, 0),
    totalIssuesFound: categories.reduce((s, c) => s + (c.issuesFound ?? 0), 0),
    issuesByType: [],
    categories: categories.map(c => ({
      name: c.name,
      emoji: '',
      score: c.score,
      max: c.max,
      summary: '',
      subcategories: c.issuesFound !== undefined
        ? [{ name: 'sub', score: c.score, max: c.max, summary: '', issuesFound: c.issuesFound }]
        : [],
    })),
  };
}

describe('diffCategories', () => {
  it('returns empty array when both scans have no categories', () => {
    const scan = makeScan([]);
    expect(diffCategories(scan, scan)).toEqual([]);
  });

  it('returns delta=0 when scores are unchanged', () => {
    const before = makeScan([{ name: 'Testing', score: 10, max: 25, issuesFound: 3 }]);
    const after = makeScan([{ name: 'Testing', score: 10, max: 25, issuesFound: 3 }]);
    const result = diffCategories(before, after);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ category: 'Testing', before: 10, after: 10, delta: 0, issuesFixed: 0, wastedEffort: false });
  });

  it('detects positive score delta when score improves', () => {
    const before = makeScan([{ name: 'Testing', score: 10, max: 25, issuesFound: 5 }]);
    const after = makeScan([{ name: 'Testing', score: 15, max: 25, issuesFound: 2 }]);
    const [cd] = diffCategories(before, after);
    expect(cd.delta).toBe(5);
    expect(cd.issuesFixed).toBe(3);
    expect(cd.wastedEffort).toBe(false);
  });

  it('detects negative score delta when score regresses', () => {
    const before = makeScan([{ name: 'Testing', score: 15, max: 25, issuesFound: 2 }]);
    const after = makeScan([{ name: 'Testing', score: 10, max: 25, issuesFound: 5 }]);
    const [cd] = diffCategories(before, after);
    expect(cd.delta).toBe(-5);
    expect(cd.issuesFixed).toBe(0); // issues increased, not fixed
  });

  it('flags wastedEffort when issues fixed but category already maxed', () => {
    const before = makeScan([{ name: 'Type Safety', score: 15, max: 15, issuesFound: 8 }]);
    const after = makeScan([{ name: 'Type Safety', score: 15, max: 15, issuesFound: 0 }]);
    const [cd] = diffCategories(before, after);
    expect(cd.delta).toBe(0);
    expect(cd.issuesFixed).toBe(8);
    expect(cd.wastedEffort).toBe(true);
  });

  it('does NOT flag wastedEffort when no issues were fixed', () => {
    const before = makeScan([{ name: 'Type Safety', score: 15, max: 15, issuesFound: 0 }]);
    const after = makeScan([{ name: 'Type Safety', score: 15, max: 15, issuesFound: 0 }]);
    const [cd] = diffCategories(before, after);
    expect(cd.wastedEffort).toBe(false);
  });

  it('handles multiple categories independently', () => {
    const before = makeScan([
      { name: 'Testing', score: 10, max: 25, issuesFound: 5 },
      { name: 'Logging', score: 8, max: 15, issuesFound: 3 },
    ]);
    const after = makeScan([
      { name: 'Testing', score: 12, max: 25, issuesFound: 3 },
      { name: 'Logging', score: 10, max: 15, issuesFound: 1 },
    ]);
    const result = diffCategories(before, after);
    expect(result).toHaveLength(2);

    const testing = result.find(r => r.category === 'Testing')!;
    expect(testing.delta).toBe(2);
    expect(testing.issuesFixed).toBe(2);

    const logging = result.find(r => r.category === 'Logging')!;
    expect(logging.delta).toBe(2);
    expect(logging.issuesFixed).toBe(2);
  });

  it('includes category present only in before scan (score dropped to 0)', () => {
    const before = makeScan([{ name: 'Errors', score: 5, max: 10, issuesFound: 2 }]);
    const after = makeScan([]);
    const [cd] = diffCategories(before, after);
    expect(cd.category).toBe('Errors');
    expect(cd.before).toBe(5);
    expect(cd.after).toBe(0);
    expect(cd.delta).toBe(-5);
  });

  it('includes category present only in after scan', () => {
    const before = makeScan([]);
    const after = makeScan([{ name: 'Errors', score: 5, max: 10, issuesFound: 0 }]);
    const [cd] = diffCategories(before, after);
    expect(cd.category).toBe('Errors');
    expect(cd.before).toBe(0);
    expect(cd.after).toBe(5);
    expect(cd.delta).toBe(5);
  });

  it('uses max from before scan when available', () => {
    const before = makeScan([{ name: 'Testing', score: 10, max: 25, issuesFound: 0 }]);
    const after = makeScan([{ name: 'Testing', score: 20, max: 25, issuesFound: 0 }]);
    const [cd] = diffCategories(before, after);
    expect(cd.max).toBe(25);
  });
});
