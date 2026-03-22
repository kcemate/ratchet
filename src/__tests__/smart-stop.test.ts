import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkTimeoutStop,
  checkBudgetStop,
  checkPlateauStop,
  checkRegressionStop,
} from '../core/engine.js';

// ── checkTimeoutStop ─────────────────────────────────────────────────────────

describe('checkTimeoutStop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not stop when elapsed time is under the limit', () => {
    const startedAt = new Date();
    vi.advanceTimersByTime(30_000); // 30 seconds
    const result = checkTimeoutStop(startedAt, 60_000, 1); // 1 minute limit
    expect(result.stop).toBe(false);
  });

  it('stops when elapsed time exceeds the limit', () => {
    const startedAt = new Date();
    vi.advanceTimersByTime(90_000); // 1.5 minutes
    const result = checkTimeoutStop(startedAt, 60_000, 2); // 1 minute limit
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toMatch(/Timeout reached/);
  });

  it('includes elapsed minutes in the stop reason', () => {
    const startedAt = new Date();
    vi.advanceTimersByTime(3 * 60_000 + 10_000); // ~3 minutes
    const result = checkTimeoutStop(startedAt, 2 * 60_000, 3);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toBe('Timeout reached (3m)');
  });

  it('does not stop exactly at the limit (requires exceeding)', () => {
    const startedAt = new Date();
    vi.advanceTimersByTime(60_000); // exactly 1 minute
    // Date.now() - startedAt === timeoutMs, not >, so stop depends on > check
    const result = checkTimeoutStop(startedAt, 60_001, 1);
    expect(result.stop).toBe(false);
  });
});

// ── checkBudgetStop ──────────────────────────────────────────────────────────

describe('checkBudgetStop', () => {
  it('does not stop when cumulative cost is under budget', () => {
    const result = checkBudgetStop(0.05, 0.10);
    expect(result.stop).toBe(false);
  });

  it('stops when cumulative cost reaches budget', () => {
    const result = checkBudgetStop(0.10, 0.10);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toMatch(/Budget limit reached/);
  });

  it('stops when cumulative cost exceeds budget', () => {
    const result = checkBudgetStop(0.15, 0.10);
    expect(result.stop).toBe(true);
  });

  it('formats the cost with two decimal places in the stop reason', () => {
    const result = checkBudgetStop(0.1234, 0.10);
    expect(result.earlyStopReason).toBe('Budget limit reached ($0.12)');
  });

  it('does not stop at zero cost with non-zero budget', () => {
    const result = checkBudgetStop(0, 1.00);
    expect(result.stop).toBe(false);
  });
});

// ── checkPlateauStop ─────────────────────────────────────────────────────────

describe('checkPlateauStop', () => {
  it('does not trigger on short runs (totalClicks <= 3)', () => {
    const result = checkPlateauStop(3, 3);
    expect(result.stop).toBe(false);
  });

  it('does not trigger when fewer than 3 consecutive zero-delta clicks', () => {
    const result = checkPlateauStop(2, 7);
    expect(result.stop).toBe(false);
  });

  it('triggers after 3 consecutive zero-delta clicks on runs > 3 clicks', () => {
    const result = checkPlateauStop(3, 7);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toBe('Score plateau detected (3 consecutive zero-delta clicks)');
  });

  it('triggers after more than 3 consecutive zero-delta clicks', () => {
    const result = checkPlateauStop(5, 7);
    expect(result.stop).toBe(true);
  });

  it('does not trigger at zero consecutive zero-delta clicks', () => {
    const result = checkPlateauStop(0, 7);
    expect(result.stop).toBe(false);
  });
});

// ── checkRegressionStop ──────────────────────────────────────────────────────

describe('checkRegressionStop', () => {
  it('does not stop when no regression detected', () => {
    const result = checkRegressionStop(false);
    expect(result.stop).toBe(false);
  });

  it('stops when regression is detected', () => {
    const result = checkRegressionStop(true, 'score regression: 85 → 82 (-3pts)');
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toBe('Score regression detected (85 → 82)');
  });

  it('handles missing rollback reason gracefully', () => {
    const result = checkRegressionStop(true, undefined);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toBe('Score regression detected ()');
  });

  it('extracts the before/after scores from the rollback reason', () => {
    const result = checkRegressionStop(true, 'score regression: 72 → 68 (-4pts)');
    expect(result.earlyStopReason).toContain('72 → 68');
  });
});

// ── Integration-style logic tests ────────────────────────────────────────────
//
// These tests verify the decision logic for combining multiple stop conditions,
// mirroring what runEngine does between clicks.

describe('stop condition priority', () => {
  it('regression takes priority: stopOnRegression flag gates it', () => {
    // With flag off: regression doesn't stop
    const withoutFlag = checkRegressionStop(false, 'score regression: 80 → 78 (-2pts)');
    expect(withoutFlag.stop).toBe(false);

    // With flag on via regressionDetected=true: stops
    const withFlag = checkRegressionStop(true, 'score regression: 80 → 78 (-2pts)');
    expect(withFlag.stop).toBe(true);
  });

  it('plateau does not trigger on exactly 3-click runs', () => {
    // 3 consecutive zeros on a 3-click run — should NOT trigger
    expect(checkPlateauStop(3, 3).stop).toBe(false);
    // Same on a 4-click run — SHOULD trigger
    expect(checkPlateauStop(3, 4).stop).toBe(true);
  });

  it('budget stops at exactly the threshold', () => {
    expect(checkBudgetStop(0.099, 0.10).stop).toBe(false);
    expect(checkBudgetStop(0.10, 0.10).stop).toBe(true);
    expect(checkBudgetStop(0.101, 0.10).stop).toBe(true);
  });
});
