import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { parse } from 'yaml';
import type { RatchetConfig, Target, Boundary } from '../types.js';

const CONFIG_FILE = '.ratchet.yml';

export const DEFAULT_CONFIG: RatchetConfig = {
  agent: 'shell',
  defaults: {
    clicks: 7,
    testCommand: 'npm test',
    autoCommit: true,
  },
  targets: [],
};

interface RawConfig {
  agent?: string;
  model?: string;
  defaults?: {
    clicks?: number;
    test_command?: string;
    auto_commit?: boolean;
  };
  targets?: Array<{
    name?: string;
    path?: string;
    description?: string;
  }>;
  boundaries?: Array<{
    path?: string;
    rule?: string;
    reason?: string;
  }>;
}

export function loadConfig(cwd: string = process.cwd()): RatchetConfig {
  const configPath = resolve(join(cwd, CONFIG_FILE));
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = readFileSync(configPath, 'utf8');
  return parseConfig(raw);
}

export function parseConfig(raw: string): RatchetConfig {
  let data: RawConfig;
  try {
    data = parse(raw) as RawConfig;
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `.ratchet.yml contains invalid YAML and could not be parsed.\n` +
        `  Detail: ${detail}\n` +
        `  Fix the syntax error and try again, or run: ratchet init --force`,
    );
  }

  if (!data || typeof data !== 'object') {
    return { ...DEFAULT_CONFIG };
  }

  const agent = validateAgent(data.agent);

  const defaults = {
    clicks: data.defaults?.clicks ?? DEFAULT_CONFIG.defaults.clicks,
    testCommand: data.defaults?.test_command ?? DEFAULT_CONFIG.defaults.testCommand,
    autoCommit: data.defaults?.auto_commit ?? DEFAULT_CONFIG.defaults.autoCommit,
  };

  const targets: Target[] = (data.targets ?? [])
    .filter((t): t is Required<typeof t> => Boolean(t.name && t.path && t.description))
    .map((t) => ({
      name: t.name,
      path: t.path,
      description: t.description,
    }));

  const boundaries: Boundary[] | undefined = data.boundaries
    ? data.boundaries
        .filter((b): b is Required<typeof b> => Boolean(b.path && b.rule))
        .map((b) => ({
          path: b.path,
          rule: validateBoundaryRule(b.rule),
          reason: b.reason,
        }))
    : undefined;

  return {
    agent,
    model: data.model,
    defaults,
    targets,
    boundaries,
  };
}

function validateAgent(agent: string | undefined): RatchetConfig['agent'] {
  if (agent === 'claude-code' || agent === 'codex' || agent === 'shell') {
    return agent;
  }
  return DEFAULT_CONFIG.agent;
}

function validateBoundaryRule(rule: string): Boundary['rule'] {
  if (rule === 'no-modify' || rule === 'no-delete' || rule === 'preserve-pattern') {
    return rule;
  }
  return 'no-modify';
}

export function findTarget(config: RatchetConfig, name: string): Target | undefined {
  return config.targets.find((t) => t.name === name);
}

/**
 * Returns warning strings for any targets in the raw YAML that are missing
 * required fields (name, path, description) and were silently dropped.
 */
export function findIncompleteTargets(raw: string): string[] {
  let data: RawConfig;
  try {
    data = parse(raw) as RawConfig;
  } catch {
    return [];
  }
  if (!data?.targets) return [];

  const warnings: string[] = [];
  for (const t of data.targets) {
    if (!t.name && !t.path && !t.description) continue; // fully empty entry, skip
    const missing: string[] = [];
    if (!t.name) missing.push('name');
    if (!t.path) missing.push('path');
    if (!t.description) missing.push('description');
    if (missing.length > 0) {
      const id = t.name ? `"${t.name}"` : '(unnamed)';
      warnings.push(`Target ${id} is missing required field(s): ${missing.join(', ')}`);
    }
  }
  return warnings;
}

export function configFilePath(cwd: string = process.cwd()): string {
  return resolve(join(cwd, CONFIG_FILE));
}
