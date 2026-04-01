import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitSourceOnly, RATCHET_PATHS } from '../core/git.js';

vi.mock('child_process', () => {
  return { execFile: vi.fn() };
});

import { execFile } from 'child_process';

const mockExecFile = execFile as ReturnType<typeof vi.fn>;
const CWD = '/test/repo';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock execFile implementation driven by a sequence of call handlers.
 * Each handler receives the git args and returns { stdout, stderr, exitCode }.
 */
function mockSequence(
  handlers: Array<(args: string[]) => { stdout?: string; stderr?: string; exitCode?: number }>,
) {
  let callIndex = 0;
  mockExecFile.mockImplementation(
    (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
      const handler = handlers[callIndex] ?? (() => ({ stdout: '', stderr: '', exitCode: 0 }));
      callIndex++;
      const { stdout = '', stderr = '', exitCode = 0 } = handler(args);
      if (cb) {
        const err =
          exitCode === 0
            ? null
            : Object.assign(new Error('git error'), { code: exitCode, stderr });
        cb(err, { stdout, stderr });
      }
      return Promise.resolve({ stdout, stderr });
    },
  );
}

// ---------------------------------------------------------------------------
// Tests: RATCHET_PATHS
// ---------------------------------------------------------------------------

describe('RATCHET_PATHS', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(RATCHET_PATHS)).toBe(true);
    expect(RATCHET_PATHS.length).toBeGreaterThan(0);
  });

  it('covers the .ratchet/ directory', () => {
    expect(RATCHET_PATHS).toContain('.ratchet/');
  });

  it('covers .ratchet.yml', () => {
    expect(RATCHET_PATHS).toContain('.ratchet.yml');
  });

  it('covers .ratchetignore', () => {
    expect(RATCHET_PATHS).toContain('.ratchetignore');
  });

  it('covers .ratchet.lock', () => {
    expect(RATCHET_PATHS).toContain('.ratchet.lock');
  });

  it('covers docs/*-ratchet.md pattern', () => {
    expect(RATCHET_PATHS).toContain('docs/*-ratchet.md');
  });

  it('covers docs/*-ratchet-report.md pattern', () => {
    expect(RATCHET_PATHS).toContain('docs/*-ratchet-report.md');
  });

  it('covers .ratchet/runs/', () => {
    expect(RATCHET_PATHS).toContain('.ratchet/runs/');
  });

  it('covers .ratchet/scan-cache.json', () => {
    expect(RATCHET_PATHS).toContain('.ratchet/scan-cache.json');
  });
});

// ---------------------------------------------------------------------------
// Tests: commitSourceOnly — only ratchet metadata staged
// ---------------------------------------------------------------------------

