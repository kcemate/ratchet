import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadFeedback,
  recordRollback,
  getFailureCount,
  isBlacklisted,
  getBlacklistedFiles,
  type RollbackEntry,
} from '../core/feedback.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-feedback-test-'));
}

function makeEntry(overrides: Partial<RollbackEntry> = {}): RollbackEntry {
  return {
    issueId: 'Dead code',
    strategy: 'torque',
    filesTargeted: ['src/foo.ts'],
    rollbackReason: 'test_fail',
    model: 'claude-sonnet-4-6',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── loadFeedback ────────────────────────────────────────────────────────────

describe('loadFeedback', () => {
  it('returns empty store when .ratchet/ does not exist', () => {
    const store = loadFeedback(tmpDir);
    expect(store.entries).toHaveLength(0);
    expect(store.version).toBe(1);
  });

  it('returns empty store when feedback.json is missing', () => {
    fs.mkdirSync(path.join(tmpDir, '.ratchet'));
    const store = loadFeedback(tmpDir);
    expect(store.entries).toHaveLength(0);
  });

  it('returns empty store when feedback.json is corrupt JSON', () => {
    const dir = path.join(tmpDir, '.ratchet');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'feedback.json'), 'not json');
    const store = loadFeedback(tmpDir);
    expect(store.entries).toHaveLength(0);
  });

  it('loads a previously written store', () => {
    recordRollback(tmpDir, makeEntry({ issueId: 'Empty catches' }));
    const store = loadFeedback(tmpDir);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]?.issueId).toBe('Empty catches');
  });
});

// ── recordRollback ──────────────────────────────────────────────────────────

describe('recordRollback', () => {
  it('creates .ratchet/ directory if missing', () => {
    recordRollback(tmpDir, makeEntry());
    expect(fs.existsSync(path.join(tmpDir, '.ratchet'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.ratchet', 'feedback.json'))).toBe(true);
  });

  it('appends entries on successive calls', () => {
    recordRollback(tmpDir, makeEntry({ issueId: 'A' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'B' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'C' }));
    const store = loadFeedback(tmpDir);
    expect(store.entries).toHaveLength(3);
  });

  it('evicts oldest entries when MAX_ENTRIES (500) is exceeded', () => {
    // Fill to exactly 500
    for (let i = 0; i < 500; i++) {
      recordRollback(tmpDir, makeEntry({ issueId: `issue-${i}` }));
    }
    // Add one more — should drop the oldest
    recordRollback(tmpDir, makeEntry({ issueId: 'overflow-entry' }));
    const store = loadFeedback(tmpDir);
    expect(store.entries).toHaveLength(500);
    // Oldest entry (issue-0) should be gone
    expect(store.entries.find(e => e.issueId === 'issue-0')).toBeUndefined();
    // Newest entry should be present
    expect(store.entries.at(-1)?.issueId).toBe('overflow-entry');
  });

  it('stores all required fields', () => {
    const entry = makeEntry({
      issueId: 'Coverage',
      strategy: 'sweep',
      filesTargeted: ['src/a.ts', 'src/b.ts'],
      rollbackReason: 'score_regression',
      model: 'claude-opus-4-6',
    });
    recordRollback(tmpDir, entry);
    const stored = loadFeedback(tmpDir).entries[0];
    expect(stored?.issueId).toBe('Coverage');
    expect(stored?.strategy).toBe('sweep');
    expect(stored?.filesTargeted).toEqual(['src/a.ts', 'src/b.ts']);
    expect(stored?.rollbackReason).toBe('score_regression');
    expect(stored?.model).toBe('claude-opus-4-6');
  });
});

// ── getFailureCount ─────────────────────────────────────────────────────────

describe('getFailureCount', () => {
  it('returns 0 for empty store', () => {
    expect(getFailureCount(tmpDir, 'Dead code')).toBe(0);
  });

  it('counts all entries matching issueId when no strategy filter', () => {
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'torque' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'sweep' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'Other issue', strategy: 'torque' }));
    expect(getFailureCount(tmpDir, 'Dead code')).toBe(2);
  });

  it('counts only entries matching issueId+strategy when strategy is provided', () => {
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'torque' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'torque' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'sweep' }));
    expect(getFailureCount(tmpDir, 'Dead code', 'torque')).toBe(2);
    expect(getFailureCount(tmpDir, 'Dead code', 'sweep')).toBe(1);
  });

  it('returns 0 for an issueId with no entries', () => {
    recordRollback(tmpDir, makeEntry({ issueId: 'Coverage' }));
    expect(getFailureCount(tmpDir, 'Dead code')).toBe(0);
  });
});

