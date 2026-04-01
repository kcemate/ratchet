import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import type { Agent } from '../src/core/agents/base.js';
import { createAgentContext } from '../src/core/agents/base.js';
import type { Target, BuildResult, RatchetConfig, HardenPhase } from '../src/types.js';
import { executeClick } from '../src/core/click.js';
import { runEngine } from '../src/core/engine.js';
import { countTestFiles } from '../src/core/detect.js';

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

function makeAgent(hardenPhasesSeen: HardenPhase[] = [], buildSuccess = true): Agent {
  return {
    analyze: vi.fn().mockImplementation(async (_ctx: string, hardenPhase?: HardenPhase) => {
      if (hardenPhase) hardenPhasesSeen.push(hardenPhase);
      return 'Mocked analysis';
    }),
    propose: vi.fn().mockResolvedValue('Mocked proposal: add a comment'),
    build: vi.fn().mockResolvedValue({
      success: buildSuccess,
      output: 'build output',
      filesModified: [],
    } satisfies BuildResult),
  };
}

// ─── createAgentContext with hardenPhase ──────────────────────────────────────

describe('createAgentContext with hardenPhase', () => {
  const target: Target = {
    name: 'my-target',
    path: 'src/',
    description: 'Test target',
  };

  it('omits Mode line when hardenPhase is undefined', () => {
    const ctx = createAgentContext(target, 1);
    expect(ctx.split('\n')).toHaveLength(4);
    expect(ctx).not.toContain('Mode:');
  });

  it('adds Mode: harden:tests line when hardenPhase is harden:tests', () => {
    const ctx = createAgentContext(target, 1, 'harden:tests');
    expect(ctx).toContain('Mode: harden:tests');
    expect(ctx.split('\n')).toHaveLength(5);
  });

  it('adds Mode: improve line when hardenPhase is improve', () => {
    const ctx = createAgentContext(target, 2, 'improve');
    expect(ctx).toContain('Mode: improve');
    expect(ctx.split('\n')).toHaveLength(5);
  });
});

// ─── executeClick with hardenPhase ───────────────────────────────────────────

describe('executeClick with hardenPhase', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-harden-click-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes hardenPhase to agent.analyze', async () => {
    const phasesSeen: HardenPhase[] = [];
    const agent = makeAgent(phasesSeen);
    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
      hardenPhase: 'harden:tests',
    });

    expect(phasesSeen).toContain('harden:tests');
  });

  it('passes undefined hardenPhase when not set', async () => {
    const phasesSeen: HardenPhase[] = [];
    const agent = makeAgent(phasesSeen);
    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    await executeClick({
      clickNumber: 1,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
    });

    expect(phasesSeen).toHaveLength(0);
  });

  it('passes improve phase to agent', async () => {
    const phasesSeen: HardenPhase[] = [];
    const agent = makeAgent(phasesSeen);
    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    await executeClick({
      clickNumber: 3,
      target: makeTarget(),
      config,
      agent,
      cwd: dir,
      hardenPhase: 'improve',
    });

    expect(phasesSeen).toContain('improve');
  });
});

// ─── runEngine harden mode ────────────────────────────────────────────────────

