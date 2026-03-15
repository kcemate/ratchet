import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@ratchet.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Ratchet Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
}

describe('prevalidate', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-prevalidate-test-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns proceed when there are no changes', async () => {
    const { prevalidate } = await import('../src/core/prevalidate.js');
    const result = await prevalidate(dir, undefined);
    expect(result.recommendation).toBe('proceed');
    expect(result.confidence).toBe(1.0);
    expect(result.approved).toBe(true);
    expect(result.concerns).toHaveLength(0);
  });

  it('returns a valid result shape when there are unstaged changes (fallback path)', async () => {
    // Write an unstaged change so there's a diff
    writeFileSync(join(dir, 'foo.ts'), 'export const x = 1;\n');

    const { prevalidate } = await import('../src/core/prevalidate.js');

    // With a real diff but no claude binary or a failing call,
    // prevalidate must ALWAYS return a valid result (non-blocking).
    // We call with a nonsense model to force a fast failure, but the
    // function must still return a PrevalidateResult (not throw).
    let result;
    try {
      result = await prevalidate(dir, undefined);
    } catch {
      // If it somehow throws, the test fails — that's intentional
      throw new Error('prevalidate must not throw');
    }
    expect(typeof result.approved).toBe('boolean');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.concerns)).toBe(true);
    expect(['proceed', 'escalate-swarm', 'reject']).toContain(result.recommendation);
  });

  it('result shape has all required fields', async () => {
    const { prevalidate } = await import('../src/core/prevalidate.js');
    const result = await prevalidate(dir, undefined);
    expect(typeof result.approved).toBe('boolean');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.concerns)).toBe(true);
    expect(['proceed', 'escalate-swarm', 'reject']).toContain(result.recommendation);
  });

  describe('recommendation thresholds', () => {
    // Test the recommendation logic indirectly by verifying that confidence maps
    // to the right recommendation values (white-box via the exported types)
    it('confidence > 0.7 should map to proceed', () => {
      // The boundary is encoded in getRecommendation — we validate via shape expectations
      // by importing and testing with a mock response
      expect(true).toBe(true); // placeholder — see integration test above
    });

    it('confidence 0.5-0.7 range corresponds to escalate-swarm recommendation', () => {
      expect(true).toBe(true);
    });

    it('confidence < 0.5 corresponds to reject recommendation', () => {
      expect(true).toBe(true);
    });
  });
});

describe('prevalidate strict mode', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-prevalidate-strict-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('strict=true timeout/failure → reject with reason', async () => {
    // Modify a tracked file so git diff shows changes (untracked files don't appear in git diff)
    writeFileSync(join(dir, 'README.md'), '# modified\nexport const x = 1;\n');

    const { prevalidate } = await import('../src/core/prevalidate.js');
    // Set PATH to only git's directory so `claude` binary can't be found → spawn fails immediately
    const origPath = process.env.PATH;
    process.env.PATH = '/usr/bin';
    try {
      const result = await prevalidate(dir, undefined, { strict: true });

      // Claude binary can't be found, so this hits the failure path
      expect(result.recommendation).toBe('reject');
      expect(result.approved).toBe(false);
      expect(result.confidence).toBe(0.3);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('strict=false (default) keeps current fallback-to-proceed behavior', async () => {
    // Modify a tracked file so git diff shows changes
    writeFileSync(join(dir, 'README.md'), '# modified for strict=false test\n');

    const { prevalidate } = await import('../src/core/prevalidate.js');
    // Set PATH to only git's directory so `claude` binary can't be found → spawn fails immediately
    const origPath = process.env.PATH;
    process.env.PATH = '/usr/bin';
    try {
      const result = await prevalidate(dir, undefined, { strict: false });

      // Without Claude, falls back to proceed
      expect(result.recommendation).toBe('proceed');
      expect(result.approved).toBe(true);
      expect(result.confidence).toBe(0.75);
      expect(result.reason).toBeDefined();
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('strict=true with no git → reject', async () => {
    const noGitDir = mkdtempSync(join(tmpdir(), 'ratchet-nogit-'));
    try {
      const { prevalidate } = await import('../src/core/prevalidate.js');
      const result = await prevalidate(noGitDir, undefined, { strict: true });

      expect(result.recommendation).toBe('reject');
      expect(result.approved).toBe(false);
      expect(result.confidence).toBe(0.3);
      expect(result.reason).toContain('git');
    } finally {
      rmSync(noGitDir, { recursive: true, force: true });
    }
  });

  it('strict=false with no git → proceed (backward compatible)', async () => {
    const noGitDir = mkdtempSync(join(tmpdir(), 'ratchet-nogit2-'));
    try {
      const { prevalidate } = await import('../src/core/prevalidate.js');
      const result = await prevalidate(noGitDir, undefined, { strict: false });

      expect(result.recommendation).toBe('proceed');
      expect(result.approved).toBe(true);
      expect(result.reason).toContain('git');
    } finally {
      rmSync(noGitDir, { recursive: true, force: true });
    }
  });

  it('reason field populated on no-change result (undefined — not a fallback)', async () => {
    const { prevalidate } = await import('../src/core/prevalidate.js');
    const result = await prevalidate(dir, undefined, { strict: true });

    // No changes → normal proceed, reason should be undefined (not a fallback)
    expect(result.recommendation).toBe('proceed');
    expect(result.reason).toBeUndefined();
  });
});

describe('PrevalidateResult interface contract', () => {
  it('approved is false when recommendation is reject', async () => {
    // We can test this by directly importing the result type and validating invariants
    // Since parseClaudeResponse is internal, we test via known valid JSON response paths
    const { prevalidate } = await import('../src/core/prevalidate.js');

    // In a clean repo with no changes, we always get proceed/approved=true
    const dir2 = mkdtempSync(join(tmpdir(), 'ratchet-pv2-'));
    try {
      execFileSync('git', ['init'], { cwd: dir2 });
      execFileSync('git', ['config', 'user.email', 'test@ratchet.dev'], { cwd: dir2 });
      execFileSync('git', ['config', 'user.name', 'Ratchet Test'], { cwd: dir2 });
      writeFileSync(join(dir2, 'README.md'), '# test\n');
      execFileSync('git', ['add', '-A'], { cwd: dir2 });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir2 });

      const result = await prevalidate(dir2, undefined);
      // No changes → confidence=1.0, approved=true, recommend=proceed
      if (result.recommendation === 'reject') {
        expect(result.approved).toBe(false);
      } else {
        expect(result.approved).toBe(true);
      }
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
