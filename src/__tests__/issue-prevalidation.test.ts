import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stripCommentsAndStrings, prevalidateIssues } from '../core/issue-prevalidation.js';
import type { IssueTask } from '../core/issue-backlog.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

// Mock fs modules to avoid real file I/O
vi.mock('fs/promises');
vi.mock('fs');

const mockReadFile = vi.mocked(readFile);
const mockExistsSync = vi.mocked(existsSync);

function makeIssue(overrides: Partial<IssueTask> = {}): IssueTask {
  return {
    category: 'error-handling',
    subcategory: 'Logging',
    description: 'console.log calls',
    count: 3,
    severity: 'low',
    priority: 1,
    sweepFiles: ['/project/src/app.ts'],
    ...overrides,
  };
}

// ── stripCommentsAndStrings ────────────────────────────────────────────────

describe('stripCommentsAndStrings', () => {
  it('preserves real console.log in code', () => {
    const src = 'function foo() { console.log("hello"); }';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).toContain('console.log(');
  });

  it('removes console.log inside single-line comment', () => {
    const src = '// console.log("debug")\nconst x = 1;';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toMatch(/console\.log/);
    expect(stripped).toContain('const x = 1;');
  });

  it('removes console.log inside block comment', () => {
    const src = '/* console.log("example") */ const y = 2;';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toMatch(/console\.log/);
  });

  it('removes console.log inside double-quoted string', () => {
    const src = 'const msg = "use console.log to debug"; doSomething();';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toMatch(/console\.log/);
    expect(stripped).toContain('doSomething()');
  });

  it('removes console.log inside single-quoted string', () => {
    const src = "const msg = 'avoid console.log in production'; const x = 1;";
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toMatch(/console\.log/);
  });

  it('removes console.log inside template literal', () => {
    const src = 'const docs = `Example: console.log(value)`; realCode();';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toMatch(/console\.log/);
    expect(stripped).toContain('realCode()');
  });

  it('preserves empty catch in real code', () => {
    const src = 'try { risky(); } catch (e) {}';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).toContain('catch (e) {}');
  });

  it('removes empty catch inside block comment', () => {
    const src = '/* catch (e) {} */ realCode();';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toMatch(/catch\s*\(e\)\s*\{/);
  });

  it('preserves newlines from block comments (for line number stability)', () => {
    const src = '/*\n * line 1\n * line 2\n */ const x = 1;';
    const stripped = stripCommentsAndStrings(src);
    const newlines = stripped.split('\n').length - 1;
    expect(newlines).toBeGreaterThanOrEqual(3); // at least 3 newlines preserved
  });

  it('handles escaped quotes inside strings', () => {
    const src = 'const s = "he said \\"console.log\\" is bad"; realCode();';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toMatch(/console\.log/);
    expect(stripped).toContain('realCode()');
  });
});

// ── prevalidateIssues ──────────────────────────────────────────────────────

