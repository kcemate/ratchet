import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import type { Agent } from '../src/core/agents/base.js';
import type { Target, BuildResult, RatchetConfig } from '../src/types.js';
import { executeClick } from '../src/core/click.js';

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
    defaults: {
      clicks: 3,
      testCommand: 'node --version',
      autoCommit: false,
      ...overrides,
    },
    targets: [],
  };
}

function makeTarget(): Target {
  return {
    name: 'test-target',
    path: 'src/',
    description: 'Test description',
  };
}

function makeAgent(buildSuccess: boolean = true, filesModified: string[] = []): Agent {
  return {
    analyze: vi.fn().mockResolvedValue('Mocked analysis'),
    propose: vi.fn().mockResolvedValue('Mocked proposal: add a comment'),
    build: vi.fn().mockResolvedValue({
      success: buildSuccess,
      output: 'build output',
      filesModified,
    } satisfies BuildResult),
  };
}

describe('executeClick', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-click-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs analyze → propose → build sequence', async () => {
    const agent = makeAgent(true);
    const config = makeConfig({ testCommand: 'node --version' });

    const { click } = await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
    });

    expect(agent.analyze).toHaveBeenCalledOnce();
    expect(agent.propose).toHaveBeenCalledOnce();
    expect(agent.build).toHaveBeenCalledOnce();
    expect(click.number).toBe(1);
    expect(click.analysis).toBe('Mocked analysis');
    expect(click.proposal).toBe('Mocked proposal: add a comment');
  });

  it('sets testsPassed=true when tests pass', async () => {
    const agent = makeAgent(true);
    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    const { click, rolled_back } = await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
    });

    expect(click.testsPassed).toBe(true);
    expect(rolled_back).toBe(false);
  });

  it('rolls back and sets testsPassed=false when tests fail', async () => {
    const agent = makeAgent(true);
    const config = makeConfig({ testCommand: 'node -e "process.exit(1)"', autoCommit: false });

    const { click, rolled_back } = await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
    });

    expect(click.testsPassed).toBe(false);
    expect(rolled_back).toBe(true);
    expect(click.commitHash).toBeUndefined();
  });

  it('rolls back when build fails', async () => {
    const agent = makeAgent(false);
    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    const { click, rolled_back } = await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
    });

    expect(rolled_back).toBe(true);
    expect(click.testsPassed).toBe(false);
  });

  it('creates a commit when autoCommit=true and tests pass', async () => {
    // Build mock that actually writes a file so git commit has something to commit
    const agent: Agent = {
      analyze: vi.fn().mockResolvedValue('Mocked analysis'),
      propose: vi.fn().mockResolvedValue('Mocked proposal: add a comment'),
      build: vi.fn().mockImplementation(async (_proposal: string, cwd: string): Promise<BuildResult> => {
        writeFileSync(join(cwd, 'generated.ts'), `export const x = ${Date.now()};\n`);
        return { success: true, output: 'ok', filesModified: ['generated.ts'] };
      }),
    };
    const config = makeConfig({ testCommand: 'node --version', autoCommit: true });

    const { click } = await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
    });

    expect(click.commitHash).toBeDefined();
    expect(click.commitHash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('sets timestamp on click', async () => {
    const before = new Date();
    const agent = makeAgent(true);
    const config = makeConfig({ testCommand: 'node --version' });

    const { click } = await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
    });

    expect(click.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
