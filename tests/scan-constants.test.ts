import { describe, it, expect } from 'vitest';
import {
  IGNORE_DIRS,
  NON_PROD_DIRS,
  CODE_EXTENSIONS,
  TEST_PATTERNS,
  isTestFile,
  countMatches,
  countMatchesWithFiles,
  anyFileHasMatch,
  scoreByThresholds,
  DUP_SCORE_THRESHOLDS,
  type Threshold,
} from '../src/core/scan-constants.js';

// ── isTestFile ───────────────────────────────────────────────────────────────

describe('isTestFile', () => {
  it('identifies .test.ts and .spec.ts files', () => {
    expect(isTestFile('src/foo.test.ts')).toBe(true);
    expect(isTestFile('src/foo.spec.ts')).toBe(true);
    expect(isTestFile('src/foo.ts')).toBe(false);
    expect(isTestFile('src/testing-utils.ts')).toBe(false);
  });

  it('identifies .test.js and .spec.js files', () => {
    expect(isTestFile('lib/bar.test.js')).toBe(true);
    expect(isTestFile('lib/bar.spec.js')).toBe(true);
    expect(isTestFile('lib/bar.js')).toBe(false);
  });

  it('identifies files in /tests/ and /test/ directories', () => {
    expect(isTestFile('/project/tests/utils.ts')).toBe(true);
    expect(isTestFile('/project/test/utils.ts')).toBe(true);
    expect(isTestFile('/project/src/utils.ts')).toBe(false);
  });

  it('identifies files in /spec/ directory', () => {
    expect(isTestFile('/project/spec/utils.ts')).toBe(true);
    expect(isTestFile('/project/lib/utils.ts')).toBe(false);
    expect(isTestFile('/project/spectral/utils.ts')).toBe(false);
  });

  it('identifies _test. and _spec. patterns', () => {
    expect(isTestFile('src/foo_test.ts')).toBe(true);
    expect(isTestFile('src/foo_spec.ts')).toBe(true);
    expect(isTestFile('src/foo_utils.ts')).toBe(false);
  });

  it('returns false for regular source files with test in path', () => {
    expect(isTestFile('src/context/foo.ts')).toBe(false);
    expect(isTestFile('src/commands/scan.ts')).toBe(false);
    expect(isTestFile('lib/index.js')).toBe(false);
  });
});

// ── IGNORE_DIRS ──────────────────────────────────────────────────────────────

describe('IGNORE_DIRS', () => {
  it('is a non-empty Set', () => {
    expect(IGNORE_DIRS instanceof Set).toBe(true);
    expect(IGNORE_DIRS.size).toBeGreaterThan(0);
  });

  it('includes standard build and dependency directories', () => {
    expect(IGNORE_DIRS.has('node_modules')).toBe(true);
    expect(IGNORE_DIRS.has('dist')).toBe(true);
    expect(IGNORE_DIRS.has('.git')).toBe(true);
    expect(IGNORE_DIRS.has('coverage')).toBe(true);
    expect(IGNORE_DIRS.has('build')).toBe(true);
  });

  it('includes cache and vendor directories', () => {
    expect(IGNORE_DIRS.has('.cache')).toBe(true);
    expect(IGNORE_DIRS.has('vendor')).toBe(true);
    expect(IGNORE_DIRS.has('.ratchet')).toBe(true);
  });

  it('does not include source directories', () => {
    expect(IGNORE_DIRS.has('src')).toBe(false);
    expect(IGNORE_DIRS.has('lib')).toBe(false);
    expect(IGNORE_DIRS.has('tests')).toBe(false);
    expect(IGNORE_DIRS.has('api')).toBe(false);
  });
});

// ── CODE_EXTENSIONS ──────────────────────────────────────────────────────────

