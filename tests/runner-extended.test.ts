import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseCommand, runTests, detectTestCommand } from '../src/core/runner.js';

describe('parseCommand - additional cases', () => {
  it('handles mixed quotes in single command', () => {
    // After quoting is stripped, should produce two tokens
    const result = parseCommand('"node" --version');
    expect(result).toEqual(['node', '--version']);
  });

  it('preserves spaces inside double quotes', () => {
    const result = parseCommand('node -e "console.log(1 + 2)"');
    expect(result).toEqual(['node', '-e', 'console.log(1 + 2)']);
  });

  it('handles empty string', () => {
    const result = parseCommand('');
    expect(result).toEqual([]);
  });

  it('handles trailing whitespace', () => {
    const result = parseCommand('npm test   ');
    expect(result).toEqual(['npm', 'test']);
  });
});

describe('detectTestCommand - additional project types', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-runner-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects pytest for pytest.ini', async () => {
    writeFileSync(join(dir, 'pytest.ini'), '[pytest]\n');
    const cmd = await detectTestCommand(dir);
    expect(cmd).toBe('pytest');
  });

  it('detects pytest for pyproject.toml', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.pytest]\n');
    const cmd = await detectTestCommand(dir);
    expect(cmd).toBe('pytest');
  });

  it('detects cargo test for Cargo.toml', async () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "app"\n');
    const cmd = await detectTestCommand(dir);
    expect(cmd).toBe('cargo test');
  });

  it('detects make test for Makefile', async () => {
    writeFileSync(join(dir, 'Makefile'), 'test:\n\techo done\n');
    const cmd = await detectTestCommand(dir);
    expect(cmd).toBe('make test');
  });

  it('prefers package.json over Makefile', async () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'Makefile'), 'test:\n\techo done\n');
    const cmd = await detectTestCommand(dir);
    expect(cmd).toBe('npm test');
  });
});

describe('runTests - additional cases', () => {
  it('captures stderr output', async () => {
    const result = await runTests({
      command: 'node -e "process.stderr.write(\'err output\')"',
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(true);
    expect(result.output).toContain('err output');
  });

  it('returns error message on failure', async () => {
    const result = await runTests({
      command: 'node -e "process.exit(42)"',
      cwd: process.cwd(),
    });
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  it('respects custom timeout parameter type', async () => {
    // Just verify the function signature accepts timeout without throwing
    const result = await runTests({
      command: 'node --version',
      cwd: process.cwd(),
      timeout: 30_000,
    });
    expect(result.passed).toBe(true);
  });
});
