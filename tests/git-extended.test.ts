import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import {
  stash,
  stashPop,
  revert,
  addAll,
  checkoutBranch,
  getModifiedFiles,
  status,
  commit,
  createBranch,
  currentBranch,
  gitDropStash,
} from '../src/core/git.js';

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@ratchet.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Ratchet Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
}

describe('git extended operations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-git-ext-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('getModifiedFiles', () => {
    it('returns modified files after changes', async () => {
      writeFileSync(join(dir, 'README.md'), '# modified\n');
      const files = await getModifiedFiles(dir);
      expect(files).toContain('README.md');
    });

    it('returns newly created tracked files', async () => {
      writeFileSync(join(dir, 'new-file.ts'), 'export const x = 1;\n');
      execFileSync('git', ['add', 'new-file.ts'], { cwd: dir });
      const files = await getModifiedFiles(dir);
      expect(files).toContain('new-file.ts');
    });
  });

  describe('addAll', () => {
    it('stages all untracked files', async () => {
      writeFileSync(join(dir, 'staged.ts'), 'const x = 1;\n');
      await addAll(dir);
      const s = await status(dir);
      expect(s.staged).toContain('staged.ts');
    });

    it('stages modified files', async () => {
      writeFileSync(join(dir, 'README.md'), '# updated\n');
      await addAll(dir);
      const s = await status(dir);
      expect(s.staged).toContain('README.md');
    });
  });

  describe('stash and stashPop', () => {
    it('stashes local changes and makes working tree clean', async () => {
      writeFileSync(join(dir, 'work.ts'), 'const wip = true;\n');
      execFileSync('git', ['add', '-A'], { cwd: dir });
      await stash(dir, 'wip changes');
      const s = await status(dir);
      expect(s.clean).toBe(true);
    });

    it('restores changes after stashPop', async () => {
      writeFileSync(join(dir, 'work.ts'), 'const wip = true;\n');
      execFileSync('git', ['add', '-A'], { cwd: dir });
      await stash(dir);
      await stashPop(dir);
      const s = await status(dir);
      expect(s.staged).toContain('work.ts');
    });
  });

  describe('revert', () => {
    it('discards uncommitted changes to tracked files', async () => {
      writeFileSync(join(dir, 'README.md'), '# this should go away\n');
      await revert(dir);
      const s = await status(dir);
      expect(s.clean).toBe(true);
    });

    it('removes untracked files', async () => {
      writeFileSync(join(dir, 'untracked.ts'), 'const x = 1;\n');
      await revert(dir);
      const s = await status(dir);
      expect(s.untracked).not.toContain('untracked.ts');
    });
  });

  describe('checkoutBranch', () => {
    it('switches to an existing branch', async () => {
      await createBranch('feature/test', dir);
      // go back to original branch first
      const orig = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
        .toString()
        .trim();
      expect(orig).toBe('feature/test');
    });

    it('checks out a branch created earlier', async () => {
      await createBranch('ratchet/old', dir);
      // create another branch from here
      writeFileSync(join(dir, 'branch-file.ts'), 'export const b = 2;\n');
      await commit('feat: branch file', dir);
      await createBranch('ratchet/new', dir);
      await checkoutBranch('ratchet/old', dir);
      const branch = await currentBranch(dir);
      expect(branch).toBe('ratchet/old');
    });
  });

  describe('status - staged files', () => {
    it('reports staged files correctly', async () => {
      writeFileSync(join(dir, 'staged.ts'), 'export const s = 1;\n');
      execFileSync('git', ['add', 'staged.ts'], { cwd: dir });
      const s = await status(dir);
      expect(s.staged).toContain('staged.ts');
      expect(s.clean).toBe(false);
    });

    it('reports changes to tracked files as dirty', async () => {
      writeFileSync(join(dir, 'README.md'), '# changed\n');
      const s = await status(dir);
      // Modified tracked file shows as unstaged (or staged if somehow auto-staged)
      const allChanged = [...s.staged, ...s.unstaged];
      expect(s.clean).toBe(false);
      expect(allChanged.length).toBeGreaterThan(0);
    });
  });
});