describe('CODE_EXTENSIONS', () => {
  it('is a non-empty Set', () => {
    expect(CODE_EXTENSIONS instanceof Set).toBe(true);
    expect(CODE_EXTENSIONS.size).toBeGreaterThan(0);
  });

  it('includes TypeScript extensions', () => {
    expect(CODE_EXTENSIONS.has('.ts')).toBe(true);
    expect(CODE_EXTENSIONS.has('.tsx')).toBe(true);
  });

  it('includes all JavaScript module extensions', () => {
    expect(CODE_EXTENSIONS.has('.js')).toBe(true);
    expect(CODE_EXTENSIONS.has('.jsx')).toBe(true);
    expect(CODE_EXTENSIONS.has('.mjs')).toBe(true);
    expect(CODE_EXTENSIONS.has('.cjs')).toBe(true);
  });

  it('includes Python, Go, and Rust', () => {
    expect(CODE_EXTENSIONS.has('.py')).toBe(true);
    expect(CODE_EXTENSIONS.has('.go')).toBe(true);
    expect(CODE_EXTENSIONS.has('.rs')).toBe(true);
  });

  it('does not include non-code file extensions', () => {
    expect(CODE_EXTENSIONS.has('.json')).toBe(false);
    expect(CODE_EXTENSIONS.has('.md')).toBe(false);
    expect(CODE_EXTENSIONS.has('.css')).toBe(false);
    expect(CODE_EXTENSIONS.has('.html')).toBe(false);
    expect(CODE_EXTENSIONS.has('.txt')).toBe(false);
  });
});

// ── TEST_PATTERNS ────────────────────────────────────────────────────────────

describe('TEST_PATTERNS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(TEST_PATTERNS)).toBe(true);
    expect(TEST_PATTERNS.length).toBeGreaterThan(0);
  });

  it('includes .test. and .spec. patterns', () => {
    expect(TEST_PATTERNS.some(p => p.includes('.test.'))).toBe(true);
    expect(TEST_PATTERNS.some(p => p.includes('.spec.'))).toBe(true);
  });

  it('includes directory-based patterns', () => {
    expect(TEST_PATTERNS.some(p => p.includes('/tests/'))).toBe(true);
    expect(TEST_PATTERNS.some(p => p.includes('/test/'))).toBe(true);
  });

  it('all entries are non-empty strings', () => {
    for (const pattern of TEST_PATTERNS) {
      expect(typeof pattern).toBe('string');
      expect(pattern.length).toBeGreaterThan(0);
    }
  });
});

// ── NON_PROD_DIRS ────────────────────────────────────────────────────────────

describe('NON_PROD_DIRS', () => {
  it('is a non-empty Set', () => {
    expect(NON_PROD_DIRS instanceof Set).toBe(true);
    expect(NON_PROD_DIRS.size).toBeGreaterThan(0);
  });

  it('includes common non-production directory names', () => {
    expect(NON_PROD_DIRS.has('scripts')).toBe(true);
    expect(NON_PROD_DIRS.has('fixtures')).toBe(true);
    expect(NON_PROD_DIRS.has('docs')).toBe(true);
    expect(NON_PROD_DIRS.has('examples')).toBe(true);
  });

  it('does not include production directories', () => {
    expect(NON_PROD_DIRS.has('src')).toBe(false);
    expect(NON_PROD_DIRS.has('lib')).toBe(false);
    expect(NON_PROD_DIRS.has('api')).toBe(false);
    expect(NON_PROD_DIRS.has('app')).toBe(false);
  });
});

// ── countMatches ─────────────────────────────────────────────────────────────