// ── isBlacklisted ───────────────────────────────────────────────────────────

describe('isBlacklisted', () => {
  it('returns false for empty store', () => {
    expect(isBlacklisted(tmpDir, 'Dead code')).toBe(false);
  });

  it('returns false when failure count is below threshold', () => {
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'torque' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'torque' }));
    expect(isBlacklisted(tmpDir, 'Dead code', 'torque')).toBe(false);
  });

  it('returns true when failure count reaches default threshold (3)', () => {
    for (let i = 0; i < 3; i++) {
      recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'torque' }));
    }
    expect(isBlacklisted(tmpDir, 'Dead code', 'torque')).toBe(true);
  });

  it('returns true when failure count exceeds threshold', () => {
    for (let i = 0; i < 5; i++) {
      recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'torque' }));
    }
    expect(isBlacklisted(tmpDir, 'Dead code', 'torque')).toBe(true);
  });

  it('uses custom maxFailures parameter', () => {
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code' }));
    expect(isBlacklisted(tmpDir, 'Dead code', undefined, 1)).toBe(true);
    expect(isBlacklisted(tmpDir, 'Dead code', undefined, 2)).toBe(false);
  });

  it('considers mixed strategies when no strategy filter given', () => {
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'torque' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'sweep' }));
    recordRollback(tmpDir, makeEntry({ issueId: 'Dead code', strategy: 'architect' }));
    // 3 total, no strategy filter → blacklisted
    expect(isBlacklisted(tmpDir, 'Dead code')).toBe(true);
    // But per-strategy count is only 1 each
    expect(isBlacklisted(tmpDir, 'Dead code', 'torque')).toBe(false);
  });

  it('does not blacklist a different issueId', () => {
    for (let i = 0; i < 3; i++) {
      recordRollback(tmpDir, makeEntry({ issueId: 'Dead code' }));
    }
    expect(isBlacklisted(tmpDir, 'Coverage')).toBe(false);
  });
});

// ── getBlacklistedFiles ─────────────────────────────────────────────────────

describe('getBlacklistedFiles', () => {
  it('returns empty array for empty store', () => {
    expect(getBlacklistedFiles(tmpDir)).toEqual([]);
  });

  it('returns empty array when no file reaches the threshold', () => {
    recordRollback(tmpDir, makeEntry({ filesTargeted: ['src/a.ts'] }));
    recordRollback(tmpDir, makeEntry({ filesTargeted: ['src/b.ts'] }));
    expect(getBlacklistedFiles(tmpDir, 3)).toEqual([]);
  });

  it('returns file that appears >= maxConsecutive times', () => {
    for (let i = 0; i < 3; i++) {
      recordRollback(tmpDir, makeEntry({ filesTargeted: ['src/a.ts'] }));
    }
    const result = getBlacklistedFiles(tmpDir, 3);
    expect(result).toContain('src/a.ts');
  });

  it('excludes files just below the threshold', () => {
    recordRollback(tmpDir, makeEntry({ filesTargeted: ['src/a.ts'] }));
    recordRollback(tmpDir, makeEntry({ filesTargeted: ['src/a.ts'] }));
    expect(getBlacklistedFiles(tmpDir, 3)).toEqual([]);
  });

  it('handles multiple files across entries', () => {
    // src/a.ts → 3 rollbacks (blacklisted), src/b.ts → 2 (not blacklisted)
    for (let i = 0; i < 3; i++) {
      recordRollback(tmpDir, makeEntry({ filesTargeted: ['src/a.ts', 'src/b.ts'] }));
    }
    recordRollback(tmpDir, makeEntry({ filesTargeted: ['src/b.ts'] })); // b gets 4 — also blacklisted
    const result = getBlacklistedFiles(tmpDir, 3);
    expect(result).toContain('src/a.ts');
    expect(result).toContain('src/b.ts');
  });

  it('uses custom maxConsecutive parameter', () => {
    recordRollback(tmpDir, makeEntry({ filesTargeted: ['src/a.ts'] }));
    expect(getBlacklistedFiles(tmpDir, 1)).toContain('src/a.ts');
    expect(getBlacklistedFiles(tmpDir, 2)).toEqual([]);
  });
});
