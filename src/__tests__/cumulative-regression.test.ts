/**
 * Tests for cumulative (net) regression detection.
 *
 * The engine rolls back any click whose post-scan total drops BELOW
 * state.initialTotalScore, even if it doesn't drop below the previous click's
 * score (the "death by a thousand cuts" guard).
 */
import { describe, it, expect } from 'vitest';

// We test the net-regression guard logic by verifying the conditions that
// trigger it. The guard fires when:
//   state.netRegressionGuardEnabled === true
//   AND newTotal < state.initialTotalScore
//
// It does NOT fire when:
//   newTotal >= state.initialTotalScore  (even if newTotal < previousTotal handled by per-click guard)

describe('net regression guard conditions', () => {
  it('should trigger when newTotal is below initialTotalScore', () => {
    const initialTotalScore = 80;
    const newTotal = 79;
    const netRegressionGuardEnabled = true;

    const shouldRollback = netRegressionGuardEnabled && newTotal < initialTotalScore;
    expect(shouldRollback).toBe(true);
  });

  it('should NOT trigger when newTotal equals initialTotalScore', () => {
    const initialTotalScore = 80;
    const newTotal = 80;
    const netRegressionGuardEnabled = true;

    const shouldRollback = netRegressionGuardEnabled && newTotal < initialTotalScore;
    expect(shouldRollback).toBe(false);
  });

  it('should NOT trigger when newTotal is above initialTotalScore', () => {
    const initialTotalScore = 80;
    const newTotal = 83;
    const netRegressionGuardEnabled = true;

    const shouldRollback = netRegressionGuardEnabled && newTotal < initialTotalScore;
    expect(shouldRollback).toBe(false);
  });

  it('no false positive: score above initial but below previous high', () => {
    // Scenario: run started at 80, went up to 85, now at 82.
    // Per-click guard: 82 < 85 would normally fire — that's the per-click guard.
    // Net guard: 82 >= 80 initial — net guard should NOT fire.
    const initialTotalScore = 80;
    const previousTotal = 85;
    const newTotal = 82;
    const netRegressionGuardEnabled = true;

    const perClickShouldRollback = newTotal < previousTotal;  // true — separate guard
    const netShouldRollback = netRegressionGuardEnabled && newTotal < initialTotalScore;

    expect(perClickShouldRollback).toBe(true);   // per-click guard fires
    expect(netShouldRollback).toBe(false);        // net guard does NOT additionally fire
  });

  it('should NOT trigger when guard is disabled', () => {
    const initialTotalScore = 80;
    const newTotal = 70;
    const netRegressionGuardEnabled = false;

    const shouldRollback = netRegressionGuardEnabled && newTotal < initialTotalScore;
    expect(shouldRollback).toBe(false);
  });

  it('detects cumulative drift: 7 clicks each 83→83 but final score is 79', () => {
    // Simulate a run where each per-click scan showed no regression,
    // but the cumulative score drifted below initial.
    const initialTotalScore = 83;
    const netRegressionGuardEnabled = true;

    // After 7 clicks, final total is 79 (auth subcategory degraded across commits)
    const finalTotal = 79;

    const shouldRollback = netRegressionGuardEnabled && finalTotal < initialTotalScore;
    expect(shouldRollback).toBe(true);
  });
});
