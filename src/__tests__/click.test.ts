import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  estimateCost,
  classifyRollbackReason,
  determineOutcome,
} from '../core/click.js';
import type { RollbackReason } from '../types.js';

describe('estimateCost', () => {
  it('returns 0 for zero linesChanged', () => {
    expect(estimateCost(0)).toBe(0);
    expect(estimateCost(0, 'sonnet')).toBe(0);
  });

  it('uses sonnet rates by default', () => {
    // sonnet: $3/M input, $15/M output
    // 100 lines → 100*20=2000 input tokens, 100*10=1000 output tokens
    // (2/1M)*3 + (1/1M)*15 = 0.006 + 0.015 = 0.021
    const cost = estimateCost(100);
    expect(cost).toBeCloseTo(0.021, 4);
  });

  it('uses opus rates when model includes opus', () => {
    // opus: $15/M input, $75/M output
    // 100 lines → 2000 input + 1000 output tokens
    // (2/1M)*15 + (1/1M)*75 = 0.03 + 0.075 = 0.105
    const cost = estimateCost(100, 'claude-opus-4');
    expect(cost).toBeCloseTo(0.105, 4);
  });

  it('uses haiku rates when model includes haiku', () => {
    // haiku: $0.25/M input, $1.25/M output
    const cost = estimateCost(100, 'claude-haiku-3');
    expect(cost).toBeCloseTo(0.00175, 5);
  });

  it('scales linearly with linesChanged', () => {
    const cost10 = estimateCost(10);
    const cost100 = estimateCost(100);
    // Use toBeCloseTo for floating point comparison
    expect(cost100).toBeCloseTo(cost10 * 10, 5);
  });

  it('handles fractional lines correctly', () => {
    const cost = estimateCost(1);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });
});

describe('classifyRollbackReason', () => {
  it('returns undefined for empty/undefined reason', () => {
    expect(classifyRollbackReason(undefined)).toBeUndefined();
    expect(classifyRollbackReason('')).toBeUndefined();
  });

  it('returns timeout for timeout-related reasons', () => {
    expect(classifyRollbackReason('timeout after 300s')).toBe('timeout');
    expect(classifyRollbackReason('Timed out after 900 seconds')).toBe('timeout');
    expect(classifyRollbackReason('TIMEOUT')).toBe('timeout');
    expect(classifyRollbackReason('operation timed out')).toBe('timeout');
  });

  it('returns scope-exceeded for scope reasons', () => {
    expect(classifyRollbackReason('Scope.exceeded: too many files')).toBe('scope-exceeded');
    expect(classifyRollbackReason('SCOPE.EXCEED')).toBe('scope-exceeded');
  });

  it('returns score-regression for score reasons', () => {
    expect(classifyRollbackReason('score.regression detected')).toBe('score-regression');
    expect(classifyRollbackReason('SCORE.REGRESS')).toBe('score-regression');
  });

  it('returns lint-error for lint/typecheck reasons', () => {
    expect(classifyRollbackReason('lint error')).toBe('lint-error');
    expect(classifyRollbackReason('TypeScript: typecheck failed')).toBe('lint-error');
    expect(classifyRollbackReason('tsc noEmit error')).toBe('lint-error');
  });

  it('returns guard-rejected for too many lines', () => {
    expect(classifyRollbackReason('Too many lines changed: 500 > 200 max')).toBe('guard-rejected');
  });

  it('returns guard-rejected for too many files', () => {
    expect(classifyRollbackReason('Too many files changed: 10 > 5 max')).toBe('guard-rejected');
  });

  it('returns guard-rejected for single file too many lines', () => {
    expect(classifyRollbackReason('Single file changed too many lines in sweep mode')).toBe('guard-rejected');
  });

  it('returns test-related for other reasons', () => {
    expect(classifyRollbackReason('tests failed')).toBe('test-related');
    expect(classifyRollbackReason('build failed')).toBe('test-related');
    expect(classifyRollbackReason('arbitrary reason')).toBe('test-related');
  });
});

describe('determineOutcome', () => {
  it('returns landed when not rolled back', () => {
    expect(determineOutcome(false)).toBe('landed');
    expect(determineOutcome(false, 'some reason')).toBe('landed');
  });

  it('returns rolled-back when rolled back with no reason', () => {
    expect(determineOutcome(true)).toBe('rolled-back');
    expect(determineOutcome(true, undefined)).toBe('rolled-back');
  });

  it('returns timeout when rolled back with timeout reason', () => {
    expect(determineOutcome(true, 'timeout after 300s')).toBe('timeout');
    expect(determineOutcome(true, 'Command timed out')).toBe('timeout');
  });

  it('returns guard-rejected when too many lines', () => {
    expect(determineOutcome(true, 'Too many lines changed: 500 > 200 max')).toBe('guard-rejected');
  });

  it('returns guard-rejected when too many files', () => {
    expect(determineOutcome(true, 'Too many files changed: 10 > 5 max')).toBe('guard-rejected');
  });

  it('returns scope-rejected for scope.exceed reasons', () => {
    expect(determineOutcome(true, 'Scope.exceeded')).toBe('scope-rejected');
  });

  it('returns rolled-back for test-related reasons', () => {
    expect(determineOutcome(true, 'tests failed')).toBe('rolled-back');
    expect(determineOutcome(true, 'build errored')).toBe('rolled-back');
    expect(determineOutcome(true, 'prevalidate rejected')).toBe('rolled-back');
  });
});
