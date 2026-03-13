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
  const data = parse(raw) as RawConfig;

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

export function configFilePath(cwd: string = process.cwd()): string {
  return resolve(join(cwd, CONFIG_FILE));
}
