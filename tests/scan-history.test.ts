import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadScanHistory,
  appendScanHistory,
  calculateDelta,
  calculateStreak,
  getHistory,
  SCAN_HISTORY_FILE,
} from '../src/core/scan-history.js';
import type { ScanHistoryEntry } from '../src/core/scan-history.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-scan-history-'));
}

function makeEntry(score: number, overrides: Partial<ScanHistoryEntry> = {}): ScanHistoryEntry {
  return {
    score,
    maxScore: 100,
    categories: { Testing: 20, Security: 15, 'Type Safety': 15, 'Error Handling': 18, Performance: 9, 'Code Quality': 13 },
    timestamp: new Date().toISOString(),
    branch: 'main',
    ...overrides,
  };
}

describe('loadScanHistory', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns empty array when no history file exists', async () => {
    expect(await loadScanHistory(dir)).toEqual([]);
  });

  it('returns empty array for corrupted history file', async () => {
    mkdirSync(join(dir, '.ratchet'), { recursive: true });
    writeFileSync(join(dir, SCAN_HISTORY_FILE), 'not-json', 'utf-8');
    expect(await loadScanHistory(dir)).toEqual([]);
  });

  it('loads saved entries', async () => {
    const entries = [makeEntry(80), makeEntry(85)];
    mkdirSync(join(dir, '.ratchet'), { recursive: true });
    writeFileSync(join(dir, SCAN_HISTORY_FILE), JSON.stringify(entries), 'utf-8');
    const loaded = await loadScanHistory(dir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.score).toBe(80);
    expect(loaded[1]!.score).toBe(85);
  });
});

describe('appendScanHistory', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates .ratchet directory if missing', async () => {
    await appendScanHistory(dir, makeEntry(70));
    const { existsSync } = await import('fs');
    expect(existsSync(join(dir, '.ratchet'))).toBe(true);
  });

  it('writes the first entry to history.json', async () => {
    await appendScanHistory(dir, makeEntry(75));
    const history = await loadScanHistory(dir);
    expect(history).toHaveLength(1);
    expect(history[0]!.score).toBe(75);
  });

  it('appends subsequent entries to existing history', async () => {
    await appendScanHistory(dir, makeEntry(70));
    await appendScanHistory(dir, makeEntry(80));
    await appendScanHistory(dir, makeEntry(90));
    const history = await loadScanHistory(dir);
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.score)).toEqual([70, 80, 90]);
  });

  it('stores all fields correctly', async () => {
    const entry = makeEntry(88, { branch: 'feature/my-branch', timestamp: '2026-03-01T10:00:00.000Z' });
    await appendScanHistory(dir, entry);
    const [saved] = await loadScanHistory(dir);
    expect(saved!.score).toBe(88);
    expect(saved!.branch).toBe('feature/my-branch');
    expect(saved!.timestamp).toBe('2026-03-01T10:00:00.000Z');
    expect(saved!.maxScore).toBe(100);
  });
});

describe('calculateDelta', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns null when no history exists', async () => {
    expect(await calculateDelta(dir)).toBeNull();
  });

  it('returns null when only one entry exists', async () => {
    await appendScanHistory(dir, makeEntry(80));
    expect(await calculateDelta(dir)).toBeNull();
  });

  it('returns positive delta when score improved', async () => {
    await appendScanHistory(dir, makeEntry(80));
    await appendScanHistory(dir, makeEntry(88));
    const delta = await calculateDelta(dir);
    expect(delta).not.toBeNull();
    expect(delta!.delta).toBe(8);
    expect(delta!.direction).toBe('up');
    expect(delta!.before).toBe(80);
    expect(delta!.after).toBe(88);
  });

  it('returns negative delta when score regressed', async () => {
    await appendScanHistory(dir, makeEntry(90));
    await appendScanHistory(dir, makeEntry(82));
    const delta = await calculateDelta(dir);
    expect(delta!.delta).toBe(-8);
    expect(delta!.direction).toBe('down');
  });

  it('returns same direction when score unchanged', async () => {
    await appendScanHistory(dir, makeEntry(85));
    await appendScanHistory(dir, makeEntry(85));
    const delta = await calculateDelta(dir);
    expect(delta!.delta).toBe(0);
    expect(delta!.direction).toBe('same');
  });

  it('compares only the last two entries (not first vs last)', async () => {
    await appendScanHistory(dir, makeEntry(50));
    await appendScanHistory(dir, makeEntry(70));
    await appendScanHistory(dir, makeEntry(75));
    const delta = await calculateDelta(dir);
    expect(delta!.before).toBe(70);
    expect(delta!.after).toBe(75);
    expect(delta!.delta).toBe(5);
  });
});

describe('calculateStreak', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns 0 when no history exists', async () => {
    expect(await calculateStreak(dir, 90)).toBe(0);
  });

  it('returns 0 when latest score is below threshold', async () => {
    await appendScanHistory(dir, makeEntry(95));
    await appendScanHistory(dir, makeEntry(85));
    expect(await calculateStreak(dir, 90)).toBe(0);
  });

  it('counts consecutive entries above threshold from the end', async () => {
    await appendScanHistory(dir, makeEntry(70));
    await appendScanHistory(dir, makeEntry(91));
    await appendScanHistory(dir, makeEntry(92));
    await appendScanHistory(dir, makeEntry(93));
    expect(await calculateStreak(dir, 90)).toBe(3);
  });

  it('returns the full streak when all entries qualify', async () => {
    await appendScanHistory(dir, makeEntry(91));
    await appendScanHistory(dir, makeEntry(92));
    expect(await calculateStreak(dir, 90)).toBe(2);
  });

  it('breaks streak at first entry below threshold', async () => {
    await appendScanHistory(dir, makeEntry(95));
    await appendScanHistory(dir, makeEntry(88)); // below
    await appendScanHistory(dir, makeEntry(96));
    expect(await calculateStreak(dir, 90)).toBe(1);
  });
});

describe('getHistory', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns all history when no days filter', async () => {
    await appendScanHistory(dir, makeEntry(80, { timestamp: '2020-01-01T00:00:00Z' }));
    await appendScanHistory(dir, makeEntry(85));
    const all = await getHistory(dir);
    expect(all).toHaveLength(2);
  });

  it('filters entries older than the given number of days', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 60);
    await appendScanHistory(dir, makeEntry(70, { timestamp: old.toISOString() }));
    await appendScanHistory(dir, makeEntry(90));
    const recent = await getHistory(dir, 30);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.score).toBe(90);
  });

  it('returns empty array when all entries are outside the range', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 90);
    await appendScanHistory(dir, makeEntry(80, { timestamp: old.toISOString() }));
    expect(await getHistory(dir, 7)).toHaveLength(0);
  });

  it('includes entries exactly at the cutoff boundary', async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    // Add 1 second past the cutoff (should be included)
    const boundary = new Date(cutoff.getTime() + 1000);
    await appendScanHistory(dir, makeEntry(77, { timestamp: boundary.toISOString() }));
    expect(await getHistory(dir, 7)).toHaveLength(1);
  });
});
