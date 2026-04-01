import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveRun, loadRun, listRuns, loadLatestRun, RUNS_DIR } from '../src/core/history.js';
import type { RatchetRun, Target, Click } from '../src/types.js';
import type { ScanResult } from '../src/commands/scan.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-history-'));
}

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    name: 'api',
    path: 'src/',
    description: 'API quality improvements',
    ...overrides,
  };
}

function makeClick(overrides: Partial<Click> = {}): Click {
  return {
    number: 1,
    target: 'api',
    analysis: 'Found issues',
    proposal: 'Fixed issues',
    filesModified: ['src/api.ts'],
    testsPassed: true,
    commitHash: 'abc1234',
    timestamp: new Date('2026-01-01T00:01:00Z'),
    ...overrides,
  };
}

function makeRun(id: string, overrides: Partial<RatchetRun> = {}): RatchetRun {
  return {
    id,
    target: makeTarget(),
    clicks: [makeClick()],
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:05:00Z'),
    status: 'completed',
    ...overrides,
  };
}

function makeScan(total: number): ScanResult {
  return {
    projectName: 'test-project',
    total,
    maxTotal: 100,
    categories: [
      { name: 'Testing', emoji: '🧪', score: 12, max: 17, summary: '3 test files' },
      { name: 'Error Handling', emoji: '⚠️ ', score: 11, max: 17, summary: '5 try/catch' },
      { name: 'Types', emoji: '📝', score: 17, max: 17, summary: 'TypeScript, strict' },
      { name: 'Security', emoji: '🔒', score: 14, max: 16, summary: 'no secrets' },
      { name: 'Performance', emoji: '⚡', score: total - 54, max: 16, summary: 'no await-in-loop' },
      { name: 'Readability', emoji: '📖', score: 9, max: 17, summary: 'short functions' },
    ],
  };
}

describe('saveRun', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('saves a run to .ratchet/runs/<id>.json', async () => {
    const run = makeRun('test-run-001');
    await saveRun(dir, run);

    const { existsSync } = await import('fs');
    expect(existsSync(join(dir, RUNS_DIR, 'test-run-001.json'))).toBe(true);
  });

  it('saves run with scoreBefore and scoreAfter', async () => {
    const run = makeRun('scored-run-001');
    const before = makeScan(68);
    const after = makeScan(75);
    await saveRun(dir, run, before, after);

    const { readFileSync } = await import('fs');
    const raw = readFileSync(join(dir, RUNS_DIR, 'scored-run-001.json'), 'utf-8');
    const entry = JSON.parse(raw) as { scoreBefore: ScanResult; scoreAfter: ScanResult; savedAt: string };

    expect(entry.scoreBefore.total).toBe(68);
    expect(entry.scoreAfter.total).toBe(75);
    expect(entry.savedAt).toBeTruthy();
  });

  it('saves run without scores when not provided', async () => {
    const run = makeRun('bare-run-001');
    await saveRun(dir, run);

    const { readFileSync } = await import('fs');
    const raw = readFileSync(join(dir, RUNS_DIR, 'bare-run-001.json'), 'utf-8');
    const entry = JSON.parse(raw) as { scoreBefore?: ScanResult; scoreAfter?: ScanResult };

    expect(entry.scoreBefore).toBeUndefined();
    expect(entry.scoreAfter).toBeUndefined();
  });

  it('creates the .ratchet/runs directory if it does not exist', async () => {
    const run = makeRun('mkdir-run-001');
    await saveRun(dir, run);

    const { existsSync } = await import('fs');
    expect(existsSync(join(dir, RUNS_DIR))).toBe(true);
  });
});

describe('loadRun', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads a saved run by ID', async () => {
    const run = makeRun('load-test-001');
    await saveRun(dir, run);

    const entry = await loadRun(dir, 'load-test-001');
    expect(entry).not.toBeNull();
    expect(entry!.run.id).toBe('load-test-001');
  });

  it('returns null for a nonexistent run ID', async () => {
    const result = await loadRun(dir, 'does-not-exist');
    expect(result).toBeNull();
  });

  it('loads scoreBefore and scoreAfter when present', async () => {
    const run = makeRun('load-scores-001');
    const before = makeScan(60);
    const after = makeScan(80);
    await saveRun(dir, run, before, after);

    const entry = await loadRun(dir, 'load-scores-001');
    expect(entry!.scoreBefore!.total).toBe(60);
    expect(entry!.scoreAfter!.total).toBe(80);
  });

  it('throws an informative error for a corrupted file', async () => {
    mkdirSync(join(dir, RUNS_DIR), { recursive: true });
    writeFileSync(join(dir, RUNS_DIR, 'corrupt.json'), 'not valid json!!!', 'utf-8');

    await expect(loadRun(dir, 'corrupt')).rejects.toThrow('could not be parsed');
  });
});

