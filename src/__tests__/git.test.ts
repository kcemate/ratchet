import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  currentBranch,
  isDetachedHead,
  createBranch,
  checkoutBranch,
  status,
  stash,
  stashPop,
  commit,
  revert,
  revertLastCommit,
  getLastCommitHash,
  getModifiedFiles,
  isRepo,
  gitDropStash,
  hasRemote,
  branchName,
} from '../core/git.js';

vi.mock('child_process', () => {
  return { execFile: vi.fn() };
});

import { execFile } from 'child_process';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const CWD = '/test/repo';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper to mock execFile for a sequence of calls.
 * Each entry: { args?, stdout, stderr, exitCode }
 * If args matches the pattern in the entry, return its stdout/stderr.
 * Uses the first matching entry.
 */
function mockForArgs(
  patterns: Array<{ match: (args: string[]) => boolean; stdout: string; stderr?: string; exitCode?: number }>,
) {
  mockExecFile.mockImplementation(
    (_cmd: string, args: string[], _opts: unknown, cb?: Function) => {
      const entry = patterns.find(p => p.match(args));
      const stdout = entry?.stdout ?? '';
      const stderr = entry?.stderr ?? '';
      const exitCode = entry?.exitCode ?? 0;
      if (cb) {
        const err = exitCode === 0 ? null : Object.assign(new Error('git error'), { code: exitCode, stderr });
        cb(err, { stdout, stderr });
      }
      return Promise.resolve({ stdout, stderr });
    },
  );
}

function mockSimple(stdout: string, stderr = '', exitCode = 0) {
  mockForArgs([
    { match: () => true, stdout, stderr, exitCode },
  ]);
}

