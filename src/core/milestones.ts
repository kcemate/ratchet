import type { ScanHistoryEntry } from './scan-history.js';

export type MilestoneTier = 'None' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Verified';

export interface MilestoneBadge {
  tier: MilestoneTier;
  color: string;
  icon: string;
  label: string;
}

export interface MilestoneResult {
  currentTier: MilestoneTier;
  badge: MilestoneBadge;
  nextTier: MilestoneTier | null;
  progressDays: number;   // consecutive days at ≥ threshold for next streak tier
  requiredDays: number;   // days required for that streak tier
  progressScore: number;  // current score
  nextThreshold: number;  // score needed for next tier (0 when already at top)
}

const TIER_BADGES: Record<MilestoneTier, MilestoneBadge> = {
  None:     { tier: 'None',     color: '#9f9f9f', icon: '—',  label: 'No tier'          },
  Bronze:   { tier: 'Bronze',   color: '#cd7f32', icon: '🥉', label: 'Bronze'            },
  Silver:   { tier: 'Silver',   color: '#c0c0c0', icon: '🥈', label: 'Silver'            },
  Gold:     { tier: 'Gold',     color: '#ffd700', icon: '🥇', label: 'Gold'              },
  Platinum: { tier: 'Platinum', color: '#e5e4e2', icon: '💎', label: 'Platinum'          },
  Verified: { tier: 'Verified', color: '#7c3aed', icon: '👑', label: 'Ratchet Verified'  },
};

/**
 * Returns the number of consecutive calendar days (UTC) ending today where
 * the highest score observed on each day is >= threshold.
 */
export function consecutiveDaysAbove(history: ScanHistoryEntry[], threshold: number): number {
  if (history.length === 0) return 0;

  // Build a map of date → max score that day
  const byDay = new Map<string, number>();
  for (const entry of history) {
    const day = entry.timestamp.slice(0, 10); // "YYYY-MM-DD"
    const current = byDay.get(day) ?? 0;
    if (entry.score > current) byDay.set(day, entry.score);
  }

  // Walk backwards from the most recent day
  const sortedDays = [...byDay.keys()].sort().reverse();

  let streak = 0;
  for (const day of sortedDays) {
    if ((byDay.get(day) ?? 0) >= threshold) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function checkMilestones(history: ScanHistoryEntry[]): MilestoneResult {
  if (history.length === 0) {
    return {
      currentTier: 'None',
      badge: TIER_BADGES['None'],
      nextTier: 'Bronze',
      progressDays: 0,
      requiredDays: 0,
      progressScore: 0,
      nextThreshold: 60,
    };
  }

  const latestScore = history[history.length - 1]!.score;
  const verifiedStreak = consecutiveDaysAbove(history, 95);
  const platinumStreak = consecutiveDaysAbove(history, 90);

  let currentTier: MilestoneTier;
  let progressDays = 0;
  let requiredDays = 0;
  let nextTier: MilestoneTier | null = null;
  let nextThreshold = 0;

  if (verifiedStreak >= 90) {
    currentTier = 'Verified';
    nextTier = null;
  } else if (platinumStreak >= 30) {
    currentTier = 'Platinum';
    nextTier = 'Verified';
    progressDays = verifiedStreak;
    requiredDays = 90;
    nextThreshold = 95;
  } else if (latestScore >= 90) {
    currentTier = 'Gold';
    nextTier = 'Platinum';
    progressDays = platinumStreak;
    requiredDays = 30;
    nextThreshold = 90;
  } else if (latestScore >= 75) {
    currentTier = 'Silver';
    nextTier = 'Gold';
    nextThreshold = 90;
  } else if (latestScore >= 60) {
    currentTier = 'Bronze';
    nextTier = 'Silver';
    nextThreshold = 75;
  } else {
    currentTier = 'None';
    nextTier = 'Bronze';
    nextThreshold = 60;
  }

  return {
    currentTier,
    badge: TIER_BADGES[currentTier],
    nextTier,
    progressDays,
    requiredDays,
    progressScore: latestScore,
    nextThreshold,
  };
}