describe('prevalidateIssues', () => {
  const cwd = '/project';

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks issue as valid when real console.log exists in code', async () => {
    mockReadFile.mockResolvedValue('function foo() { console.log("debug"); }' as unknown as Buffer);

    const issues = [makeIssue()];
    const result = await prevalidateIssues(issues, cwd);

    expect(result.validIssues).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(0);
  });

  it('marks issue as false positive when console.log only in comment', async () => {
    mockReadFile.mockResolvedValue('// console.log("example")\nconst x = 1;\n' as unknown as Buffer);

    const issues = [makeIssue()];
    const result = await prevalidateIssues(issues, cwd);

    expect(result.falsePositives).toHaveLength(1);
    expect(result.validIssues).toHaveLength(0);
    expect(result.falsePositives[0].description).toBe('console.log calls');
  });

  it('marks issue as false positive when console.log only in string literal', async () => {
    mockReadFile.mockResolvedValue('const msg = "use console.log for debugging";\n' as unknown as Buffer);

    const issues = [makeIssue()];
    const result = await prevalidateIssues(issues, cwd);

    expect(result.falsePositives).toHaveLength(1);
    expect(result.validIssues).toHaveLength(0);
  });

  it('marks issue as false positive when console.log only in template literal', async () => {
    mockReadFile.mockResolvedValue('const doc = `Example: console.log(val)`;\n' as unknown as Buffer);

    const issues = [makeIssue()];
    const result = await prevalidateIssues(issues, cwd);

    expect(result.falsePositives).toHaveLength(1);
  });

  it('skips doc files (explanations.ts pattern)', async () => {
    const issue = makeIssue({ sweepFiles: ['/project/src/explanations.ts'] });

    const result = await prevalidateIssues([issue], cwd);

    // File was skipped → no real occurrences found → false positive
    expect(result.skippedFiles).toContain('/project/src/explanations.ts');
    expect(result.falsePositives).toHaveLength(1);
    // readFile should not have been called for doc files
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('skips *.example.ts files', async () => {
    const issue = makeIssue({ sweepFiles: ['/project/src/logger.example.ts'] });

    const result = await prevalidateIssues([issue], cwd);

    expect(result.skippedFiles).toContain('/project/src/logger.example.ts');
    expect(result.falsePositives).toHaveLength(1);
  });

  it('skips files under docs/ directory', async () => {
    const issue = makeIssue({ sweepFiles: ['/project/docs/guide.ts'] });

    const result = await prevalidateIssues([issue], cwd);

    expect(result.skippedFiles).toContain('/project/docs/guide.ts');
    expect(result.falsePositives).toHaveLength(1);
  });

  it('treats issue as valid when no sweep files', async () => {
    const issue = makeIssue({ sweepFiles: [] });

    const result = await prevalidateIssues([issue], cwd);

    expect(result.validIssues).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(0);
  });

  it('treats issue as valid when no sweepFiles field at all', async () => {
    const issue = makeIssue({ sweepFiles: undefined });

    const result = await prevalidateIssues([issue], cwd);

    expect(result.validIssues).toHaveLength(1);
  });

  it('passes through issues with no known validation pattern', async () => {
    const issue = makeIssue({
      category: 'type-safety',
      subcategory: 'Any type count',
      description: 'any types',
      sweepFiles: ['/project/src/app.ts'],
    });

    const result = await prevalidateIssues([issue], cwd);

    // No validation pattern for "any types" → always valid
    expect(result.validIssues).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(0);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('handles mixed real + false positive issues', async () => {
    // First file: only comment → false positive
    // Second file: real code → valid
    mockReadFile
      .mockResolvedValueOnce('// console.log("example")\n' as unknown as Buffer)
      .mockResolvedValueOnce('console.log("real debug");\n' as unknown as Buffer);

    const fpIssue = makeIssue({
      description: 'console.log calls',
      sweepFiles: ['/project/src/docs-helper.ts'],
    });
    const realIssue = makeIssue({
      description: 'console.log calls',
      sweepFiles: ['/project/src/server.ts'],
    });

    const result = await prevalidateIssues([fpIssue, realIssue], cwd);

    expect(result.falsePositives).toHaveLength(1);
    expect(result.validIssues).toHaveLength(1);
    expect(result.falsePositives[0].sweepFiles).toContain('/project/src/docs-helper.ts');
    expect(result.validIssues[0].sweepFiles).toContain('/project/src/server.ts');
  });

  it('marks as valid if at least one sweep file has real occurrence', async () => {
    // Two sweep files: first is doc file, second has real code
    mockReadFile.mockResolvedValue('console.log("real");\n' as unknown as Buffer);

    const issue = makeIssue({
      sweepFiles: [
        '/project/src/explanations.ts', // doc file — skipped
        '/project/src/server.ts',       // real file with occurrence
      ],
    });

    const result = await prevalidateIssues([issue], cwd);

    expect(result.validIssues).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(0);
    expect(result.skippedFiles).toContain('/project/src/explanations.ts');
  });

  it('handles non-existent files gracefully', async () => {
    mockExistsSync.mockReturnValue(false);

    const issue = makeIssue({ sweepFiles: ['/project/src/missing.ts'] });

    const result = await prevalidateIssues([issue], cwd);

    // File doesn't exist → skipped → no occurrences → false positive
    expect(result.skippedFiles).toContain('/project/src/missing.ts');
    expect(result.falsePositives).toHaveLength(1);
  });

  it('treats issue as valid when readFile throws', async () => {
    mockReadFile.mockRejectedValue(new Error('EACCES: permission denied'));

    const issue = makeIssue();
    const result = await prevalidateIssues([issue], cwd);

    // Unreadable → assume valid (don't filter)
    expect(result.validIssues).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(0);
  });

  it('detects empty catch in real code', async () => {
    mockReadFile.mockResolvedValue('try { risky(); } catch (e) {}\n' as unknown as Buffer);

    const issue = makeIssue({
      subcategory: 'Empty catches',
      description: 'empty catch blocks',
    });
    const result = await prevalidateIssues([issue], cwd);

    expect(result.validIssues).toHaveLength(1);
  });

  it('marks empty catch as false positive when only in comment', async () => {
    mockReadFile.mockResolvedValue('// catch (e) {} — bad pattern\nrealCode();\n' as unknown as Buffer);

    const issue = makeIssue({
      subcategory: 'Empty catches',
      description: 'empty catch blocks',
    });
    const result = await prevalidateIssues([issue], cwd);

    expect(result.falsePositives).toHaveLength(1);
  });
});
