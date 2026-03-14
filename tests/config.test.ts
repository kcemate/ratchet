import { describe, it, expect } from 'vitest';
import { parseConfig, DEFAULT_CONFIG, findTarget } from '../src/core/config.js';

const SAMPLE_YAML = `
agent: claude-code
model: claude-sonnet-4-6
defaults:
  clicks: 5
  test_command: npm test
  auto_commit: true
targets:
  - name: error-handling
    path: src/api/
    description: "Improve error handling"
boundaries:
  - path: src/auth/
    rule: no-modify
    reason: "Auth is intentional"
  - path: "**/*.test.ts"
    rule: preserve-pattern
`;

describe('parseConfig', () => {
  it('parses a full valid config', () => {
    const config = parseConfig(SAMPLE_YAML);
    expect(config.agent).toBe('claude-code');
    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.defaults.clicks).toBe(5);
    expect(config.defaults.testCommand).toBe('npm test');
    expect(config.defaults.autoCommit).toBe(true);
  });

  it('parses targets', () => {
    const config = parseConfig(SAMPLE_YAML);
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].name).toBe('error-handling');
    expect(config.targets[0].path).toBe('src/api/');
    expect(config.targets[0].description).toBe('Improve error handling');
  });

  it('parses boundaries', () => {
    const config = parseConfig(SAMPLE_YAML);
    expect(config.boundaries).toHaveLength(2);
    expect(config.boundaries![0].rule).toBe('no-modify');
    expect(config.boundaries![0].reason).toBe('Auth is intentional');
    expect(config.boundaries![1].rule).toBe('preserve-pattern');
  });

  it('returns defaults for empty config', () => {
    const config = parseConfig('');
    expect(config.agent).toBe(DEFAULT_CONFIG.agent);
    expect(config.defaults.clicks).toBe(DEFAULT_CONFIG.defaults.clicks);
  });

  it('throws a user-friendly error for malformed YAML', () => {
    const malformed = 'key: [unclosed bracket\nanother: value';
    expect(() => parseConfig(malformed)).toThrow('.ratchet.yml contains invalid YAML');
  });

  it('includes ratchet init hint in YAML parse error', () => {
    const malformed = '{\nbad yaml: [';
    expect(() => parseConfig(malformed)).toThrow('ratchet init --force');
  });

  it('returns defaults for missing fields', () => {
    const config = parseConfig('agent: claude-code');
    expect(config.defaults.clicks).toBe(DEFAULT_CONFIG.defaults.clicks);
    expect(config.defaults.testCommand).toBe(DEFAULT_CONFIG.defaults.testCommand);
    expect(config.targets).toHaveLength(0);
  });

  it('falls back to shell for unknown agent', () => {
    const config = parseConfig('agent: unknown-agent');
    expect(config.agent).toBe('shell');
  });

  it('accepts all valid agent types', () => {
    for (const agent of ['claude-code', 'codex', 'shell'] as const) {
      const config = parseConfig(`agent: ${agent}`);
      expect(config.agent).toBe(agent);
    }
  });

  it('handles missing boundaries gracefully', () => {
    const config = parseConfig('agent: shell\ntargets: []');
    expect(config.boundaries).toBeUndefined();
  });
});

describe('findTarget', () => {
  it('finds target by name', () => {
    const config = parseConfig(SAMPLE_YAML);
    const target = findTarget(config, 'error-handling');
    expect(target).toBeDefined();
    expect(target!.path).toBe('src/api/');
  });

  it('returns undefined for missing target', () => {
    const config = parseConfig(SAMPLE_YAML);
    const target = findTarget(config, 'nonexistent');
    expect(target).toBeUndefined();
  });
});