describe('listRuns', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns an empty array when no runs exist', async () => {
    const runs = await listRuns(dir);
    expect(runs).toEqual([]);
  });

  it('lists all saved runs', async () => {
    await saveRun(dir, makeRun('run-a'));
    await saveRun(dir, makeRun('run-b'));
    await saveRun(dir, makeRun('run-c'));

    const runs = await listRuns(dir);
    expect(runs).toHaveLength(3);
  });

  it('returns runs sorted newest first by savedAt', async () => {
    // Save with slight delays to ensure different savedAt timestamps
    await saveRun(dir, makeRun('oldest-run'));
    await new Promise((r) => setTimeout(r, 10));
    await saveRun(dir, makeRun('middle-run'));
    await new Promise((r) => setTimeout(r, 10));
    await saveRun(dir, makeRun('newest-run'));

    const runs = await listRuns(dir);
    expect(runs[0]!.run.id).toBe('newest-run');
    expect(runs[runs.length - 1]!.run.id).toBe('oldest-run');
  });

  it('skips corrupted files gracefully', async () => {
    await saveRun(dir, makeRun('valid-run'));
    mkdirSync(join(dir, RUNS_DIR), { recursive: true });
    writeFileSync(join(dir, RUNS_DIR, 'bad.json'), '{bad json', 'utf-8');

    const runs = await listRuns(dir);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.run.id).toBe('valid-run');
  });
});

describe('loadLatestRun', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns null when there are no runs and no fallback', async () => {
    const result = await loadLatestRun(dir);
    expect(result).toBeNull();
  });

  it('loads the most recent run from history', async () => {
    await saveRun(dir, makeRun('old-run'));
    await new Promise((r) => setTimeout(r, 10));
    await saveRun(dir, makeRun('new-run'));

    const entry = await loadLatestRun(dir);
    expect(entry!.run.id).toBe('new-run');
  });

  it('falls back to .ratchet-state.json when no history exists', async () => {
    const legacyRun = makeRun('legacy-run-001');
    writeFileSync(
      join(dir, '.ratchet-state.json'),
      JSON.stringify(legacyRun, null, 2),
      'utf-8',
    );

    const entry = await loadLatestRun(dir);
    expect(entry).not.toBeNull();
    expect(entry!.run.id).toBe('legacy-run-001');
  });

  it('prefers history over .ratchet-state.json when both exist', async () => {
    const legacyRun = makeRun('legacy-run-002');
    writeFileSync(
      join(dir, '.ratchet-state.json'),
      JSON.stringify(legacyRun, null, 2),
      'utf-8',
    );

    await saveRun(dir, makeRun('history-run-001'));

    const entry = await loadLatestRun(dir);
    expect(entry!.run.id).toBe('history-run-001');
  });

  it('returns null if .ratchet-state.json is missing and no history', async () => {
    const result = await loadLatestRun(dir);
    expect(result).toBeNull();
  });
});

describe('--list output formatting', () => {
  it('scoreArrow shows score range when both before and after are present', () => {
    // Simulate what the list renderer produces
    const before = makeScan(68);
    const after = makeScan(75);
    const score =
      before && after
        ? `${before.total} → ${after.total}`
        : after
        ? String(after.total)
        : before
        ? String(before.total)
        : '—';
    expect(score).toBe('68 → 75');
  });

  it('scoreArrow shows single value when only after is present', () => {
    const after = makeScan(75);
    const score = after ? String(after.total) : '—';
    expect(score).toBe('75');
  });

  it('scoreArrow shows fallback dash when no scores', () => {
    const score = '—';
    expect(score).toBe('—');
  });

  it('formatDate produces readable date string', () => {
    const date = new Date('2026-03-13T16:25:00Z');
    const formatted =
      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ', ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    expect(formatted).toMatch(/Mar \d+, \d+:\d+ (AM|PM)/);
  });
});
