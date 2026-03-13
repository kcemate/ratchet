import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import {
  isRepo,
  currentBranch,
  createBranch,
  status,
  commit,
  branchName,
  getLastCommitHash,
  getModifiedFiles,
} from '../src/core/git.js';

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@ratchet.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Ratchet Test'], { cwd: dir });
  // Initial commit
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
}

describe('git operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-git-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('isRepo', () => {
    it('returns true for git repos', async () => {
      expect(await isRepo(dir)).toBe(true);
    });

    it('returns false for non-git directories', async () => {
      const nonRepo = mkdtempSync(join(tmpdir(), 'ratchet-nongit-'));
      try {
        expect(await isRepo(nonRepo)).toBe(false);
      } finally {
        rmSync(nonRepo, { recursive: true, force: true });
      }
    });
  });

  describe('currentBranch', () => {
    it('returns the current branch name', async () => {
      const branch = await currentBranch(dir);
      // Could be 'main' or 'master' depending on git config
      expect(branch).toMatch(/^(main|master)$/);
    });
  });

  describe('createBranch', () => {
    it('creates and switches to a new branch', async () => {
      await createBranch('ratchet/test-branch', dir);
      const branch = await currentBranch(dir);
      expect(branch).toBe('ratchet/test-branch');
    });
  });

  describe('status', () => {
    it('reports clean status on fresh repo', async () => {
      const s = await status(dir);
      expect(s.clean).toBe(true);
      expect(s.staged).toHaveLength(0);
      expect(s.unstaged).toHaveLength(0);
      expect(s.untracked).toHaveLength(0);
    });

    it('reports untracked files', async () => {
      writeFileSync(join(dir, 'new-file.ts'), 'export const x = 1;\n');
      const s = await status(dir);
      expect(s.clean).toBe(false);
      expect(s.untracked).toContain('new-file.ts');
    });
  });

  describe('commit', () => {
    it('commits files and returns a hash', async () => {
      writeFileSync(join(dir, 'foo.ts'), 'export const x = 42;\n');
      const hash = await commit('feat: add foo', dir);
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });

    it('hash matches getLastCommitHash', async () => {
      writeFileSync(join(dir, 'bar.ts'), 'export const y = 1;\n');
      const hash = await commit('feat: add bar', dir);
      const last = await getLastCommitHash(dir);
      expect(hash).toBe(last);
    });
  });

  describe('getModifiedFiles', () => {
    it('returns empty when nothing changed since last commit', async () => {
      const files = await getModifiedFiles(dir);
      expect(files).toHaveLength(0);
    });
  });
});

describe('branchName', () => {
  it('generates ratchet-prefixed branch names', () => {
    const name = branchName('error-handling');
    expect(name).toMatch(/^ratchet\/error-handling-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it('sanitizes special characters in target name', () => {
    const name = branchName('my target/with spaces!');
    expect(name).not.toMatch(/[ !]/);
    expect(name).toMatch(/^ratchet\//);
  });
});
