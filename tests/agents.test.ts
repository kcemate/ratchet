import { describe, it, expect } from 'vitest';
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