describe('runEngine harden mode', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-harden-engine-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sends harden:tests phase to first two clicks', async () => {
    const clickStartPhases: Array<HardenPhase | undefined> = [];
    const agent = makeAgent();
    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    await runEngine({
      target: makeTarget(),
      clicks: 4,
      config,
      cwd: dir,
      agent,
      createBranch: false,
      hardenMode: true,
      callbacks: {
        onClickStart: (_num, _total, hardenPhase) => {
          clickStartPhases.push(hardenPhase);
        },
      },
    });

    expect(clickStartPhases[0]).toBe('harden:tests');
    expect(clickStartPhases[1]).toBe('harden:tests');
  });

  it('transitions to improve phase after click 3 if no new test files', async () => {
    const clickStartPhases: Array<HardenPhase | undefined> = [];
    const agent = makeAgent();
    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    await runEngine({
      target: makeTarget(),
      clicks: 4,
      config,
      cwd: dir,
      agent,
      createBranch: false,
      hardenMode: true,
      callbacks: {
        onClickStart: (_num, _total, hardenPhase) => {
          clickStartPhases.push(hardenPhase);
        },
      },
    });

    // Clicks 1-3: harden:tests (no new test files written)
    expect(clickStartPhases[2]).toBe('harden:tests');
    // Click 4: improve (forced transition after 3rd test click)
    expect(clickStartPhases[3]).toBe('improve');
  });

  it('transitions to improve at click 3 when test files added after click 2', async () => {
    const clickStartPhases: Array<HardenPhase | undefined> = [];
    let clickCount = 0;

    // Agent that writes a test file on click 2
    const agent: Agent = {
      analyze: vi.fn().mockResolvedValue('analysis'),
      propose: vi.fn().mockResolvedValue('proposal'),
      build: vi.fn().mockImplementation(async (_proposal: string, cwd: string): Promise<BuildResult> => {
        clickCount++;
        if (clickCount === 2) {
          // Write a test file to simulate tests being created
          mkdirSync(join(cwd, 'tests'), { recursive: true });
          writeFileSync(join(cwd, 'tests', 'new.test.ts'), '// new test\n');
        }
        return { success: true, output: 'ok', filesModified: [] };
      }),
    };

    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    await runEngine({
      target: makeTarget(),
      clicks: 4,
      config,
      cwd: dir,
      agent,
      createBranch: false,
      hardenMode: true,
      callbacks: {
        onClickStart: (_num, _total, hardenPhase) => {
          clickStartPhases.push(hardenPhase);
        },
      },
    });

    // Click 3 should be improve since test files increased after click 2
    expect(clickStartPhases[2]).toBe('improve');
    expect(clickStartPhases[3]).toBe('improve');
  });

  it('sends undefined hardenPhase when hardenMode is false', async () => {
    const clickStartPhases: Array<HardenPhase | undefined> = [];
    const agent = makeAgent();
    const config = makeConfig({ testCommand: 'node --version', autoCommit: false });

    await runEngine({
      target: makeTarget(),
      clicks: 3,
      config,
      cwd: dir,
      agent,
      createBranch: false,
      hardenMode: false,
      callbacks: {
        onClickStart: (_num, _total, hardenPhase) => {
          clickStartPhases.push(hardenPhase);
        },
      },
    });

    expect(clickStartPhases.every((p) => p === undefined)).toBe(true);
  });
});

// ─── countTestFiles ───────────────────────────────────────────────────────────

describe('countTestFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-count-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 0 for empty directory', () => {
    expect(countTestFiles(dir)).toBe(0);
  });

  it('counts .test.ts files', () => {
    writeFileSync(join(dir, 'foo.test.ts'), '// test');
    expect(countTestFiles(dir)).toBe(1);
  });

  it('counts .spec.ts files', () => {
    writeFileSync(join(dir, 'bar.spec.ts'), '// test');
    expect(countTestFiles(dir)).toBe(1);
  });

  it('counts test_ prefixed files', () => {
    writeFileSync(join(dir, 'test_foo.py'), '# test');
    expect(countTestFiles(dir)).toBe(1);
  });

  it('counts _test suffixed files', () => {
    writeFileSync(join(dir, 'foo_test.go'), '// test');
    expect(countTestFiles(dir)).toBe(1);
  });

  it('counts multiple test files across subdirectories', () => {
    mkdirSync(join(dir, 'tests'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'tests', 'a.test.ts'), '// test');
    writeFileSync(join(dir, 'tests', 'b.test.ts'), '// test');
    writeFileSync(join(dir, 'src', 'c.spec.js'), '// test');
    writeFileSync(join(dir, 'src', 'helper.ts'), '// not a test');
    expect(countTestFiles(dir)).toBe(3);
  });

  it('ignores node_modules directory', () => {
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'foo.test.js'), '// test');
    expect(countTestFiles(dir)).toBe(0);
  });

  it('ignores .git directory', () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'foo.test.ts'), '// test');
    expect(countTestFiles(dir)).toBe(0);
  });
});