describe('currentBranch', () => {
  it('returns the current branch name', async () => {
    mockSimple('main');
    const branch = await currentBranch(CWD);
    expect(branch).toBe('main');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('trims trailing whitespace', async () => {
    mockSimple('feature/my-branch\n');
    const branch = await currentBranch(CWD);
    expect(branch).toBe('feature/my-branch');
  });
});

describe('isDetachedHead', () => {
  it('returns false for a normal branch', async () => {
    mockSimple('main');
    expect(await isDetachedHead(CWD)).toBe(false);
  });

  it('returns true when git returns HEAD', async () => {
    mockSimple('HEAD');
    expect(await isDetachedHead(CWD)).toBe(true);
  });

  it('returns false when git rev-parse fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error('not a git repo'), { stdout: '', stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    );
    expect(await isDetachedHead(CWD)).toBe(false);
  });
});

describe('createBranch', () => {
  it('creates a new branch with git checkout -b', async () => {
    mockSimple('');
    await createBranch('feature/new', CWD);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['checkout', '-b', 'feature/new'],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe('checkoutBranch', () => {
  it('checks out a named branch', async () => {
    mockSimple('');
    await checkoutBranch('main', CWD);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['checkout', 'main'],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe('status', () => {
  it('parses staged modified file', async () => {
    mockForArgs([
      { match: (a) => a.includes('--abbrev-ref'), stdout: 'main' },
      { match: (a) => a.includes('--porcelain'), stdout: 'M  src/index.ts\n' },
    ]);
    const result = await status(CWD);
    expect(result.branch).toBe('main');
    expect(result.staged).toContain('src/index.ts');
    expect(result.clean).toBe(false);
  });

  it('parses untracked files', async () => {
    mockForArgs([
      { match: (a) => a.includes('--abbrev-ref'), stdout: 'main' },
      { match: (a) => a.includes('--porcelain'), stdout: '?? new-file.ts\n' },
    ]);
    const result = await status(CWD);
    expect(result.untracked).toContain('new-file.ts');
    expect(result.clean).toBe(false);
  });

  it('reports clean when no changes', async () => {
    mockForArgs([
      { match: (a) => a.includes('--abbrev-ref'), stdout: 'main' },
      { match: (a) => a.includes('--porcelain'), stdout: '' },
    ]);
    const result = await status(CWD);
    expect(result.clean).toBe(true);
  });

  it('handles mixed staged and unstaged changes', async () => {
    mockForArgs([
      { match: (a) => a.includes('--abbrev-ref'), stdout: 'main' },
      // XY porcelain: X=index (staged), Y=working-tree, space, path
      // 'M  ' = staged modified, ' M ' = unstaged modified
      { match: (a) => a.includes('--porcelain'), stdout: 'M  src/index.ts\n M src/utils.ts\n' },
    ]);
    const result = await status(CWD);
    expect(result.staged).toContain('src/index.ts');
    expect(result.unstaged).toContain('src/utils.ts');
  });
});

describe('stash', () => {
  it('returns true when changes were stashed', async () => {
    mockSimple('Saved working directory and ...');
    expect(await stash(CWD, 'my stash')).toBe(true);
  });

  it('returns false when there was nothing to stash', async () => {
    mockSimple('No local changes to save');
    expect(await stash(CWD)).toBe(false);
  });

  it('passes message to git stash push', async () => {
    mockSimple('Saved working directory and ...');
    await stash(CWD, 'my-stash-message');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['stash', 'push', '-m', 'my-stash-message'],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe('stashPop', () => {
  it('runs git stash pop', async () => {
    mockSimple('');
    await stashPop(CWD);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['stash', 'pop'],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe('commit', () => {
  it('stages, commits, and returns the new hash', async () => {
    let step = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        step++;
        if (step === 1) cb(null, { stdout: '', stderr: '' }); // add
        else if (step === 2) cb(null, { stdout: '', stderr: '' }); // commit
        else cb(null, { stdout: 'abc123def\n', stderr: '' }); // rev-parse
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    );
    const hash = await commit('fix: something', CWD);
    expect(hash).toBe('abc123def');
  });

  it('throws with a clear message when nothing to commit', async () => {
    let step = 0;
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        step++;
        if (step === 1) cb(null, { stdout: '', stderr: '' }); // add
        else cb(
          Object.assign(new Error('nothing'), { stderr: 'nothing to commit' }),
          { stdout: '', stderr: 'nothing to commit' },
        );
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    );
    await expect(commit('empty', CWD)).rejects.toThrow('Nothing to commit');
  });
});

describe('revert', () => {
  it('resets hard and cleans', async () => {
    const calls: string[][] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
        calls.push(args);
        cb(null, { stdout: '', stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    );
    await revert(CWD);
    expect(calls[0]).toContain('reset');
    expect(calls[0]).toContain('--hard');
    expect(calls[1]).toContain('clean');
    expect(calls[1]).toContain('-fd');
  });
});

describe('revertLastCommit', () => {
  it('resets to HEAD~1', async () => {
    mockSimple('');
    await revertLastCommit(CWD);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'HEAD~1'],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe('getLastCommitHash', () => {
  it('returns the current HEAD hash', async () => {
    mockSimple('f3a1b9c2d4e5');
    expect(await getLastCommitHash(CWD)).toBe('f3a1b9c2d4e5');
  });

  it('returns empty string when no commits', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error('fatal: not a git repository'), { stdout: '', stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    );
    expect(await getLastCommitHash(CWD)).toBe('');
  });
});

describe('getModifiedFiles', () => {
  it('returns files changed vs HEAD', async () => {
    mockSimple('src/a.ts\nsrc/b.ts\n');
    expect(await getModifiedFiles(CWD)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns empty array when no changes', async () => {
    mockSimple('');
    expect(await getModifiedFiles(CWD)).toEqual([]);
  });
});

describe('isRepo', () => {
  it('returns true when .git directory exists', async () => {
    mockSimple('.git');
    expect(await isRepo(CWD)).toBe(true);
  });

  it('returns false when not a git repo', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error('fatal: not a git repository'), { stdout: '', stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    );
    expect(await isRepo(CWD)).toBe(false);
  });
});

describe('gitDropStash', () => {
  it('drops the stash', async () => {
    mockSimple('');
    await gitDropStash(CWD);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['stash', 'drop'],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe('hasRemote', () => {
  it('returns true when remotes are configured', async () => {
    mockSimple('origin\ngh');
    expect(await hasRemote(CWD)).toBe(true);
  });

  it('returns false when no remotes', async () => {
    mockSimple('');
    expect(await hasRemote(CWD)).toBe(false);
  });
});

describe('branchName', () => {
  it('starts with ratchet/ prefix', () => {
    const name = branchName('test');
    expect(name.startsWith('ratchet/')).toBe(true);
  });

  it('contains a lowercased version of the target name', () => {
    const name = branchName('API-LAYER');
    expect(name).toContain('api-layer');
  });

  it('replaces spaces and special chars with hyphens', () => {
    const name = branchName('My API (v2)');
    expect(name).not.toContain(' ');
    expect(name).not.toContain('(');
    expect(name).not.toContain(')');
  });

  it('includes an ISO timestamp', () => {
    const name = branchName('test');
    // Timestamp portion: YYYY-MM-DDThh-mm-ss
    expect(name).toMatch(/-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});
