import { describe, it, expect } from 'vitest';
import { allocateClicks } from '../src/core/allocator.js';
import type { ClickAllocation } from '../src/core/allocator.js';
import type { ScanResult } from '../src/commands/scan.js';

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test',
    total: 70,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 0,
    issuesByType: [],
    ...overrides,
  };
}

describe('allocateClicks', () => {
  it('returns 0/0 for totalClicks=0', () => {
    const result = allocateClicks(makeScan(), 0);
    expect(result.architectClicks).toBe(0);
    expect(result.surgicalClicks).toBe(0);
  });

  it('returns 1/0 for totalClicks=1', () => {
    const result = allocateClicks(makeScan(), 1);
    expect(result.architectClicks).toBe(1);
    expect(result.surgicalClicks).toBe(0);
  });

  it('always has at least 1 architect and 1 surgical click when totalClicks >= 2', () => {
    const scans = [
      makeScan(), // no issues
      makeScan({
        totalIssuesFound: 10,
        issuesByType: [
          { category: 'Quality', subcategory: 'Console cleanup', count: 10, description: 'console.log calls', severity: 'low' },
        ],
      }),
      makeScan({
        totalIssuesFound: 5,
        issuesByType: [
          { category: 'Quality', subcategory: 'Duplication', count: 5, description: 'duplicated blocks', severity: 'high' },
        ],
      }),
    ];

    for (const scan of scans) {
      for (const clicks of [2, 4, 5, 10, 20]) {
        const result = allocateClicks(scan, clicks);
        expect(result.architectClicks).toBeGreaterThanOrEqual(1);
        expect(result.surgicalClicks).toBeGreaterThanOrEqual(1);
        expect(result.architectClicks + result.surgicalClicks).toBe(clicks);
      }
    }
  });

  it('gives architect 60% when structural issues > 40% of weighted severity', () => {
    const scan = makeScan({
      totalIssuesFound: 10,
      issuesByType: [
        // Structural: Duplication (high=3) × 5 = 15 weight
        { category: 'Quality', subcategory: 'Duplication', count: 5, description: 'dup', severity: 'high' },
        // Local: Console cleanup (low=1) × 2 = 2 weight
        { category: 'Quality', subcategory: 'Console cleanup', count: 2, description: 'logs', severity: 'low' },
      ],
    });
    // structural = 15, local = 2, total = 17, ratio = ~0.88 → > 0.4 → 60%
    const result = allocateClicks(scan, 10);
    expect(result.architectClicks).toBe(6);
    expect(result.surgicalClicks).toBe(4);
    expect(result.reasoning).toContain('architect');
  });

  it('gives architect 40% when structural issues 25-40% of weighted severity', () => {
    const scan = makeScan({
      totalIssuesFound: 10,
      issuesByType: [
        // Structural: Function length (medium=2) × 4 = 8 weight
        { category: 'Quality', subcategory: 'Function length', count: 4, description: 'long fns', severity: 'medium' },
        // Local: Any type (medium=2) × 8 = 16 weight
        { category: 'Quality', subcategory: 'Any type count', count: 8, description: 'any types', severity: 'medium' },
      ],
    });
    // structural = 8, local = 16, total = 24, ratio = 0.33 → 25-40% → 40%
    const result = allocateClicks(scan, 10);
    expect(result.architectClicks).toBe(4);
    expect(result.surgicalClicks).toBe(6);
    expect(result.reasoning).toContain('balanced');
  });

  it('gives architect 20% when structural issues < 25% of weighted severity', () => {
    const scan = makeScan({
      totalIssuesFound: 20,
      issuesByType: [
        // Structural: Dead code (low=1) × 2 = 2 weight
        { category: 'Quality', subcategory: 'Dead code', count: 2, description: 'dead code', severity: 'low' },
        // Local: Console cleanup (low=1) × 20 = 20 weight
        { category: 'Quality', subcategory: 'Console cleanup', count: 20, description: 'logs', severity: 'low' },
      ],
    });
    // structural = 2, local = 20, total = 22, ratio = ~0.09 → < 25% → 20%
    const result = allocateClicks(scan, 10);
    expect(result.architectClicks).toBe(2);
    expect(result.surgicalClicks).toBe(8);
    expect(result.reasoning).toContain('surgical-heavy');
  });

  it('includes reasoning string', () => {
    const result = allocateClicks(makeScan({ totalIssuesFound: 5 }), 8);
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it('sums to totalClicks for various inputs', () => {
    const scan = makeScan({
      totalIssuesFound: 15,
      issuesByType: [
        { category: 'Q', subcategory: 'Duplication', count: 3, description: 'd', severity: 'high' },
        { category: 'Q', subcategory: 'Any type count', count: 12, description: 'a', severity: 'medium' },
      ],
    });
    for (const n of [2, 3, 5, 7, 10, 13, 20, 50]) {
      const r = allocateClicks(scan, n);
      expect(r.architectClicks + r.surgicalClicks).toBe(n);
    }
  });

  it('handles empty issuesByType gracefully', () => {
    const scan = makeScan({ issuesByType: [], totalIssuesFound: 0 });
    const result = allocateClicks(scan, 6);
    // structuralRatio = 0 → 20% architect
    expect(result.architectClicks).toBeGreaterThanOrEqual(1);
    expect(result.surgicalClicks).toBeGreaterThanOrEqual(1);
    expect(result.architectClicks + result.surgicalClicks).toBe(6);
  });

  it('result shape matches ClickAllocation interface', () => {
    const result: ClickAllocation = allocateClicks(makeScan(), 4);
    expect(typeof result.architectClicks).toBe('number');
    expect(typeof result.surgicalClicks).toBe('number');
    expect(typeof result.reasoning).toBe('string');
  });
});
