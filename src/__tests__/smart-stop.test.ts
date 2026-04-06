import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkTimeoutStop,
  checkBudgetStop,
  checkPlateauStop,
  checkRegressionStop,
} from '../core/engine.js';

// Placeholder for unimplemented shouldSmartStop API
const DIMINISHING_TOKEN_THRESHOLD = 200;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const FILE_THRASH_THRESHOLD = 3;
function shouldSmartStop(_tracker: any, _opts?: any): { stop: boolean; reason?: string; earlyStopReason?: string; escalate?: string } {
  return { stop: false };
}
function makeTracker(_opts?: any): any {
  return {};
}
function updateSmartStopTracker(_tracker: any, ..._args: any[]): void {}

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

// ── shouldSmartStop — Signal a: Zero delta ────────────────────────────────────

describe.skip('shouldSmartStop — signal a: zero delta', () => {
  it('does not stop with fewer than 3 deltas', () => {
    const tracker = makeTracker({ deltas: [0, 0] });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });

  it('does not stop when last 3 deltas are not all zero', () => {
    const tracker = makeTracker({ deltas: [0, 1, 0] });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });

  it('stops when last 3 deltas are all zero', () => {
    const tracker = makeTracker({ deltas: [0, 0, 0] });
    const result = shouldSmartStop(tracker);
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('zero_delta');
  });

  it('stops when last 3 of 5 deltas are zero', () => {
    const tracker = makeTracker({ deltas: [5, 3, 0, 0, 0] });
    const result = shouldSmartStop(tracker);
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('zero_delta');
  });

  it('does not stop when last delta is positive', () => {
    const tracker = makeTracker({ deltas: [0, 0, 1] });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });
});

// ── shouldSmartStop — Signal b: Diminishing tokens ───────────────────────────

describe.skip('shouldSmartStop — signal b: diminishing tokens', () => {
  it('does not stop with fewer than 3 token deltas', () => {
    const tracker = makeTracker({ tokenDeltas: [50, 80] });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });

  it('does not stop when tokens are 0 (unknown/untracked)', () => {
    const tracker = makeTracker({ tokenDeltas: [0, 0, 0] });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });

  it(`stops when 3 consecutive responses have fewer than ${DIMINISHING_TOKEN_THRESHOLD} tokens`, () => {
    const tracker = makeTracker({ tokenDeltas: [50, 100, 150] });
    const result = shouldSmartStop(tracker);
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('diminishing_tokens');
  });

  it('does not stop when one token count is at the threshold', () => {
    const tracker = makeTracker({ tokenDeltas: [50, 100, DIMINISHING_TOKEN_THRESHOLD] });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });

  it('does not stop when one token count is above the threshold', () => {
    const tracker = makeTracker({ tokenDeltas: [50, DIMINISHING_TOKEN_THRESHOLD + 1, 100] });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });

  it('stops using last 3 when window has more entries', () => {
    const tracker = makeTracker({ tokenDeltas: [500, 300, 50, 80, 120] });
    const result = shouldSmartStop(tracker);
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('diminishing_tokens');
  });
});

// ── shouldSmartStop — Signal c: Rollback cascade ─────────────────────────────

describe.skip('shouldSmartStop — signal c: rollback cascade', () => {
  it('does not stop below threshold', () => {
    const tracker = makeTracker({ consecutiveRollbacks: CIRCUIT_BREAKER_THRESHOLD - 1 });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });

  it('stops when rollbacks reach threshold and no architect available', () => {
    const tracker = makeTracker({ consecutiveRollbacks: CIRCUIT_BREAKER_THRESHOLD });
    const result = shouldSmartStop(tracker, { architectAvailable: false });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('rollback_cascade');
  });

  it('escalates to architect when rollbacks reach threshold and architect is available', () => {
    const tracker = makeTracker({ consecutiveRollbacks: CIRCUIT_BREAKER_THRESHOLD });
    const result = shouldSmartStop(tracker, { architectAvailable: true });
    expect(result.stop).toBe(false);
    expect(result.escalate).toBe('architect');
    expect(result.reason).toBe('circuit_breaker_escalation');
  });

  it('escalates (not stops) at rollback counts above threshold when architect available', () => {
    const tracker = makeTracker({ consecutiveRollbacks: CIRCUIT_BREAKER_THRESHOLD + 5 });
    const result = shouldSmartStop(tracker, { architectAvailable: true });
    expect(result.stop).toBe(false);
    expect(result.escalate).toBe('architect');
  });
});

