/**
 * Deep coverage of scan-constants utility functions:
 * countMatchesWithLocations, scoreStrictConfig, and edge cases.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  countMatchesWithLocations,
  countMatches,
  countMatchesWithFiles,
  anyFileHasMatch,
  scoreStrictConfig,
} from '../src/core/scan-constants.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-cst-'));
}

// ── countMatchesWithLocations ─────────────────────────────────────────────────

describe('countMatchesWithLocations', () => {
  it('returns count=0 and empty locations for no files', () => {
    const { count, locations } = countMatchesWithLocations([], new Map(), /foo/g);
    expect(count).toBe(0);
    expect(locations).toHaveLength(0);
    expect(Array.isArray(locations)).toBe(true);
    expect(typeof count).toBe('number');
  });

  it('reports count and file:line for a single match', () => {
    const contents = new Map([['src/a.ts', 'line1\nfoo here\nline3']]);
    const { count, locations } = countMatchesWithLocations(['src/a.ts'], contents, /foo/g);
    expect(count).toBe(1);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toContain('src/a.ts');
    expect(locations[0]).toContain(':2');
  });

  it('reports multiple matches across lines in one file', () => {
    const src = 'foo\nbar\nfoo\nbaz\nfoo';
    const contents = new Map([['a.ts', src]]);
    const { count, locations } = countMatchesWithLocations(['a.ts'], contents, /foo/g);
    expect(count).toBe(3);
    expect(locations).toHaveLength(3);
    expect(locations[0]).toContain(':1');
    expect(locations[1]).toContain(':3');
    expect(locations[2]).toContain(':5');
  });

  it('reports matches across multiple files with correct file paths', () => {
    const contents = new Map([
      ['a.ts', 'target'],
      ['b.ts', 'other\ntarget'],
      ['c.ts', 'nothing'],
    ]);
    const { count, locations } = countMatchesWithLocations(['a.ts', 'b.ts', 'c.ts'], contents, /target/g);
    expect(count).toBe(2);
    expect(locations).toHaveLength(2);
    expect(locations.some(l => l.startsWith('a.ts'))).toBe(true);
    expect(locations.some(l => l.startsWith('b.ts'))).toBe(true);
    expect(locations.every(l => !l.startsWith('c.ts'))).toBe(true);
  });

  it('locations are in file:lineNumber format', () => {
    const contents = new Map([['src/utils.ts', 'const x = 1;\nconst y = 2;\nconst z = 3;']]);
    const { count, locations } = countMatchesWithLocations(['src/utils.ts'], contents, /const/g);
    expect(count).toBe(3);
    expect(locations).toHaveLength(3);
    for (const loc of locations) {
      expect(loc).toMatch(/:.+$/);
      expect(loc).toContain('src/utils.ts');
    }
  });

  it('uses empty string for files missing from contents map', () => {
    const { count, locations } = countMatchesWithLocations(['missing.ts'], new Map(), /foo/g);
    expect(count).toBe(0);
    expect(locations).toHaveLength(0);
    expect(Array.isArray(locations)).toBe(true);
  });

  it('handles multi-line source correctly with line numbers', () => {
    const src = Array.from({ length: 10 }, (_, i) => i % 3 === 0 ? 'match' : 'no').join('\n');
    const contents = new Map([['f.ts', src]]);
    const { count, locations } = countMatchesWithLocations(['f.ts'], contents, /match/g);
    expect(count).toBeGreaterThan(0);
    expect(locations.length).toBe(count);
    for (const loc of locations) {
      const lineNum = parseInt(loc.split(':').pop()!, 10);
      expect(lineNum).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(lineNum)).toBe(true);
    }
  });

  it('strips comments when contextAware is true', () => {
    const contents = new Map([['a.ts', '// secret = "abc"\nconst x = 1;']]);
    const { count, locations } = countMatchesWithLocations(['a.ts'], contents, /secret/g, true);
    expect(count).toBe(0);
    expect(locations).toHaveLength(0);
    expect(Array.isArray(locations)).toBe(true);
  });

  it('counts raw content when contextAware is false', () => {
    const contents = new Map([['a.ts', '// foo\nfoo']]);
    const { count, locations } = countMatchesWithLocations(['a.ts'], contents, /foo/g, false);
    expect(count).toBe(2);
    expect(locations).toHaveLength(2);
    expect(locations[0]).toContain(':1');
    expect(locations[1]).toContain(':2');
  });
});

// ── scoreStrictConfig ─────────────────────────────────────────────────────────

describe('scoreStrictConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns score 7 for strict: true tsconfig', () => {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true },
    }));
    const { score, summary } = scoreStrictConfig(dir);
    expect(score).toBe(7);
    expect(summary).toBe('strict mode enabled');
    expect(typeof score).toBe('number');
    expect(typeof summary).toBe('string');
  });

  it('returns score 5 for noImplicitAny + strictNullChecks without strict', () => {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { noImplicitAny: true, strictNullChecks: true },
    }));
    const { score, summary } = scoreStrictConfig(dir);
    expect(score).toBe(5);
    expect(summary).toBe('noImplicitAny + strictNullChecks');
    expect(score).toBeLessThan(7);
    expect(score).toBeGreaterThan(1);
  });

  it('returns score 3 for noImplicitAny only', () => {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { noImplicitAny: true },
    }));
    const { score, summary } = scoreStrictConfig(dir);
    expect(score).toBe(3);
    expect(summary).toBe('noImplicitAny');
    expect(score).toBeLessThan(5);
    expect(score).toBeGreaterThan(1);
  });

  it('returns score 1 when no strict flags are set', () => {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020' },
    }));
    const { score, summary } = scoreStrictConfig(dir);
    expect(score).toBe(1);
    expect(summary).toContain('TypeScript');
    expect(score).toBeLessThan(3);
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it('returns score 1 when no tsconfig exists', () => {
    const { score, summary } = scoreStrictConfig(dir);
    expect(score).toBe(1);
    expect(summary).toContain('no tsconfig');
    expect(score).toBeLessThan(7);
    expect(typeof summary).toBe('string');
  });

  it('returns score 1 for malformed tsconfig JSON', () => {
    writeFileSync(join(dir, 'tsconfig.json'), '{ invalid json }');
    const { score, summary } = scoreStrictConfig(dir);
    expect(score).toBe(1);
    expect(summary).toContain('parse error');
    expect(score).toBeLessThan(7);
    expect(typeof summary).toBe('string');
  });

  it('strict: true takes priority over noImplicitAny', () => {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noImplicitAny: true, strictNullChecks: true },
    }));
    const { score, summary } = scoreStrictConfig(dir);
    expect(score).toBe(7);
    expect(summary).toBe('strict mode enabled');
    expect(score).toBeGreaterThan(5);
  });
});

// ── countMatches edge cases ───────────────────────────────────────────────────

describe('countMatches — edge cases', () => {
  it('handles regex with global flag correctly across calls', () => {
    const contents = new Map([['a.ts', 'foo foo foo']]);
    const count1 = countMatches(['a.ts'], contents, /foo/g);
    const count2 = countMatches(['a.ts'], contents, /foo/g);
    expect(count1).toBe(3);
    expect(count2).toBe(3);
    expect(count1).toBe(count2);
  });

  it('counts zero for empty file content', () => {
    const contents = new Map([['a.ts', '']]);
    const count = countMatches(['a.ts'], contents, /foo/g);
    expect(count).toBe(0);
    expect(typeof count).toBe('number');
    expect(Number.isInteger(count)).toBe(true);
  });

  it('only counts files in the provided list', () => {
    const contents = new Map([
      ['a.ts', 'foo foo'],
      ['b.ts', 'foo foo foo'],
    ]);
    const countA = countMatches(['a.ts'], contents, /foo/g);
    const countB = countMatches(['b.ts'], contents, /foo/g);
    const countBoth = countMatches(['a.ts', 'b.ts'], contents, /foo/g);
    expect(countA).toBe(2);
    expect(countB).toBe(3);
    expect(countBoth).toBe(5);
  });
});

// ── anyFileHasMatch — edge cases ──────────────────────────────────────────────

describe('anyFileHasMatch — edge cases', () => {
  it('returns false for all-empty content files', () => {
    const contents = new Map([['a.ts', ''], ['b.ts', '']]);
    const result = anyFileHasMatch(['a.ts', 'b.ts'], contents, /foo/g);
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });

  it('returns true immediately when first file matches', () => {
    const contents = new Map([
      ['a.ts', 'target'],
      ['b.ts', 'also target'],
    ]);
    const result = anyFileHasMatch(['a.ts', 'b.ts'], contents, /target/g);
    expect(result).toBe(true);
    expect(result).not.toBe(false);
  });

  it('is not affected by file contents outside the list', () => {
    const contents = new Map([
      ['in-list.ts', 'no match'],
      ['not-listed.ts', 'target'],
    ]);
    const result = anyFileHasMatch(['in-list.ts'], contents, /target/g);
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });
});

// ── countMatchesWithFiles — edge cases ───────────────────────────────────────

describe('countMatchesWithFiles — edge cases', () => {
  it('returns count proportional to actual matches', () => {
    const contents = new Map([
      ['a.ts', 'x x x'],
      ['b.ts', 'x'],
    ]);
    const { count, matchedFiles } = countMatchesWithFiles(['a.ts', 'b.ts'], contents, /x/g);
    expect(count).toBe(4);
    expect(matchedFiles).toHaveLength(2);
    expect(count).toBeGreaterThan(matchedFiles.length);
  });

  it('does not double-count a file with multiple lines of matches', () => {
    const src = 'match\nmatch\nmatch';
    const contents = new Map([['a.ts', src]]);
    const { count, matchedFiles } = countMatchesWithFiles(['a.ts'], contents, /match/g);
    expect(count).toBe(3);
    expect(matchedFiles).toHaveLength(1);
    expect(matchedFiles[0]).toBe('a.ts');
  });

  it('returns zero count when file contents are all empty', () => {
    const contents = new Map([['a.ts', ''], ['b.ts', '']]);
    const { count, matchedFiles } = countMatchesWithFiles(['a.ts', 'b.ts'], contents, /x/g);
    expect(count).toBe(0);
    expect(matchedFiles).toHaveLength(0);
    expect(Array.isArray(matchedFiles)).toBe(true);
  });
});
