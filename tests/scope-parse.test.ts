import { describe, it, expect } from 'vitest';
import { parseScopeArg, type ScopeSpec, type ScopeType } from '../src/core/scope.js';
import { aggregateAndSortIssues } from '../src/core/scan-scorers.js';
import type { CategoryResult } from '../src/commands/scan.js';

// ── parseScopeArg ─────────────────────────────────────────────────────────────

describe('parseScopeArg — keywords', () => {
  it('parses "diff" keyword', () => {
    const result = parseScopeArg('diff');
    expect(result.type).toBe('diff');
    expect(result.pattern).toBeUndefined();
    expect(result.files).toBeUndefined();
    expect(typeof result.type).toBe('string');
  });

  it('parses "branch" keyword', () => {
    const result = parseScopeArg('branch');
    expect(result.type).toBe('branch');
    expect(result.pattern).toBeUndefined();
    expect(result.files).toBeUndefined();
    expect(typeof result.type).toBe('string');
  });

  it('parses "staged" keyword', () => {
    const result = parseScopeArg('staged');
    expect(result.type).toBe('staged');
    expect(result.pattern).toBeUndefined();
    expect(result.files).toBeUndefined();
    expect(typeof result.type).toBe('string');
  });

  it('trims whitespace from keywords', () => {
    const r1 = parseScopeArg('  diff  ');
    const r2 = parseScopeArg('  branch  ');
    const r3 = parseScopeArg('  staged  ');
    expect(r1.type).toBe('diff');
    expect(r2.type).toBe('branch');
    expect(r3.type).toBe('staged');
    expect(r1.pattern).toBeUndefined();
  });

  it('returns ScopeSpec with correct shape for all keywords', () => {
    const keywords: string[] = ['diff', 'branch', 'staged'];
    for (const kw of keywords) {
      const result = parseScopeArg(kw);
      expect('type' in result).toBe(true);
      expect(typeof result.type).toBe('string');
    }
  });
});

describe('parseScopeArg — file: prefix', () => {
  it('parses a single file with file: prefix', () => {
    const result = parseScopeArg('file:src/utils.ts');
    expect(result.type).toBe('file');
    expect(result.files).toHaveLength(1);
    expect(result.files).toContain('src/utils.ts');
    expect(result.pattern).toBeUndefined();
  });

  it('parses comma-separated files', () => {
    const result = parseScopeArg('file:src/a.ts,src/b.ts,src/c.ts');
    expect(result.type).toBe('file');
    expect(result.files).toHaveLength(3);
    expect(result.files).toContain('src/a.ts');
    expect(result.files).toContain('src/b.ts');
    expect(result.files).toContain('src/c.ts');
  });

  it('trims whitespace from individual file paths', () => {
    const result = parseScopeArg('file: src/a.ts , src/b.ts ');
    expect(result.type).toBe('file');
    expect(result.files).toContain('src/a.ts');
    expect(result.files).toContain('src/b.ts');
    expect(result.files?.every(f => f === f.trim())).toBe(true);
  });

  it('filters out empty entries from file list', () => {
    const result = parseScopeArg('file:src/a.ts,,src/b.ts');
    expect(result.type).toBe('file');
    expect(result.files).not.toContain('');
    expect(result.files?.length).toBeGreaterThanOrEqual(2);
  });

  it('parses a single file and has no pattern', () => {
    const result = parseScopeArg('file:README.md');
    expect(result.type).toBe('file');
    expect(result.pattern).toBeUndefined();
    expect(result.files).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
  });
});

describe('parseScopeArg — glob patterns', () => {
  it('treats non-keyword strings as glob patterns', () => {
    const result = parseScopeArg('src/**/*.ts');
    expect(result.type).toBe('glob');
    expect(result.pattern).toBe('src/**/*.ts');
    expect(result.files).toBeUndefined();
    expect(typeof result.pattern).toBe('string');
  });

  it('treats arbitrary paths as glob patterns', () => {
    const result = parseScopeArg('lib/**/*.js');
    expect(result.type).toBe('glob');
    expect(result.pattern).toBe('lib/**/*.js');
    expect(result.files).toBeUndefined();
  });

  it('treats single file paths without file: prefix as glob', () => {
    const result = parseScopeArg('src/utils.ts');
    expect(result.type).toBe('glob');
    expect(result.pattern).toBe('src/utils.ts');
    expect(result.files).toBeUndefined();
    expect(result.pattern?.length).toBeGreaterThan(0);
  });

  it('treats dotfile patterns as glob', () => {
    const result = parseScopeArg('./**/*.ts');
    expect(result.type).toBe('glob');
    expect(result.pattern).toBe('./**/*.ts');
    expect(result.files).toBeUndefined();
  });

  it('handles wildcards correctly as glob', () => {
    const result = parseScopeArg('**/*.test.ts');
    expect(result.type).toBe('glob');
    expect(result.pattern).toBe('**/*.test.ts');
    expect(result.pattern).toContain('*');
    expect(result.files).toBeUndefined();
  });
});

