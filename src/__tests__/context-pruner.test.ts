import { describe, it, expect } from 'vitest';
import { buildClickContext } from '../core/context-pruner.js';
import { diffScans, getIncrementalIssues } from '../core/scan-diff.js';
import type { ScanResult, IssueType } from '../commands/scan.js';
import type { IssueTask } from '../core/issue-backlog.js';

// Minimal ScanResult factory for tests
function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test',
    total: 70,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 5,
    issuesByType: [],
    ...overrides,
  };
}

function makeIssue(overrides: Partial<IssueType> = {}): IssueType {
  return {
    category: 'Code Quality',
    subcategory: 'console-log',
    count: 3,
    description: 'console.log statements',
    severity: 'low',
    ...overrides,
  };
}

function makeTask(overrides: Partial<IssueTask> = {}): IssueTask {
  return {
    category: 'Code Quality',
    subcategory: 'console-log',
    description: 'console.log statements',
    count: 3,
    severity: 'low',
    priority: 0.5,
    ...overrides,
  };
}

// ── buildClickContext ─────────────────────────────────────────────────────

describe('buildClickContext', () => {
  it('includes issue category and subcategory in output', () => {
    const scan = makeScan();
    const issues: IssueTask[] = [
      makeTask({ category: 'Code Quality', subcategory: 'console-log', count: 3 }),
    ];
    const { summary } = buildClickContext(scan, issues, '/cwd');
    expect(summary).toContain('Code Quality');
    expect(summary).toContain('console-log');
  });

  it('includes project score in output', () => {
    const scan = makeScan({ total: 72, maxTotal: 100 });
    const { summary } = buildClickContext(scan, [], '/cwd');
    expect(summary).toContain('72/100');
  });

  it('lists sweep files for targeted issues', () => {
    const scan = makeScan();
    const issues: IssueTask[] = [
      makeTask({
        sweepFiles: ['src/foo.ts', 'src/bar.ts', 'src/baz.ts'],
      }),
    ];
    const { summary } = buildClickContext(scan, issues, '/cwd');
    expect(summary).toContain('src/foo.ts');
    expect(summary).toContain('src/bar.ts');
  });

  it('maps sweep files to relevance 1.0', () => {
    const scan = makeScan();
    const issues: IssueTask[] = [
      makeTask({ sweepFiles: ['src/alpha.ts', 'src/beta.ts'] }),
    ];
    const { fileRelevanceMap } = buildClickContext(scan, issues, '/cwd');
    expect(fileRelevanceMap['src/alpha.ts']).toBe(1.0);
    expect(fileRelevanceMap['src/beta.ts']).toBe(1.0);
  });

  it('excludes files not referenced by target issues', () => {
    const scan = makeScan({
      issuesByType: [
        makeIssue({ subcategory: 'any-type', locations: ['src/unrelated.ts'] }),
      ],
    });
    const issues: IssueTask[] = [
      makeTask({ subcategory: 'console-log', sweepFiles: ['src/relevant.ts'] }),
    ];
    const { fileRelevanceMap } = buildClickContext(scan, issues, '/cwd');
    // src/unrelated.ts belongs to a different subcategory — not included
    expect(fileRelevanceMap['src/unrelated.ts']).toBeUndefined();
    expect(fileRelevanceMap['src/relevant.ts']).toBe(1.0);
  });

  it('picks up locations from scan issuesByType when subcategory matches', () => {
    const scan = makeScan({
      issuesByType: [
        makeIssue({
          subcategory: 'console-log',
          locations: ['src/from-scan.ts'],
        }),
      ],
    });
    const issues: IssueTask[] = [
      makeTask({ subcategory: 'console-log', sweepFiles: [] }),
    ];
    const { fileRelevanceMap } = buildClickContext(scan, issues, '/cwd');
    expect(fileRelevanceMap['src/from-scan.ts']).toBe(1.0);
  });

  it('truncates long sweep file lists with overflow message', () => {
    const manyFiles = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
    const scan = makeScan();
    const issues: IssueTask[] = [makeTask({ sweepFiles: manyFiles })];
    const { summary } = buildClickContext(scan, issues, '/cwd');
    expect(summary).toContain('5 more files');
  });
});

// ── diffScans ─────────────────────────────────────────────────────────────

describe('diffScans', () => {
  it('detects new issues that appear in after but not before', () => {
    const before = makeScan({ issuesByType: [], totalIssuesFound: 0 });
    const after = makeScan({
      issuesByType: [makeIssue({ subcategory: 'new-issue' })],
      totalIssuesFound: 3,
    });
    const diff = diffScans(before, after);
    expect(diff.newIssues).toHaveLength(1);
    expect(diff.newIssues[0].subcategory).toBe('new-issue');
    expect(diff.fixedIssues).toHaveLength(0);
    expect(diff.persistingIssues).toHaveLength(0);
  });

  it('detects fixed issues that were in before but gone in after', () => {
    const before = makeScan({
      issuesByType: [makeIssue({ subcategory: 'console-log' })],
      totalIssuesFound: 3,
    });
    const after = makeScan({ issuesByType: [], totalIssuesFound: 0 });
    const diff = diffScans(before, after);
    expect(diff.fixedIssues).toHaveLength(1);
    expect(diff.fixedIssues[0].subcategory).toBe('console-log');
    expect(diff.newIssues).toHaveLength(0);
  });

  it('classifies issues present in both scans as persisting', () => {
    const issue = makeIssue({ subcategory: 'empty-catch' });
    const before = makeScan({ issuesByType: [issue], totalIssuesFound: 2 });
    const after = makeScan({ issuesByType: [issue], totalIssuesFound: 2 });
    const diff = diffScans(before, after);
    expect(diff.persistingIssues).toHaveLength(1);
    expect(diff.newIssues).toHaveLength(0);
    expect(diff.fixedIssues).toHaveLength(0);
  });

  it('computes correct issueCountDelta', () => {
    const before = makeScan({ totalIssuesFound: 10 });
    const after = makeScan({ totalIssuesFound: 7 });
    const diff = diffScans(before, after);
    expect(diff.issueCountDelta).toBe(-3);
  });
});

// ── getIncrementalIssues ──────────────────────────────────────────────────

describe('getIncrementalIssues', () => {
  it('returns persisting + new issues, not fixed ones', () => {
    const persisting = makeIssue({ subcategory: 'any-type' });
    const fixed = makeIssue({ subcategory: 'console-log' });
    const newIssue = makeIssue({ subcategory: 'long-function' });

    const before = makeScan({ issuesByType: [persisting, fixed], totalIssuesFound: 5 });
    const after = makeScan({ issuesByType: [persisting, newIssue], totalIssuesFound: 4 });

    const result = getIncrementalIssues(before, after);
    const subcats = result.map(i => i.subcategory);
    expect(subcats).toContain('any-type');
    expect(subcats).toContain('long-function');
    expect(subcats).not.toContain('console-log');
  });

  it('returns empty array when all issues are fixed', () => {
    const before = makeScan({
      issuesByType: [makeIssue()],
      totalIssuesFound: 3,
    });
    const after = makeScan({ issuesByType: [], totalIssuesFound: 0 });
    expect(getIncrementalIssues(before, after)).toHaveLength(0);
  });
});
