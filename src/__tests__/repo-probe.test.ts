import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  probeRepo,
  getVerifyCommand,
  getBuildCommand,
  getLintCommand,
  getSourceRoots,
} from '../core/repo-probe.js';
import type { RepoProfile } from '../core/repo-probe.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ratchet-probe-'));
  dirs.push(dir);
  return dir;
}

function write(dir: string, rel: string, content: string = ''): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function mkdir(dir: string, rel: string): void {
  mkdirSync(join(dir, rel), { recursive: true });
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TypeScript project (tsconfig + vitest)
// ---------------------------------------------------------------------------

describe('TypeScript + Vitest project', () => {
  it('detects language as ts', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    write(dir, 'vitest.config.ts', '');
    const p = probeRepo(dir);
    expect(p.language).toBe('ts');
  });

  it('detects vitest as test runner', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    write(dir, 'vitest.config.ts', '');
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('vitest');
    expect(p.testRunner?.command).toBe('npx vitest run');
    expect(p.testRunner?.configFile).toBe('vitest.config.ts');
  });

  it('detects tsc as build tool when no bundler in package.json', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    write(dir, 'package.json', JSON.stringify({ devDependencies: { typescript: '^5' } }));
    const p = probeRepo(dir);
    expect(p.buildTool?.name).toBe('tsc');
    expect(p.buildTool?.command).toBe('npx tsc --noEmit');
  });

  it('detects eslint when eslint.config.js exists', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    write(dir, 'eslint.config.js', '');
    const p = probeRepo(dir);
    expect(p.lintTool?.name).toBe('eslint');
    expect(p.lintTool?.command).toBe('npx eslint .');
  });

  it('detects eslint when .eslintrc.json exists', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    write(dir, '.eslintrc.json', '{}');
    const p = probeRepo(dir);
    expect(p.lintTool?.name).toBe('eslint');
    expect(p.lintTool?.configFile).toBe('.eslintrc.json');
  });

  it('detects pnpm when pnpm-lock.yaml exists', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    write(dir, 'pnpm-lock.yaml', '');
    const p = probeRepo(dir);
    expect(p.packageManager).toBe('pnpm');
  });

  it('returns detectedAt as ISO string', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    const before = Date.now();
    const p = probeRepo(dir);
    const after = Date.now();
    const ts = new Date(p.detectedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Go project
// ---------------------------------------------------------------------------

describe('Go project', () => {
  it('detects language as go', () => {
    const dir = tmpDir();
    write(dir, 'go.mod', 'module example.com/myapp\n\ngo 1.21\n');
    const p = probeRepo(dir);
    expect(p.language).toBe('go');
  });

  it('detects go-test as test runner', () => {
    const dir = tmpDir();
    write(dir, 'go.mod', 'module example.com/myapp\n\ngo 1.21\n');
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('go-test');
    expect(p.testRunner?.command).toBe('go test ./...');
  });

  it('detects go-build as build tool', () => {
    const dir = tmpDir();
    write(dir, 'go.mod', 'module example.com/myapp\n\ngo 1.21\n');
    const p = probeRepo(dir);
    expect(p.buildTool?.name).toBe('go-build');
    expect(p.buildTool?.command).toBe('go build ./...');
  });

  it('detects golangci-lint when .golangci.yml exists', () => {
    const dir = tmpDir();
    write(dir, 'go.mod', 'module example.com/myapp\n\ngo 1.21\n');
    write(dir, '.golangci.yml', '');
    const p = probeRepo(dir);
    expect(p.lintTool?.name).toBe('golangci-lint');
    expect(p.lintTool?.command).toBe('golangci-lint run');
  });

  it('returns null lint tool for go project without golangci config', () => {
    const dir = tmpDir();
    write(dir, 'go.mod', 'module example.com/myapp\n\ngo 1.21\n');
    const p = probeRepo(dir);
    expect(p.lintTool).toBeNull();
  });

  it('detects go workspace as monorepo', () => {
    const dir = tmpDir();
    write(dir, 'go.mod', 'module example.com/myapp\n\ngo 1.21\n');
    write(dir, 'go.work', 'go 1.21\n\nuse (\n\t./api\n\t./worker\n)\n');
    const p = probeRepo(dir);
    expect(p.monorepo?.tool).toBe('go-workspace');
    expect(p.monorepo?.packages).toEqual(['api', 'worker']);
  });

  it('getVerifyCommand returns go test ./...', () => {
    const dir = tmpDir();
    write(dir, 'go.mod', '');
    const p = probeRepo(dir);
    expect(getVerifyCommand(p)).toBe('go test ./...');
  });

  it('getBuildCommand returns go build ./...', () => {
    const dir = tmpDir();
    write(dir, 'go.mod', '');
    const p = probeRepo(dir);
    expect(getBuildCommand(p)).toBe('go build ./...');
  });
});

// ---------------------------------------------------------------------------
// Python project (pyproject.toml + pytest)
// ---------------------------------------------------------------------------

describe('Python project', () => {
  it('detects language as python', () => {
    const dir = tmpDir();
    write(dir, 'pyproject.toml', '[build-system]\n[tool.pytest.ini_options]\n');
    const p = probeRepo(dir);
    expect(p.language).toBe('python');
  });

  it('detects pytest via pyproject.toml [tool.pytest]', () => {
    const dir = tmpDir();
    write(dir, 'pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('pytest');
    expect(p.testRunner?.command).toBe('python -m pytest');
  });

  it('detects pytest via pytest.ini', () => {
    const dir = tmpDir();
    write(dir, 'pyproject.toml', '[build-system]\n');
    write(dir, 'pytest.ini', '[pytest]\n');
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('pytest');
  });

  it('detects ruff via pyproject.toml [tool.ruff]', () => {
    const dir = tmpDir();
    write(dir, 'pyproject.toml', '[tool.pytest.ini_options]\n[tool.ruff]\nline-length = 88\n');
    const p = probeRepo(dir);
    expect(p.lintTool?.name).toBe('ruff');
    expect(p.lintTool?.command).toBe('ruff check');
  });

  it('detects ruff via ruff.toml', () => {
    const dir = tmpDir();
    write(dir, 'pyproject.toml', '[build-system]\n');
    write(dir, 'ruff.toml', '');
    const p = probeRepo(dir);
    expect(p.lintTool?.name).toBe('ruff');
    expect(p.lintTool?.configFile).toBe('ruff.toml');
  });

  it('getLintCommand returns ruff check for Python+ruff', () => {
    const dir = tmpDir();
    write(dir, 'pyproject.toml', '[tool.pytest.ini_options]\n[tool.ruff]\n');
    const p = probeRepo(dir);
    expect(getLintCommand(p)).toBe('ruff check');
  });

  it('getVerifyCommand returns python -m pytest', () => {
    const dir = tmpDir();
    write(dir, 'pyproject.toml', '[tool.pytest.ini_options]\n');
    const p = probeRepo(dir);
    expect(getVerifyCommand(p)).toBe('python -m pytest');
  });
});

// ---------------------------------------------------------------------------
// Rust project (Cargo.toml)
// ---------------------------------------------------------------------------

describe('Rust project', () => {
  it('detects cargo-test and cargo-build', () => {
    const dir = tmpDir();
    write(dir, 'Cargo.toml', '[package]\nname = "myapp"\nversion = "0.1.0"\n');
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('cargo-test');
    expect(p.buildTool?.name).toBe('cargo-build');
    expect(p.lintTool?.name).toBe('clippy');
  });

  it('detects cargo workspace', () => {
    const dir = tmpDir();
    write(dir, 'Cargo.toml', '[workspace]\nmembers = ["crate-a", "crate-b"]\n');
    const p = probeRepo(dir);
    expect(p.monorepo?.tool).toBe('cargo-workspace');
    expect(p.monorepo?.packages).toEqual(['crate-a', 'crate-b']);
  });

  it('does not detect cargo-workspace for non-workspace Cargo.toml', () => {
    const dir = tmpDir();
    write(dir, 'Cargo.toml', '[package]\nname = "myapp"\n');
    const p = probeRepo(dir);
    expect(p.monorepo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Monorepo (pnpm-workspace.yaml + turbo.json)
// ---------------------------------------------------------------------------

describe('Monorepo — pnpm + turborepo', () => {
  it('detects turborepo (turbo.json wins over pnpm-workspace.yaml)', () => {
    const dir = tmpDir();
    write(dir, 'package.json', JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }));
    write(dir, 'pnpm-lock.yaml', '');
    write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n  - apps/*\n');
    write(dir, 'turbo.json', '{}');
    const p = probeRepo(dir);
    expect(p.monorepo?.tool).toBe('turborepo');
    expect(p.packageManager).toBe('pnpm');
  });

  it('detects pnpm-workspaces when no turbo/nx/lerna', () => {
    const dir = tmpDir();
    write(dir, 'pnpm-lock.yaml', '');
    write(dir, 'pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n  - "apps/*"\n');
    const p = probeRepo(dir);
    expect(p.monorepo?.tool).toBe('pnpm-workspaces');
    expect(p.monorepo?.packages).toEqual(['packages/*', 'apps/*']);
  });

  it('detects nx', () => {
    const dir = tmpDir();
    write(dir, 'nx.json', '{}');
    write(dir, 'package.json', JSON.stringify({ workspaces: ['libs/*', 'apps/*'] }));
    const p = probeRepo(dir);
    expect(p.monorepo?.tool).toBe('nx');
    expect(p.monorepo?.packages).toEqual(['libs/*', 'apps/*']);
  });

  it('detects lerna', () => {
    const dir = tmpDir();
    write(dir, 'lerna.json', JSON.stringify({ packages: ['packages/*'] }));
    const p = probeRepo(dir);
    expect(p.monorepo?.tool).toBe('lerna');
    expect(p.monorepo?.packages).toEqual(['packages/*']);
  });

  it('turborepo workspace packages come from package.json workspaces', () => {
    const dir = tmpDir();
    write(dir, 'turbo.json', '{}');
    write(dir, 'package.json', JSON.stringify({ workspaces: ['apps/*', 'packages/*'] }));
    const p = probeRepo(dir);
    expect(p.monorepo?.packages).toEqual(['apps/*', 'packages/*']);
  });
});

// ---------------------------------------------------------------------------
// Full-stack app (client/src/ + server/ source roots)
// ---------------------------------------------------------------------------

describe('Full-stack app source roots', () => {
  it('detects client/src/ and server/ roots', () => {
    const dir = tmpDir();
    mkdir(dir, 'client/src');
    mkdir(dir, 'server');
    const roots = getSourceRoots(dir);
    expect(roots).toContain('client/src/');
    expect(roots).toContain('server/');
  });

  it('prefers client/src/ over client/ when both nest exists', () => {
    const dir = tmpDir();
    mkdir(dir, 'client/src');
    const roots = getSourceRoots(dir);
    expect(roots).toContain('client/src/');
    expect(roots).not.toContain('client/');
  });

  it('detects src/ root when present', () => {
    const dir = tmpDir();
    mkdir(dir, 'src');
    const roots = getSourceRoots(dir);
    expect(roots).toContain('src/');
  });

  it('returns empty array for empty directory', () => {
    const dir = tmpDir();
    const roots = getSourceRoots(dir);
    expect(roots).toEqual([]);
  });

  it('probeRepo includes source roots', () => {
    const dir = tmpDir();
    mkdir(dir, 'client/src');
    mkdir(dir, 'server');
    write(dir, 'tsconfig.json', '{}');
    const p = probeRepo(dir);
    expect(p.sourceRoots).toContain('client/src/');
    expect(p.sourceRoots).toContain('server/');
  });

  it('does not include files as source roots', () => {
    const dir = tmpDir();
    write(dir, 'src', ''); // file, not a directory
    const roots = getSourceRoots(dir);
    expect(roots).not.toContain('src/');
  });
});

// ---------------------------------------------------------------------------
// Empty directory (all nulls)
// ---------------------------------------------------------------------------

describe('Empty directory', () => {
  it('returns null testRunner, buildTool, lintTool, packageManager, monorepo', () => {
    const dir = tmpDir();
    const p = probeRepo(dir);
    expect(p.testRunner).toBeNull();
    expect(p.buildTool).toBeNull();
    expect(p.lintTool).toBeNull();
    expect(p.packageManager).toBeNull();
    expect(p.monorepo).toBeNull();
  });

  it('returns empty sourceRoots', () => {
    const dir = tmpDir();
    const p = probeRepo(dir);
    expect(p.sourceRoots).toEqual([]);
  });

  it('defaults language to ts', () => {
    const dir = tmpDir();
    const p = probeRepo(dir);
    expect(p.language).toBe('ts');
  });

  it('getVerifyCommand falls back to npm test', () => {
    const dir = tmpDir();
    const p = probeRepo(dir);
    expect(getVerifyCommand(p)).toBe('npm test');
  });

  it('getBuildCommand falls back to npm run build', () => {
    const dir = tmpDir();
    const p = probeRepo(dir);
    expect(getBuildCommand(p)).toBe('npm run build');
  });

  it('getLintCommand returns null', () => {
    const dir = tmpDir();
    const p = probeRepo(dir);
    expect(getLintCommand(p)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cache behaviour
// ---------------------------------------------------------------------------

describe('cache', () => {
  it('writes .ratchet/repo-profile.json after probe', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    probeRepo(dir);
    expect(existsSync(join(dir, '.ratchet', 'repo-profile.json'))).toBe(true);
  });

  it('returns cached profile on second call (same object shape)', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    const first = probeRepo(dir);
    const second = probeRepo(dir);
    expect(second.detectedAt).toBe(first.detectedAt);
    expect(second.language).toBe(first.language);
  });

  it('force: true bypasses cache and updates detectedAt', async () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    const first = probeRepo(dir);

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 10));

    const forced = probeRepo(dir, { force: true });
    expect(forced.detectedAt).not.toBe(first.detectedAt);
  });

  it('respects 24h expiry — reads stale cache as expired', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');

    // Write a fake cache with an old timestamp
    const staleProfile: RepoProfile = {
      language: 'go',             // wrong — real dir has tsconfig.json
      sourceRoots: [],
      testRunner: null,
      buildTool: null,
      lintTool: null,
      packageManager: null,
      monorepo: null,
      detectedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    };
    mkdirSync(join(dir, '.ratchet'), { recursive: true });
    writeFileSync(
      join(dir, '.ratchet', 'repo-profile.json'),
      JSON.stringify(staleProfile, null, 2),
    );

    // Should re-probe since cache is expired — detects ts not go
    const p = probeRepo(dir);
    expect(p.language).toBe('ts');
  });

  it('uses fresh cache within 24h window', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');

    // Write a fake fresh cache claiming language is 'go'
    const freshProfile: RepoProfile = {
      language: 'go',
      sourceRoots: [],
      testRunner: null,
      buildTool: null,
      lintTool: null,
      packageManager: null,
      monorepo: null,
      detectedAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
    };
    mkdirSync(join(dir, '.ratchet'), { recursive: true });
    writeFileSync(
      join(dir, '.ratchet', 'repo-profile.json'),
      JSON.stringify(freshProfile, null, 2),
    );

    // Should return cached value (go), not re-probe (ts)
    const p = probeRepo(dir);
    expect(p.language).toBe('go');
  });

  it('handles malformed cache JSON gracefully', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    mkdirSync(join(dir, '.ratchet'), { recursive: true });
    writeFileSync(join(dir, '.ratchet', 'repo-profile.json'), 'not-valid-json');

    // Should fall back to fresh probe without throwing
    expect(() => probeRepo(dir)).not.toThrow();
    const p = probeRepo(dir);
    expect(p.language).toBe('ts');
  });
});

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

describe('package manager detection', () => {
  it('detects bun via bun.lockb', () => {
    const dir = tmpDir();
    write(dir, 'bun.lockb', '');
    expect(probeRepo(dir).packageManager).toBe('bun');
  });

  it('detects bun via bun.lock', () => {
    const dir = tmpDir();
    write(dir, 'bun.lock', '');
    expect(probeRepo(dir).packageManager).toBe('bun');
  });

  it('detects yarn via yarn.lock', () => {
    const dir = tmpDir();
    write(dir, 'yarn.lock', '');
    expect(probeRepo(dir).packageManager).toBe('yarn');
  });

  it('detects npm via package-lock.json', () => {
    const dir = tmpDir();
    write(dir, 'package-lock.json', '');
    expect(probeRepo(dir).packageManager).toBe('npm');
  });

  it('bun takes priority over pnpm when both lockfiles present', () => {
    const dir = tmpDir();
    write(dir, 'bun.lockb', '');
    write(dir, 'pnpm-lock.yaml', '');
    expect(probeRepo(dir).packageManager).toBe('bun');
  });
});

// ---------------------------------------------------------------------------
// Vite / esbuild build tools
// ---------------------------------------------------------------------------

describe('build tool detection', () => {
  it('detects vite when vite.config.ts exists (even with tsconfig)', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    write(dir, 'vite.config.ts', '');
    const p = probeRepo(dir);
    expect(p.buildTool?.name).toBe('vite');
    expect(p.buildTool?.command).toBe('npx vite build');
  });

  it('detects esbuild when in devDependencies and tsconfig present', () => {
    const dir = tmpDir();
    write(dir, 'tsconfig.json', '{}');
    write(dir, 'package.json', JSON.stringify({ devDependencies: { esbuild: '^0.20' } }));
    const p = probeRepo(dir);
    // tsc check: tsconfig present but esbuild is a bundler dep → skip tsc, detect esbuild
    expect(p.buildTool?.name).toBe('esbuild');
  });

  it('falls back to npm run build via package.json build script', () => {
    const dir = tmpDir();
    write(dir, 'package.json', JSON.stringify({ scripts: { build: 'node build.js' } }));
    const p = probeRepo(dir);
    expect(p.buildTool?.name).toBe('npm-build');
    expect(p.buildTool?.command).toBe('npm run build');
  });
});

// ---------------------------------------------------------------------------
// Test runner: jest, mocha, deno
// ---------------------------------------------------------------------------

describe('test runner detection — jest / mocha / deno', () => {
  it('detects jest via jest.config.js', () => {
    const dir = tmpDir();
    write(dir, 'jest.config.js', '');
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('jest');
    expect(p.testRunner?.command).toBe('npx jest');
  });

  it('detects jest via package.json devDependencies', () => {
    const dir = tmpDir();
    write(dir, 'package.json', JSON.stringify({ devDependencies: { jest: '^29' } }));
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('jest');
  });

  it('detects mocha via .mocharc.yml', () => {
    const dir = tmpDir();
    write(dir, '.mocharc.yml', '');
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('mocha');
    expect(p.testRunner?.command).toBe('npx mocha');
  });

  it('detects mocha via package.json dep', () => {
    const dir = tmpDir();
    write(dir, 'package.json', JSON.stringify({ devDependencies: { mocha: '^10' } }));
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('mocha');
  });

  it('detects deno-test via deno.json tasks.test', () => {
    const dir = tmpDir();
    write(dir, 'deno.json', JSON.stringify({ tasks: { test: 'deno test --allow-all' } }));
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('deno-test');
    expect(p.testRunner?.command).toBe('deno test');
  });

  it('does not detect deno-test when deno.json has no test task', () => {
    const dir = tmpDir();
    write(dir, 'deno.json', JSON.stringify({ tasks: { start: 'deno run main.ts' } }));
    const p = probeRepo(dir);
    expect(p.testRunner?.name).not.toBe('deno-test');
  });

  it('detects npm-test fallback via package.json scripts.test', () => {
    const dir = tmpDir();
    write(dir, 'package.json', JSON.stringify({ scripts: { test: 'node test.js' } }));
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('npm-test');
    expect(p.testRunner?.command).toBe('npm test');
  });

  it('vitest takes priority over jest when both config files present', () => {
    const dir = tmpDir();
    write(dir, 'vitest.config.ts', '');
    write(dir, 'jest.config.ts', '');
    const p = probeRepo(dir);
    expect(p.testRunner?.name).toBe('vitest');
  });
});

// ---------------------------------------------------------------------------
// Lint tool: biome, deno-lint
// ---------------------------------------------------------------------------

describe('lint tool detection — biome / deno', () => {
  it('detects biome via biome.json', () => {
    const dir = tmpDir();
    write(dir, 'biome.json', '{}');
    const p = probeRepo(dir);
    expect(p.lintTool?.name).toBe('biome');
    expect(p.lintTool?.command).toBe('npx biome check');
    expect(p.lintTool?.configFile).toBe('biome.json');
  });

  it('eslint takes priority over biome', () => {
    const dir = tmpDir();
    write(dir, '.eslintrc.json', '{}');
    write(dir, 'biome.json', '{}');
    const p = probeRepo(dir);
    expect(p.lintTool?.name).toBe('eslint');
  });

  it('detects deno-lint via deno.json', () => {
    const dir = tmpDir();
    write(dir, 'deno.json', JSON.stringify({ tasks: { start: 'deno run main.ts' } }));
    const p = probeRepo(dir);
    expect(p.lintTool?.name).toBe('deno-lint');
    expect(p.lintTool?.command).toBe('deno lint');
  });
});

// ---------------------------------------------------------------------------
// getVerifyCommand / getBuildCommand / getLintCommand convenience
// ---------------------------------------------------------------------------

describe('command convenience functions', () => {
  it('getVerifyCommand returns testRunner.command', () => {
    const profile: RepoProfile = {
      language: 'ts',
      sourceRoots: [],
      testRunner: { name: 'vitest', command: 'npx vitest run' },
      buildTool: null,
      lintTool: null,
      packageManager: null,
      monorepo: null,
      detectedAt: new Date().toISOString(),
    };
    expect(getVerifyCommand(profile)).toBe('npx vitest run');
  });

  it('getVerifyCommand falls back to npm test when testRunner is null', () => {
    const profile: RepoProfile = {
      language: 'ts',
      sourceRoots: [],
      testRunner: null,
      buildTool: null,
      lintTool: null,
      packageManager: null,
      monorepo: null,
      detectedAt: new Date().toISOString(),
    };
    expect(getVerifyCommand(profile)).toBe('npm test');
  });

  it('getBuildCommand returns buildTool.command', () => {
    const profile: RepoProfile = {
      language: 'go',
      sourceRoots: [],
      testRunner: null,
      buildTool: { name: 'go-build', command: 'go build ./...' },
      lintTool: null,
      packageManager: null,
      monorepo: null,
      detectedAt: new Date().toISOString(),
    };
    expect(getBuildCommand(profile)).toBe('go build ./...');
  });

  it('getBuildCommand falls back to npm run build when buildTool is null', () => {
    const profile: RepoProfile = {
      language: 'ts',
      sourceRoots: [],
      testRunner: null,
      buildTool: null,
      lintTool: null,
      packageManager: null,
      monorepo: null,
      detectedAt: new Date().toISOString(),
    };
    expect(getBuildCommand(profile)).toBe('npm run build');
  });

  it('getLintCommand returns lintTool.command', () => {
    const profile: RepoProfile = {
      language: 'rust',
      sourceRoots: [],
      testRunner: null,
      buildTool: null,
      lintTool: { name: 'clippy', command: 'cargo clippy' },
      packageManager: null,
      monorepo: null,
      detectedAt: new Date().toISOString(),
    };
    expect(getLintCommand(profile)).toBe('cargo clippy');
  });

  it('getLintCommand returns null when lintTool is null', () => {
    const profile: RepoProfile = {
      language: 'go',
      sourceRoots: [],
      testRunner: null,
      buildTool: null,
      lintTool: null,
      packageManager: null,
      monorepo: null,
      detectedAt: new Date().toISOString(),
    };
    expect(getLintCommand(profile)).toBeNull();
  });
});
