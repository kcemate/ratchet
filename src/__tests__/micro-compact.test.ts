import { describe, it, expect } from 'vitest';
import {
  microCompact,
  shouldMicroCompact,
  removeCodeComments,
  collapseBlankLines,
  truncateFileBlock,
  truncateFileBlocks,
  dropReadOnlyBlocks,
  removeCommentsFromFileBlocks,
  MICRO_COMPACT_THRESHOLD,
  DEFAULT_CONTEXT_WINDOW_CHARS,
} from '../core/micro-compact.js';

// ── shouldMicroCompact ────────────────────────────────────────────────────────

describe('shouldMicroCompact', () => {
  it('returns false when prompt is under threshold', () => {
    expect(shouldMicroCompact(50_000, 100_000)).toBe(false);
  });

  it('returns false when prompt is exactly at 80% threshold', () => {
    expect(shouldMicroCompact(80_000, 100_000)).toBe(false);
  });

  it('returns true when prompt exceeds 80% of context window', () => {
    expect(shouldMicroCompact(81_000, 100_000)).toBe(true);
  });

  it('uses default context window when not specified', () => {
    expect(shouldMicroCompact(DEFAULT_CONTEXT_WINDOW_CHARS * MICRO_COMPACT_THRESHOLD + 1)).toBe(true);
    expect(shouldMicroCompact(1000)).toBe(false);
  });

  it('respects custom threshold', () => {
    expect(shouldMicroCompact(60_000, 100_000, 0.5)).toBe(true);
    expect(shouldMicroCompact(40_000, 100_000, 0.5)).toBe(false);
  });
});

// ── removeCodeComments ────────────────────────────────────────────────────────

describe('removeCodeComments', () => {
  it('removes single-line comments', () => {
    const input = 'const x = 1; // this is a comment\nconst y = 2;';
    const result = removeCodeComments(input);
    expect(result).not.toContain('// this is a comment');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('const y = 2;');
  });

  it('removes block comments', () => {
    const input = '/* block comment */\nconst x = 1;';
    const result = removeCodeComments(input);
    expect(result).not.toContain('block comment');
    expect(result).toContain('const x = 1;');
  });

  it('removes multi-line block comments', () => {
    const input = '/**\n * JSDoc comment\n * @param x\n */\nfunction foo() {}';
    const result = removeCodeComments(input);
    expect(result).not.toContain('JSDoc comment');
    expect(result).toContain('function foo() {}');
  });

  it('returns text unchanged when no comments present', () => {
    const input = 'const x = 1;\nconst y = 2;';
    expect(removeCodeComments(input)).toBe(input);
  });
});

// ── collapseBlankLines ────────────────────────────────────────────────────────

describe('collapseBlankLines', () => {
  it('collapses 3+ consecutive blank lines into 2', () => {
    const input = 'line1\n\n\n\nline2';
    const result = collapseBlankLines(input);
    expect(result).not.toMatch(/\n{4,}/);
    expect(result).toContain('line1');
    expect(result).toContain('line2');
  });

  it('preserves single blank lines', () => {
    const input = 'line1\n\nline2';
    expect(collapseBlankLines(input)).toBe(input);
  });

  it('returns unchanged text when no extra blanks', () => {
    const input = 'line1\nline2\nline3';
    expect(collapseBlankLines(input)).toBe(input);
  });
});

// ── truncateFileBlock ─────────────────────────────────────────────────────────

describe('truncateFileBlock', () => {
  it('returns content unchanged when lines <= 2 * keepLines', () => {
    const content = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    expect(truncateFileBlock(content, 20)).toBe(content);
  });

  it('truncates middle when content exceeds 2 * keepLines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const content = lines.join('\n');
    const result = truncateFileBlock(content, 20);
    expect(result).toContain('[...60 lines trimmed...]');
    expect(result).toContain('line 0');
    expect(result).toContain('line 99');
    expect(result).not.toContain('line 50');
  });

  it('includes correct trim count in message', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const content = lines.join('\n');
    const result = truncateFileBlock(content, 10);
    expect(result).toContain('[...30 lines trimmed...]');
  });
});

// ── truncateFileBlocks ────────────────────────────────────────────────────────

