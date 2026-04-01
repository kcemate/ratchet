import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { parse } from 'yaml';
import type { RatchetConfig, Target, Boundary, ProviderConfig } from '../types.js';
import { buildAutoConfig } from './detect.js';
import { toErrorMessage } from './utils.js';
import { modelRegistry } from './model-registry.js';

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
  models?: {
    cheap?: string;
    default?: string;
    premium?: string;
    scan?: string;
    fix?: string;
    sweep?: string;
    analyze?: string;
    architect?: string;
    report?: string;
    'deep-scan'?: string;
  };
  providers?: Record<string, {
    api_key_env?: string;
    base_url?: string;
    models?: string[];
  }>;
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
  scan?: {
    include_non_production?: boolean;
    engine?: 'classic' | 'deep' | 'auto';
  };
}

export function loadConfig(cwd: string = process.cwd()): RatchetConfig {
  const configPath = resolve(join(cwd, CONFIG_FILE));
  if (!existsSync(configPath)) {
    return buildAutoConfig(cwd);
  }
  const raw = readFileSync(configPath, 'utf8');
  const config = parseConfig(raw);
  config._source = 'file';
  modelRegistry.applyConfig(config.models, config.model);
  return config;
}

export function parseConfig(raw: string): RatchetConfig {
  let data: RawConfig;
  try {
    data = parse(raw) as RawConfig;
  } catch (err: unknown) {
    const detail = toErrorMessage(err);
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

  const rawClicks = data.defaults?.clicks;
  const clicks =
    rawClicks !== undefined && (Number.isInteger(rawClicks) && rawClicks >= 1)
      ? rawClicks
      : DEFAULT_CONFIG.defaults.clicks;

  const rawTestCommand = (data.defaults?.test_command ?? '').trim();
  const testCommand = rawTestCommand || DEFAULT_CONFIG.defaults.testCommand;

  const defaults = {
    clicks,
    testCommand,
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

  const scan = data.scan ? {
    includeNonProduction: data.scan.include_non_production ?? false,
    ...(data.scan.engine !== undefined ? { engine: data.scan.engine } : {}),
  } : undefined;

  const providers = parseProviders(data.providers);

  return {
    agent,
    model: data.model,
    models: data.models,
    providers,
    defaults,
    targets,
    boundaries,
    scan,
  };
}

function parseProviders(
  raw: RawConfig['providers'],
): Record<string, ProviderConfig> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const result: Record<string, ProviderConfig> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entry.api_key_env) {
      throw new Error(
        `Provider "${name}" is missing required field api_key_env.\n` +
        `  Set api_key_env to the name of the environment variable holding the API key.\n` +
        `  Example: api_key_env: ${name.toUpperCase()}_API_KEY`,
      );
    }
    result[name] = {
      api_key_env: entry.api_key_env,
      ...(entry.base_url !== undefined ? { base_url: entry.base_url } : {}),
      ...(Array.isArray(entry.models) ? { models: entry.models } : {}),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
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

const VALID_AGENTS: RatchetConfig['agent'][] = ['claude-code', 'codex', 'shell'];
const VALID_RULES: Boundary['rule'][] = ['no-modify', 'no-delete', 'preserve-pattern'];

/**
 * Returns human-readable warnings for any invalid or unrecognised field values
 * in the raw YAML that were silently corrected to defaults.
 */
export function getConfigWarnings(raw: string): string[] {
  let data: RawConfig;
  try {
    data = parse(raw) as RawConfig;
  } catch {
    return []; // parse errors are handled elsewhere
  }
  if (!data || typeof data !== 'object') return [];

  const warnings: string[] = [];

  if (data.agent !== undefined && !VALID_AGENTS.includes(data.agent as RatchetConfig['agent'])) {
    warnings.push(
      `Invalid agent "${data.agent}" — expected one of: ${VALID_AGENTS.join(', ')}. ` +
      `Falling back to "${DEFAULT_CONFIG.agent}".`,
    );
  }

  const rawClicks = data.defaults?.clicks;
  if (rawClicks !== undefined && !(Number.isInteger(rawClicks) && rawClicks >= 1)) {
    warnings.push(
      `Invalid defaults.clicks "${rawClicks}" — must be a positive integer. ` +
      `Falling back to ${DEFAULT_CONFIG.defaults.clicks}.`,
    );
  }

  if (data.boundaries) {
    for (const b of data.boundaries) {
      if (b.rule !== undefined && !VALID_RULES.includes(b.rule as Boundary['rule'])) {
        const where = b.path ? ` for boundary "${b.path}"` : '';
        warnings.push(
          `Invalid boundary rule "${b.rule}"${where} — expected one of: ${VALID_RULES.join(', ')}. ` +
          `Falling back to "no-modify".`,
        );
      }
    }
  }

  // Collect all known model IDs from providers
  const knownModels = new Set<string>();
  if (data.providers && typeof data.providers === 'object') {
    for (const entry of Object.values(data.providers)) {
      if (entry?.models && Array.isArray(entry.models)) {
        for (const m of entry.models) knownModels.add(m);
      }
    }
  }

  // Warn on unknown model names (only when providers are defined)
  if (knownModels.size > 0) {
    const modelEntries: Array<[string, string | undefined]> = [
      ['model', data.model],
      ...(data.models ? Object.entries(data.models).map(([k, v]) => [`models.${k}`, v] as [string, string | undefined]) : []),
    ];
    for (const [field, value] of modelEntries) {
      if (value && !knownModels.has(value)) {
        warnings.push(
          `Unknown model "${value}" in ${field} — not listed in any provider's models array.`,
        );
      }
    }
  }

  return warnings;
}
