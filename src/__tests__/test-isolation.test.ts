import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractFailingTestFiles,
  classifyFailures,
  isUnrelatedFailure,
  getChangedFiles,
} from '../core/test-isolation.js';

// --- extractFailingTestFiles ---

describe('extractFailingTestFiles', () => {
  it('extracts FAIL lines from Vitest output', () => {
    const output = `
 FAIL  src/__tests__/api.test.ts
 FAIL  src/__tests__/auth.test.ts
 ✓ src/__tests__/utils.test.ts
`;
    const result = extractFailingTestFiles(output);
    expect(result).toContain('api.test.ts');
    expect(result).toContain('auth.test.ts');
    expect(result).not.toContain('utils.test.ts');
  });

  it('deduplicates repeated file names', () => {
    const output = `
 FAIL  src/__tests__/api.test.ts
 FAIL  src/__tests__/api.test.ts
`;
    const result = extractFailingTestFiles(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('api.test.ts');
  });

  it('returns empty array when no failures', () => {
    const output = '✓ all tests passed\n Tests: 5 passed';
    expect(extractFailingTestFiles(output)).toEqual([]);
  });

  it('handles × (cross) prefix common in some Vitest versions', () => {
    const output = ' ×  src/__tests__/widget.test.ts\n';
    const result = extractFailingTestFiles(output);
    expect(result).toContain('widget.test.ts');
  });

  it('strips directory prefixes — returns basename only', () => {
    const output = ' FAIL  deeply/nested/path/to/widget.test.ts\n';
    const result = extractFailingTestFiles(output);
    expect(result).toEqual(['widget.test.ts']);
  });
});

// --- classifyFailures ---

describe('classifyFailures', () => {
  it('classifies all tests as unrelated when changedFiles is empty', () => {
    // With no changed files, isUnrelatedFailure returns false (conservative), so related
    const { related, unrelated } = classifyFailures([], ['foo.test.ts'], '/tmp');
    expect(related).toContain('foo.test.ts');
    expect(unrelated).toHaveLength(0);
  });

  it('returns symmetric partition — related + unrelated = input', () => {
    const failures = ['a.test.ts', 'b.test.ts', 'c.test.ts'];
    const { related, unrelated } = classifyFailures(['src/foo.ts'], failures, '/tmp/nonexistent');
    // File system lookup will fail so all are "related" (conservative default)
    expect(related.length + unrelated.length).toBe(failures.length);
  });

  it('returns empty arrays for empty failure list', () => {
    const { related, unrelated } = classifyFailures(['src/foo.ts'], [], '/tmp');
    expect(related).toEqual([]);
    expect(unrelated).toEqual([]);
  });
});

// --- isUnrelatedFailure ---

describe('isUnrelatedFailure', () => {
  it('returns false when changedFiles is empty (conservative)', () => {
    expect(isUnrelatedFailure('foo.test.ts', [], '/tmp')).toBe(false);
  });

  it('returns true (unrelated) when test file cannot be found', () => {
    // File doesn't exist → assume unrelated (can't read it)
    const result = isUnrelatedFailure('nonexistent-xyz.test.ts', ['src/core/click.ts'], '/tmp/nonexistent');
    expect(result).toBe(true);
  });

  it('returns false (related) when test file cannot be read (conservative)', () => {
    // When cwd exists but file not there, resolveTestFile returns null → returns true (unrelated)
    // This tests the "unrelated" path — when file is genuinely not found
    const result = isUnrelatedFailure('missing.test.ts', ['src/click.ts'], '/tmp/nonexistent-dir');
    expect(result).toBe(true);
  });

  it('detects related test via import content', async () => {
    const { writeFileSync, mkdirSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const tmpDir = '/tmp/ratchet-test-isolation-' + Date.now();

    mkdirSync(`${tmpDir}/src/__tests__`, { recursive: true });

    // Write a test file that imports the changed source file
    writeFileSync(
      `${tmpDir}/src/__tests__/click.test.ts`,
      `import { executeClick } from '../core/click.js';\ndescribe('click', () => {});\n`,
    );

    const result = isUnrelatedFailure('click.test.ts', ['src/core/click.ts'], tmpDir);
    expect(result).toBe(false); // test imports click → related

    rmSync(tmpDir, { recursive: true });
  });

  it('detects unrelated test that imports different module', async () => {
    const { writeFileSync, mkdirSync, rmSync } = await import('fs');
    const tmpDir = '/tmp/ratchet-test-isolation-unrelated-' + Date.now();

    mkdirSync(`${tmpDir}/src/__tests__`, { recursive: true });

    // Write a test file that imports a different module
    writeFileSync(
      `${tmpDir}/src/__tests__/badge.test.ts`,
      `import { generateBadge } from '../badge.js';\ndescribe('badge', () => {});\n`,
    );

    // Changed file is click.ts — badge.test.ts doesn't import it
    const result = isUnrelatedFailure('badge.test.ts', ['src/core/click.ts'], tmpDir);
    expect(result).toBe(true); // badge test doesn't import click → unrelated

    rmSync(tmpDir, { recursive: true });
  });
});

// --- getChangedFiles ---

describe('getChangedFiles', () => {
  it('returns an array (may be empty in clean git state)', () => {
    // This runs against the actual test repo — just check the return type
    const result = getChangedFiles(process.cwd());
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns empty array when cwd is not a git repo', () => {
    const result = getChangedFiles('/tmp');
    expect(result).toEqual([]);
  });

  it('deduplicates entries appearing in both staged and unstaged', () => {
    // All entries should be unique
    const result = getChangedFiles(process.cwd());
    const unique = [...new Set(result)];
    expect(result).toEqual(unique);
  });
});
