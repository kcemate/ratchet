import { describe, it, expect } from 'vitest';
import {
  classifyIssues,
  summarizeClassifications,
  type IssueClassification,
} from '../core/cross-cutting.js';
import type { ScanResult, IssueType } from '../core/scanner';
import type { ClickGuards } from '../types.js';

const defaultGuards: ClickGuards = {
  maxFilesChanged: 3,
  maxLinesChanged: 200,
};

const makeIssue = (overrides: Partial<IssueType>): IssueType => ({
  category: 'Testing',
  subcategory: 'Coverage ratio',
  count: 1,
  description: 'low coverage',
  severity: 'low',
  locations: [],
  ...overrides,
});

const makeScanResult = (issues: IssueType[]): ScanResult =>
  ({
    total: 50,
    totalIssuesFound: 10,
    categories: [],
    issuesByType: issues,
  }) as unknown as ScanResult;

describe('classifyIssues — single-file issues', () => {
  it('flags as single-file when hitCount is zero', () => {
    const scan = makeScanResult([makeIssue({ count: 0, locations: ['src/a.ts'] })] as any);
    const results = classifyIssues(scan, defaultGuards);
    expect(results).toHaveLength(0); // filtered out when count === 0
  });

  it('flags as single-file when fileCount <= maxFilesChanged', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Console cleanup',
        count: 3,
        locations: ['src/a.ts', 'src/b.ts'],
        severity: 'low',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('single-file');
    expect(results[0].files).toContain('src/a.ts');
  });

  it('flags as single-file when exactly at maxFilesChanged boundary', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Empty catches',
        count: 5,
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        severity: 'medium',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    // Exactly at boundary = not cross-cutting (fileCount > guards.maxFilesChanged triggers cross-cutting)
    expect(results[0].type).toBe('single-file');
  });

  it('includes all file locations', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Dead code',
        locations: ['src/a.ts:10', 'src/b.ts:20', 'src/c.ts:30'],
        severity: 'low',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].files).toHaveLength(3);
    expect(results[0].files).toContain('src/a.ts');
  });

  it('deduplicates file locations', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Dead code',
        locations: ['src/a.ts:10', 'src/a.ts:20', 'src/b.ts'],
        severity: 'low',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    // After deduplication should be 2 files
    expect(results[0].files).toHaveLength(2);
    expect(results[0].files).toContain('src/a.ts');
    expect(results[0].files).toContain('src/b.ts');
  });

  it('strips line numbers from file paths', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Dead code',
        locations: ['src/a.ts:42', 'src/b.ts:99'],
        severity: 'low',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].files[0]).toBe('src/a.ts');
    expect(results[0].files[1]).toBe('src/b.ts');
  });
});

describe('classifyIssues — cross-cutting issues', () => {
  it('flags as cross-cutting when fileCount > maxFilesChanged', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Empty catches',
        count: 10,
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        severity: 'medium',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].type).toBe('cross-cutting');
  });

  it('flags as cross-cutting with recommendation', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Empty catches',
        count: 20,
        locations: Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`),
        severity: 'medium',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].recommendation).toContain('--guards refactor');
  });
});

describe('classifyIssues — architectural issues', () => {
  it('flags cross-cutting Structured logging as architectural (needs many files)', () => {
    // Architectural subcategories only get that classification when fileCount > maxFilesChanged
    const scan = makeScanResult([
      makeIssue({
        category: 'Error Handling',
        subcategory: 'Structured logging',
        count: 15,
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        severity: 'high',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].type).toBe('architectural');
    expect(results[0].recommendation).toContain('--guards refactor');
  });

  it('flags cross-cutting Duplication as architectural', () => {
    const scan = makeScanResult([
      makeIssue({
        category: 'Code Quality',
        subcategory: 'Duplication',
        count: 12,
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        severity: 'high',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].type).toBe('architectural');
    expect(results[0].recommendation).toContain('extract-then-propagate');
  });

  it('flags cross-cutting Strict config as architectural', () => {
    const scan = makeScanResult([
      makeIssue({
        category: 'Type Safety',
        subcategory: 'Strict config',
        count: 3,
        locations: ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.test.json'],
        severity: 'medium',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].type).toBe('architectural');
  });

  it('single-file Structured logging is single-file (not architectural) when fileCount <= maxFilesChanged', () => {
    // Even architectural subcategories are single-file if not cross-cutting
    const scan = makeScanResult([
      makeIssue({
        category: 'Error Handling',
        subcategory: 'Structured logging',
        count: 5,
        locations: ['src/logger.ts'],
        severity: 'high',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].type).toBe('single-file');
    expect(results[0].recommendation).toBeUndefined();
  });

  it('flags cross-cutting Structured logging as architectural', () => {
    const scan = makeScanResult([
      makeIssue({
        category: 'Error Handling',
        subcategory: 'Structured logging',
        count: 20,
        locations: Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`),
        severity: 'high',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].type).toBe('architectural');
  });
});

