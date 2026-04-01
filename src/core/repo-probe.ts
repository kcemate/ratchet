/**
 * Repo environment detection — runs before the first torque click to probe
 * the target repo's toolchain. Results are cached in .ratchet/repo-profile.json
 * and feed into agent prompts and verification commands.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { detectProjectLanguage } from './detect-language.js';
import type { SupportedLanguage } from './language-rules.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoProfile {
  language: SupportedLanguage;
  sourceRoots: string[];          // e.g. ['client/src/', 'server/', 'shared/']
  testRunner: TestRunnerInfo | null;
  buildTool: BuildToolInfo | null;
  lintTool: LintToolInfo | null;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | null;
  monorepo: MonorepoInfo | null;
  detectedAt: string;             // ISO timestamp
}

export interface TestRunnerInfo {
  name: string;     // jest, vitest, mocha, go-test, pytest, cargo-test, deno-test
  command: string;  // the actual command to run tests e.g. "npx vitest run"
  configFile?: string;
}

export interface BuildToolInfo {
  name: string;     // tsc, esbuild, vite, go-build, cargo-build, deno
  command: string;  // e.g. "npx tsc --noEmit"
}

export interface LintToolInfo {
  name: string;     // eslint, biome, golangci-lint, clippy, ruff, deno-lint
  command: string;  // e.g. "npx eslint ."
  configFile?: string;
}

export interface MonorepoInfo {
  tool: string;     // nx, turborepo, lerna, pnpm-workspaces, go-workspace, cargo-workspace
  packages: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_FILE = '.ratchet/repo-profile.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const SOURCE_ROOT_CANDIDATES = ['src', 'lib', 'app', 'server', 'client', 'packages', 'shared'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function has(cwd: string, ...parts: string[]): boolean {
  return existsSync(join(cwd, ...parts));
}

function readJson(cwd: string, ...parts: string[]): Record<string, unknown> | null {
  try {
    const raw = readFileSync(join(cwd, ...parts), 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasFileWithPrefix(cwd: string, prefix: string): boolean {
  try {
    return readdirSync(cwd).some(f => f.startsWith(prefix));
  } catch {
    return false;
  }
}

interface PkgInfo {
  scripts: Record<string, string>;
  deps: Set<string>;
}

function readPkgInfo(cwd: string): PkgInfo | null {
  const pkg = readJson(cwd, 'package.json');
  if (!pkg) return null;

  const scripts: Record<string, string> = {};
  if (pkg['scripts'] && typeof pkg['scripts'] === 'object') {
    for (const [k, v] of Object.entries(pkg['scripts'] as Record<string, string>)) {
      scripts[k] = v;
    }
  }

  const deps = new Set<string>();
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const section = pkg[key];
    if (section && typeof section === 'object') {
      for (const name of Object.keys(section as Record<string, unknown>)) {
        deps.add(name);
      }
    }
  }

  return { scripts, deps };
}

// ---------------------------------------------------------------------------
// Source root detection
// ---------------------------------------------------------------------------

/**
 * Returns relative paths (with trailing slash) for detected source root
 * directories under `cwd`. Handles the common `client/src/` full-stack layout.
 */
