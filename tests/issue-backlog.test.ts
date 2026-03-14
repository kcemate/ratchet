import { describe, it, expect } from 'vitest';
import { buildBacklog, groupBacklogBySubcategory, formatIssuesForPrompt } from '../src/core/issue-backlog.js';
import type { ScanResult, CategoryResult } from '../src/commands/scan.js';
import type { IssueTask } from '../src/core/issue-backlog.js';

// Minimal mock ScanResult factory
function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  const categories: CategoryResult[] = [
    {
      name: 'Error Handling',
      emoji: '⚠️',
      score: 3,
      max: 14,
      summary: 'needs work',
      subcategories: [
        { name: 'Empty catches', score: 0, max: 5, summary: '6 empty catches', issuesFound: 6, issuesDescription: 'empty catch blocks' },
        { name: 'Coverage', score: 3, max: 5, summary: '3 try/catch', issuesFound: 2, issuesDescription: 'async functions without error handling' },
      ],
    },
    {
      name: 'Performance',
      emoji: '⚡',
      score: 9,
      max: 14,
      summary: 'ok',
      subcategories: [
        { name: 'Console cleanup', score: 2, max: 5, summary: '15 console.log', issuesFound: 15, issuesDescription: 'console.log calls in src' },
        { name: 'Async patterns', score: 5, max: 5, summary: 'clean', issuesFound: 0, issuesDescription: 'await-in-loop patterns' },
      ],
    },
  ];

  const issuesByType = [
    { category: 'Error Handling', subcategory: 'Empty catches', count: 6, description: 'empty catch blocks', severity: 'high' as const },
    { category: 'Error Handling', subcategory: 'Coverage', count: 2, description: 'async functions without error handling', severity: 'high' as const },
    { category: 'Performance', subcategory: 'Console cleanup', count: 15, description: 'console.log calls in src', severity: 'low' as const },
  ];

  return {
    projectName: 'test-project',
    total: 12,
    maxTotal: 28,
    categories,
    totalIssuesFound: 23,
    issuesByType,
    ...overrides,
  };
}

describe('buildBacklog', () => {
  it('returns tasks sorted by priority (highest first)', () => {
    const scan = makeScan();
    const backlog = buildBacklog(scan);

    expect(backlog.length).toBe(3);
    // All tasks should have priority >= 0
    for (const task of backlog) {
      expect(task.priority).toBeGreaterThanOrEqual(0);
    }
    // Should be sorted descending
    for (let i = 0; i < backlog.length - 1; i++) {
      expect(backlog[i]!.priority).toBeGreaterThanOrEqual(backlog[i + 1]!.priority);
    }
  });

  it('computes priority = severity_weight * count * gap_ratio', () => {
    const scan = makeScan();
    const backlog = buildBacklog(scan);

    const emptyCatches = backlog.find((t) => t.subcategory === 'Empty catches');
    expect(emptyCatches).toBeDefined();
    // severity=high (weight=3), count=6, gap_ratio=(5-0)/5=1.0
    expect(emptyCatches!.priority).toBeCloseTo(3 * 6 * 1.0, 5);
  });

  it('maps severity correctly', () => {
    const scan = makeScan();
    const backlog = buildBacklog(scan);

    const consoleCleaning = backlog.find((t) => t.subcategory === 'Console cleanup');
    expect(consoleCleaning).toBeDefined();
    expect(consoleCleaning!.severity).toBe('low');
    // severity=low (weight=1), count=15, gap_ratio=(5-2)/5=0.6
    expect(consoleCleaning!.priority).toBeCloseTo(1 * 15 * 0.6, 5);
  });

  it('returns empty array when no issues', () => {
    const scan = makeScan({
      issuesByType: [],
      totalIssuesFound: 0,
    });
    const backlog = buildBacklog(scan);
    expect(backlog).toHaveLength(0);
  });

  it('handles zero-max subcategory safely (no division by zero)', () => {
    const scan = makeScan();
    // Override to have a zero-max subcategory
    scan.categories[0]!.subcategories[0]!.max = 0;
    // Should not throw
    expect(() => buildBacklog(scan)).not.toThrow();
    const backlog = buildBacklog(scan);
    // Gap ratio defaults to 1 when max=0
    const task = backlog.find((t) => t.subcategory === 'Empty catches');
    expect(task).toBeDefined();
    expect(task!.priority).toBeCloseTo(3 * 6 * 1, 5);
  });

  it('includes all issue fields', () => {
    const scan = makeScan();
    const backlog = buildBacklog(scan);
    for (const task of backlog) {
      expect(task).toHaveProperty('category');
      expect(task).toHaveProperty('subcategory');
      expect(task).toHaveProperty('description');
      expect(task).toHaveProperty('count');
      expect(task).toHaveProperty('severity');
      expect(task).toHaveProperty('priority');
    }
  });
});

describe('groupBacklogBySubcategory', () => {
  it('groups tasks by subcategory key', () => {
    const tasks: IssueTask[] = [
      { category: 'A', subcategory: 'X', description: 'foo', count: 1, severity: 'high', priority: 10 },
      { category: 'A', subcategory: 'X', description: 'bar', count: 2, severity: 'medium', priority: 8 },
      { category: 'B', subcategory: 'Y', description: 'baz', count: 3, severity: 'low', priority: 3 },
    ];
    const groups = groupBacklogBySubcategory(tasks);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2); // A::X group
    expect(groups[1]).toHaveLength(1); // B::Y group
  });

  it('returns empty array for empty input', () => {
    expect(groupBacklogBySubcategory([])).toHaveLength(0);
  });

  it('treats same subcategory in different categories as different groups', () => {
    const tasks: IssueTask[] = [
      { category: 'A', subcategory: 'X', description: 'foo', count: 1, severity: 'high', priority: 10 },
      { category: 'B', subcategory: 'X', description: 'bar', count: 2, severity: 'high', priority: 9 },
    ];
    const groups = groupBacklogBySubcategory(tasks);
    expect(groups).toHaveLength(2);
  });
});

describe('formatIssuesForPrompt', () => {
  it('formats issue list for LLM consumption', () => {
    const tasks: IssueTask[] = [
      { category: 'Error Handling', subcategory: 'Empty catches', description: 'empty catch blocks', count: 6, severity: 'high', priority: 18 },
      { category: 'Performance', subcategory: 'Console cleanup', description: 'console.log calls', count: 15, severity: 'low', priority: 9 },
    ];
    const output = formatIssuesForPrompt(tasks);
    expect(output).toContain('[HIGH]');
    expect(output).toContain('6 empty catch blocks');
    expect(output).toContain('[LOW]');
    expect(output).toContain('15 console.log calls');
    expect(output).toContain('Error Handling > Empty catches');
  });

  it('returns empty string for empty list', () => {
    expect(formatIssuesForPrompt([])).toBe('');
  });
});
