import { describe, it, expect } from 'vitest';
import { parseCommand, runTests } from '../src/core/runner.js';
import { tmpdir } from 'os';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';

describe('parseCommand', () => {
  it('splits simple command', () => {
    expect(parseCommand('npm test')).toEqual(['npm', 'test']);
  });

  it('splits command with multiple args', () => {
    expect(parseCommand('npx vitest run --reporter verbose')).toEqual([
      'npx', 'vitest', 'run', '--reporter', 'verbose',
    ]);
  });

  it('handles single-quoted strings', () => {
    expect(parseCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('handles double-quoted strings', () => {
    expect(parseCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('handles single word', () => {
    expect(parseCommand('make')).toEqual(['make']);
  });

  it('collapses extra spaces', () => {
    expect(parseCommand('npm  test')).toEqual(['npm', 'test']);
  });
});

describe('runTests', () => {
  it('returns passed=true for successful command', async () => {
    const result = await runTests({
      command: 'node --version',
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
    expect(result.output).toMatch(/v\d+/);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('returns passed=false for failing command', async () => {
    const result = await runTests({
      command: 'node -e "process.exit(1)"',
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('captures stdout output', async () => {
    const result = await runTests({
      command: 'node -e "console.log(\'hello\')"',
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('measures duration', async () => {
    const result = await runTests({
      command: 'node --version',
      cwd: process.cwd(),
    });
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeLessThan(10_000);
  });

  it('returns friendly error when binary is not found', async () => {
    const result = await runTests({
      command: 'nonexistent-binary-xyz --test',
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(result.error).toContain('nonexistent-binary-xyz');
    expect(result.error).toContain('.ratchet.yml');
  });
});

describe('detectTestCommand', () => {
  it('detects npm for package.json projects', async () => {
    const { detectTestCommand } = await import('../src/core/runner.js');
    const cmd = await detectTestCommand(process.cwd());
    // This project has a package.json
    expect(cmd).toBe('npm test');
  });

  it('falls back to npm test for unknown project', async () => {
    const { detectTestCommand } = await import('../src/core/runner.js');
    const dir = mkdtempSync(join(tmpdir(), 'ratchet-test-'));
    const cmd = await detectTestCommand(dir);
    expect(cmd).toBe('npm test');
  });

  it('detects go for go.mod projects', async () => {
    const { detectTestCommand } = await import('../src/core/runner.js');
    const dir = mkdtempSync(join(tmpdir(), 'ratchet-go-'));
    writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.21\n');
    const cmd = await detectTestCommand(dir);
    expect(cmd).toBe('go test ./...');
  });
});
