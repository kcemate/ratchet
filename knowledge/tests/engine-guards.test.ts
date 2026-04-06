import { describe, it, expect } from 'vitest';
import type { Target, RatchetConfig, ClickGuards } from '../types.js';
import { GUARD_PROFILES, GUARD_ESCALATION_ORDER, nextGuardProfile, isGuardRejection, resolveGuards } from './engine-guards';

// Mock GUARD_PROFILES for testing
const mockGuardProfiles = {
  tight: { maxFilesChanged: 3, maxLinesChanged: 100 },
  refactor: { maxFilesChanged: 12, maxLinesChanged: 280 },
  broad: { maxFilesChanged: 20, maxLinesChanged: 500 },
  atomic: null,
  sweep: { maxFilesChanged: 8, maxLinesChanged: 200 },
};

// Override the imported GUARD_PROFILES with our mock
Object.assign(GUARD_PROFILES, mockGuardProfiles);

// Mock Target and RatchetConfig types
interface MockTarget {
  name?: string;
  guards?: ClickGuards | null;
}

interface MockRatchetConfig {
  guards?: ClickGuards | string | null;
}

describe('engine-guards.ts', () => {
  describe('nextGuardProfile', () => {
    it('should return null when current is null (atomic)', () => {
      expect(nextGuardProfile(null)).toBeNull();
    });

    it('should return null when current is already atomic', () => {
      expect(nextGuardProfile(null)).toBeNull();
    });

    it('should return the next guard profile in escalation chain', () => {
      const current = { maxFilesChanged: 3, maxLinesChanged: 100 }; // tight
      const result = nextGuardProfile(current);
      expect(result).toEqual({ name: 'refactor', guards: mockGuardProfiles.refactor });
    });

    it('should return refactor when current is tight', () => {
      const current = mockGuardProfiles.tight;
      const result = nextGuardProfile(current);
      expect(result?.name).toBe('refactor');
      expect(result?.guards).toEqual(mockGuardProfiles.refactor);
    });

    it('should return broad when current is refactor', () => {
      const current = mockGuardProfiles.refactor;
      const result = nextGuardProfile(current);
      expect(result?.name).toBe('broad');
      expect(result?.guards).toEqual(mockGuardProfiles.broad);
    });

    it('should return atomic when current is broad', () => {
      const current = mockGuardProfiles.broad;
      const result = nextGuardProfile(current);
      expect(result?.name).toBe('atomic');
      expect(result?.guards).toBeNull();
    });

    it('should return null when current is atomic (already at top)', () => {
      const current = null;
      const result = nextGuardProfile(current);
      expect(result).toBeNull();
    });

    it('should return null when current does not match any known profile', () => {
      const current = { maxFilesChanged: 999, maxLinesChanged: 999 };
      const result = nextGuardProfile(current);
      expect(result).toBeNull();
    });

    it('should handle edge case where current matches tight but is at end of array', () => {
      // Simulate tight being last in the order (though it's actually first)
      const originalOrder = [...GUARD_ESCALATION_ORDER];
      GUARD_ESCALATION_ORDER.length = 0;
      GUARD_ESCALATION_ORDER.push('atomic', 'broad', 'refactor', 'tight');
      
      const current = mockGuardProfiles.tight;
      const result = nextGuardProfile(current);
      expect(result).toBeNull();
      
      // Restore original order
      GUARD_ESCALATION_ORDER.length = 0;
      GUARD_ESCALATION_ORDER.push(...originalOrder);
    });
  });

  describe('isGuardRejection', () => {
    it('should return false for undefined reason', () => {
      expect(isGuardRejection(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isGuardRejection('')).toBe(false);
    });

    it('should return true for "Too many lines changed:" reason', () => {
      expect(isGuardRejection('Too many lines changed: 150 > 100')).toBe(true);
    });

    it('should return true for "Too many files changed:" reason', () => {
      expect(isGuardRejection('Too many files changed: 5 > 3')).toBe(true);
    });

    it('should return true for "Single file changed too many lines" reason', () => {
      expect(isGuardRejection('Single file changed too many lines: 80 > 50')).toBe(true);
    });

    it('should return false for other rollback reasons', () => {
      expect(isGuardRejection('Tests failed')).toBe(false);
      expect(isGuardRejection('Network error')).toBe(false);
      expect(isGuardRejection('Timeout')).toBe(false);
    });

    it('should handle reason with extra text after prefix', () => {
      expect(isGuardRejection('Too many lines changed: 150 (max 100)')).toBe(true);
    });

    it('should be case-insensitive for prefixes', () => {
      expect(isGuardRejection('too many lines changed: 150')).toBe(true);
    });
  });

  describe('resolveGuards', () => {
    it('should return config.guards when set (string profile name)', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = { guards: 'refactor' };
      const result = resolveGuards(target, config, 'normal');
      expect(result).toEqual(mockGuardProfiles.refactor);
    });

    it('should return config.guards when set (object)', () => {
      const customGuards = { maxFilesChanged: 5, maxLinesChanged: 150 };
      const target: MockTarget = {};
      const config: MockRatchetConfig = { guards: customGuards };
      const result = resolveGuards(target, config, 'normal');
      expect(result).toEqual(customGuards);
    });

    it('should return target.guards when config.guards is undefined', () => {
      const targetGuards = { maxFilesChanged: 8, maxLinesChanged: 200 };
      const target: MockTarget = { guards: targetGuards };
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'normal');
      expect(result).toEqual(targetGuards);
    });

    it('should return atomic (null) when both config and target guards are null', () => {
      const target: MockTarget = { guards: null };
      const config: MockRatchetConfig = { guards: null };
      const result = resolveGuards(target, config, 'normal');
      expect(result).toBeNull();
    });

    it('should auto-elevate to refactor for testing focus category', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'normal', 'testing');
      expect(result).toEqual(mockGuardProfiles.refactor);
    });

    it('should use broad guards for architect mode', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'architect');
      expect(result).toEqual(mockGuardProfiles.broad);
    });

    it('should use sweep guards for sweep mode', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'sweep');
      expect(result).toEqual(mockGuardProfiles.sweep);
    });

    it('should use tight guards for normal mode by default', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'normal');
      expect(result).toEqual(mockGuardProfiles.tight);
    });

    it('should prioritize config.guards over mode defaults', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = { guards: 'broad' };
      const result = resolveGuards(target, config, 'normal');
      expect(result).toEqual(mockGuardProfiles.broad);
    });

    it('should prioritize target.guards over mode defaults when config.guards undefined', () => {
      const target: MockTarget = { guards: 'atomic' };
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'normal');
      expect(result).toBeNull();
    });

    it('should handle undefined focusCategory correctly', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'normal', undefined);
      expect(result).toEqual(mockGuardProfiles.tight);
    });

    it('should handle empty string focusCategory', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'normal', '');
      expect(result).toEqual(mockGuardProfiles.tight);
    });

    it('should handle invalid mode (fallback to tight)', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = {};
      // @ts-expect-error Invalid mode
      const result = resolveGuards(target, config, 'invalid-mode' as any);
      expect(result).toEqual(mockGuardProfiles.tight);
    });

    it('should handle config.guards as undefined (not set)', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = { guards: undefined };
      const result = resolveGuards(target, config, 'normal');
      expect(result).toEqual(mockGuardProfiles.tight);
    });

    it('should handle target.guards as undefined (not set)', () => {
      const target: MockTarget = { guards: undefined };
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'normal');
      expect(result).toEqual(mockGuardProfiles.tight);
    });

    it('should handle config.guards as null', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = { guards: null };
      const result = resolveGuards(target, config, 'normal');
      expect(result).toBeNull();
    });

    it('should handle target.guards as null', () => {
      const target: MockTarget = { guards: null };
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'normal');
      expect(result).toBeNull();
    });

    it('should handle focusCategory "testing" with other mode', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = {};
      const result = resolveGuards(target, config, 'architect', 'testing');
      expect(result).toEqual(mockGuardProfiles.refactor);
    });

    it('should handle focusCategory "testing" with config.guards set', () => {
      const target: MockTarget = {};
      const config: MockRatchetConfig = { guards: 'tight' };
      const result = resolveGuards(target, config, 'normal', 'testing');
      expect(result).toEqual(mockGuardProfiles.tight); // config overrides
    });
  });
});