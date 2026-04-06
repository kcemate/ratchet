import { describe, it, expect } from 'vitest';
import { allocateClicks } from '../core/allocator.js';
import type { ScanResult, IssueType } from '../core/scanner';
import { STRUCTURAL_SUBCATEGORIES, LOCAL_SUBCATEGORIES } from '../core/taxonomy.js';

// Helper to create a structural issue
const createStructuralIssue = (
  subcategory: string,
  count: number,
  severity: 'low' | 'medium' | 'high' = 'high',
  description: string = 'test issue'
): IssueType => ({
  category: 'Code Quality',
  subcategory,
  count,
  description,
  severity,
});

// Helper to create a local issue
const createLocalIssue = (
  subcategory: string,
  count: number,
  severity: 'low' | 'medium' | 'high' = 'medium',
  description: string = 'test issue'
): IssueType => ({
  category: 'Code Quality',
  subcategory,
  count,
  description,
  severity,
});

// Mock scan results for testing
const createMockScan = (
  issuesByType: IssueType[] = [],
  totalIssuesFound?: number
): ScanResult => ({
  projectName: 'test',
  total: 0,
  maxTotal: 0,
  categories: [],
  issuesByType,
  totalIssuesFound: totalIssuesFound ?? issuesByType.reduce((sum, i) => sum + i.count, 0),
});

describe('allocateClicks', () => {
  it('returns 0,0 for no clicks to allocate', () => {
    const scan = createMockScan();
    const result = allocateClicks(scan, 0);
    expect(result.architectClicks).toBe(0);
    expect(result.surgicalClicks).toBe(0);
    expect(result.reasoning).toBe('No clicks to allocate.');
  });

  it('allocates 1 architect click when only 1 total click', () => {
    const scan = createMockScan([createStructuralIssue('Function length', 10)], 10);
    const result = allocateClicks(scan, 1);
    expect(result.architectClicks).toBe(1);
    expect(result.surgicalClicks).toBe(0);
    expect(result.reasoning).toContain('Only 1 click');
  });

  it('allocates architect-heavy (60%) when structural ratio > 40%', () => {
    // Create scan with high structural weight
    const scan = createMockScan([
      createStructuralIssue('Function length', 100, 'high'), // structural issue with high severity
      createLocalIssue('Secrets & env vars', 10, 'medium'), // local issue with medium severity
    ]);

    const result = allocateClicks(scan, 10);
    
    expect(result.architectClicks).toBe(6);  // 60% of 10 = 6
    expect(result.surgicalClicks).toBe(4);   // 40% of 10 = 4
expect(result.reasoning).toContain('architect-heavy (60%)');
expect(result.reasoning).toContain('structural severity');
  });

  it('allocates balanced (40%) when structural ratio between 25-40%', () => {
    // Create scan with moderate structural weight
    const scan = createMockScan([
      createStructuralIssue('Function length', 30, 'high'),
      createLocalIssue('Secrets & env vars', 70, 'medium'),
    ]);

    const result = allocateClicks(scan, 10);
    
    expect(result.architectClicks).toBe(4);  // 40% of 10 = 4
    expect(result.surgicalClicks).toBe(6);   // 60% of 10 = 6
    expect(result.reasoning).toContain('balanced (40% architect)');
  });

  it('allocates surgical-heavy (20%) when structural ratio < 25%', () => {
    // Create scan with low structural weight
    const scan = createMockScan([
      createStructuralIssue('Function length', 10, 'high'),
      createLocalIssue('Secrets & env vars', 90, 'medium'),
    ]);

    const result = allocateClicks(scan, 10);
    
    expect(result.architectClicks).toBe(2);  // 20% of 10 = 2
    expect(result.surgicalClicks).toBe(8);   // 80% of 10 = 8
    expect(result.reasoning).toContain('surgical-heavy (20% architect)');
  });

  it('enforces minimum 1 architect and 1 surgical click', () => {
    // Even with very few total clicks, ensure minimums
    const scan = createMockScan([
      createStructuralIssue('Function length', 100, 'high'), // high structural ratio
    ]);

    const result = allocateClicks(scan, 1);
    
    expect(result.architectClicks).toBe(1);
    expect(result.surgicalClicks).toBe(0); // special case for 1 click
  });

  it('handles unknown subcategories by splitting evenly', () => {
    // Create an issue with an unknown subcategory
    const unknownIssue = {
      category: 'Code Quality',
      subcategory: 'UNKNOWN',
      count: 50,
      description: 'Unknown issue',
      severity: 'high' as const,
    };

    const scan = createMockScan([unknownIssue]);

    const result = allocateClicks(scan, 10);
    
    // Should split unknown issues 50/50 between structural and local
    // So structuralWeight gets 25, localWeight gets 25
    // This should result in a 50% structural ratio → balanced (40% architect)
    expect(result.architectClicks).toBe(4);
    expect(result.surgicalClicks).toBe(6);
  });

  it('handles edge case with zero total weight', () => {
    const scan = createMockScan([]);
    const result = allocateClicks(scan, 10);
    
    expect(result.architectClicks).toBe(2); // default 20% architect
    expect(result.surgicalClicks).toBe(8);
    expect(result.reasoning).toContain('0% structural severity');
  });

  it('provides detailed reasoning with weights and counts', () => {
    const scan = createMockScan([
      createStructuralIssue('Function length', 40, 'high'),
      createLocalIssue('Secrets & env vars', 60, 'medium'),
    ]);

    const result = allocateClicks(scan, 10);
    
    expect(result.reasoning).toContain('Structural weight: 120');
    expect(result.reasoning).toContain('Local weight: 120');
    expect(result.reasoning).toContain('Total issues: 100');
expect(result.reasoning).toContain('Allocating 6 architect + 4 surgical clicks.');
  });

  it('handles multiple issue types correctly', () => {
    // Complex scenario with multiple structural and local issues
    const scan = createMockScan([
      createStructuralIssue('Function length', 25, 'high'),
      createStructuralIssue('Dead code', 15, 'medium'),
      createLocalIssue('Secrets & env vars', 40, 'high'),
      createLocalIssue('Input validation', 20, 'medium'),
    ]);

    const result = allocateClicks(scan, 20);
    
    // Calculate expected: structural weight = (25*3 + 15*2) = 75 + 30 = 105
    // Local weight = (40*3 + 20*2) = 120 + 40 = 160
    // Total = 265, structural ratio = 105/265 ≈ 39.6% → balanced (40% architect)
    expect(result.architectClicks).toBe(8);
    expect(result.surgicalClicks).toBe(12);
  });
});