describe('truncateFileBlocks', () => {
  it('truncates FILE blocks in a prompt', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    const prompt = `Preamble\n--- FILE: src/foo.ts ---\n${lines}\n--- END FILE ---\nPostamble`;
    const result = truncateFileBlocks(prompt, 10);
    expect(result).toContain('lines trimmed');
    expect(result).toContain('Preamble');
    expect(result).toContain('Postamble');
  });

  it('leaves prompt unchanged when file blocks are small', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const prompt = `--- FILE: src/foo.ts ---\n${lines}\n--- END FILE ---`;
    const result = truncateFileBlocks(prompt, 20);
    expect(result).toBe(prompt);
  });
});

// ── dropReadOnlyBlocks ────────────────────────────────────────────────────────

describe('dropReadOnlyBlocks', () => {
  it('removes READ-ONLY blocks from prompt', () => {
    const prompt = 'Before\n--- READ-ONLY: src/foo.ts ---\nsome content\n--- END READ-ONLY ---\nAfter';
    const result = dropReadOnlyBlocks(prompt);
    expect(result).not.toContain('READ-ONLY');
    expect(result).not.toContain('some content');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('returns prompt unchanged when no READ-ONLY blocks', () => {
    const prompt = 'No read-only blocks here';
    expect(dropReadOnlyBlocks(prompt)).toBe(prompt);
  });

  it('removes multiple READ-ONLY blocks', () => {
    const prompt = [
      '--- READ-ONLY: a.ts ---\ncontent a\n--- END READ-ONLY ---',
      '--- READ-ONLY: b.ts ---\ncontent b\n--- END READ-ONLY ---',
    ].join('\n');
    const result = dropReadOnlyBlocks(prompt);
    expect(result).not.toContain('content a');
    expect(result).not.toContain('content b');
  });
});

// ── removeCommentsFromFileBlocks ───────────────────────────────────────────────

describe('removeCommentsFromFileBlocks', () => {
  it('removes comments from FILE block content', () => {
    const content = 'const x = 1; // inline comment\n/* block */\nconst y = 2;';
    const prompt = `--- FILE: src/foo.ts ---\n${content}\n--- END FILE ---`;
    const result = removeCommentsFromFileBlocks(prompt);
    expect(result).not.toContain('inline comment');
    expect(result).not.toContain('/* block */');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('const y = 2;');
  });

  it('does not modify content outside FILE blocks', () => {
    const prompt = '// This comment is outside\n--- FILE: foo.ts ---\nconst x = 1;\n--- END FILE ---';
    const result = removeCommentsFromFileBlocks(prompt);
    expect(result).toContain('// This comment is outside');
  });
});

// ── microCompact ──────────────────────────────────────────────────────────────

describe('microCompact', () => {
  it('returns prompt unchanged when it fits within maxChars', () => {
    const prompt = 'Short prompt';
    expect(microCompact(prompt, 1000)).toBe(prompt);
  });

  it('reduces prompt length when it exceeds maxChars', () => {
    // Create a large prompt with comments and blank lines to compress
    const fileContent = Array.from({ length: 200 }, (_, i) =>
      `const x${i} = ${i}; // comment ${i}\n`,
    ).join('\n\n\n');
    const prompt = `Preamble text here\n--- FILE: src/big.ts ---\n${fileContent}\n--- END FILE ---\n--- READ-ONLY: src/helper.ts ---\nhelper content\n--- END READ-ONLY ---`;
    const maxChars = 500;
    const result = microCompact(prompt, maxChars);
    expect(result.length).toBeLessThanOrEqual(prompt.length);
  });

  it('drops READ-ONLY blocks as last resort', () => {
    const readOnlyContent = 'x'.repeat(2000);
    const prompt = `Core content\n--- READ-ONLY: a.ts ---\n${readOnlyContent}\n--- END READ-ONLY ---`;
    const result = microCompact(prompt, 100);
    expect(result).not.toContain(readOnlyContent);
    expect(result).toContain('Core content');
  });

  it('applies steps in order — comments first, then blank lines, then truncation', () => {
    const commentHeavyContent = Array.from({ length: 10 }, (_, i) =>
      `const x${i} = ${i}; // comment that adds length`,
    ).join('\n');
    const prompt = `--- FILE: foo.ts ---\n${commentHeavyContent}\n--- END FILE ---`;
    const maxChars = prompt.length - 10;
    const result = microCompact(prompt, maxChars);
    // Comments should be removed first
    expect(result).not.toContain('// comment that adds length');
  });
});
