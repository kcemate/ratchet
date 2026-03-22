import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectScoreDrop,
  loadNotificationConfig,
} from '../src/core/notifications.js';
import type { ScanHistoryEntry } from '../src/core/scan-history.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-notif-'));
}

function makeEntry(
  score: number,
  categories: Record<string, number> = {},
  timestamp = new Date().toISOString(),
): ScanHistoryEntry {
  return {
    score,
    maxScore: 100,
    categories: {
      Testing: 20,
      Security: 14,
      'Type Safety': 13,
      'Error Handling': 16,
      Performance: 9,
      'Code Quality': 13,
      ...categories,
    },
    timestamp,
    branch: 'main',
  };
}

// ---- detectScoreDrop ----

describe('detectScoreDrop', () => {
  it('returns null when history has fewer than 2 entries', () => {
    expect(detectScoreDrop([], 5)).toBeNull();
    expect(detectScoreDrop([makeEntry(90)], 5)).toBeNull();
  });

  it('returns null when score improved', () => {
    const history = [makeEntry(80), makeEntry(88)];
    expect(detectScoreDrop(history)).toBeNull();
  });

  it('returns null when score is unchanged', () => {
    const history = [makeEntry(85), makeEntry(85)];
    expect(detectScoreDrop(history)).toBeNull();
  });

  it('returns null when drop is below threshold', () => {
    const history = [makeEntry(90), makeEntry(87)]; // 3-point drop
    expect(detectScoreDrop(history, 5)).toBeNull();
  });

  it('returns null when drop exactly equals threshold minus one', () => {
    const history = [makeEntry(90), makeEntry(86)]; // 4-point drop, threshold=5
    expect(detectScoreDrop(history, 5)).toBeNull();
  });

  it('detects a drop exactly at the threshold', () => {
    const history = [makeEntry(90), makeEntry(85)]; // 5-point drop, threshold=5
    const drop = detectScoreDrop(history, 5);
    expect(drop).not.toBeNull();
    expect(drop!.delta).toBe(-5);
  });

  it('detects a large score drop', () => {
    const history = [makeEntry(95), makeEntry(78)];
    const drop = detectScoreDrop(history, 5);
    expect(drop).not.toBeNull();
    expect(drop!.before).toBe(95);
    expect(drop!.after).toBe(78);
    expect(drop!.delta).toBe(-17);
  });

  it('uses default threshold of 5 when not specified', () => {
    const noDropHistory = [makeEntry(90), makeEntry(86)]; // 4-point drop
    expect(detectScoreDrop(noDropHistory)).toBeNull();

    const dropHistory = [makeEntry(90), makeEntry(84)]; // 6-point drop
    expect(detectScoreDrop(dropHistory)).not.toBeNull();
  });

  it('compares the last two entries only', () => {
    // First entry is very low — should not influence the comparison
    const history = [makeEntry(40), makeEntry(90), makeEntry(82)];
    const drop = detectScoreDrop(history, 5);
    expect(drop!.before).toBe(90);
    expect(drop!.after).toBe(82);
    expect(drop!.delta).toBe(-8);
  });

  it('builds categoryBreakdown with only regressed categories', () => {
    const prev = makeEntry(90, { Testing: 22, Security: 14 });
    const curr = makeEntry(82, { Testing: 15, Security: 14 }); // Testing dropped 7
    const drop = detectScoreDrop([prev, curr], 5);
    expect(drop).not.toBeNull();
    expect(drop!.categoryBreakdown).toHaveLength(1);
    expect(drop!.categoryBreakdown[0]!.name).toBe('Testing');
    expect(drop!.categoryBreakdown[0]!.before).toBe(22);
    expect(drop!.categoryBreakdown[0]!.after).toBe(15);
    expect(drop!.categoryBreakdown[0]!.delta).toBe(-7);
  });

  it('categoryBreakdown is empty when all categories stayed the same', () => {
    // Total drops because the scores in makeEntry are default —
    // override categories so they stay the same but totals differ
    const cats = { Testing: 20, Security: 14, 'Type Safety': 13, 'Error Handling': 16, Performance: 9, 'Code Quality': 13 };
    const prev = { ...makeEntry(90), score: 90, categories: { ...cats } };
    const curr = { ...makeEntry(80), score: 80, categories: { ...cats } };
    const drop = detectScoreDrop([prev, curr], 5);
    expect(drop!.categoryBreakdown).toHaveLength(0);
  });

  it('handles missing categories in latest entry gracefully', () => {
    const prev = makeEntry(90, { NewCat: 10 });
    const curr = makeEntry(82, {}); // NewCat absent in curr
    // Should not throw
    const drop = detectScoreDrop([prev, curr], 5);
    expect(drop).not.toBeNull();
  });

  it('includes the timestamp from the latest entry', () => {
    const ts = '2026-03-15T12:00:00.000Z';
    const history = [makeEntry(90), makeEntry(82, {}, ts)];
    const drop = detectScoreDrop(history, 5);
    expect(drop!.timestamp).toBe(ts);
  });
});

// ---- loadNotificationConfig ----

describe('loadNotificationConfig', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns empty object when .ratchet.yml does not exist', () => {
    const config = loadNotificationConfig(dir);
    expect(config).toEqual({});
  });

  it('returns empty object when .ratchet.yml has no notifications section', () => {
    writeFileSync(join(dir, '.ratchet.yml'), 'agent: shell\n', 'utf-8');
    expect(loadNotificationConfig(dir)).toEqual({});
  });

  it('returns empty object for malformed YAML', () => {
    writeFileSync(join(dir, '.ratchet.yml'), ': bad: yaml: [[[', 'utf-8');
    expect(loadNotificationConfig(dir)).toEqual({});
  });

  it('reads score-drop and threshold fields', () => {
    writeFileSync(
      join(dir, '.ratchet.yml'),
      'notifications:\n  score-drop: true\n  threshold: 3\n',
      'utf-8',
    );
    const config = loadNotificationConfig(dir);
    expect(config['score-drop']).toBe(true);
    expect(config.threshold).toBe(3);
  });

  it('reads create-issue field', () => {
    writeFileSync(
      join(dir, '.ratchet.yml'),
      'notifications:\n  create-issue: true\n',
      'utf-8',
    );
    expect(loadNotificationConfig(dir)['create-issue']).toBe(true);
  });

  it('reads webhook URL', () => {
    writeFileSync(
      join(dir, '.ratchet.yml'),
      'notifications:\n  webhook: https://hooks.example.com/notify\n',
      'utf-8',
    );
    expect(loadNotificationConfig(dir).webhook).toBe('https://hooks.example.com/notify');
  });

  it('reads full notifications block', () => {
    writeFileSync(
      join(dir, '.ratchet.yml'),
      [
        'agent: shell',
        'notifications:',
        '  score-drop: true',
        '  threshold: 5',
        '  create-issue: false',
        '  webhook: https://hooks.example.com/ratchet',
      ].join('\n'),
      'utf-8',
    );
    const config = loadNotificationConfig(dir);
    expect(config['score-drop']).toBe(true);
    expect(config.threshold).toBe(5);
    expect(config['create-issue']).toBe(false);
    expect(config.webhook).toBe('https://hooks.example.com/ratchet');
  });
});
