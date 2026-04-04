import { describe, it, expect } from 'vitest';
import { checkMilestones, consecutiveDaysAbove } from '../src/core/milestones.js';
import type { ScanHistoryEntry } from '../src/core/scan-history.js';

function makeEntry(score: number, timestamp: string, branch = 'main'): ScanHistoryEntry {
  return {
    score,
    maxScore: 100,
    categories: { Testing: score > 20 ? 20 : score, Security: 15 },
    timestamp,
    branch,
  };
}

/** Creates entries for N consecutive days ending today, each with the given score. */
function entriesForDays(n: number, score: number): ScanHistoryEntry[] {
  const entries: ScanHistoryEntry[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    // Use UTC noon to avoid timezone boundary issues
    const d = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i, 12, 0, 0
    ));
    entries.push(makeEntry(score, d.toISOString()));
  }
  return entries;
}

describe('consecutiveDaysAbove', () => {
  it('returns 0 for empty history', () => {
    expect(consecutiveDaysAbove([], 90)).toBe(0);
  });

  it('returns 0 when latest day is below threshold', () => {
    const history = entriesForDays(3, 95);
    // override the last entry to be below threshold
    history[history.length - 1] = makeEntry(85, new Date().toISOString());
    expect(consecutiveDaysAbove(history, 90)).toBe(0);
  });

  it('counts consecutive days above threshold', () => {
    const history = entriesForDays(5, 91);
    expect(consecutiveDaysAbove(history, 90)).toBe(5);
  });

  it('breaks the streak at the first day below threshold', () => {
    const entries: ScanHistoryEntry[] = [];
    // day -4: below
    const d4 = new Date(); d4.setDate(d4.getDate() - 4);
    entries.push(makeEntry(80, d4.toISOString()));
    // days -3, -2, -1, today: above
    for (let i = 3; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      entries.push(makeEntry(92, d.toISOString()));
    }
    expect(consecutiveDaysAbove(entries, 90)).toBe(4);
  });

  it('deduplicates multiple entries on the same day — uses max score', () => {
    const today = new Date().toISOString().slice(0, 10);
    const history = [
      makeEntry(75, `${today}T08:00:00Z`), // below threshold
      makeEntry(92, `${today}T20:00:00Z`), // above threshold — max wins
    ];
    expect(consecutiveDaysAbove(history, 90)).toBe(1);
  });
});

describe('checkMilestones — no history', () => {
  it('returns None tier with Bronze as next', () => {
    const result = checkMilestones([]);
    expect(result.currentTier).toBe('None');
    expect(result.nextTier).toBe('Bronze');
    expect(result.nextThreshold).toBe(60);
  });
});

describe('checkMilestones — score-based tiers', () => {
  it('assigns Bronze for score 60–74', () => {
    const history = [makeEntry(65, new Date().toISOString())];
    const result = checkMilestones(history);
    expect(result.currentTier).toBe('Bronze');
    expect(result.badge.icon).toBe('🥉');
    expect(result.nextTier).toBe('Silver');
    expect(result.nextThreshold).toBe(75);
  });

  it('assigns Silver for score 75–89', () => {
    const result = checkMilestones([makeEntry(80, new Date().toISOString())]);
    expect(result.currentTier).toBe('Silver');
    expect(result.nextTier).toBe('Gold');
    expect(result.nextThreshold).toBe(90);
  });

  it('assigns Gold for score 90+ (without 30-day streak)', () => {
    const result = checkMilestones([makeEntry(92, new Date().toISOString())]);
    expect(result.currentTier).toBe('Gold');
    expect(result.nextTier).toBe('Platinum');
  });

  it('assigns None when score is below 60', () => {
    const result = checkMilestones([makeEntry(55, new Date().toISOString())]);
    expect(result.currentTier).toBe('None');
    expect(result.nextThreshold).toBe(60);
  });

  it('reflects exactly score 60 → Bronze', () => {
    const result = checkMilestones([makeEntry(60, new Date().toISOString())]);
    expect(result.currentTier).toBe('Bronze');
  });

  it('reflects exactly score 75 → Silver', () => {
    const result = checkMilestones([makeEntry(75, new Date().toISOString())]);
    expect(result.currentTier).toBe('Silver');
  });

  it('reflects exactly score 90 → Gold', () => {
    const result = checkMilestones([makeEntry(90, new Date().toISOString())]);
    expect(result.currentTier).toBe('Gold');
  });
});

describe('checkMilestones — Platinum (90+ for 30 days)', () => {
  it('assigns Platinum when streak ≥ 30 days at 90+', () => {
    const history = entriesForDays(35, 91);
    const result = checkMilestones(history);
    expect(result.currentTier).toBe('Platinum');
    expect(result.badge.icon).toBe('💎');
    expect(result.nextTier).toBe('Verified');
    expect(result.requiredDays).toBe(90);
  });

  it('stays Gold when streak is 29 days at 90+', () => {
    const history = entriesForDays(29, 91);
    const result = checkMilestones(history);
    expect(result.currentTier).toBe('Gold');
    expect(result.progressDays).toBe(29);
    expect(result.requiredDays).toBe(30);
  });

  it('shows progress toward Platinum while at Gold', () => {
    const history = entriesForDays(15, 91);
    const result = checkMilestones(history);
    expect(result.currentTier).toBe('Gold');
    expect(result.progressDays).toBe(15);
    expect(result.requiredDays).toBe(30);
    expect(result.nextTier).toBe('Platinum');
  });
});

describe('checkMilestones — Verified (95+ for 90 days)', () => {
  it('assigns Verified when streak ≥ 90 days at 95+', () => {
    const history = entriesForDays(90, 96);
    const result = checkMilestones(history);
    expect(result.currentTier).toBe('Verified');
    expect(result.badge.icon).toBe('👑');
    expect(result.nextTier).toBeNull();
  });

  it('stays Platinum when streak is 89 days at 95+', () => {
    // Need ≥30 days at 90+ for Platinum, plus some 95+ days for Verified progress
    const history = entriesForDays(89, 96);
    const result = checkMilestones(history);
    // Should be Platinum (≥30 days at 90+) but not yet Verified
    expect(result.currentTier).toBe('Platinum');
    expect(result.nextTier).toBe('Verified');
  });
});

describe('checkMilestones — badge metadata', () => {
  it('returns correct color for each tier', () => {
    const tiers: Array<[number, string]> = [
      [55, '#9f9f9f'],  // None
      [65, '#cd7f32'],  // Bronze
      [78, '#c0c0c0'],  // Silver
      [92, '#ffd700'],  // Gold
    ];
    for (const [score, expectedColor] of tiers) {
      const result = checkMilestones([makeEntry(score, new Date().toISOString())]);
      expect(result.badge.color).toBe(expectedColor);
    }
  });

  it('returns Platinum color for Platinum tier', () => {
    const history = entriesForDays(35, 91);
    const result = checkMilestones(history);
    expect(result.badge.color).toBe('#e5e4e2');
  });

  it('returns Verified color for Verified tier', () => {
    const history = entriesForDays(90, 96);
    const result = checkMilestones(history);
    expect(result.badge.color).toBe('#7c3aed');
  });
});

describe('checkMilestones — progressScore', () => {
  it('reflects the most recent score', () => {
    const history = [
      makeEntry(80, '2026-01-01T00:00:00Z'),
      makeEntry(92, new Date().toISOString()),
    ];
    const result = checkMilestones(history);
    expect(result.progressScore).toBe(92);
  });
});
