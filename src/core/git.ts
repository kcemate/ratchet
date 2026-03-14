import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GitStatus } from '../types.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function gitSafe(args: string[], cwd: string): Promise<string> {
  try {
    return await git(args, cwd);
  } catch {
    return '';
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

/**
 * Returns true when git is in detached HEAD state (e.g. after `git checkout <hash>`).
 * In this state branch-based operations like `git checkout -b` still work but the
 * user's mental model is likely wrong — surface a clear warning before proceeding.
 */
export async function isDetachedHead(cwd: string): Promise<boolean> {
  const branch = await gitSafe(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return branch === 'HEAD';
}

export async function createBranch(name: string, cwd: string): Promise<void> {
  await git(['checkout', '-b', name], cwd);
}

export async function checkoutBranch(name: string, cwd: string): Promise<void> {
  await git(['checkout', name], cwd);
}

export async function status(cwd: string): Promise<GitStatus> {
  const branch = await gitSafe(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const raw = await gitSafe(['status', '--porcelain'], cwd);

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of raw.split('\n').filter(Boolean)) {
    const x = line[0];
    const y = line[1];
    const file = line.slice(3);

    if (x === '?' && y === '?') {
      untracked.push(file);
    } else {
      if (x !== ' ' && x !== '?') staged.push(file);
      if (y !== ' ' && y !== '?') unstaged.push(file);
    }
  }

  return {
    branch,
    clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
    staged,
    unstaged,
    untracked,
  };
}

/**
 * Stash uncommitted changes.
 * Returns true if a stash entry was created, false if the working tree was already clean.
 * This is important: if we return false, callers must NOT call stashPop() — doing so
 * would pop an unrelated stash and potentially destroy the user's saved work.
 */
export async function stash(cwd: string, message?: string): Promise<boolean> {
  const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
  const output = await git(args, cwd);
  // git prints "No local changes to save" (exit 0) when the tree is clean
  return !output.includes('No local changes to save');
}

export async function stashPop(cwd: string): Promise<void> {
  await git(['stash', 'pop'], cwd);
}

export async function addAll(cwd: string): Promise<void> {
  await git(['add', '-A'], cwd);
}

export async function commit(message: string, cwd: string): Promise<string> {
  await git(['add', '-A'], cwd);
  try {
    await git(['commit', '-m', message], cwd);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const output = [error.stdout, error.stderr, (error as Error).message]
      .filter(Boolean)
      .join('\n');
    if (output.includes('nothing to commit') || output.includes('nothing added to commit')) {
      throw new Error(
        'Nothing to commit — the agent reported success but made no file changes.\n' +
          '  The agent may have returned a no-op or the proposal was too vague to act on.',
      );
    }
    throw err;
  }
  return git(['rev-parse', 'HEAD'], cwd);
}

export async function revert(cwd: string): Promise<void> {
  await git(['checkout', '--', '.'], cwd);
  await git(['clean', '-fd'], cwd);
}

export async function getLastCommitHash(cwd: string): Promise<string> {
  return gitSafe(['rev-parse', 'HEAD'], cwd);
}

export async function getModifiedFiles(cwd: string): Promise<string[]> {
  const raw = await gitSafe(['diff', '--name-only', 'HEAD'], cwd);
  return raw.split('\n').filter(Boolean);
}

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--git-dir'], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function gitDropStash(cwd: string): Promise<void> {
  await git(['stash', 'drop'], cwd);
}

export function branchName(target: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = target.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
  return `ratchet/${safe}-${timestamp}`;
}
