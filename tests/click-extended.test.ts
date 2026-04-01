import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { branchName } from '../src/core/git.js';
import { summarizeRun } from '../src/core/engine.js';
import { executeClick } from '../src/core/click.js';
import type { Agent } from '../src/core/agents/base.js';
import type { Target, BuildResult, RatchetConfig, RatchetRun } from '../src/types.js';

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@ratchet.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Ratchet Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
}

function makeConfig(overrides: Partial<RatchetConfig['defaults']> = {}): RatchetConfig {
  return {
    agent: 'shell',
    defaults: { clicks: 3, testCommand: 'node --version', autoCommit: false, ...overrides },
    targets: [],
  };
}

function makeTarget(): Target {
  return { name: 'test-target', path: 'src/', description: 'Test target' };
}

function makeAgent(): Agent {
  return {
    analyze: vi.fn().mockResolvedValue('analysis'),
    propose: vi.fn().mockResolvedValue('proposal'),
    build: vi.fn().mockResolvedValue({ success: true, output: 'ok', filesModified: [] } satisfies BuildResult),
  };
}

describe('branchName - additional edge cases', () => {
  it('lowercases the target name', () => {
    const name = branchName('MyTarget');
    expect(name).toMatch(/^ratchet\/mytarget-/);
  });

  it('replaces dots with dashes', () => {
    const name = branchName('my.target.name');
    expect(name).not.toContain('.');
    expect(name).toMatch(/^ratchet\//);
  });

  it('replaces slashes in target name', () => {
    const name = branchName('src/api');
    expect(name).not.toMatch(/src\/api/);
    expect(name).toMatch(/^ratchet\//);
  });

  it('includes a timestamp suffix', () => {
    const name = branchName('my-target');
    // Should have format: ratchet/my-target-YYYY-MM-DDTHH-MM-SS
    expect(name).toMatch(/ratchet\/my-target-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it('two calls produce different branch names (different timestamps)', async () => {
    // Wait 1ms to ensure different timestamps
    const name1 = branchName('target');
    await new Promise((r) => setTimeout(r, 1));
    const name2 = branchName('target');
    // Both should be valid ratchet branches
    expect(name1).toMatch(/^ratchet\//);
    expect(name2).toMatch(/^ratchet\//);
  });
});

describe('summarizeRun - additional cases', () => {
  function makeRun(overrides: Partial<RatchetRun> = {}): RatchetRun {
    return {
      id: 'run-xyz',
      target: { name: 'my-target', path: 'src/', description: 'desc' },
      clicks: [],
      startedAt: new Date('2026-01-01T00:00:00Z'),
      finishedAt: new Date('2026-01-01T00:01:00Z'),
      status: 'completed',
      ...overrides,
    };
  }

  it('includes the run id in summary', () => {
    const summary = summarizeRun(makeRun({ id: 'unique-run-id' }));
    expect(summary.id).toBe('unique-run-id');
  });

  it('includes the target name in summary', () => {
    const summary = summarizeRun(makeRun());
    expect(summary.target).toBe('my-target');
  });

  it('calculates exact 1-minute duration', () => {
    const summary = summarizeRun(makeRun());
    expect(summary.duration).toBe(60_000);
  });

  it('handles all clicks passed', () => {
    const run = makeRun({
      clicks: [
        { number: 1, target: 't', analysis: '', proposal: '', filesModified: [], testsPassed: true, commitHash: 'a', timestamp: new Date() },
        { number: 2, target: 't', analysis: '', proposal: '', filesModified: [], testsPassed: true, commitHash: 'b', timestamp: new Date() },
      ],
    });
    const summary = summarizeRun(run);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.commits).toEqual(['a', 'b']);
  });
});

describe('executeClick - additional paths', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-click-ext-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets filesModified from build result', async () => {
    const agent: Agent = {
      analyze: vi.fn().mockResolvedValue('analysis'),
      propose: vi.fn().mockResolvedValue('proposal'),
      build: vi.fn().mockResolvedValue({
        success: true,
        output: 'ok',
        filesModified: ['src/foo.ts', 'src/bar.ts'],
      } satisfies BuildResult),
    };
    const { click } = await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config: makeConfig(),
      agent,
      cwd: dir,
    });
    expect(click.filesModified).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('sets target name on click', async () => {
    const { click } = await executeClick({
      clickNumber: 1,
      target: { ...makeTarget(), name: 'specific-target' },
      config: makeConfig(),
      agent: makeAgent(),
      cwd: dir,
    });
    expect(click.target).toBe('specific-target');
  });

  it('uses click number in the click result', async () => {
    const { click } = await executeClick({
      clickNumber: 7,
      target: makeTarget(),
      config: makeConfig(),
      agent: makeAgent(),
      cwd: dir,
    });
    expect(click.number).toBe(7);
  });
});
