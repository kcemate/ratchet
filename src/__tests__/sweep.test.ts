import { describe, it, expect } from 'vitest';
import { buildSweepPrompt } from '../../src/core/agents/shell.js';
import { chunk } from '../../src/core/engine.js';
import { buildBacklog } from '../../src/core/issue-backlog.js';
import type { ScanResult } from '../../src/core/scanner';

// --- buildSweepPrompt ---

describe('buildSweepPrompt', () => {
  it('includes the issue description in the prompt', () => {
    const prompt = buildSweepPrompt('console.log calls in src', ['src/a.ts', 'src/b.ts']);
    expect(prompt).toContain('console.log calls in src');
  });

  it('lists all file paths in the prompt', () => {
    const files = ['src/foo.ts', 'src/bar.ts', 'src/baz.ts'];
    const prompt = buildSweepPrompt('empty catch blocks', files);
    for (const f of files) {
      expect(prompt).toContain(f);
    }
  });

  it('includes MODIFIED: output instruction', () => {
    const prompt = buildSweepPrompt('any types', ['src/x.ts']);
    expect(prompt).toContain('MODIFIED:');
  });

  it('includes constraint about not modifying unlisted files', () => {
    const prompt = buildSweepPrompt('any types', ['src/x.ts']);
    // Should mention only touching listed files
    expect(prompt.toLowerCase()).toMatch(/only|listed|listed files|touch/);
  });

  it('handles an empty file list gracefully', () => {
    const prompt = buildSweepPrompt('console.log calls in src', []);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// --- chunk (batch splitting) ---

describe('chunk', () => {
  it('splits an array into batches of the given size', () => {
    const result = chunk([1, 2, 3, 4, 5, 6, 7], 3);
    expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('returns a single batch when array is smaller than batch size', () => {
    const result = chunk(['a', 'b'], 5);
    expect(result).toEqual([['a', 'b']]);
  });

  it('returns empty array for empty input', () => {
    const result = chunk([], 6);
    expect(result).toEqual([]);
  });

  it('returns batches of the exact size when evenly divisible', () => {
    const result = chunk([1, 2, 3, 4], 2);
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('handles batch size of 1', () => {
    const result = chunk(['x', 'y', 'z'], 1);
    expect(result).toEqual([['x'], ['y'], ['z']]);
  });
});

// --- location tracking in buildBacklog ---

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test',
    total: 50,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 0,
    issuesByType: [],
    ...overrides,
  };
}

describe('buildBacklog — location tracking', () => {
  it('passes locations from IssueType into IssueTask sweepFiles', () => {
    const scan = makeScanResult({
      categories: [
        {
          name: 'Performance',
          emoji: '⚡',
          score: 3,
          max: 14,
          summary: 'test',
          subcategories: [
            {
              name: 'Console cleanup',
              score: 2,
              max: 5,
              summary: '5 console.log calls',
              issuesFound: 5,
              issuesDescription: 'console.log calls in src',
            },
          ],
        },
      ],
      totalIssuesFound: 5,
      issuesByType: [
        {
          category: 'Performance',
          subcategory: 'Console cleanup',
          count: 5,
          description: 'console.log calls in src',
          severity: 'low',
          locations: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        },
      ],
    });

    const backlog = buildBacklog(scan);
    expect(backlog).toHaveLength(1);
    expect(backlog[0]!.sweepFiles).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('sets sweepFiles to empty array when no locations provided', () => {
    const scan = makeScanResult({
      categories: [
        {
          name: 'Error Handling',
          emoji: '⚠️ ',
          score: 2,
          max: 14,
          summary: 'test',
          subcategories: [
            {
              name: 'Empty catches',
              score: 2,
              max: 5,
              summary: '3 empty catches',
              issuesFound: 3,
              issuesDescription: 'empty catch blocks',
            },
          ],
        },
      ],
      totalIssuesFound: 3,
      issuesByType: [
        {
          category: 'Error Handling',
          subcategory: 'Empty catches',
          count: 3,
          description: 'empty catch blocks',
          severity: 'high',
          // No locations field
        },
      ],
    });

    const backlog = buildBacklog(scan);
    expect(backlog).toHaveLength(1);
    expect(backlog[0]!.sweepFiles).toEqual([]);
  });

  it('preserves all locations from IssueType', () => {
    const locations = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];
    const scan = makeScanResult({
      categories: [
        {
          name: 'Code Quality',
          emoji: '📖',
          score: 2,
          max: 24,
          summary: 'test',
          subcategories: [
            {
              name: 'Function length',
              score: 2,
              max: 6,
              summary: '5 long functions',
              issuesFound: 5,
              issuesDescription: 'functions >50 lines',
            },
          ],
        },
      ],
      totalIssuesFound: 5,
      issuesByType: [
        {
          category: 'Code Quality',
          subcategory: 'Function length',
          count: 5,
          description: 'functions >50 lines',
          severity: 'medium',
          locations,
        },
      ],
    });

    const backlog = buildBacklog(scan);
    expect(backlog[0]!.sweepFiles).toHaveLength(5);
    expect(backlog[0]!.sweepFiles).toEqual(locations);
  });
});
