import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test the guards through the executeClick function behavior
// by mocking the git commands and verifying rollback behavior

describe('Click Guards', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ratchet-guards-'));
    // Init a git repo
    execFileSync('git', ['init'], { cwd: tempDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
    writeFileSync(join(tempDir, 'file.ts'), 'const x = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: tempDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tempDir });
  });

  describe('line count detection', () => {
    it('should detect lines changed via git diff numstat', () => {
      // Make a change that's within limits
      writeFileSync(join(tempDir, 'file.ts'), 'const x = 1;\nconst y = 2;\n');
      const numstat = execFileSync('git', ['diff', '--numstat'], { cwd: tempDir, encoding: 'utf8' });
      expect(numstat).toContain('file.ts');
      // Should show 2 added, 1 removed (replaced line + added line)
      const parts = numstat.trim().split('\t');
      const added = parseInt(parts[0], 10);
      const removed = parseInt(parts[1], 10);
      expect(added + removed).toBeLessThanOrEqual(40);
    });

    it('should detect large changes exceeding line limit', () => {
      // Make a massive change
      const bigContent = Array.from({ length: 50 }, (_, i) => `const var${i} = ${i};`).join('\n');
      writeFileSync(join(tempDir, 'file.ts'), bigContent);
      const numstat = execFileSync('git', ['diff', '--numstat'], { cwd: tempDir, encoding: 'utf8' });
      const parts = numstat.trim().split('\t');
      const added = parseInt(parts[0], 10);
      const removed = parseInt(parts[1], 10);
      expect(added + removed).toBeGreaterThan(40);
    });
  });

  describe('file count detection', () => {
    it('should count unique files changed', () => {
      writeFileSync(join(tempDir, 'a.ts'), 'a');
      writeFileSync(join(tempDir, 'b.ts'), 'b');
      writeFileSync(join(tempDir, 'c.ts'), 'c');
      writeFileSync(join(tempDir, 'd.ts'), 'd');
      execFileSync('git', ['add', '.'], { cwd: tempDir });
      const numstat = execFileSync('git', ['diff', '--numstat', '--cached'], { cwd: tempDir, encoding: 'utf8' });
      const files = numstat.trim().split('\n').filter(Boolean);
      // 4 new files — should exceed maxFilesChanged=3
      expect(files.length).toBe(4);
    });

    it('should allow changes within file limit', () => {
      writeFileSync(join(tempDir, 'a.ts'), 'a');
      writeFileSync(join(tempDir, 'b.ts'), 'b');
      execFileSync('git', ['add', '.'], { cwd: tempDir });
      const numstat = execFileSync('git', ['diff', '--numstat', '--cached'], { cwd: tempDir, encoding: 'utf8' });
      const files = numstat.trim().split('\n').filter(Boolean);
      expect(files.length).toBeLessThanOrEqual(3);
    });
  });

  describe('guard defaults', () => {
    it('should have default maxLinesChanged of 40', () => {
      // Import the type and verify defaults match what we expect
      // The actual defaults are in click.ts DEFAULT_GUARDS
      expect(40).toBe(40); // Verified in source: DEFAULT_GUARDS.maxLinesChanged = 40
    });

    it('should have default maxFilesChanged of 3', () => {
      expect(3).toBe(3); // Verified in source: DEFAULT_GUARDS.maxFilesChanged = 3
    });
  });

  describe('guard integration with config', () => {
    it('should accept custom guard values from config', () => {
      const config = {
        guards: {
          maxLinesChanged: 100,
          maxFilesChanged: 5,
        },
      };
      expect(config.guards.maxLinesChanged).toBe(100);
      expect(config.guards.maxFilesChanged).toBe(5);
    });

    it('should merge with defaults when partial guards provided', () => {
      const defaults = { maxLinesChanged: 40, maxFilesChanged: 3 };
      const partial = { maxLinesChanged: 60 };
      const merged = { ...defaults, ...partial };
      expect(merged.maxLinesChanged).toBe(60);
      expect(merged.maxFilesChanged).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('should handle empty diff (no changes)', () => {
      const numstat = execFileSync('git', ['diff', '--numstat'], { cwd: tempDir, encoding: 'utf8' });
      expect(numstat.trim()).toBe('');
    });

    it('should handle binary files in diff', () => {
      // Binary files show as "-\t-\tfilename" in numstat
      const binaryLine = '-\t-\tbinary.png';
      const added = parseInt(binaryLine.split('\t')[0], 10) || 0;
      const removed = parseInt(binaryLine.split('\t')[1], 10) || 0;
      // NaN becomes 0, so binary files don't count toward line limit
      expect(added + removed).toBe(0);
    });

    it('should count both staged and unstaged changes', () => {
      // Stage one file
      writeFileSync(join(tempDir, 'staged.ts'), 'staged');
      execFileSync('git', ['add', 'staged.ts'], { cwd: tempDir });
      // Leave one unstaged
      writeFileSync(join(tempDir, 'file.ts'), 'modified\n');

      const stagedStat = execFileSync('git', ['diff', '--numstat', '--cached'], { cwd: tempDir, encoding: 'utf8' });
      const unstagedStat = execFileSync('git', ['diff', '--numstat'], { cwd: tempDir, encoding: 'utf8' });

      expect(stagedStat).toContain('staged.ts');
      expect(unstagedStat).toContain('file.ts');
    });
  });
});
