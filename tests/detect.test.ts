import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectProjectType,
  detectTestCommand,
  detectSourcePaths,
  detectProject,
  buildAutoConfig,
} from '../src/core/detect.js';

// We mock 'fs' so tests are hermetic — no real filesystem reads
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
const mockExists = existsSync as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  mockExists.mockReturnValue(false);
});

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// detectProjectType
// ---------------------------------------------------------------------------
describe('detectProjectType', () => {
  it('returns node when package.json exists', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('package.json'));
    expect(detectProjectType('/project')).toBe('node');
  });

  it('returns python when requirements.txt exists', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('requirements.txt'));
    expect(detectProjectType('/project')).toBe('python');
  });

  it('returns python when pyproject.toml exists', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('pyproject.toml'));
    expect(detectProjectType('/project')).toBe('python');
  });

  it('returns python when setup.py exists', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('setup.py'));
    expect(detectProjectType('/project')).toBe('python');
  });

  it('returns go when go.mod exists', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('go.mod'));
    expect(detectProjectType('/project')).toBe('go');
  });

  it('returns rust when Cargo.toml exists', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('Cargo.toml'));
    expect(detectProjectType('/project')).toBe('rust');
  });

  it('returns unknown when no known manifests exist', () => {
    mockExists.mockReturnValue(false);
    expect(detectProjectType('/project')).toBe('unknown');
  });

  it('prefers node over python when both markers exist', () => {
    mockExists.mockImplementation(
      (p: string) => p.endsWith('package.json') || p.endsWith('requirements.txt'),
    );
    expect(detectProjectType('/project')).toBe('node');
  });
});

// ---------------------------------------------------------------------------
// detectTestCommand
// ---------------------------------------------------------------------------
describe('detectTestCommand', () => {
  it('returns pytest for python projects', () => {
    expect(detectTestCommand('/project', 'python')).toBe('pytest');
  });

  it('returns go test ./... for go projects', () => {
    expect(detectTestCommand('/project', 'go')).toBe('go test ./...');
  });

  it('returns cargo test for rust projects', () => {
    expect(detectTestCommand('/project', 'rust')).toBe('cargo test');
  });

  it('returns null for unknown projects', () => {
    expect(detectTestCommand('/project', 'unknown')).toBeNull();
  });

  describe('node project detection', () => {
    it('uses npm run test when test script exists in package.json', () => {
      mockExists.mockImplementation((p: string) => p.endsWith('package.json'));
      mockRead.mockReturnValue(
        JSON.stringify({ scripts: { test: 'vitest run' } }),
      );
      // The test script is 'vitest run' exactly, so we normalize to 'npx vitest run'
      expect(detectTestCommand('/project', 'node')).toBe('npx vitest run');
    });

    it('uses npm run test:unit when test:unit script exists', () => {
      mockExists.mockImplementation((p: string) => p.endsWith('package.json'));
      mockRead.mockReturnValue(
        JSON.stringify({ scripts: { 'test:unit': 'jest --testPathPattern=unit' } }),
      );
      expect(detectTestCommand('/project', 'node')).toBe('npm run test:unit');
    });

    it('prefers test over test:unit', () => {
      mockExists.mockImplementation((p: string) => p.endsWith('package.json'));
      mockRead.mockReturnValue(
        JSON.stringify({ scripts: { test: 'mocha', 'test:unit': 'jest' } }),
      );
      expect(detectTestCommand('/project', 'node')).toBe('npm run test');
    });

    it('falls back to npx vitest run when vitest.config.ts exists and no test script', () => {
      mockExists.mockImplementation(
        (p: string) => p.endsWith('package.json') || p.endsWith('vitest.config.ts'),
      );
      mockRead.mockReturnValue(JSON.stringify({ scripts: {} }));
      expect(detectTestCommand('/project', 'node')).toBe('npx vitest run');
    });

    it('falls back to npx jest when jest.config.js exists and no test script', () => {
      mockExists.mockImplementation(
        (p: string) => p.endsWith('package.json') || p.endsWith('jest.config.js'),
      );
      mockRead.mockReturnValue(JSON.stringify({ scripts: {} }));
      expect(detectTestCommand('/project', 'node')).toBe('npx jest');
    });

    it('returns null when no test script and no config file found', () => {
      mockExists.mockImplementation((p: string) => p.endsWith('package.json'));
      mockRead.mockReturnValue(JSON.stringify({ scripts: {} }));
      expect(detectTestCommand('/project', 'node')).toBeNull();
    });

    it('returns null when package.json is unreadable', () => {
      mockExists.mockImplementation((p: string) => p.endsWith('package.json'));
      mockRead.mockImplementation(() => {
        throw new Error('EACCES');
      });
      expect(detectTestCommand('/project', 'node')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// detectSourcePaths
// ---------------------------------------------------------------------------
describe('detectSourcePaths', () => {
  it('returns matching source directories that exist', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('/src') || p.endsWith('/lib'));
    const paths = detectSourcePaths('/project');
    expect(paths).toContain('src');
    expect(paths).toContain('lib');
    expect(paths).not.toContain('app');
  });

  it('returns empty array when no source dirs exist', () => {
    mockExists.mockReturnValue(false);
    expect(detectSourcePaths('/project')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectProject
// ---------------------------------------------------------------------------
describe('detectProject', () => {
  it('sets noTestCommand=true when no test command found', () => {
    mockExists.mockReturnValue(false);
    const result = detectProject('/project');
    expect(result.type).toBe('unknown');
    expect(result.testCommand).toBeNull();
    expect(result.noTestCommand).toBe(true);
  });

  it('sets noTestCommand=false when test command found', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('go.mod'));
    const result = detectProject('/project');
    expect(result.type).toBe('go');
    expect(result.testCommand).toBe('go test ./...');
    expect(result.noTestCommand).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildAutoConfig
// ---------------------------------------------------------------------------
describe('buildAutoConfig', () => {
  it('returns a valid RatchetConfig', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('package.json') || p.endsWith('/src'));
    mockRead.mockReturnValue(JSON.stringify({ scripts: { test: 'vitest run' } }));
    const config = buildAutoConfig('/project');
    expect(config.agent).toBe('shell');
    expect(config._source).toBe('auto-detected');
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].name).toBe('auto');
    expect(config.targets[0].path).toBe('src/');
    expect(config.defaults.testCommand).toBe('npx vitest run');
    expect(config._noTestCommand).toBe(false);
    expect(config.defaults.hardenMode).toBe(false);
  });

  it('sets hardenMode when no test command detected', () => {
    mockExists.mockReturnValue(false);
    const config = buildAutoConfig('/project');
    expect(config._noTestCommand).toBe(true);
    expect(config.defaults.hardenMode).toBe(true);
    expect(config.defaults.testCommand).toBe('npm test'); // fallback
  });

  it('falls back to . as source path when no known dirs exist', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('go.mod'));
    const config = buildAutoConfig('/project');
    expect(config.targets[0].path).toBe('./');
  });

  it('uses python test command for python projects', () => {
    mockExists.mockImplementation((p: string) => p.endsWith('requirements.txt'));
    const config = buildAutoConfig('/project');
    expect(config.defaults.testCommand).toBe('pytest');
    expect(config._noTestCommand).toBe(false);
  });
});
