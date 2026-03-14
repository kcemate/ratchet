import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { RatchetConfig, Target } from '../types.js';

export type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'unknown';

export interface DetectedProject {
  type: ProjectType;
  testCommand: string | null;
  sourcePaths: string[];
  noTestCommand: boolean;
}

const SOURCE_DIRS = ['src', 'lib', 'app', 'pkg', 'internal', 'cmd'];

export function detectProject(cwd: string): DetectedProject {
  const type = detectProjectType(cwd);
  const testCommand = detectTestCommand(cwd, type);
  const sourcePaths = detectSourcePaths(cwd);

  return {
    type,
    testCommand,
    sourcePaths,
    noTestCommand: testCommand === null,
  };
}

export function detectProjectType(cwd: string): ProjectType {
  if (existsSync(join(cwd, 'package.json'))) return 'node';
  if (
    existsSync(join(cwd, 'requirements.txt')) ||
    existsSync(join(cwd, 'pyproject.toml')) ||
    existsSync(join(cwd, 'setup.py'))
  )
    return 'python';
  if (existsSync(join(cwd, 'go.mod'))) return 'go';
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'rust';
  return 'unknown';
}

export function detectTestCommand(cwd: string, type: ProjectType): string | null {
  switch (type) {
    case 'node':
      return detectNodeTestCommand(cwd);
    case 'python':
      return 'pytest';
    case 'go':
      return 'go test ./...';
    case 'rust':
      return 'cargo test';
    default:
      return null;
  }
}

function detectNodeTestCommand(cwd: string): string | null {
  try {
    const pkgPath = join(cwd, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};

    // Priority order: prefer common script names
    const candidates = ['test', 'test:unit', 'test:ci', 'test:run'];
    for (const name of candidates) {
      if (scripts[name]) {
        // If the script is literally "vitest run" or "jest", run it directly
        const cmd = scripts[name].trim();
        if (cmd === 'vitest run' || cmd === 'vitest') return 'npx vitest run';
        if (cmd === 'jest') return 'npx jest';
        return `npm run ${name}`;
      }
    }

    // No scripts matched — fall back to config file detection
    if (
      existsSync(join(cwd, 'vitest.config.ts')) ||
      existsSync(join(cwd, 'vitest.config.js')) ||
      existsSync(join(cwd, 'vitest.config.mts'))
    ) {
      return 'npx vitest run';
    }
    if (
      existsSync(join(cwd, 'jest.config.ts')) ||
      existsSync(join(cwd, 'jest.config.js')) ||
      existsSync(join(cwd, 'jest.config.json'))
    ) {
      return 'npx jest';
    }

    return null;
  } catch {
    return null;
  }
}

export function detectSourcePaths(cwd: string): string[] {
  return SOURCE_DIRS.filter((dir) => existsSync(join(cwd, dir)));
}

export function buildAutoConfig(cwd: string): RatchetConfig {
  const detected = detectProject(cwd);

  const sourcePaths = detected.sourcePaths.length > 0 ? detected.sourcePaths : ['.'];
  const primarySource = sourcePaths[0];

  const targets: Target[] = [
    {
      name: 'auto',
      path: `${primarySource}/`,
      description: `Auto-detected ${detected.type} project — ${primarySource}/`,
    },
  ];

  return {
    agent: 'shell',
    defaults: {
      clicks: 7,
      testCommand: detected.testCommand ?? 'npm test',
      autoCommit: true,
      hardenMode: detected.noTestCommand,
    },
    targets,
    _source: 'auto-detected',
    _noTestCommand: detected.noTestCommand,
  };
}
