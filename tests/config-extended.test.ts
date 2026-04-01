import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  parseConfig,
  configFilePath,
  findIncompleteTargets,
  DEFAULT_CONFIG,
} from '../src/core/config.js';

describe('loadConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns auto-detected config when .ratchet.yml does not exist', () => {
    const config = loadConfig(dir);
    expect(config.agent).toBe(DEFAULT_CONFIG.agent);
    expect(config.defaults.clicks).toBe(DEFAULT_CONFIG.defaults.clicks);
    // Auto-detection always produces at least one target
    expect(config.targets.length).toBeGreaterThanOrEqual(1);
    expect(config._source).toBe('auto-detected');
  });

  it('loads config from .ratchet.yml when it exists', () => {
    const yaml = `
agent: claude-code
defaults:
  clicks: 3
  test_command: yarn test
targets:
  - name: my-target
    path: src/
    description: My target
`;
    writeFileSync(join(dir, '.ratchet.yml'), yaml, 'utf8');
    const config = loadConfig(dir);
    expect(config.agent).toBe('claude-code');
    expect(config.defaults.clicks).toBe(3);
    expect(config.defaults.testCommand).toBe('yarn test');
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].name).toBe('my-target');
  });

  it('parses boundaries from disk config', () => {
    const yaml = `
agent: shell
boundaries:
  - path: src/auth/
    rule: no-modify
    reason: Security sensitive
`;
    writeFileSync(join(dir, '.ratchet.yml'), yaml, 'utf8');
    const config = loadConfig(dir);
    expect(config.boundaries).toHaveLength(1);
    expect(config.boundaries![0].path).toBe('src/auth/');
    expect(config.boundaries![0].rule).toBe('no-modify');
    expect(config.boundaries![0].reason).toBe('Security sensitive');
  });

  it('returns default for empty yaml file', () => {
    writeFileSync(join(dir, '.ratchet.yml'), '', 'utf8');
    const config = loadConfig(dir);
    expect(config.agent).toBe(DEFAULT_CONFIG.agent);
  });
});

describe('configFilePath', () => {
  it('returns absolute path to .ratchet.yml in given cwd', () => {
    const path = configFilePath('/some/project');
    expect(path).toBe('/some/project/.ratchet.yml');
  });

  it('ends with .ratchet.yml', () => {
    const path = configFilePath('/users/foo/myproject');
    expect(path.endsWith('.ratchet.yml')).toBe(true);
  });
});

describe('parseConfig - edge cases', () => {
  it('filters out targets with missing name', () => {
    const yaml = `
targets:
  - path: src/
    description: No name here
  - name: valid
    path: src/api/
    description: Valid target
`;
    const config = parseConfig(yaml);
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].name).toBe('valid');
  });

  it('filters out targets with missing path', () => {
    const yaml = `
targets:
  - name: no-path
    description: No path here
  - name: valid
    path: src/
    description: Valid
`;
    const config = parseConfig(yaml);
    expect(config.targets).toHaveLength(1);
  });

  it('filters out targets with missing description', () => {
    const yaml = `
targets:
  - name: no-desc
    path: src/
  - name: valid
    path: src/
    description: Has description
`;
    const config = parseConfig(yaml);
    expect(config.targets).toHaveLength(1);
  });

  it('filters out boundaries with missing path', () => {
    const yaml = `
boundaries:
  - rule: no-modify
    reason: No path given
  - path: src/auth/
    rule: no-delete
`;
    const config = parseConfig(yaml);
    expect(config.boundaries).toHaveLength(1);
    expect(config.boundaries![0].rule).toBe('no-delete');
  });

  it('falls back to no-modify for invalid boundary rule', () => {
    const yaml = `
boundaries:
  - path: src/
    rule: invalid-rule
`;
    const config = parseConfig(yaml);
    expect(config.boundaries![0].rule).toBe('no-modify');
  });

  it('accepts no-delete boundary rule', () => {
    const yaml = `
boundaries:
  - path: src/
    rule: no-delete
`;
    const config = parseConfig(yaml);
    expect(config.boundaries![0].rule).toBe('no-delete');
  });

  it('preserves model field when set', () => {
    const config = parseConfig('model: claude-opus-4-6');
    expect(config.model).toBe('claude-opus-4-6');
  });

  it('handles non-object YAML (plain string)', () => {
    const config = parseConfig('just a string');
    expect(config.agent).toBe(DEFAULT_CONFIG.agent);
    expect(config.targets).toHaveLength(0);
  });
});

describe('findIncompleteTargets', () => {
  it('returns empty array when all targets are valid', () => {
    const yaml = `
targets:
  - name: my-target
    path: src/
    description: A valid target
`;
    expect(findIncompleteTargets(yaml)).toHaveLength(0);
  });

  it('reports target missing path', () => {
    const yaml = `
targets:
  - name: no-path
    description: Missing path
`;
    const warnings = findIncompleteTargets(yaml);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no-path/);
    expect(warnings[0]).toMatch(/path/);
  });

  it('reports target missing description', () => {
    const yaml = `
targets:
  - name: no-desc
    path: src/
`;
    const warnings = findIncompleteTargets(yaml);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/description/);
  });

  it('reports multiple missing fields for one target', () => {
    const yaml = `
targets:
  - name: only-name
`;
    const warnings = findIncompleteTargets(yaml);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/path/);
    expect(warnings[0]).toMatch(/description/);
  });

  it('returns empty array when there are no targets', () => {
    const yaml = 'agent: shell';
    expect(findIncompleteTargets(yaml)).toHaveLength(0);
  });

  it('returns empty array for invalid YAML', () => {
    expect(findIncompleteTargets('{ bad yaml: [')).toHaveLength(0);
  });
});
