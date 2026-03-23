import { describe, it, expect, beforeEach } from 'vitest';
import { countMatches, countMatchesWithFiles, anyFileHasMatch, clearStrippedCache } from '../core/scan-constants.js';

beforeEach(() => {
  clearStrippedCache();
});

const CONSOLE_LOG = /console\.log/g;

describe('countMatches (context-aware)', () => {
  it('strips false positives in comments', () => {
    const contents = new Map([['a.ts', '// console.log(debug)\nconst x = 1;']]);
    expect(countMatches(['a.ts'], contents, CONSOLE_LOG)).toBe(0);
  });

  it('strips false positives in string literals', () => {
    const contents = new Map([['a.ts', 'const msg = "console.log(x)";']]);
    expect(countMatches(['a.ts'], contents, CONSOLE_LOG)).toBe(0);
  });

  it('strips false positives in template literals', () => {
    const contents = new Map([['a.ts', 'const msg = `console.log(x)`;']]);
    expect(countMatches(['a.ts'], contents, CONSOLE_LOG)).toBe(0);
  });

  it('still counts real occurrences', () => {
    const contents = new Map([['a.ts', 'console.log(x);\nconsole.log(y);']]);
    expect(countMatches(['a.ts'], contents, CONSOLE_LOG)).toBe(2);
  });

  it('counts only real code in mixed content', () => {
    const contents = new Map([[
      'a.ts',
      '// console.log(comment)\nconsole.log(real);\nconst s = "console.log(str)";',
    ]]);
    expect(countMatches(['a.ts'], contents, CONSOLE_LOG)).toBe(1);
  });

  it('preserves old behavior when contextAware=false', () => {
    const contents = new Map([['a.ts', '// console.log(debug)\nconsole.log(real);']]);
    // Without context-awareness, the comment match is also counted
    expect(countMatches(['a.ts'], contents, CONSOLE_LOG, false)).toBe(2);
  });

  it('handles missing files gracefully', () => {
    const contents = new Map<string, string>();
    expect(countMatches(['missing.ts'], contents, CONSOLE_LOG)).toBe(0);
  });
});

describe('countMatchesWithFiles (context-aware)', () => {
  it('strips false positives and returns correct matchedFiles', () => {
    const contents = new Map([
      ['real.ts', 'console.log(x);'],
      ['comment.ts', '// console.log(x)'],
      ['string.ts', 'const s = "console.log(x)";'],
    ]);
    const { count, matchedFiles } = countMatchesWithFiles(
      ['real.ts', 'comment.ts', 'string.ts'],
      contents,
      CONSOLE_LOG,
    );
    expect(count).toBe(1);
    expect(matchedFiles).toEqual(['real.ts']);
  });

  it('preserves old behavior when contextAware=false', () => {
    const contents = new Map([
      ['real.ts', 'console.log(x);'],
      ['comment.ts', '// console.log(x)'],
    ]);
    const { count, matchedFiles } = countMatchesWithFiles(
      ['real.ts', 'comment.ts'],
      contents,
      CONSOLE_LOG,
      false,
    );
    expect(count).toBe(2);
    expect(matchedFiles).toEqual(['real.ts', 'comment.ts']);
  });
});

describe('anyFileHasMatch (context-aware)', () => {
  it('returns false when only comments match', () => {
    const contents = new Map([['a.ts', '// console.log(x)']]);
    expect(anyFileHasMatch(['a.ts'], contents, CONSOLE_LOG)).toBe(false);
  });

  it('returns true when real code matches', () => {
    const contents = new Map([['a.ts', 'console.log(x);']]);
    expect(anyFileHasMatch(['a.ts'], contents, CONSOLE_LOG)).toBe(true);
  });

  it('preserves old behavior when contextAware=false', () => {
    const contents = new Map([['a.ts', '// console.log(x)']]);
    expect(anyFileHasMatch(['a.ts'], contents, CONSOLE_LOG, false)).toBe(true);
  });
});
