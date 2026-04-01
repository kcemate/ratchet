/**
 * context-manager.ts — Two-tier context management for long torque runs.
 *
 * Inspired by Claude Code's time-based compaction and per-click round grouping.
 *
 * Tier 1: Time-based stale detection
 *   If the last click ended >STALE_THRESHOLD_MS ago, mark rounds older than
 *   keepRecentRounds as compactable. This prevents stale scan/fix/test results
 *   from bloating context across idle gaps (user went to lunch, etc.).
 *
 * Tier 2: API-round grouping
 *   Each click = 1 atomic unit: [scan result + fix attempt + test result].
 *   Never split a round — each click is treated as an indivisible whole.
 *   Keep the last keepRecentRounds units intact; compress older units to a
 *   summary string injected into the next API call's prompt.
 */

/** Milliseconds of idle time after which older rounds become compactable. */
export const STALE_THRESHOLD_MS = 600_000; // 10 minutes

/** Default number of recent rounds to keep intact (never compacted). */
export const DEFAULT_KEEP_RECENT_ROUNDS = 2;

/**
 * One atomic API round: scan result + fix attempt + test result.
 * Corresponds 1:1 with a torque click.
 */
export interface ContextRound {
  /** Click number (1-based). */
  clickNumber: number;
  /** Unix ms timestamp when this round ended. */
  endedAt: number;
  /** Whether the click was kept or rolled back. */
  outcome: 'landed' | 'rolled-back';
  /** Score delta produced by this click (0 when rolled back). */
  scoreDelta: number;
  /** Files modified during this click. */
  filesModified: string[];
  /** Issue subcategories targeted this click. */
  issueCategories: string[];
}

export interface ContextManagerConfig {
  /** Ms of idle time after which older rounds are compactable (default: 600_000). */
  staleThresholdMs: number;
  /** Number of recent rounds to always keep intact (default: 2). */
  keepRecentRounds: number;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  staleThresholdMs: STALE_THRESHOLD_MS,
  keepRecentRounds: DEFAULT_KEEP_RECENT_ROUNDS,
};

export class ContextManager {
  /** Rounds currently held in memory (not yet compacted). */
  private rounds: ContextRound[] = [];
  /** Accumulated summary of all compacted (older) rounds. */
  private compactedSummary = '';

  readonly config: ContextManagerConfig;

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Mutation ─────────────────────────────────────────────────────────────

  /**
   * Record a completed click round. Call this after each click resolves
   * (regardless of outcome).
   */
  recordRound(round: ContextRound): void {
    this.rounds.push(round);
  }

  /**
   * Compact rounds older than keepRecentRounds into the summary string.
   * The most recent keepRecentRounds rounds are always kept intact.
   *
   * This is a no-op when there are <= keepRecentRounds rounds.
   * Never splits a round — each click is atomic.
   */
  compact(): void {
    if (this.rounds.length <= this.config.keepRecentRounds) return;

    const compactableCount = this.rounds.length - this.config.keepRecentRounds;
    const olderRounds = this.rounds.slice(0, compactableCount);
    const recentRounds = this.rounds.slice(compactableCount);

    this.compactedSummary = appendSummary(this.compactedSummary, formatRoundsSummary(olderRounds));
    this.rounds = recentRounds;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Tier 1 check: returns true when stale threshold has been exceeded AND
   * there are rounds older than keepRecentRounds that could be compacted.
   *
   * Conditions:
   *   - More than keepRecentRounds rounds are tracked
   *   - The last round ended >staleThresholdMs ago
   */
  shouldCompact(now: number = Date.now()): boolean {
    if (this.rounds.length <= this.config.keepRecentRounds) return false;
    const lastRound = this.rounds[this.rounds.length - 1];
    if (!lastRound) return false;
    return now - lastRound.endedAt > this.config.staleThresholdMs;
  }

  /**
   * Returns the rounds that would be compacted by a compact() call
   * (rounds older than keepRecentRounds).
   */
  getCompactableRounds(): ContextRound[] {
    if (this.rounds.length <= this.config.keepRecentRounds) return [];
    return this.rounds.slice(0, this.rounds.length - this.config.keepRecentRounds);
  }

  /** Returns all rounds currently held in memory (not yet compacted). */
  getRounds(): readonly ContextRound[] {
    return this.rounds;
  }

  /** Returns the compacted summary string (empty when no rounds have been compacted). */
  getSummary(): string {
    return this.compactedSummary;
  }

  /**
   * Returns a prompt-ready context string combining the compacted summary
   * (if any) with the recent rounds narrative.
   *
   * Returns empty string when there is nothing to report.
   */
  getPromptContext(): string {
    const parts: string[] = [];

    if (this.compactedSummary) {
      parts.push(this.compactedSummary);
    }

    if (this.rounds.length > 0) {
      parts.push('RECENT CLICKS:');
      for (const round of this.rounds) {
        parts.push('  ' + formatRound(round));
      }
    }

    return parts.join('\n');
  }
}

// ── Formatting helpers (exported for testing) ─────────────────────────────

/**
 * Format a single round as a one-line summary.
 */
export function formatRound(round: ContextRound): string {
  const outcomeStr =
    round.outcome === 'landed'
      ? `landed (+${round.scoreDelta.toFixed(1)} pts)`
      : 'rolled-back';
  const categories = round.issueCategories.slice(0, 3).join(', ') || 'unknown';
  const files = round.filesModified.slice(0, 3).join(', ');
  return `Click ${round.clickNumber} (${outcomeStr}): ${categories}${files ? ` in ${files}` : ''}`;
}

/**
 * Format a list of rounds as a compacted summary block.
 */
export function formatRoundsSummary(rounds: ContextRound[]): string {
  if (rounds.length === 0) return '';
  const lines = ['--- PRIOR CLICKS (COMPACTED) ---'];
  for (const round of rounds) {
    lines.push('  ' + formatRound(round));
  }
  lines.push('[Older rounds compacted — context summarized above]');
  lines.push('---');
  return lines.join('\n');
}

/**
 * Append a new summary block to an existing one, preserving history.
 */
function appendSummary(existing: string, next: string): string {
  if (!existing) return next;
  if (!next) return existing;
  return existing + '\n' + next;
}
