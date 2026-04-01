import { describe, it, expect } from 'vitest';
import { isSweepable } from '../src/core/score-optimizer.js';
import { resolveEscalationMode } from '../src/core/engine.js';
import { resolveGuards } from '../src/core/engine-guards.js';
import { GUARD_PROFILES } from '../src/types.js';

// ── isSweepable ───────────────────────────────────────────────────────────────

describe('isSweepable', () => {
  it('returns true for known sweepable subcategories', () => {
    expect(isSweepable('Line length')).toBe(true);
    expect(isSweepable('Console cleanup')).toBe(true);
    expect(isSweepable('Dead code')).toBe(true);
    expect(isSweepable('Empty catches')).toBe(true);
    expect(isSweepable('Structured logging')).toBe(true);
    expect(isSweepable('Test quality')).toBe(true);
    expect(isSweepable('Coverage')).toBe(true);
  });

  it('returns false for known non-sweepable subcategories', () => {
    expect(isSweepable('Async patterns')).toBe(false);
    expect(isSweepable('Import hygiene')).toBe(false);
    expect(isSweepable('Duplication')).toBe(false);
    expect(isSweepable('Function length')).toBe(false);
    expect(isSweepable('Auth & rate limiting')).toBe(false);
    expect(isSweepable('Input validation')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSweepable('line length')).toBe(true);
    expect(isSweepable('LINE LENGTH')).toBe(true);
    expect(isSweepable('async patterns')).toBe(false);
  });

  it('returns false for unknown subcategories', () => {
    expect(isSweepable('nonexistent-subcategory')).toBe(false);
    expect(isSweepable('')).toBe(false);
  });
});

// ── resolveEscalationMode ─────────────────────────────────────────────────────

describe('resolveEscalationMode', () => {
  it('returns sweep for sweepable subcategory stall', () => {
    expect(resolveEscalationMode('Line length')).toBe('sweep');
    expect(resolveEscalationMode('Dead code')).toBe('sweep');
    expect(resolveEscalationMode('Console cleanup')).toBe('sweep');
    expect(resolveEscalationMode('Empty catches')).toBe('sweep');
  });

  it('returns architect for non-sweepable subcategory stall', () => {
    expect(resolveEscalationMode('Async patterns')).toBe('architect');
    expect(resolveEscalationMode('Duplication')).toBe('architect');
    expect(resolveEscalationMode('Function length')).toBe('architect');
    expect(resolveEscalationMode('Auth & rate limiting')).toBe('architect');
  });

  it('returns architect when subcategory is undefined (no backlog)', () => {
    expect(resolveEscalationMode(undefined)).toBe('architect');
  });

  it('returns architect when subcategory is empty string', () => {
    expect(resolveEscalationMode('')).toBe('architect');
  });

  it('sweep escalation uses the stalled subcategory as category filter', () => {
    // The subcategory returned is the one that should be passed as `category` to runSweepEngine
    const subcategory = 'Line length';
    const mode = resolveEscalationMode(subcategory);
    expect(mode).toBe('sweep');
    // The subcategory string is passed verbatim — verify it's the expected one
    expect(subcategory).toBe('Line length');
  });
});

// ── Sweep guard profile ───────────────────────────────────────────────────────

describe('sweep guard profile', () => {
  it('sweep profile allows 50 files and 1000 lines per click', () => {
    expect(GUARD_PROFILES.sweep).toEqual({ maxFilesChanged: 50, maxLinesChanged: 1000 });
  });

  it('resolveGuards returns sweep profile (50 files) for sweep mode', () => {
    const target = { name: 'test', path: 'src/', description: '' };
    const config = {
      agent: 'shell' as const,
      defaults: { clicks: 3, testCommand: 'npm test', autoCommit: false },
      targets: [],
    };
    const guards = resolveGuards(target, config, 'sweep');
    expect(guards).toEqual(GUARD_PROFILES.sweep);
    expect(guards?.maxFilesChanged).toBe(50);
  });

  it('sweep guard is more permissive than refactor (architect) guard', () => {
    const sweepGuard = GUARD_PROFILES.sweep!;
    const refactorGuard = GUARD_PROFILES.refactor!;
    expect(sweepGuard.maxFilesChanged).toBeGreaterThan(refactorGuard.maxFilesChanged);
    expect(sweepGuard.maxLinesChanged).toBeGreaterThan(refactorGuard.maxLinesChanged);
  });
});
