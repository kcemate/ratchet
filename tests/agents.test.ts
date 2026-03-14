import { describe, it, expect, vi } from 'vitest';
import { createAgentContext } from '../src/core/agents/base.js';
import { ShellAgent, createShellAgent } from '../src/core/agents/shell.js';
import type { Target } from '../src/types.js';

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    name: 'error-handling',
    path: 'src/api/',
    description: 'Improve error handling',
    ...overrides,
  };
}

describe('createAgentContext', () => {
  it('includes target name', () => {
    const ctx = createAgentContext(makeTarget({ name: 'my-target' }), 1);
    expect(ctx).toContain('Target: my-target');
  });

  it('includes target path', () => {
    const ctx = createAgentContext(makeTarget({ path: 'src/api/' }), 1);
    expect(ctx).toContain('Path: src/api/');
  });

  it('includes target description', () => {
    const ctx = createAgentContext(makeTarget({ description: 'Fix error handling' }), 1);
    expect(ctx).toContain('Description: Fix error handling');
  });

  it('includes click number', () => {
    const ctx = createAgentContext(makeTarget(), 5);
    expect(ctx).toContain('Click: 5');
  });

  it('click number changes per click', () => {
    const ctx1 = createAgentContext(makeTarget(), 1);
    const ctx3 = createAgentContext(makeTarget(), 3);
    expect(ctx1).toContain('Click: 1');
    expect(ctx3).toContain('Click: 3');
  });

  it('formats as newline-separated string', () => {
    const ctx = createAgentContext(makeTarget(), 2);
    const lines = ctx.split('\n');
    expect(lines).toHaveLength(4);
  });
});

describe('ShellAgent', () => {
  describe('constructor', () => {
    it('creates an agent with default command', () => {
      const agent = new ShellAgent();
      expect(agent).toBeDefined();
      expect(typeof agent.analyze).toBe('function');
      expect(typeof agent.propose).toBe('function');
      expect(typeof agent.build).toBe('function');
    });

    it('creates an agent with custom config', () => {
      const agent = new ShellAgent({ command: 'my-cli', timeout: 60_000 });
      expect(agent).toBeDefined();
    });

    it('accepts extraArgs override', () => {
      const agent = new ShellAgent({ extraArgs: ['--verbose', '--print'] });
      expect(agent).toBeDefined();
    });
  });

  describe('build error handling', () => {
    it('returns failed result when command produces no output', async () => {
      // Use a command that immediately fails with no output
      const agent = new ShellAgent({ command: 'false', extraArgs: [] });
      const result = await agent.build('some proposal', process.cwd());
      expect(result.success).toBe(false);
    });

    it('returns a friendly timeout error message', async () => {
      // Use a 1ms timeout so the sleep command definitely exceeds it
      const agent = new ShellAgent({ command: 'sleep', extraArgs: [], timeout: 1 });
      const result = await agent.build('proposal', process.cwd());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timed out/i);
    });

    it('returns a friendly ENOENT error message', async () => {
      const agent = new ShellAgent({ command: 'nonexistent-command-xyz', extraArgs: [] });
      const result = await agent.build('proposal', process.cwd());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  describe('createShellAgent factory', () => {
    it('returns a ShellAgent instance', () => {
      const agent = createShellAgent();
      expect(agent).toBeInstanceOf(ShellAgent);
    });

    it('passes config through to ShellAgent', () => {
      const agent = createShellAgent({ command: 'my-tool', timeout: 10_000 });
      expect(agent).toBeInstanceOf(ShellAgent);
    });

    it('returns an agent satisfying the Agent interface', () => {
      const agent = createShellAgent();
      expect(typeof agent.analyze).toBe('function');
      expect(typeof agent.propose).toBe('function');
      expect(typeof agent.build).toBe('function');
    });
  });
});
