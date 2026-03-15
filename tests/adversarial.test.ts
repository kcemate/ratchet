import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RedTeamAgent,
  computeSimpleDiff,
  extractTestCode,
  extractReasoning,
  detectTestFile,
} from '../src/core/adversarial.js';
import type { RedTeamResult } from '../src/core/adversarial.js';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

// ---------- Unit tests for helpers ----------

describe('computeSimpleDiff', () => {
  it('returns empty string when code is identical', () => {
    const code = 'function foo() { return 1; }';
    expect(computeSimpleDiff(code, code)).toBe('');
  });

  it('ignores whitespace-only changes', () => {
    const original = 'function foo() { return 1; }';
    const updated = '  function foo() { return 1; }  ';
    expect(computeSimpleDiff(original, updated)).toBe('');
  });

  it('ignores comment-only changes', () => {
    const original = 'const x = 1;';
    const updated = 'const x = 1; // added a comment';
    expect(computeSimpleDiff(original, updated)).toBe('');
  });

  it('detects behavioral changes', () => {
    const original = 'const x = 1;';
    const updated = 'const x = 2;';
    const diff = computeSimpleDiff(original, updated);
    expect(diff).toContain('- const x = 1;');
    expect(diff).toContain('+ const x = 2;');
  });

  it('handles added lines', () => {
    const original = 'line1';
    const updated = 'line1\nline2';
    const diff = computeSimpleDiff(original, updated);
    expect(diff).toContain('+ line2');
  });

  it('handles removed lines', () => {
    const original = 'line1\nline2';
    const updated = 'line1';
    const diff = computeSimpleDiff(original, updated);
    expect(diff).toContain('- line2');
  });
});

describe('extractTestCode', () => {
  it('extracts code from typescript fenced block', () => {
    const output = 'Some text\n```typescript\nconst x = 1;\n```\nMore text';
    expect(extractTestCode(output)).toBe('const x = 1;');
  });

  it('extracts code from ts fenced block', () => {
    const output = '```ts\nit("works", () => {});\n```';
    expect(extractTestCode(output)).toBe('it("works", () => {});');
  });

  it('extracts code from plain fenced block', () => {
    const output = '```\nplain code\n```';
    expect(extractTestCode(output)).toBe('plain code');
  });

  it('returns empty string when no code block found', () => {
    expect(extractTestCode('no code here')).toBe('');
  });
});

describe('extractReasoning', () => {
  it('extracts reasoning text', () => {
    const output = 'REASONING: The change modifies the return value.\n```ts\ncode\n```';
    expect(extractReasoning(output)).toBe('The change modifies the return value.');
  });

  it('returns default when no reasoning found', () => {
    expect(extractReasoning('just some output')).toBe('No reasoning provided.');
  });
});

// ---------- RedTeamAgent construction ----------

describe('RedTeamAgent', () => {
  it('constructs with default config', () => {
    const agent = new RedTeamAgent();
    expect(agent).toBeInstanceOf(RedTeamAgent);
  });

  it('constructs with custom config', () => {
    const agent = new RedTeamAgent({ model: 'claude-sonnet-4-6', timeout: 60_000 });
    expect(agent).toBeInstanceOf(RedTeamAgent);
  });

  it('returns not-challenged when code is identical (no behavioral change)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-test-'));
    try {
      // Create a dummy test file
      await writeFile(join(tmpDir, 'foo.test.ts'), 'describe("foo", () => {});');

      const agent = new RedTeamAgent();
      const result = await agent.challenge(
        'function foo() { return 1; }',
        'function foo() { return 1; }',
        'foo.test.ts',
        tmpDir,
      );

      expect(result.challenged).toBe(false);
      expect(result.rollbackRecommended).toBe(false);
      expect(result.reasoning).toContain('No behavioral change');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns not-challenged when test file does not exist', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-test-'));
    try {
      const agent = new RedTeamAgent();
      const result = await agent.challenge(
        'const x = 1;',
        'const x = 2;',
        'nonexistent.test.ts',
        tmpDir,
      );

      expect(result.challenged).toBe(false);
      expect(result.rollbackRecommended).toBe(false);
      expect(result.reasoning).toContain('Test file not found');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns not-challenged when test file cannot be read', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-test-'));
    try {
      // Create a directory with the test file name (can't be read as file)
      await mkdir(join(tmpDir, 'bad.test.ts'), { recursive: true });

      const agent = new RedTeamAgent();
      const result = await agent.challenge(
        'const x = 1;',
        'const x = 2;',
        'bad.test.ts',
        tmpDir,
      );

      expect(result.challenged).toBe(false);
      expect(result.rollbackRecommended).toBe(false);
      expect(result.reasoning).toContain('Could not read test file');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------- detectTestFile ----------

describe('detectTestFile', () => {
  it('finds foo.test.ts for foo.ts in same directory', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-test-'));
    try {
      await writeFile(join(tmpDir, 'src', 'foo.ts'), '', { flag: 'w' }).catch(() => {});
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'foo.test.ts'), '');

      const result = await detectTestFile('src/foo.ts', tmpDir);
      expect(result).toBe(join('src', 'foo.test.ts'));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds __tests__/foo.test.ts for foo.ts', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-test-'));
    try {
      await mkdir(join(tmpDir, 'src', '__tests__'), { recursive: true });
      await writeFile(join(tmpDir, 'src', '__tests__', 'foo.test.ts'), '');

      const result = await detectTestFile('src/foo.ts', tmpDir);
      expect(result).toBe(join('src', '__tests__', 'foo.test.ts'));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds tests/foo.test.ts at repo root', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-test-'));
    try {
      await mkdir(join(tmpDir, 'tests'), { recursive: true });
      await writeFile(join(tmpDir, 'tests', 'foo.test.ts'), '');

      const result = await detectTestFile('src/foo.ts', tmpDir);
      expect(result).toBe(join('tests', 'foo.test.ts'));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns undefined when no test file exists', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-test-'));
    try {
      const result = await detectTestFile('src/bar.ts', tmpDir);
      expect(result).toBeUndefined();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('prefers same-directory test over __tests__ directory', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-test-'));
    try {
      await mkdir(join(tmpDir, 'src', '__tests__'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'foo.test.ts'), '');
      await writeFile(join(tmpDir, 'src', '__tests__', 'foo.test.ts'), '');

      const result = await detectTestFile('src/foo.ts', tmpDir);
      // Same directory should be found first
      expect(result).toBe(join('src', 'foo.test.ts'));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------- RedTeamResult interface shape ----------

describe('RedTeamResult shape', () => {
  it('has all required fields when challenged', () => {
    const result: RedTeamResult = {
      challenged: true,
      testPassed: true,
      testFailed: false,
      testCode: 'it("test", () => expect(1).toBe(1));',
      reasoning: 'Testing return value',
      rollbackRecommended: false,
    };

    expect(result).toHaveProperty('challenged');
    expect(result).toHaveProperty('testPassed');
    expect(result).toHaveProperty('testFailed');
    expect(result).toHaveProperty('testCode');
    expect(result).toHaveProperty('reasoning');
    expect(result).toHaveProperty('rollbackRecommended');
  });

  it('rollbackRecommended is true when test fails', () => {
    const result: RedTeamResult = {
      challenged: true,
      testPassed: false,
      testFailed: true,
      testCode: 'it("test", () => expect(1).toBe(2));',
      reasoning: 'Return value changed incorrectly',
      rollbackRecommended: true,
    };

    expect(result.rollbackRecommended).toBe(true);
    expect(result.testFailed).toBe(true);
    expect(result.testPassed).toBe(false);
  });
});
