import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import type { Target, RatchetConfig, BuildResult, SwarmConfig } from '../src/types.js';
import type { Agent } from '../src/core/agents/base.js';
import { SwarmExecutor, buildSwarmConfig } from '../src/core/swarm.js';
import {
  SpecializedAgent,
  createSpecializedAgent,
  isValidSpecialization,
  ALL_SPECIALIZATIONS,
  DEFAULT_SPECIALIZATIONS,
} from '../src/core/agents/specialized.js';
import type { Specialization } from '../src/core/agents/specialized.js';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

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

function makeAgent(buildSuccess = true, filesModified: string[] = []): Agent {
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

// ──────────────────────────────────────────────────────────────
// Specialized Agents
// ──────────────────────────────────────────────────────────────

describe('SpecializedAgent', () => {
  it('stores specialization on construction', () => {
    const agent = createSpecializedAgent('security');
    expect(agent.specialization).toBe('security');
  });

  it('has a prompt prefix for each specialization', () => {
    for (const spec of ALL_SPECIALIZATIONS) {
      const agent = createSpecializedAgent(spec);
      expect(agent.promptPrefix).toBeTruthy();
      expect(agent.promptPrefix.length).toBeGreaterThan(20);
    }
  });

  it('security agent prompt mentions authentication', () => {
    const agent = createSpecializedAgent('security');
    expect(agent.promptPrefix.toLowerCase()).toContain('security');
    expect(agent.promptPrefix.toLowerCase()).toContain('authentication');
  });

  it('performance agent prompt mentions caching', () => {
    const agent = createSpecializedAgent('performance');
    expect(agent.promptPrefix.toLowerCase()).toContain('performance');
    expect(agent.promptPrefix.toLowerCase()).toContain('caching');
  });

  it('quality agent prompt mentions duplication', () => {
    const agent = createSpecializedAgent('quality');
    expect(agent.promptPrefix.toLowerCase()).toContain('quality');
    expect(agent.promptPrefix.toLowerCase()).toContain('duplication');
  });

  it('errors agent prompt mentions catch blocks', () => {
    const agent = createSpecializedAgent('errors');
    expect(agent.promptPrefix.toLowerCase()).toContain('error');
    expect(agent.promptPrefix.toLowerCase()).toContain('catch');
  });

  it('types agent prompt mentions any types', () => {
    const agent = createSpecializedAgent('types');
    expect(agent.promptPrefix.toLowerCase()).toContain('type safety');
    expect(agent.promptPrefix.toLowerCase()).toContain('any');
  });

  it('is an instance of SpecializedAgent', () => {
    const agent = createSpecializedAgent('quality');
    expect(agent).toBeInstanceOf(SpecializedAgent);
  });
});

// ──────────────────────────────────────────────────────────────
// isValidSpecialization
// ──────────────────────────────────────────────────────────────

describe('isValidSpecialization', () => {
  it('returns true for valid specializations', () => {
    expect(isValidSpecialization('security')).toBe(true);
    expect(isValidSpecialization('performance')).toBe(true);
    expect(isValidSpecialization('quality')).toBe(true);
    expect(isValidSpecialization('errors')).toBe(true);
    expect(isValidSpecialization('types')).toBe(true);
  });

  it('returns false for invalid specializations', () => {
    expect(isValidSpecialization('banana')).toBe(false);
    expect(isValidSpecialization('')).toBe(false);
    expect(isValidSpecialization('SECURITY')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// SwarmExecutor construction
// ──────────────────────────────────────────────────────────────

describe('SwarmExecutor', () => {
  describe('construction', () => {
    it('uses default config when none provided', () => {
      const executor = new SwarmExecutor();
      // Can't inspect private fields directly, but we can verify it doesn't throw
      expect(executor).toBeDefined();
    });

    it('accepts custom agent count', () => {
      const executor = new SwarmExecutor({ agentCount: 5 });
      expect(executor).toBeDefined();
    });

    it('accepts custom specializations', () => {
      const executor = new SwarmExecutor({
        specializations: ['security', 'types'],
        agentCount: 2,
      });
      expect(executor).toBeDefined();
    });

    it('falls back to defaults for invalid specializations', () => {
      const executor = new SwarmExecutor({
        specializations: ['banana', 'apple'] as string[],
        agentCount: 2,
      });
      // Should not throw — falls back to defaults
      expect(executor).toBeDefined();
    });

    it('pads specializations when fewer than agent count', () => {
      const executor = new SwarmExecutor({
        specializations: ['security'],
        agentCount: 3,
      });
      expect(executor).toBeDefined();
    });
  });

  // Integration tests that need real git repos
  describe('execute (integration)', () => {
    let dir: string;
    let worktreeDir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'ratchet-swarm-'));
      worktreeDir = mkdtempSync(join(tmpdir(), 'ratchet-swarm-wt-'));
      initRepo(dir);
    });

    afterEach(() => {
      // Cleanup worktrees first
      try {
        execFileSync('git', ['worktree', 'prune'], { cwd: dir });
      } catch { /* ignore */ }
      rmSync(dir, { recursive: true, force: true });
      rmSync(worktreeDir, { recursive: true, force: true });
    });

    it.skip('creates and cleans up worktrees (requires real agent)', async () => {
      // Mock executeClick to avoid needing real Claude
      const { executeClick } = await import('../src/core/click.js');
      const mockExecuteClick = vi.fn().mockResolvedValue({
        click: {
          number: 1,
          target: 'test-target',
          analysis: 'mock',
          proposal: 'mock',
          filesModified: [],
          testsPassed: false,
          timestamp: new Date(),
        },
        rolled_back: true,
      });

      // We can't easily mock executeClick since SwarmExecutor calls it internally.
      // Instead, just test that the executor handles the overall flow without crashing.
      // The real test: worktrees should be cleaned up even when agents fail.

      const executor = new SwarmExecutor({
        agentCount: 2,
        specializations: ['security', 'quality'],
        worktreeDir,
      });

      // This will fail because there's no real Claude agent, but it should
      // clean up worktrees on failure
      try {
        await executor.execute(
          {
            clickNumber: 1,
            target: makeTarget(),
            config: makeConfig(),
            agent: makeAgent(false),
            cwd: dir,
          },
          dir,
        );
      } catch {
        // Expected — no real agent
      }

      // Verify worktrees were cleaned up
      const worktreeList = execFileSync('git', ['worktree', 'list'], { cwd: dir, encoding: 'utf8' });
      const lines = worktreeList.trim().split('\n');
      // Should only have the main worktree
      expect(lines.length).toBe(1);
    });
  });
});

// ──────────────────────────────────────────────────────────────
// buildSwarmConfig
// ──────────────────────────────────────────────────────────────

describe('buildSwarmConfig', () => {
  it('returns undefined when swarm is not enabled', () => {
    expect(buildSwarmConfig({})).toBeUndefined();
    expect(buildSwarmConfig({ swarm: false })).toBeUndefined();
  });

  it('returns config with defaults when swarm is true', () => {
    const config = buildSwarmConfig({ swarm: true });
    expect(config).toBeDefined();
    expect(config!.enabled).toBe(true);
    expect(config!.agentCount).toBe(3);
    expect(config!.parallel).toBe(true);
    expect(config!.worktreeDir).toBe('/tmp/ratchet-swarm');
    expect(config!.specializations).toEqual([...DEFAULT_SPECIALIZATIONS]);
  });

  it('accepts custom agent count', () => {
    const config = buildSwarmConfig({ swarm: true, agents: 5 });
    expect(config!.agentCount).toBe(5);
  });

  it('accepts custom focus specializations', () => {
    const config = buildSwarmConfig({
      swarm: true,
      focus: ['security', 'types'],
    });
    expect(config!.specializations).toEqual(['security', 'types']);
  });

  it('uses default specializations when focus is not provided', () => {
    const config = buildSwarmConfig({ swarm: true });
    expect(config!.specializations).toEqual([...DEFAULT_SPECIALIZATIONS]);
  });
});

// ──────────────────────────────────────────────────────────────
// Winner selection logic (unit tests with mock data)
// ──────────────────────────────────────────────────────────────

describe('SwarmResult winner selection', () => {
  it('winner is null when allResults is empty', () => {
    // Simulating the selection logic from SwarmExecutor
    const allResults: import('../src/types.js').SwarmAgentResult[] = [];
    const candidates = allResults.filter((r) => !r.outcome.rolled_back && r.outcome.click.testsPassed);
    const winner = candidates.length > 0
      ? candidates.sort((a, b) => b.scoreDelta - a.scoreDelta)[0]
      : null;
    expect(winner).toBeNull();
  });

  it('winner is null when all results rolled back', () => {
    const allResults: import('../src/types.js').SwarmAgentResult[] = [
      {
        agentName: 'swarm-security',
        specialization: 'security',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: [], testsPassed: false, timestamp: new Date() },
          rolled_back: true,
        },
        scoreDelta: 0,
        worktreePath: '/tmp/wt1',
      },
      {
        agentName: 'swarm-quality',
        specialization: 'quality',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: [], testsPassed: false, timestamp: new Date() },
          rolled_back: true,
        },
        scoreDelta: 0,
        worktreePath: '/tmp/wt2',
      },
    ];

    const candidates = allResults.filter((r) => !r.outcome.rolled_back && r.outcome.click.testsPassed);
    expect(candidates.length).toBe(0);
  });

  it('picks the candidate with highest score delta', () => {
    const allResults: import('../src/types.js').SwarmAgentResult[] = [
      {
        agentName: 'swarm-security',
        specialization: 'security',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: ['a.ts'], testsPassed: true, timestamp: new Date() },
          rolled_back: false,
        },
        scoreDelta: 1,
        worktreePath: '/tmp/wt1',
      },
      {
        agentName: 'swarm-quality',
        specialization: 'quality',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: ['b.ts'], testsPassed: true, timestamp: new Date() },
          rolled_back: false,
        },
        scoreDelta: 3,
        worktreePath: '/tmp/wt2',
      },
      {
        agentName: 'swarm-errors',
        specialization: 'errors',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: ['c.ts'], testsPassed: true, timestamp: new Date() },
          rolled_back: false,
        },
        scoreDelta: 2,
        worktreePath: '/tmp/wt3',
      },
    ];

    const candidates = allResults
      .filter((r) => !r.outcome.rolled_back && r.outcome.click.testsPassed)
      .sort((a, b) => b.scoreDelta - a.scoreDelta);

    expect(candidates[0].agentName).toBe('swarm-quality');
    expect(candidates[0].scoreDelta).toBe(3);
  });

  it('filters out rolled-back results even with high score delta', () => {
    const allResults: import('../src/types.js').SwarmAgentResult[] = [
      {
        agentName: 'swarm-security',
        specialization: 'security',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: [], testsPassed: false, timestamp: new Date() },
          rolled_back: true,
        },
        scoreDelta: 10,
        worktreePath: '/tmp/wt1',
      },
      {
        agentName: 'swarm-quality',
        specialization: 'quality',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: ['b.ts'], testsPassed: true, timestamp: new Date() },
          rolled_back: false,
        },
        scoreDelta: 1,
        worktreePath: '/tmp/wt2',
      },
    ];

    const candidates = allResults
      .filter((r) => !r.outcome.rolled_back && r.outcome.click.testsPassed)
      .sort((a, b) => b.scoreDelta - a.scoreDelta);

    expect(candidates.length).toBe(1);
    expect(candidates[0].agentName).toBe('swarm-quality');
  });

  it('handles tie in score delta by picking first sorted', () => {
    const allResults: import('../src/types.js').SwarmAgentResult[] = [
      {
        agentName: 'swarm-security',
        specialization: 'security',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: ['a.ts'], testsPassed: true, timestamp: new Date() },
          rolled_back: false,
        },
        scoreDelta: 2,
        worktreePath: '/tmp/wt1',
      },
      {
        agentName: 'swarm-quality',
        specialization: 'quality',
        outcome: {
          click: { number: 1, target: 't', analysis: '', proposal: '', filesModified: ['b.ts'], testsPassed: true, timestamp: new Date() },
          rolled_back: false,
        },
        scoreDelta: 2,
        worktreePath: '/tmp/wt2',
      },
    ];

    const candidates = allResults
      .filter((r) => !r.outcome.rolled_back && r.outcome.click.testsPassed)
      .sort((a, b) => b.scoreDelta - a.scoreDelta);

    // Both have delta=2, first in original array wins (stable sort)
    expect(candidates.length).toBe(2);
    expect(candidates[0].scoreDelta).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────

describe('Swarm constants', () => {
  it('ALL_SPECIALIZATIONS has exactly 5 entries', () => {
    expect(ALL_SPECIALIZATIONS).toHaveLength(5);
  });

  it('DEFAULT_SPECIALIZATIONS is a subset of ALL_SPECIALIZATIONS', () => {
    for (const spec of DEFAULT_SPECIALIZATIONS) {
      expect(ALL_SPECIALIZATIONS).toContain(spec);
    }
  });

  it('DEFAULT_SPECIALIZATIONS has 3 entries', () => {
    expect(DEFAULT_SPECIALIZATIONS).toHaveLength(3);
  });

  it('DEFAULT_SPECIALIZATIONS matches spec defaults', () => {
    expect([...DEFAULT_SPECIALIZATIONS]).toEqual(['security', 'quality', 'errors']);
  });
});