describe('parseScopeArg — return shape', () => {
  it('always returns an object with a type property', () => {
    const inputs = ['diff', 'branch', 'staged', 'src/**/*.ts', 'file:a.ts'];
    const VALID_TYPES: ScopeType[] = ['diff', 'branch', 'staged', 'glob', 'file'];
    for (const input of inputs) {
      const result = parseScopeArg(input);
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(VALID_TYPES).toContain(result.type);
    }
  });

  it('file type results always have a files array', () => {
    const result = parseScopeArg('file:a.ts,b.ts');
    expect(result.type).toBe('file');
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files!.length).toBeGreaterThan(0);
    expect(result.pattern).toBeUndefined();
  });

  it('glob type results always have a pattern string', () => {
    const result = parseScopeArg('src/**/*.ts');
    expect(result.type).toBe('glob');
    expect(typeof result.pattern).toBe('string');
    expect(result.pattern!.length).toBeGreaterThan(0);
    expect(result.files).toBeUndefined();
  });

  it('diff/branch/staged results have no extra fields', () => {
    for (const kw of ['diff', 'branch', 'staged']) {
      const result = parseScopeArg(kw);
      expect(result.pattern).toBeUndefined();
      expect(result.files).toBeUndefined();
    }
  });
});

// ── aggregateAndSortIssues ────────────────────────────────────────────────────

describe('aggregateAndSortIssues', () => {
  it('returns empty issues for categories with no problems', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Testing', emoji: '🧪', score: 25, max: 25, summary: '',
        subcategories: [
          { name: 'Coverage ratio', score: 8, max: 8, summary: '', issuesFound: 0, issuesDescription: 'no issues' },
        ],
      },
    ];
    const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(cats);
    expect(totalIssuesFound).toBe(0);
    expect(issuesByType).toHaveLength(0);
    expect(Array.isArray(issuesByType)).toBe(true);
    expect(typeof totalIssuesFound).toBe('number');
  });

  it('aggregates issues from a single category', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Testing', emoji: '🧪', score: 20, max: 25, summary: '',
        subcategories: [
          { name: 'Coverage ratio', score: 4, max: 8, summary: '', issuesFound: 3, issuesDescription: 'files without tests' },
        ],
      },
    ];
    const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(cats);
    expect(totalIssuesFound).toBe(3);
    expect(issuesByType).toHaveLength(1);
    expect(issuesByType[0]!.count).toBe(3);
    expect(issuesByType[0]!.description).toBe('files without tests');
  });

  it('sums issues across multiple subcategories', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Testing', emoji: '🧪', score: 15, max: 25, summary: '',
        subcategories: [
          { name: 'Coverage ratio', score: 4, max: 8, summary: '', issuesFound: 2, issuesDescription: 'missing tests' },
          { name: 'Edge case depth', score: 5, max: 9, summary: '', issuesFound: 1, issuesDescription: 'no edge cases' },
        ],
      },
    ];
    const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(cats);
    expect(totalIssuesFound).toBe(3);
    expect(issuesByType).toHaveLength(2);
    expect(issuesByType.map(i => i.count).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('sorts issues by severity (high before medium before low)', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Testing', emoji: '🧪', score: 0, max: 25, summary: '',
        subcategories: [
          { name: 'Edge case depth', score: 0, max: 9, summary: '', issuesFound: 1, issuesDescription: 'medium issue' },
          { name: 'Coverage ratio', score: 0, max: 8, summary: '', issuesFound: 1, issuesDescription: 'high issue' },
        ],
      },
    ];
    const { issuesByType } = aggregateAndSortIssues(cats);
    expect(issuesByType.length).toBeGreaterThan(0);
    // Coverage ratio is 'high', Edge case depth is 'medium'
    expect(issuesByType[0]!.severity).toBe('high');
    expect(issuesByType[1]!.severity).toBe('medium');
  });

  it('includes category and subcategory names in each issue', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Security', emoji: '🔒', score: 0, max: 15, summary: '',
        subcategories: [
          { name: 'Secrets & env vars', score: 0, max: 3, summary: '', issuesFound: 2, issuesDescription: 'secrets found' },
        ],
      },
    ];
    const { issuesByType } = aggregateAndSortIssues(cats);
    expect(issuesByType).toHaveLength(1);
    expect(issuesByType[0]!.category).toBe('Security');
    expect(issuesByType[0]!.subcategory).toBe('Secrets & env vars');
    expect(issuesByType[0]!.severity).toBe('high');
    expect(issuesByType[0]!.count).toBe(2);
  });

  it('skips subcategories with issuesFound = 0', () => {
    const cats: CategoryResult[] = [
      {
        name: 'Testing', emoji: '🧪', score: 25, max: 25, summary: '',
        subcategories: [
          { name: 'Coverage ratio', score: 8, max: 8, summary: '', issuesFound: 0, issuesDescription: 'no issues' },
          { name: 'Edge case depth', score: 9, max: 9, summary: '', issuesFound: 0, issuesDescription: '' },
        ],
      },
    ];
    const { totalIssuesFound, issuesByType } = aggregateAndSortIssues(cats);
    expect(totalIssuesFound).toBe(0);
    expect(issuesByType).toHaveLength(0);
    expect(issuesByType.every(i => i.count > 0)).toBe(true);
  });

  it('handles empty categories array', () => {
    const { totalIssuesFound, issuesByType } = aggregateAndSortIssues([]);
    expect(totalIssuesFound).toBe(0);
    expect(issuesByType).toHaveLength(0);
    expect(Array.isArray(issuesByType)).toBe(true);
    expect(typeof totalIssuesFound).toBe('number');
  });
});
