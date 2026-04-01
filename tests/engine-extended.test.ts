import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { runEngine } from '../src/core/engine.js';
import type { Agent } from '../src/core/agents/base.js';
import type { Target, BuildResult, RatchetConfig } from '../src/types.js';

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@ratchet.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Ratchet Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
}

function makeConfig(): RatchetConfig {
  return {
    agent: 'shell',
    defaults: { clicks: 3, testCommand: 'node --version', autoCommit: false },
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

describe('runEngine', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-engine-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs N clicks and returns a RatchetRun', async () => {
    const run = await runEngine({
      target: makeTarget(),
      clicks: 2,
      config: makeConfig(),
      cwd: dir,
      agent: makeAgent(),
      createBranch: false,
    });
    expect(run.clicks).toHaveLength(2);
    expect(run.status).toBe('completed');
  });

  it('sets run.status to completed on success', async () => {
    const run = await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent: makeAgent(),
      createBranch: false,
    });
    expect(run.status).toBe('completed');
  });

  it('sets run.finishedAt after completing', async () => {
    const before = new Date();
    const run = await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent: makeAgent(),
      createBranch: false,
    });
    expect(run.finishedAt).toBeDefined();
    expect(run.finishedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('calls onClickStart for each click', async () => {
    const onClickStart = vi.fn();
    await runEngine({
      target: makeTarget(),
      clicks: 3,
      config: makeConfig(),
      cwd: dir,
      agent: makeAgent(),
      createBranch: false,
      callbacks: { onClickStart },
    });
    expect(onClickStart).toHaveBeenCalledTimes(3);
    expect(onClickStart).toHaveBeenNthCalledWith(1, 1, 3, undefined);
    expect(onClickStart).toHaveBeenNthCalledWith(2, 2, 3, undefined);
    expect(onClickStart).toHaveBeenNthCalledWith(3, 3, 3, undefined);
  });

  it('calls onClickComplete for each completed click', async () => {
    const onClickComplete = vi.fn();
    await runEngine({
      target: makeTarget(),
      clicks: 2,
      config: makeConfig(),
      cwd: dir,
      agent: makeAgent(),
      createBranch: false,
      callbacks: { onClickComplete },
    });
    expect(onClickComplete).toHaveBeenCalledTimes(2);
  });

  it('calls onRunComplete with the finished run', async () => {
    const onRunComplete = vi.fn();
    await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent: makeAgent(),
      createBranch: false,
      callbacks: { onRunComplete },
    });
    expect(onRunComplete).toHaveBeenCalledOnce();
    const [run] = onRunComplete.mock.calls[0];
    expect(run.status).toBe('completed');
    expect(run.clicks).toHaveLength(1);
  });

  it('calls onError when executeClick throws (non-git dir)', async () => {
    const onError = vi.fn();
    const nonGitDir = mkdtempSync(join(tmpdir(), 'ratchet-nongit-'));
    try {
      await runEngine({
        target: makeTarget(),
        clicks: 1,
        config: makeConfig(),
        cwd: nonGitDir,
        agent: makeAgent(),
        createBranch: false,
        callbacks: { onError },
      });
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][1]).toBe(1);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('records all clicks even when agent errors are caught internally', async () => {
    // executeClick catches agent errors — click still records with testsPassed=false
    let callCount = 0;
    const mixedAgent: Agent = {
      analyze: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('first agent exploded');
        return Promise.resolve('analysis');
      }),
      propose: vi.fn().mockResolvedValue('proposal'),
      build: vi.fn().mockResolvedValue({ success: true, output: 'ok', filesModified: [] }),
    };
    const run = await runEngine({
      target: makeTarget(),
      clicks: 2,
      config: makeConfig(),
      cwd: dir,
      agent: mixedAgent,
      createBranch: false,
    });
    // Both clicks recorded — executeClick handles agent errors gracefully
    expect(run.status).toBe('completed');
    expect(run.clicks).toHaveLength(2);
    expect(run.clicks[0].testsPassed).toBe(false);
  });

  it('creates a git branch when createBranch=true', async () => {
    const { currentBranch } = await import('../src/core/git.js');
    const run = await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent: makeAgent(),
      createBranch: true,
    });
    const branch = await currentBranch(dir);
    expect(branch).toMatch(/^ratchet\//);
    expect(run.status).toBe('completed');
  });
});
