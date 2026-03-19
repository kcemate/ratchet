import { describe, it, expect } from 'vitest';
import { GUARD_PROFILES } from '../src/types.js';
import type { GuardProfileName, ClickGuards } from '../src/types.js';

// Import the internal resolveGuards via re-export we'll add, or test indirectly.
// We test profiles + resolution logic directly from the exported types.

describe('GUARD_PROFILES', () => {
  it('tight profile has 3 files / 40 lines', () => {
    const p = GUARD_PROFILES.tight!;
    expect(p.maxFilesChanged).toBe(3);
    expect(p.maxLinesChanged).toBe(40);
  });

  it('refactor profile has 12 files / 280 lines', () => {
    const p = GUARD_PROFILES.refactor!;
    expect(p.maxFilesChanged).toBe(12);
    expect(p.maxLinesChanged).toBe(280);
  });

  it('broad profile has 20 files / 500 lines', () => {
    const p = GUARD_PROFILES.broad!;
    expect(p.maxFilesChanged).toBe(20);
    expect(p.maxLinesChanged).toBe(500);
  });

  it('atomic profile is null (no limits)', () => {
    expect(GUARD_PROFILES.atomic).toBeNull();
  });

  it('all four profile names are present', () => {
    const names: GuardProfileName[] = ['tight', 'refactor', 'broad', 'atomic'];
    for (const name of names) {
      expect(GUARD_PROFILES).toHaveProperty(name);
    }
  });
});

describe('guard profile ordering', () => {
  it('tight < refactor < broad in both dimensions', () => {
    const tight = GUARD_PROFILES.tight!;
    const refactor = GUARD_PROFILES.refactor!;
    const broad = GUARD_PROFILES.broad!;

    expect(tight.maxFilesChanged).toBeLessThan(refactor.maxFilesChanged);
    expect(refactor.maxFilesChanged).toBeLessThan(broad.maxFilesChanged);

    expect(tight.maxLinesChanged).toBeLessThan(refactor.maxLinesChanged);
    expect(refactor.maxLinesChanged).toBeLessThan(broad.maxLinesChanged);
  });
});

describe('guard profile as ClickGuards type', () => {
  it('non-null profiles satisfy the ClickGuards interface', () => {
    const profiles: (ClickGuards | null)[] = Object.values(GUARD_PROFILES);
    const nonNull = profiles.filter((p): p is ClickGuards => p !== null);
    for (const p of nonNull) {
      expect(typeof p.maxFilesChanged).toBe('number');
      expect(typeof p.maxLinesChanged).toBe('number');
      expect(p.maxFilesChanged).toBeGreaterThan(0);
      expect(p.maxLinesChanged).toBeGreaterThan(0);
    }
  });
});

describe('guard resolution priority (unit)', () => {
  // Simulate the resolution logic from engine.ts resolveGuards()
  function resolveGuards(
    configGuards: GuardProfileName | ClickGuards | undefined,
    targetGuards: GuardProfileName | ClickGuards | undefined,
    mode: 'normal' | 'sweep' | 'architect',
  ): ClickGuards | null {
    const source = configGuards ?? targetGuards;
    if (source !== undefined) {
      if (typeof source === 'string') return GUARD_PROFILES[source as GuardProfileName];
      return source;
    }
    if (mode === 'architect') return GUARD_PROFILES.broad;
    if (mode === 'sweep') return GUARD_PROFILES.refactor;
    return GUARD_PROFILES.tight;
  }

  it('CLI config.guards (profile name) takes priority over target.guards', () => {
    const result = resolveGuards('broad', 'tight', 'normal');
    expect(result).toEqual(GUARD_PROFILES.broad);
  });

  it('CLI config.guards (ClickGuards object) takes priority over target.guards', () => {
    const custom: ClickGuards = { maxFilesChanged: 7, maxLinesChanged: 150 };
    const result = resolveGuards(custom, 'tight', 'normal');
    expect(result).toEqual(custom);
  });

  it('target.guards is used when config.guards is not set', () => {
    const result = resolveGuards(undefined, 'refactor', 'normal');
    expect(result).toEqual(GUARD_PROFILES.refactor);
  });

  it('mode default (tight) applies when neither config nor target guards are set', () => {
    const result = resolveGuards(undefined, undefined, 'normal');
    expect(result).toEqual(GUARD_PROFILES.tight);
  });

  it('mode default for sweep is refactor', () => {
    const result = resolveGuards(undefined, undefined, 'sweep');
    expect(result).toEqual(GUARD_PROFILES.refactor);
  });

  it('mode default for architect is broad', () => {
    const result = resolveGuards(undefined, undefined, 'architect');
    expect(result).toEqual(GUARD_PROFILES.broad);
  });

  it('atomic profile resolves to null (no limits)', () => {
    const result = resolveGuards('atomic', undefined, 'normal');
    expect(result).toBeNull();
  });

  it('atomic via target.guards resolves to null', () => {
    const result = resolveGuards(undefined, 'atomic', 'sweep');
    expect(result).toBeNull();
  });

  it('CLI guards override mode defaults even for architect mode', () => {
    const result = resolveGuards('tight', undefined, 'architect');
    expect(result).toEqual(GUARD_PROFILES.tight);
  });
});
