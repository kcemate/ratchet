import { describe, it, expect } from 'vitest';
import {
  parseScopeArg,
  isFileInScope,
  findFilesOutsideScope,
  allFilesInScope,
  validateScope,
  formatScopeForDisplay,
} from '../core/scope.js';

const CWD = '/project';

// ── parseScopeArg ─────────────────────────────────────────────────────────────

describe('parseScopeArg', () => {
  it('parses "diff"', () => {
    expect(parseScopeArg('diff')).toEqual({ type: 'diff' });
  });

  it('parses "branch"', () => {
    expect(parseScopeArg('branch')).toEqual({ type: 'branch' });
  });

  it('parses "staged"', () => {
    expect(parseScopeArg('staged')).toEqual({ type: 'staged' });
  });

  it('parses glob pattern', () => {
    expect(parseScopeArg('src/**/*.ts')).toEqual({ type: 'glob', pattern: 'src/**/*.ts' });
  });

  it('parses file: with single file', () => {
    expect(parseScopeArg('file:src/a.ts')).toEqual({ type: 'file', files: ['src/a.ts'] });
  });

  it('parses file: with multiple files', () => {
    expect(parseScopeArg('file:src/a.ts,src/b.ts')).toEqual({
      type: 'file',
      files: ['src/a.ts', 'src/b.ts'],
    });
  });

  it('trims whitespace from file list', () => {
    expect(parseScopeArg('file: src/a.ts , src/b.ts ')).toEqual({
      type: 'file',
      files: ['src/a.ts', 'src/b.ts'],
    });
  });

  it('handles empty file list', () => {
    expect(parseScopeArg('file:')).toEqual({ type: 'file', files: [] });
  });

  it('trims outer whitespace', () => {
    expect(parseScopeArg('  diff  ')).toEqual({ type: 'diff' });
  });
});

// ── isFileInScope ─────────────────────────────────────────────────────────────

describe('isFileInScope', () => {
  const scope = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/utils'];

  it('returns true for exact match', () => {
    expect(isFileInScope('/project/src/a.ts', scope, CWD)).toBe(true);
  });

  it('returns true for file nested under scoped directory', () => {
    expect(isFileInScope('/project/src/utils/helper.ts', scope, CWD)).toBe(true);
  });

  it('returns false for file outside scope', () => {
    expect(isFileInScope('/project/lib/c.ts', scope, CWD)).toBe(false);
  });

  it('returns true for empty scope (no restriction)', () => {
    expect(isFileInScope('/any/file.ts', [], CWD)).toBe(true);
  });

  it('resolves relative paths against cwd', () => {
    expect(isFileInScope('src/a.ts', scope, CWD)).toBe(true);
    expect(isFileInScope('lib/c.ts', scope, CWD)).toBe(false);
  });

  it('normalizes backslashes', () => {
    expect(isFileInScope('/project/src/a.ts', ['/project\\src\\a.ts'], CWD)).toBe(true);
  });

  it('does not match partial directory names', () => {
    // /project/src-extra should NOT match scope entry /project/src
    const narrowScope = ['/project/src'];
    expect(isFileInScope('/project/src-extra/file.ts', narrowScope, CWD)).toBe(false);
  });
});

// ── findFilesOutsideScope ─────────────────────────────────────────────────────

describe('findFilesOutsideScope', () => {
  const scope = ['/project/src/a.ts', '/project/src/b.ts'];

  it('returns empty when all files are in scope', () => {
    expect(findFilesOutsideScope(['/project/src/a.ts', '/project/src/b.ts'], scope, CWD)).toEqual([]);
  });

  it('returns files outside scope', () => {
    const files = ['/project/src/a.ts', '/project/lib/c.ts', '/project/src/b.ts'];
    expect(findFilesOutsideScope(files, scope, CWD)).toEqual(['/project/lib/c.ts']);
  });

  it('returns empty when scope is empty (no restriction)', () => {
    expect(findFilesOutsideScope(['/any/file.ts'], [], CWD)).toEqual([]);
  });
});

// ── allFilesInScope ───────────────────────────────────────────────────────────

describe('allFilesInScope', () => {
  const scope = ['/project/src/a.ts', '/project/src/b.ts'];

  it('returns true when all files are in scope', () => {
    expect(allFilesInScope(['/project/src/a.ts'], scope, CWD)).toBe(true);
  });

  it('returns false when any file is outside scope', () => {
    expect(allFilesInScope(['/project/src/a.ts', '/project/lib/c.ts'], scope, CWD)).toBe(false);
  });

  it('returns true for empty file list', () => {
    expect(allFilesInScope([], scope, CWD)).toBe(true);
  });

  it('returns true when scope is empty', () => {
    expect(allFilesInScope(['/any/file.ts'], [], CWD)).toBe(true);
  });
});

// ── validateScope ─────────────────────────────────────────────────────────────

describe('validateScope', () => {
  const scope = ['/project/src/a.ts', '/project/src/b.ts'];

  it('returns valid when all files are in scope', () => {
    const result = validateScope(['/project/src/a.ts'], scope, CWD);
    expect(result.valid).toBe(true);
    expect(result.scopeViolations).toEqual([]);
    expect(result.scopeFiles).toBe(scope);
  });

  it('returns invalid with violations listed', () => {
    const result = validateScope(['/project/src/a.ts', '/project/lib/c.ts'], scope, CWD);
    expect(result.valid).toBe(false);
    expect(result.scopeViolations).toEqual(['/project/lib/c.ts']);
  });

  it('handles empty modified files', () => {
    const result = validateScope([], scope, CWD);
    expect(result.valid).toBe(true);
    expect(result.scopeViolations).toEqual([]);
  });
});

// ── formatScopeForDisplay ─────────────────────────────────────────────────────

describe('formatScopeForDisplay', () => {
  it('returns "all files" when no scopeArg', () => {
    expect(formatScopeForDisplay(undefined, [], CWD)).toBe('all files');
  });

  it('shows "(no files matched)" when scopeFiles is empty', () => {
    expect(formatScopeForDisplay('nonexistent/**', [], CWD)).toBe('nonexistent/** (no files matched)');
  });

  it('shows relative file list', () => {
    const scopeFiles = ['/project/src/a.ts', '/project/src/b.ts'];
    expect(formatScopeForDisplay('diff', scopeFiles, CWD)).toBe('diff (src/a.ts, src/b.ts)');
  });

  it('truncates to 5 files and shows +N more', () => {
    const scopeFiles = [
      '/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts',
      '/project/src/d.ts', '/project/src/e.ts', '/project/src/f.ts',
    ];
    const result = formatScopeForDisplay('src/**', scopeFiles, CWD);
    expect(result).toBe('src/** (src/a.ts, src/b.ts, src/c.ts, src/d.ts, src/e.ts, +1 more)');
  });
});