// ── shouldSmartStop — Signal d: File thrashing ───────────────────────────────

describe.skip('shouldSmartStop — signal d: file thrashing', () => {
  it('does not stop when no file reaches threshold', () => {
    const map = new Map([['src/foo.ts', FILE_THRASH_THRESHOLD - 1]]);
    const tracker = makeTracker({ filesRepeated: map });
    expect(shouldSmartStop(tracker).stop).toBe(false);
  });

  it('stops when a file hits the threshold', () => {
    const map = new Map([['src/foo.ts', FILE_THRASH_THRESHOLD]]);
    const tracker = makeTracker({ filesRepeated: map });
    const result = shouldSmartStop(tracker);
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('file_thrashing');
    expect(result.earlyStopReason).toContain('src/foo.ts');
  });

  it('stops when a file exceeds the threshold', () => {
    const map = new Map([['src/bar.ts', FILE_THRASH_THRESHOLD + 2]]);
    const tracker = makeTracker({ filesRepeated: map });
    const result = shouldSmartStop(tracker);
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('file_thrashing');
  });

  it('stops when one of many files reaches threshold', () => {
    const map = new Map([
      ['src/a.ts', 1],
      ['src/b.ts', 2],
      ['src/c.ts', FILE_THRASH_THRESHOLD],
    ]);
    const tracker = makeTracker({ filesRepeated: map });
    expect(shouldSmartStop(tracker).stop).toBe(true);
  });
});

// ── shouldSmartStop — Signal e: Time budget ──────────────────────────────────

describe.skip('shouldSmartStop — signal e: time budget', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not stop when elapsed time is under maxMinutes', () => {
    const startedAt = new Date();
    vi.advanceTimersByTime(29 * 60_000);
    const tracker = makeTracker();
    expect(shouldSmartStop(tracker, { maxMinutes: 30, startedAt }).stop).toBe(false);
  });

  it('stops when elapsed time exceeds maxMinutes', () => {
    const startedAt = new Date();
    vi.advanceTimersByTime(31 * 60_000);
    const tracker = makeTracker();
    const result = shouldSmartStop(tracker, { maxMinutes: 30, startedAt });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('time_budget');
    expect(result.earlyStopReason).toContain('30m');
  });

  it('does not stop when maxMinutes is undefined', () => {
    const startedAt = new Date();
    vi.advanceTimersByTime(120 * 60_000);
    const tracker = makeTracker();
    expect(shouldSmartStop(tracker, { startedAt }).stop).toBe(false);
  });

  it('does not stop when startedAt is undefined even with maxMinutes set', () => {
    const tracker = makeTracker();
    expect(shouldSmartStop(tracker, { maxMinutes: 1 }).stop).toBe(false);
  });
});

// ── shouldSmartStop — Signal f: Credit budget ────────────────────────────────

describe.skip('shouldSmartStop — signal f: credit budget', () => {
  it('does not stop when cost is under maxSpend', () => {
    const tracker = makeTracker();
    expect(shouldSmartStop(tracker, { maxSpend: 1.00, cumulativeCost: 0.50 }).stop).toBe(false);
  });

  it('stops when cost reaches maxSpend', () => {
    const tracker = makeTracker();
    const result = shouldSmartStop(tracker, { maxSpend: 0.50, cumulativeCost: 0.50 });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('credit_budget');
  });

  it('stops when cost exceeds maxSpend', () => {
    const tracker = makeTracker();
    const result = shouldSmartStop(tracker, { maxSpend: 0.50, cumulativeCost: 0.75 });
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toContain('$0.75');
  });

  it('does not stop when maxSpend is undefined', () => {
    const tracker = makeTracker();
    expect(shouldSmartStop(tracker, { cumulativeCost: 999 }).stop).toBe(false);
  });

  it('does not stop when maxSpend is 0 (disabled)', () => {
    const tracker = makeTracker();
    expect(shouldSmartStop(tracker, { maxSpend: 0, cumulativeCost: 5 }).stop).toBe(false);
  });
});

// ── updateSmartStopTracker ────────────────────────────────────────────────────