export function getSourceRoots(cwd: string): string[] {
  const roots: string[] = [];

  for (const candidate of SOURCE_ROOT_CANDIDATES) {
    const full = join(cwd, candidate);
    if (!existsSync(full)) continue;
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }

    // For 'client', check if client/src/ exists — prefer that over client/ alone
    if (candidate === 'client' && existsSync(join(cwd, 'client', 'src'))) {
      try {
        if (statSync(join(cwd, 'client', 'src')).isDirectory()) {
          roots.push('client/src/');
          continue;
        }
      } catch {
        // fall through and add client/
      }
    }

    roots.push(`${candidate}/`);
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Test runner detection
// ---------------------------------------------------------------------------

function detectTestRunner(cwd: string): TestRunnerInfo | null {
  // 1. vitest
  for (const cfg of ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs']) {
    if (has(cwd, cfg)) return { name: 'vitest', command: 'npx vitest run', configFile: cfg };
  }

  // 2. jest
  for (const cfg of ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs']) {
    if (has(cwd, cfg)) return { name: 'jest', command: 'npx jest', configFile: cfg };
  }
  const pkg = readPkgInfo(cwd);
  if (pkg?.deps.has('jest')) return { name: 'jest', command: 'npx jest' };

  // 3. mocha
  if (hasFileWithPrefix(cwd, '.mocharc')) return { name: 'mocha', command: 'npx mocha' };
  if (pkg?.deps.has('mocha')) return { name: 'mocha', command: 'npx mocha' };

  // 4. go test
  if (has(cwd, 'go.mod')) return { name: 'go-test', command: 'go test ./...' };

  // 5. cargo test
  if (has(cwd, 'Cargo.toml')) return { name: 'cargo-test', command: 'cargo test' };

  // 6. pytest
  if (has(cwd, 'pytest.ini')) return { name: 'pytest', command: 'python -m pytest' };
  if (has(cwd, 'pyproject.toml')) {
    try {
      const raw = readFileSync(join(cwd, 'pyproject.toml'), 'utf-8');
      if (raw.includes('[tool.pytest')) {
        return { name: 'pytest', command: 'python -m pytest' };
      }
    } catch {
      // fall through
    }
  }

  // 7. deno test (only if deno.json has a "test" task)
  for (const denoConfig of ['deno.json', 'deno.jsonc']) {
    const deno = readJson(cwd, denoConfig);
    if (deno) {
      const tasks = deno['tasks'] as Record<string, unknown> | undefined;
      if (tasks && 'test' in tasks) {
        return { name: 'deno-test', command: 'deno test' };
      }
    }
  }

  // 8. package.json "test" script fallback
  if (pkg?.scripts['test'] && !pkg.scripts['test'].includes('no test') && !pkg.scripts['test'].includes('echo "Error')) {
    return { name: 'npm-test', command: 'npm test' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Build tool detection
// ---------------------------------------------------------------------------

function detectBuildTool(cwd: string): BuildToolInfo | null {
  // 1. vite (check before tsc — vite projects also have tsconfig.json)
  for (const cfg of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
    if (has(cwd, cfg)) return { name: 'vite', command: 'npx vite build' };
  }

  // 2. tsconfig.json with no bundler
  if (has(cwd, 'tsconfig.json')) {
    const pkg = readPkgInfo(cwd);
    const hasBundler =
      pkg?.deps.has('esbuild') ||
      pkg?.deps.has('vite') ||
      pkg?.deps.has('webpack') ||
      pkg?.deps.has('@webpack-cli/serve') ||
      pkg?.deps.has('rollup') ||
      pkg?.deps.has('parcel');
    if (!hasBundler) return { name: 'tsc', command: 'npx tsc --noEmit' };
  }

  // 3. esbuild
  const pkg = readPkgInfo(cwd);
  if (pkg?.deps.has('esbuild')) return { name: 'esbuild', command: 'npx esbuild' };

  // 4. go build
  if (has(cwd, 'go.mod')) return { name: 'go-build', command: 'go build ./...' };

  // 5. cargo build
  if (has(cwd, 'Cargo.toml')) return { name: 'cargo-build', command: 'cargo build' };

  // 6. package.json "build" script
  if (pkg?.scripts['build']) return { name: 'npm-build', command: 'npm run build' };

  return null;
}

// ---------------------------------------------------------------------------
// Lint tool detection
// ---------------------------------------------------------------------------

function detectLintTool(cwd: string): LintToolInfo | null {
  // 1. eslint — .eslintrc.* variants
  for (const cfg of ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml']) {
    if (has(cwd, cfg)) return { name: 'eslint', command: 'npx eslint .', configFile: cfg };
  }
  // eslint flat config
  for (const cfg of ['eslint.config.js', 'eslint.config.ts', 'eslint.config.mjs', 'eslint.config.cjs']) {
    if (has(cwd, cfg)) return { name: 'eslint', command: 'npx eslint .', configFile: cfg };
  }

  // 2. biome
  if (has(cwd, 'biome.json')) return { name: 'biome', command: 'npx biome check', configFile: 'biome.json' };

  // 3. golangci-lint (go.mod must exist AND a golangci config file must be present)
  if (has(cwd, 'go.mod')) {
    for (const cfg of ['.golangci.yml', '.golangci.yaml', '.golangci.json', '.golangci.toml']) {
      if (has(cwd, cfg)) return { name: 'golangci-lint', command: 'golangci-lint run' };
    }
  }

  // 4. cargo clippy
  if (has(cwd, 'Cargo.toml')) return { name: 'clippy', command: 'cargo clippy' };

  // 5. ruff
  if (has(cwd, 'ruff.toml')) return { name: 'ruff', command: 'ruff check', configFile: 'ruff.toml' };
  if (has(cwd, 'pyproject.toml')) {
    try {
      const raw = readFileSync(join(cwd, 'pyproject.toml'), 'utf-8');
      if (raw.includes('[tool.ruff]')) return { name: 'ruff', command: 'ruff check' };
    } catch {
      // fall through
    }
  }

  // 6. deno lint
  if (has(cwd, 'deno.json') || has(cwd, 'deno.jsonc')) {
    return { name: 'deno-lint', command: 'deno lint' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

function detectPackageManager(cwd: string): RepoProfile['packageManager'] {
  if (has(cwd, 'bun.lock') || has(cwd, 'bun.lockb')) return 'bun';
  if (has(cwd, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(cwd, 'yarn.lock')) return 'yarn';
  if (has(cwd, 'package-lock.json')) return 'npm';
  return null;
}

// ---------------------------------------------------------------------------
// Monorepo detection
// ---------------------------------------------------------------------------

function detectMonorepo(cwd: string): MonorepoInfo | null {
  // nx
  if (has(cwd, 'nx.json')) {
    return { tool: 'nx', packages: readWorkspacePackages(cwd) };
  }

  // turborepo
  if (has(cwd, 'turbo.json')) {
    return { tool: 'turborepo', packages: readWorkspacePackages(cwd) };
  }

  // lerna
  if (has(cwd, 'lerna.json')) {
    const lerna = readJson(cwd, 'lerna.json');
    const pkgs = Array.isArray(lerna?.['packages']) ? (lerna!['packages'] as string[]) : [];
    return { tool: 'lerna', packages: pkgs };
  }

  // pnpm workspaces
  if (has(cwd, 'pnpm-workspace.yaml')) {
    return { tool: 'pnpm-workspaces', packages: readPnpmWorkspaces(cwd) };
  }

  // go workspace
  if (has(cwd, 'go.work')) {
    return { tool: 'go-workspace', packages: readGoWorkspaceModules(cwd) };
  }

  // cargo workspace
  if (has(cwd, 'Cargo.toml')) {
    try {
      const raw = readFileSync(join(cwd, 'Cargo.toml'), 'utf-8');
      if (raw.includes('[workspace]')) {
        return { tool: 'cargo-workspace', packages: readCargoWorkspaceMembers(raw) };
      }
    } catch {
      // fall through
    }
  }

  return null;
}

function readWorkspacePackages(cwd: string): string[] {
  const pkg = readJson(cwd, 'package.json');
  if (!pkg) return [];
  if (Array.isArray(pkg['workspaces'])) return pkg['workspaces'] as string[];
  return [];
}

function readPnpmWorkspaces(cwd: string): string[] {
  try {
    const raw = readFileSync(join(cwd, 'pnpm-workspace.yaml'), 'utf-8');
    const packages: string[] = [];
    let inPackages = false;
    for (const line of raw.split('\n')) {
      if (line.trim() === 'packages:') {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        const match = line.match(/^\s+-\s+['"]?(.+?)['"]?\s*$/);
        if (match?.[1]) {
          packages.push(match[1]);
        } else if (line.trim() && !/^\s/.test(line)) {
          break;
        }
      }
    }
    return packages;
  } catch {
    return [];
  }
}

function readGoWorkspaceModules(cwd: string): string[] {
  try {
    const raw = readFileSync(join(cwd, 'go.work'), 'utf-8');
    const modules: string[] = [];
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s+\.\/(.+)\s*$/);
      if (match?.[1]) modules.push(match[1]);
    }
    return modules;
  } catch {
    return [];
  }
}

function readCargoWorkspaceMembers(raw: string): string[] {
  const match = raw.match(/members\s*=\s*\[([^\]]+)\]/);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function cachePath(cwd: string): string {
  return join(cwd, CACHE_FILE);
}

function loadCache(cwd: string): RepoProfile | null {
  const p = cachePath(cwd);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as RepoProfile;
    if (!parsed.detectedAt) return null;
    const age = Date.now() - new Date(parsed.detectedAt).getTime();
    if (age > CACHE_TTL_MS) {
      logger.debug({ age, cwd }, 'repo-profile cache expired');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.debug({ err, cwd }, 'Failed to read repo-profile cache');
    return null;
  }
}

function saveCache(cwd: string, profile: RepoProfile): void {
  const dir = dirname(cachePath(cwd));
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(cwd), JSON.stringify(profile, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ err, cwd }, 'Failed to write repo-profile cache');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe the repo at `cwd` and return a RepoProfile describing its toolchain.
 * Results are cached in `.ratchet/repo-profile.json` for 24h.
 * Pass `{ force: true }` to bypass the cache.
 */
export function probeRepo(cwd: string, options?: { force?: boolean }): RepoProfile {
  if (!options?.force) {
    const cached = loadCache(cwd);
    if (cached) {
      logger.debug({ cwd }, 'returning cached repo-profile');
      return cached;
    }
  }

  const profile: RepoProfile = {
    language: detectProjectLanguage(cwd),
    sourceRoots: getSourceRoots(cwd),
    testRunner: detectTestRunner(cwd),
    buildTool: detectBuildTool(cwd),
    lintTool: detectLintTool(cwd),
    packageManager: detectPackageManager(cwd),
    monorepo: detectMonorepo(cwd),
    detectedAt: new Date().toISOString(),
  };

  saveCache(cwd, profile);
  logger.debug({ cwd, language: profile.language }, 'repo-profile detected and cached');
  return profile;
}

/**
 * Returns the verification (test) command for the repo.
 * Falls back to `npm test` if no test runner was detected.
 */
export function getVerifyCommand(profile: RepoProfile): string {
  return profile.testRunner?.command ?? 'npm test';
}

/**
 * Returns the build command for the repo.
 * Falls back to `npm run build` if no build tool was detected.
 */
export function getBuildCommand(profile: RepoProfile): string {
  return profile.buildTool?.command ?? 'npm run build';
}

/**
 * Returns the lint command for the repo, or null if no linter was detected.
 */
export function getLintCommand(profile: RepoProfile): string | null {
  return profile.lintTool?.command ?? null;
}