describe('countMatches', () => {
  it('returns 0 when no files are provided', () => {
    const count = countMatches([], new Map(), /foo/g);
    expect(count).toBe(0);
    expect(typeof count).toBe('number');
    expect(Number.isInteger(count)).toBe(true);
  });

  it('counts matches in a single file', () => {
    const contents = new Map([['a.ts', 'foo bar foo baz foo']]);
    const count = countMatches(['a.ts'], contents, /foo/g);
    expect(count).toBe(3);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('sums matches across multiple files', () => {
    const contents = new Map([
      ['a.ts', 'hello hello'],
      ['b.ts', 'hello world'],
      ['c.ts', 'no match here'],
    ]);
    const count = countMatches(['a.ts', 'b.ts', 'c.ts'], contents, /hello/g);
    expect(count).toBe(3);
    expect(count).toBeGreaterThan(2);
    expect(count).toBeLessThan(5);
  });

  it('returns 0 for a file with no matching content', () => {
    const contents = new Map([['a.ts', 'nothing here at all']]);
    const count = countMatches(['a.ts'], contents, /xyz/g);
    expect(count).toBe(0);
    expect(count).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('uses empty string for files not in contents map', () => {
    const count = countMatches(['missing.ts'], new Map(), /foo/g);
    expect(count).toBe(0);
    expect(count).toBeGreaterThanOrEqual(0);
    expect(typeof count).toBe('number');
  });

  it('counts raw content when contextAware is false', () => {
    const contents = new Map([['a.ts', '// foo foo\nfoo']]);
    const raw = countMatches(['a.ts'], contents, /foo/g, false);
    expect(raw).toBe(3);
    expect(raw).toBeGreaterThan(0);
    expect(Number.isInteger(raw)).toBe(true);
  });

  it('strips comments when contextAware is true', () => {
    const contents = new Map([['a.ts', '// const secret = "myApiKey";\nconst x = 1;']]);
    const stripped = countMatches(['a.ts'], contents, /secret/g, true);
    expect(stripped).toBe(0);
    expect(stripped).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(stripped)).toBe(true);
  });

  it('counts zero matches when file list excludes matching files', () => {
    const contents = new Map([
      ['a.ts', 'hello hello'],
      ['b.ts', 'hello'],
    ]);
    const count = countMatches(['b.ts'], contents, /hello/g);
    expect(count).toBe(1);
    expect(count).toBeLessThan(3);
    expect(count).toBeGreaterThan(0);
  });
});

// ── countMatchesWithFiles ─────────────────────────────────────────────────────

describe('countMatchesWithFiles', () => {
  it('returns count and matched file paths', () => {
    const contents = new Map([
      ['a.ts', 'foo foo'],
      ['b.ts', 'bar'],
      ['c.ts', 'foo'],
    ]);
    const { count, matchedFiles } = countMatchesWithFiles(['a.ts', 'b.ts', 'c.ts'], contents, /foo/g);
    expect(count).toBe(3);
    expect(matchedFiles).toHaveLength(2);
    expect(matchedFiles).toContain('a.ts');
    expect(matchedFiles).toContain('c.ts');
    expect(matchedFiles).not.toContain('b.ts');
  });

  it('returns empty arrays when no matches found', () => {
    const contents = new Map([['a.ts', 'nothing']]);
    const { count, matchedFiles } = countMatchesWithFiles(['a.ts'], contents, /xyz/g);
    expect(count).toBe(0);
    expect(matchedFiles).toHaveLength(0);
    expect(Array.isArray(matchedFiles)).toBe(true);
  });

  it('only lists each file once even with multiple matches', () => {
    const contents = new Map([['a.ts', 'foo foo foo foo']]);
    const { count, matchedFiles } = countMatchesWithFiles(['a.ts'], contents, /foo/g);
    expect(count).toBe(4);
    expect(matchedFiles).toHaveLength(1);
    expect(matchedFiles[0]).toBe('a.ts');
  });

  it('handles empty file list', () => {
    const { count, matchedFiles } = countMatchesWithFiles([], new Map(), /foo/g);
    expect(count).toBe(0);
    expect(matchedFiles).toHaveLength(0);
    expect(Array.isArray(matchedFiles)).toBe(true);
  });
});

// ── anyFileHasMatch ───────────────────────────────────────────────────────────

describe('anyFileHasMatch', () => {
  it('returns true when at least one file matches', () => {
    const contents = new Map([
      ['a.ts', 'nothing'],
      ['b.ts', 'target here'],
    ]);
    const result = anyFileHasMatch(['a.ts', 'b.ts'], contents, /target/g);
    expect(result).toBe(true);
    expect(typeof result).toBe('boolean');
  });

  it('returns false when no files match', () => {
    const contents = new Map([['a.ts', 'nothing here']]);
    const result = anyFileHasMatch(['a.ts'], contents, /xyz/g);
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
    expect(result).not.toBe(true);
  });

  it('returns false for empty file list', () => {
    const result = anyFileHasMatch([], new Map(), /foo/g);
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });

  it('returns true even if only the last file matches', () => {
    const contents = new Map([
      ['a.ts', 'no'],
      ['b.ts', 'no'],
      ['c.ts', 'yes match'],
    ]);
    const result = anyFileHasMatch(['a.ts', 'b.ts', 'c.ts'], contents, /match/g);
    expect(result).toBe(true);
    expect(result).not.toBe(false);
  });
});

// ── scoreByThresholds ─────────────────────────────────────────────────────────

describe('scoreByThresholds', () => {
  const thresholds: Threshold[] = [
    { min: 100, score: 10, summary: 'excellent' },
    { min: 50,  score: 7,  summary: (n) => `good: ${n}` },
    { min: 10,  score: 4,  summary: 'fair' },
    { min: -Infinity, score: 0, summary: 'poor' },
  ];

  it('returns the first matching threshold for a high value', () => {
    const { score, summary } = scoreByThresholds(150, thresholds);
    expect(score).toBe(10);
    expect(summary).toBe('excellent');
    expect(typeof score).toBe('number');
    expect(typeof summary).toBe('string');
  });

  it('matches at exact boundary value', () => {
    const { score, summary } = scoreByThresholds(100, thresholds);
    expect(score).toBe(10);
    expect(summary).toBe('excellent');
    expect(score).toBeGreaterThan(0);
  });

  it('evaluates function-based summary with the actual value', () => {
    const { score, summary } = scoreByThresholds(75, thresholds);
    expect(score).toBe(7);
    expect(summary).toBe('good: 75');
    expect(summary).toContain('75');
    expect(typeof summary).toBe('string');
  });

  it('falls to the middle threshold for values in range', () => {
    const { score, summary } = scoreByThresholds(25, thresholds);
    expect(score).toBe(4);
    expect(summary).toBe('fair');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(10);
  });

  it('uses -Infinity fallback for very low values', () => {
    const { score, summary } = scoreByThresholds(0, thresholds);
    expect(score).toBe(0);
    expect(summary).toBe('poor');
    expect(typeof score).toBe('number');
  });

  it('handles negative values with -Infinity fallback', () => {
    const { score, summary } = scoreByThresholds(-100, thresholds);
    expect(score).toBe(0);
    expect(summary).toBe('poor');
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('matches exact lower boundary of middle tier', () => {
    const { score, summary } = scoreByThresholds(50, thresholds);
    expect(score).toBe(7);
    expect(summary).toBe('good: 50');
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('matches exact lower boundary of bottom-named tier', () => {
    const { score, summary } = scoreByThresholds(10, thresholds);
    expect(score).toBe(4);
    expect(summary).toBe('fair');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(7);
  });
});

// ── DUP_SCORE_THRESHOLDS ──────────────────────────────────────────────────────

describe('DUP_SCORE_THRESHOLDS', () => {
  it('returns 6 for zero repeated lines', () => {
    const { score, summary } = scoreByThresholds(0, DUP_SCORE_THRESHOLDS);
    expect(score).toBe(6);
    expect(summary).toBe('no significant duplication');
    expect(typeof score).toBe('number');
    expect(typeof summary).toBe('string');
  });

  it('returns 5 for 1-10 repeated lines', () => {
    const { score, summary } = scoreByThresholds(5, DUP_SCORE_THRESHOLDS);
    expect(score).toBe(5);
    expect(summary).toContain('5 repeated lines');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(6);
  });

  it('returns 4 for 11-30 repeated lines', () => {
    const { score, summary } = scoreByThresholds(20, DUP_SCORE_THRESHOLDS);
    expect(score).toBe(4);
    expect(summary).toContain('20 repeated lines');
    expect(score).toBeLessThan(5);
    expect(score).toBeGreaterThan(3);
  });

  it('returns 3 for 31-100 repeated lines', () => {
    const { score, summary } = scoreByThresholds(50, DUP_SCORE_THRESHOLDS);
    expect(score).toBe(3);
    expect(summary).toContain('50 repeated lines');
    expect(score).toBeGreaterThan(2);
  });

  it('returns 2 for 101-300 repeated lines', () => {
    const { score, summary } = scoreByThresholds(200, DUP_SCORE_THRESHOLDS);
    expect(score).toBe(2);
    expect(summary).toContain('200 repeated lines');
    expect(score).toBeLessThan(3);
  });

  it('returns 1 with high-duplication label for 301-700 lines', () => {
    const { score, summary } = scoreByThresholds(500, DUP_SCORE_THRESHOLDS);
    expect(score).toBe(1);
    expect(summary).toContain('high duplication');
    expect(score).toBeLessThan(2);
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 with excessive label for 701+ lines', () => {
    const { score, summary } = scoreByThresholds(800, DUP_SCORE_THRESHOLDS);
    expect(score).toBe(0);
    expect(summary).toContain('excessive');
    expect(summary).toContain('800');
    expect(score).toBe(0);
  });

  it('thresholds array is well-formed and non-empty', () => {
    expect(Array.isArray(DUP_SCORE_THRESHOLDS)).toBe(true);
    expect(DUP_SCORE_THRESHOLDS.length).toBeGreaterThan(0);
    expect(DUP_SCORE_THRESHOLDS.every(t => 'min' in t && 'score' in t && 'summary' in t)).toBe(true);
  });
});