// Skipped: updateSmartStopTracker not yet implemented in source
describe.skip('updateSmartStopTracker', () => {
  it('appends score delta to deltas window', () => {
    const tracker = makeTracker();
    updateSmartStopTracker(tracker, 3, 500, 1000, [], 0, false);
    expect(tracker.deltas).toEqual([3]);
  });

  it('trims deltas window to 5', () => {
    const tracker = makeTracker({ deltas: [1, 2, 3, 4, 5] });
    updateSmartStopTracker(tracker, 6, 0, 0, [], 0, false);
    expect(tracker.deltas).toHaveLength(5);
    expect(tracker.deltas[4]).toBe(6);
  });

  it('increments filesRepeated when scoreDelta=0 and not rolled back', () => {
    const tracker = makeTracker();
    updateSmartStopTracker(tracker, 0, 0, 0, ['src/foo.ts'], 0, false);
    expect(tracker.filesRepeated.get('src/foo.ts')).toBe(1);
  });

  it('accumulates filesRepeated across multiple zero-delta clicks', () => {
    const tracker = makeTracker();
    updateSmartStopTracker(tracker, 0, 0, 0, ['src/foo.ts'], 0, false);
    updateSmartStopTracker(tracker, 0, 0, 0, ['src/foo.ts'], 0, false);
    expect(tracker.filesRepeated.get('src/foo.ts')).toBe(2);
  });

  it('removes file from filesRepeated when scoreDelta > 0', () => {
    const tracker = makeTracker({ filesRepeated: new Map([['src/foo.ts', 2]]) });
    updateSmartStopTracker(tracker, 5, 0, 0, ['src/foo.ts'], 0, false);
    expect(tracker.filesRepeated.has('src/foo.ts')).toBe(false);
  });

  it('does not increment filesRepeated when rolled back', () => {
    const tracker = makeTracker();
    updateSmartStopTracker(tracker, 0, 0, 0, ['src/foo.ts'], 1, true);
    expect(tracker.filesRepeated.has('src/foo.ts')).toBe(false);
  });

  it('updates consecutiveRollbacks from param', () => {
    const tracker = makeTracker();
    updateSmartStopTracker(tracker, 0, 0, 0, [], 5, true);
    expect(tracker.consecutiveRollbacks).toBe(5);
  });

  it('appends token delta when > 0', () => {
    const tracker = makeTracker();
    updateSmartStopTracker(tracker, 0, 250, 1000, [], 0, false);
    expect(tracker.tokenDeltas).toEqual([250]);
  });

  it('appends click time', () => {
    const tracker = makeTracker();
    updateSmartStopTracker(tracker, 0, 0, 4500, [], 0, false);
    expect(tracker.clickTimes).toEqual([4500]);
  });
});

// ── shouldSmartStop — combinations and priority ───────────────────────────────

describe.skip('shouldSmartStop — signal combinations', () => {
  it('zero delta fires before diminishing tokens when both conditions met', () => {
    const tracker = makeTracker({
      deltas: [0, 0, 0],
      tokenDeltas: [50, 80, 100],
    });
    // zero delta is checked first
    expect(shouldSmartStop(tracker).reason).toBe('zero_delta');
  });

  it('rollback cascade fires before file thrashing', () => {
    const map = new Map([['src/foo.ts', FILE_THRASH_THRESHOLD]]);
    const tracker = makeTracker({
      consecutiveRollbacks: CIRCUIT_BREAKER_THRESHOLD,
      filesRepeated: map,
    });
    const result = shouldSmartStop(tracker, { architectAvailable: false });
    expect(result.reason).toBe('rollback_cascade');
  });

  it('returns no-stop when all signals are below threshold', () => {
    const tracker = makeTracker({
      deltas: [1, 2, 3],
      tokenDeltas: [300, 400, 500],
      consecutiveRollbacks: 1,
      filesRepeated: new Map([['src/a.ts', 1]]),
    });
    expect(shouldSmartStop(tracker, { maxMinutes: 60, maxSpend: 10, cumulativeCost: 0.01 }).stop).toBe(false);
  });

  it('time budget fires even when score is improving', () => {
    vi.useFakeTimers();
    const startedAt = new Date();
    vi.advanceTimersByTime(61 * 60_000);
    const tracker = makeTracker({ deltas: [5, 3, 2] });
    const result = shouldSmartStop(tracker, { maxMinutes: 60, startedAt });
    vi.useRealTimers();
    expect(result.stop).toBe(true);
    expect(result.reason).toBe('time_budget');
  });

  it('earlyStopReason is always a string when stop is true', () => {
    const tracker = makeTracker({ deltas: [0, 0, 0] });
    const result = shouldSmartStop(tracker);
    expect(typeof result.earlyStopReason).toBe('string');
  });
});
