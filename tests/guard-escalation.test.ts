import { describe, it, expect } from 'vitest';
import { nextGuardProfile, isGuardRejection } from '../src/core/engine.js';
import { GUARD_PROFILES } from '../src/types.js';

describe('isGuardRejection', () => {
  it('detects "Too many lines changed" as guard rejection', () => {
    expect(isGuardRejection('Too many lines changed: 150 > 40 max')).toBe(true);
  });

  it('detects "Too many files changed" as guard rejection', () => {
    expect(isGuardRejection('Too many files changed: 8 > 3 max')).toBe(true);
  });

  it('detects "Single file changed too many lines" as guard rejection', () => {
    expect(isGuardRejection('Single file changed too many lines in sweep mode')).toBe(true);
  });

  it('returns false for test failures', () => {
    expect(isGuardRejection('build failed')).toBe(false);
  });

  it('returns false for score regression', () => {
    expect(isGuardRejection('score regression: 86 → 84 (-2pts)')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isGuardRejection(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isGuardRejection('')).toBe(false);
  });
});

describe('nextGuardProfile', () => {
  it('escalates tight → refactor', () => {
    const result = nextGuardProfile(GUARD_PROFILES.tight!);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('refactor');
    expect(result!.guards).toEqual(GUARD_PROFILES.refactor);
  });

  it('escalates refactor → broad', () => {
    const result = nextGuardProfile(GUARD_PROFILES.refactor!);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('broad');
    expect(result!.guards).toEqual(GUARD_PROFILES.broad);
  });

  it('escalates broad → atomic', () => {
    const result = nextGuardProfile(GUARD_PROFILES.broad!);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('atomic');
    expect(result!.guards).toBeNull();
  });

  it('returns null for atomic (already at top)', () => {
    const result = nextGuardProfile(null);
    expect(result).toBeNull();
  });

  it('returns null for unknown custom guards', () => {
    const result = nextGuardProfile({ maxFilesChanged: 7, maxLinesChanged: 100 });
    expect(result).toBeNull();
  });

  it('follows full escalation chain tight → refactor → broad → atomic', () => {
    let current = GUARD_PROFILES.tight!;
    const chain: string[] = ['tight'];
    
    let next = nextGuardProfile(current);
    while (next) {
      chain.push(next.name);
      current = next.guards!;
      if (next.guards === null) break; // atomic
      next = nextGuardProfile(current);
    }
    
    expect(chain).toEqual(['tight', 'refactor', 'broad', 'atomic']);
  });
});
