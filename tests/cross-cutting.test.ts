import { describe, it, expect } from 'vitest';
import { classifyIssues, summarizeClassifications } from '../src/core/cross-cutting.js';
import type { IssueClassification } from '../src/core/cross-cutting.js';
import type { ScanResult } from '../src/commands/scan.js';
import type { ClickGuards } from '../src/types.js';

const DEFAULT_GUARDS: ClickGuards = { maxFilesChanged: 3, maxLinesChanged: 40 };

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test-project',
    total: 50,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 0,
    issuesByType: [],
    ...overrides,
  };
}

describe('classifyIssues', () => {
  it('returns empty array when no issues', () => {
    const result = makeScanResult();
    expect(classifyIssues(result, DEFAULT_GUARDS)).toEqual([]);
  });

  it('classifies issue with no locations as single-file (fileCount=0)', () => {
    const result = makeScanResult({
      issuesByType: [{
        category: 'Testing',
        subcategory: 'Coverage ratio',
        count: 5,
        description: 'source files without tests',
        severity: 'high',
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications).toHaveLength(1);
    expect(classifications[0]!.type).toBe('single-file');
    expect(classifications[0]!.fileCount).toBe(0);
  });

  it('classifies issue with few locations as single-file', () => {
    const result = makeScanResult({
      issuesByType: [{
        category: 'Code Quality',
        subcategory: 'Function length',
        count: 3,
        description: 'functions >50 lines',
        severity: 'medium',
        locations: ['src/a.ts', 'src/b.ts'],
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications[0]!.type).toBe('single-file');
    expect(classifications[0]!.fileCount).toBe(2);
  });

  it('classifies issue exceeding maxFilesChanged as cross-cutting', () => {
    const result = makeScanResult({
      issuesByType: [{
        category: 'Performance',
        subcategory: 'Console cleanup',
        count: 20,
        description: 'console.log calls',
        severity: 'low',
        locations: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications[0]!.type).toBe('cross-cutting');
    expect(classifications[0]!.fileCount).toBe(5);
    expect(classifications[0]!.recommendation).toContain('--guards refactor');
  });

  it('classifies Structured logging across many files as architectural', () => {
    const files = Array.from({ length: 14 }, (_, i) => `src/module${i}.ts`);
    const result = makeScanResult({
      issuesByType: [{
        category: 'Error Handling',
        subcategory: 'Structured logging',
        count: 36,
        description: 'no structured logger',
        severity: 'low',
        locations: files,
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications[0]!.type).toBe('architectural');
    expect(classifications[0]!.recommendation).toContain('--architect');
  });

  it('classifies Duplication across many files as architectural', () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/file${i}.ts`);
    const result = makeScanResult({
      issuesByType: [{
        category: 'Code Quality',
        subcategory: 'Duplication',
        count: 687,
        description: 'repeated code lines',
        severity: 'medium',
        locations: files,
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications[0]!.type).toBe('architectural');
    expect(classifications[0]!.recommendation).toContain('extract-then-propagate');
  });

  it('classifies Strict config as architectural when cross-cutting', () => {
    // Strict config affects the whole project — simulate many files
    const files = Array.from({ length: 10 }, (_, i) => `src/${i}.ts`);
    const result = makeScanResult({
      issuesByType: [{
        category: 'Type Safety',
        subcategory: 'Strict config',
        count: 1,
        description: 'missing strict TypeScript config',
        severity: 'medium',
        locations: files,
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications[0]!.type).toBe('architectural');
  });

  it('deduplicates file paths with line numbers in locations', () => {
    const result = makeScanResult({
      issuesByType: [{
        category: 'Error Handling',
        subcategory: 'Empty catches',
        count: 5,
        description: 'empty catch blocks',
        severity: 'high',
        // Same file appears with different line numbers
        locations: ['src/a.ts:10', 'src/a.ts:50', 'src/b.ts:20', 'src/c.ts:5', 'src/d.ts:1'],
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    // 4 unique files: a.ts, b.ts, c.ts, d.ts
    expect(classifications[0]!.fileCount).toBe(4);
    // maxFilesChanged=3, so 4 > 3 → cross-cutting
    expect(classifications[0]!.type).toBe('cross-cutting');
  });

  it('filters out issues with count=0', () => {
    const result = makeScanResult({
      issuesByType: [{
        category: 'Testing',
        subcategory: 'Edge case depth',
        count: 0,
        description: 'no edge case tests',
        severity: 'medium',
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications).toHaveLength(0);
  });

  it('respects custom guards maxFilesChanged', () => {
    const strictGuards: ClickGuards = { maxFilesChanged: 1, maxLinesChanged: 20 };
    const result = makeScanResult({
      issuesByType: [{
        category: 'Performance',
        subcategory: 'Console cleanup',
        count: 5,
        description: 'console.log calls',
        severity: 'low',
        locations: ['src/a.ts', 'src/b.ts'],
      }],
    });
    // With maxFilesChanged=1, 2 files → cross-cutting
    const classifications = classifyIssues(result, strictGuards);
    expect(classifications[0]!.type).toBe('cross-cutting');
    // With default maxFilesChanged=3, 2 files → single-file
    const classifications2 = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications2[0]!.type).toBe('single-file');
  });

  it('returns correct files array with deduplication', () => {
    const result = makeScanResult({
      issuesByType: [{
        category: 'Code Quality',
        subcategory: 'Function length',
        count: 4,
        description: 'functions >50 lines',
        severity: 'medium',
        locations: ['src/a.ts:10', 'src/a.ts:80', 'src/b.ts:5'],
      }],
    });
    const classifications = classifyIssues(result, DEFAULT_GUARDS);
    expect(classifications[0]!.files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('summarizeClassifications', () => {
  function makeClassification(type: IssueClassification['type'], subcategory = 'Test'): IssueClassification {
    return {
      category: 'Testing',
      subcategory,
      hitCount: 5,
      fileCount: type === 'single-file' ? 1 : 10,
      type,
      files: [],
      recommendation: type !== 'single-file' ? 'needs refactor' : undefined,
    };
  }

  it('separates into three groups', () => {
    const classifications = [
      makeClassification('single-file', 'Coverage ratio'),
      makeClassification('cross-cutting', 'Console cleanup'),
      makeClassification('architectural', 'Structured logging'),
    ];
    const summary = summarizeClassifications(classifications);
    expect(summary.singleFile).toHaveLength(1);
    expect(summary.crossCutting).toHaveLength(1);
    expect(summary.architectural).toHaveLength(1);
  });

  it('hasAnyCrossCutting is true when there are cross-cutting issues', () => {
    const summary = summarizeClassifications([makeClassification('cross-cutting')]);
    expect(summary.hasAnyCrossCutting).toBe(true);
  });

  it('hasAnyCrossCutting is true when there are architectural issues', () => {
    const summary = summarizeClassifications([makeClassification('architectural')]);
    expect(summary.hasAnyCrossCutting).toBe(true);
  });

  it('hasAnyCrossCutting is false when all issues are single-file', () => {
    const summary = summarizeClassifications([makeClassification('single-file')]);
    expect(summary.hasAnyCrossCutting).toBe(false);
  });

  it('recommends plan-first command when cross-cutting issues exist', () => {
    const summary = summarizeClassifications([makeClassification('cross-cutting')]);
    expect(summary.recommendedCommand).toContain('--plan-first');
    expect(summary.recommendedCommand).toContain('--guards refactor');
  });

  it('recommends simple command when only single-file issues', () => {
    const summary = summarizeClassifications([makeClassification('single-file')]);
    expect(summary.recommendedCommand).not.toContain('--plan-first');
    expect(summary.recommendedCommand).toContain('ratchet torque');
  });

  it('returns empty groups for empty input', () => {
    const summary = summarizeClassifications([]);
    expect(summary.crossCutting).toHaveLength(0);
    expect(summary.architectural).toHaveLength(0);
    expect(summary.singleFile).toHaveLength(0);
    expect(summary.hasAnyCrossCutting).toBe(false);
  });
});