describe('classifyIssues — guard-sensitive classification', () => {
  it('same issue is single-file with tight guards, cross-cutting with loose guards', () => {
    const issue = makeIssue({
      subcategory: 'Console cleanup',
      count: 5,
      locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'],
      severity: 'low',
    });
    const scan = makeScanResult([issue]);

    const tight = classifyIssues(scan, { maxFilesChanged: 3, maxLinesChanged: 200 });
    expect(tight[0].type).toBe('cross-cutting');

    const loose = classifyIssues(scan, { maxFilesChanged: 10, maxLinesChanged: 500 });
    expect(loose[0].type).toBe('single-file');
  });

  it('zero maxFilesChanged means everything is cross-cutting', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Console cleanup',
        locations: ['src/a.ts'],
        severity: 'low',
      }),
    ]);
    const results = classifyIssues(scan, { maxFilesChanged: 0, maxLinesChanged: 200 });
    expect(results[0].type).toBe('cross-cutting');
  });
});

describe('classifyIssues — hitCount and fileCount metadata', () => {
  it('captures hitCount and fileCount', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Empty catches',
        count: 7,
        locations: ['src/a.ts', 'src/b.ts'],
        severity: 'medium',
      }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].hitCount).toBe(7);
    expect(results[0].fileCount).toBe(2);
  });

  it('preserves category and subcategory', () => {
    const scan = makeScanResult([
      makeIssue({ category: 'Security', subcategory: 'Secrets & env vars', severity: 'high' }),
    ]);
    const results = classifyIssues(scan, defaultGuards);
    expect(results[0].category).toBe('Security');
    expect(results[0].subcategory).toBe('Secrets & env vars');
  });
});

describe('summarizeClassifications', () => {
  it('returns empty arrays when no issues', () => {
    const scan = makeScanResult([]);
    const classifications = classifyIssues(scan, defaultGuards);
    const summary = summarizeClassifications(classifications);
    expect(summary.crossCutting).toHaveLength(0);
    expect(summary.architectural).toHaveLength(0);
    expect(summary.singleFile).toHaveLength(0);
    expect(summary.hasAnyCrossCutting).toBe(false);
  });

  it('categorizes single-file issues correctly', () => {
    const scan = makeScanResult([
      makeIssue({ subcategory: 'Console cleanup', locations: ['src/a.ts'], severity: 'low' }),
    ]);
    const classifications = classifyIssues(scan, defaultGuards);
    const summary = summarizeClassifications(classifications);
    expect(summary.singleFile).toHaveLength(1);
    expect(summary.hasAnyCrossCutting).toBe(false);
  });

  it('categorizes cross-cutting issues correctly', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Empty catches',
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        severity: 'medium',
      }),
    ]);
    const classifications = classifyIssues(scan, defaultGuards);
    const summary = summarizeClassifications(classifications);
    expect(summary.crossCutting).toHaveLength(1);
    expect(summary.hasAnyCrossCutting).toBe(true);
  });

  it('categorizes cross-cutting architectural issues correctly', () => {
    const scan = makeScanResult([
      makeIssue({
        category: 'Error Handling',
        subcategory: 'Structured logging',
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        severity: 'high',
      }),
    ]);
    const classifications = classifyIssues(scan, defaultGuards);
    const summary = summarizeClassifications(classifications);
    expect(summary.architectural).toHaveLength(1);
    expect(summary.hasAnyCrossCutting).toBe(true);
  });

  it('recommends torque --plan-first --guards refactor when cross-cutting detected', () => {
    const scan = makeScanResult([
      makeIssue({
        subcategory: 'Empty catches',
        locations: Array.from({ length: 5 }, (_, i) => `src/f${i}.ts`),
        severity: 'medium',
      }),
    ]);
    const classifications = classifyIssues(scan, defaultGuards);
    const summary = summarizeClassifications(classifications);
    expect(summary.recommendedCommand).toContain('ratchet torque');
    expect(summary.recommendedCommand).toContain('--plan-first');
    expect(summary.recommendedCommand).toContain('--guards refactor');
  });

  it('recommends simple torque when only single-file issues', () => {
    const scan = makeScanResult([
      makeIssue({ subcategory: 'Console cleanup', locations: ['src/a.ts'], severity: 'low' }),
    ]);
    const classifications = classifyIssues(scan, defaultGuards);
    const summary = summarizeClassifications(classifications);
    expect(summary.recommendedCommand).toBe('ratchet torque -c 5');
  });

  it('hasAnyCrossCutting is true when architectural issues exist (requires cross-cutting)', () => {
    const scan = makeScanResult([
      makeIssue({
        category: 'Code Quality',
        subcategory: 'Duplication',
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        severity: 'high',
      }),
    ]);
    const classifications = classifyIssues(scan, defaultGuards);
    const summary = summarizeClassifications(classifications);
    expect(summary.hasAnyCrossCutting).toBe(true);
  });

  it('mixed issues — single-file + cross-cutting + architectural', () => {
    const scan = makeScanResult([
      makeIssue({ subcategory: 'Console cleanup', locations: ['src/a.ts'], severity: 'low' }),
      makeIssue({
        subcategory: 'Empty catches',
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        severity: 'medium',
      }),
      makeIssue({
        category: 'Code Quality',
        subcategory: 'Duplication',
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        severity: 'high',
      }),
    ]);
    const classifications = classifyIssues(scan, defaultGuards);
    const summary = summarizeClassifications(classifications);
    expect(summary.singleFile).toHaveLength(1);
    expect(summary.crossCutting).toHaveLength(1);
    expect(summary.architectural).toHaveLength(1);
    expect(summary.hasAnyCrossCutting).toBe(true);
    expect(summary.recommendedCommand).toContain('--plan-first');
  });
});