describe('commitSourceOnly — only metadata staged', () => {
  it('returns null when no source files remain after unstaging ratchet paths', async () => {
    // Call order:
    // 1. git add -A                        → ok
    // 2-N. git reset HEAD -- <each path>   → ok (one per RATCHET_PATHS entry)
    // N+1. git diff --cached --name-only   → only ratchet files listed
    // N+2. git reset HEAD                  → ok (cleanup)
    const ratchetOnlyDiff = '.ratchet.yml\n.ratchet/runs/run-1.json\n';
    mockSequence([
      // add -A
      () => ({ stdout: '' }),
      // reset HEAD -- for each RATCHET_PATH
      ...RATCHET_PATHS.map(() => () => ({ stdout: '' })),
      // diff --cached after unstaging → shows nothing (unstaging worked)
      (args) => args.includes('--name-only') ? { stdout: '' } : { stdout: '' },
      // git reset HEAD (cleanup)
      () => ({ stdout: '' }),
    ]);

    const result = await commitSourceOnly('test: no source changes', CWD);
    expect(result).toBeNull();
  });

  it('does not call git commit when there are no staged source files', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        calls.push(args);
        // diff --cached --name-only returns empty (no staged files after filtering)
        const stdout = args.includes('--name-only') ? '' : '';
        if (cb) cb(null, { stdout, stderr: '' });
        return Promise.resolve({ stdout, stderr: '' });
      },
    );

    await commitSourceOnly('test: no source changes', CWD);

    const commitCall = calls.find((a) => a[0] === 'commit');
    expect(commitCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: commitSourceOnly — real source files staged
// ---------------------------------------------------------------------------

describe('commitSourceOnly — real source files staged', () => {
  it('returns a commit hash when source files are staged', async () => {
    const sourceFiles = 'src/index.ts\nsrc/utils.ts\n';
    mockSequence([
      // add -A
      () => ({ stdout: '' }),
      // reset HEAD -- for each RATCHET_PATH
      ...RATCHET_PATHS.map(() => () => ({ stdout: '' })),
      // diff --cached --name-only → real source files remain
      (args) => args.includes('--name-only') ? { stdout: sourceFiles } : { stdout: '' },
      // git commit
      () => ({ stdout: '' }),
      // git rev-parse HEAD
      () => ({ stdout: 'deadbeef1234\n' }),
    ]);

    const result = await commitSourceOnly('fix: real change', CWD);
    expect(result).toBe('deadbeef1234');
  });

  it('calls git add -A before committing', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        calls.push([...args]);
        let stdout = '';
        if (args.includes('--name-only')) stdout = 'src/foo.ts\n';
        if (args[0] === 'rev-parse') stdout = 'abc123\n';
        if (cb) cb(null, { stdout, stderr: '' });
        return Promise.resolve({ stdout, stderr: '' });
      },
    );

    await commitSourceOnly('fix: something', CWD);

    const addCall = calls.find((a) => a[0] === 'add' && a[1] === '-A');
    expect(addCall).toBeDefined();
  });

  it('calls git reset HEAD -- for every entry in RATCHET_PATHS before committing', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
        calls.push([...args]);
        let stdout = '';
        if (args.includes('--name-only')) stdout = 'src/main.ts\n';
        if (args[0] === 'rev-parse') stdout = 'cafebabe\n';
        if (cb) cb(null, { stdout, stderr: '' });
        return Promise.resolve({ stdout, stderr: '' });
      },
    );

    await commitSourceOnly('fix: something', CWD);

    for (const rp of RATCHET_PATHS) {
      const resetCall = calls.find(
        (a) => a[0] === 'reset' && a[1] === 'HEAD' && a[2] === '--' && a[3] === rp,
      );
      expect(resetCall, `expected reset call for path ${rp}`).toBeDefined();
    }
  });

  it('returns null when git commit reports nothing to commit', async () => {
    mockSequence([
      // add -A
      () => ({ stdout: '' }),
      // reset HEAD -- for each RATCHET_PATH
      ...RATCHET_PATHS.map(() => () => ({ stdout: '' })),
      // diff --cached --name-only → shows files (we think there are changes)
      (args) => args.includes('--name-only') ? { stdout: 'src/index.ts\n' } : { stdout: '' },
      // git commit → nothing to commit
      () => ({ stdout: '', stderr: 'nothing to commit', exitCode: 1 }),
    ]);

    const result = await commitSourceOnly('test: empty', CWD);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: click.ts filtering logic (unit test via pure function)
// ---------------------------------------------------------------------------

describe('click.ts ratchet-path filtering logic', () => {
  /**
   * Inline the same filtering logic used in click.ts so we can unit-test it
   * without spinning up the full executeClick machinery.
   */
  function filterSourceChanges(unstaged: string[]): string[] {
    return unstaged.filter(
      (f) =>
        !RATCHET_PATHS.some((rp) => {
          const pattern = rp.endsWith('/') ? rp.slice(0, -1) : rp;
          if (pattern.includes('*')) {
            const prefix = pattern.split('*')[0];
            return f.startsWith(prefix);
          }
          return f === pattern || f.startsWith(rp);
        }),
    );
  }

  it('filters out .ratchet.yml', () => {
    expect(filterSourceChanges(['.ratchet.yml'])).toEqual([]);
  });

  it('filters out .ratchetignore', () => {
    expect(filterSourceChanges(['.ratchetignore'])).toEqual([]);
  });

  it('filters out .ratchet.lock', () => {
    expect(filterSourceChanges(['.ratchet.lock'])).toEqual([]);
  });

  it('filters out files under .ratchet/', () => {
    expect(filterSourceChanges(['.ratchet/runs/run-1.json'])).toEqual([]);
    expect(filterSourceChanges(['.ratchet/scan-cache.json'])).toEqual([]);
    expect(filterSourceChanges(['.ratchet/state.json'])).toEqual([]);
  });

  it('filters out docs/*-ratchet.md files', () => {
    expect(filterSourceChanges(['docs/api-ratchet.md'])).toEqual([]);
    expect(filterSourceChanges(['docs/project-ratchet.md'])).toEqual([]);
  });

  it('filters out docs/*-ratchet-report.md files', () => {
    expect(filterSourceChanges(['docs/api-ratchet-report.md'])).toEqual([]);
  });

  it('keeps real source files', () => {
    expect(filterSourceChanges(['src/index.ts'])).toEqual(['src/index.ts']);
    expect(filterSourceChanges(['lib/utils.js'])).toEqual(['lib/utils.js']);
    expect(filterSourceChanges(['README.md'])).toEqual(['README.md']);
  });

  it('returns empty array when all changes are ratchet metadata', () => {
    const onlyRatchet = [
      '.ratchet.yml',
      '.ratchetignore',
      '.ratchet/runs/run-5.json',
      'docs/code-ratchet.md',
    ];
    expect(filterSourceChanges(onlyRatchet)).toEqual([]);
  });

  it('keeps source files mixed with ratchet metadata', () => {
    const mixed = [
      '.ratchet.yml',
      'src/main.ts',
      '.ratchet/scan-cache.json',
      'tests/main.test.ts',
    ];
    expect(filterSourceChanges(mixed)).toEqual(['src/main.ts', 'tests/main.test.ts']);
  });
});
