import { describe, it, expect } from 'vitest';
import { nextGuardProfile, isGuardRejection, resolveGuards } from '../core/engine-guards.js';
import type { Target, RatchetConfig, ClickGuards } from '../types.js';

describe('engine-guards', () => {
  describe('nextGuardProfile', () => {
    it('should return null when current is null (atomic)', () => {
      expect(nextGuardProfile(null)).toBeNull();
    });

    it('should escalate tight → refactor', () => {
      const tight: ClickGuards = { maxFilesChanged: 3, maxLinesChanged: 40 };
      const result = nextGuardProfile(tight);
      expect(result?.name).toBe('refactor');
      expect(result?.guards).toEqual({ maxFilesChanged: 12, maxLinesChanged: 280 });
    });

    it('should escalate refactor → broad', () => {
      const refactor: ClickGuards = { maxFilesChanged: 12, maxLinesChanged: 280 };
      const result = nextGuardProfile(refactor);
      expect(result?.name).toBe('broad');
      expect(result?.guards).toEqual({ maxFilesChanged: 20, maxLinesChanged: 500 });
    });

    it('should return null when already at atomic', () => {
      expect(nextGuardProfile(null)).toBeNull();
    });

    it('should return null for unknown guard profile', () => {
      const unknown: ClickGuards = { maxFilesChanged: 99, maxLinesChanged: 999 };
      expect(nextGuardProfile(unknown)).toBeNull();
    });
  });

  describe('isGuardRejection', () => {
    it('should detect max lines rejection', () => {
      expect(isGuardRejection('Too many lines changed: 150 > 120')).toBe(true);
    });

    it('should detect max files rejection', () => {
      expect(isGuardRejection('Too many files changed: 10 > 6')).toBe(true);
    });

    it('should detect single file max lines rejection', () => {
      expect(isGuardRejection('Single file changed too many lines: 300 > 200')).toBe(true);
    });

    it('should return false for non-guard reasons', () => {
      expect(isGuardRejection('Tests failed')).toBe(false);
      expect(isGuardRejection(undefined)).toBe(false);
    });
  });

  describe('resolveGuards', () => {
    const mockTarget: Target = { name: 'test-repo', cwd: '/tmp/test' };
    const mockConfig: RatchetConfig = { guards: undefined };

    it('should prioritize config.guards (CLI) over target.guards', () => {
      const config: RatchetConfig = { guards: { maxFilesChanged: 99, maxLinesChanged: 999 } };
      const result = resolveGuards(mockTarget, config, 'normal');
      expect(result).toEqual({ maxFilesChanged: 99, maxLinesChanged: 999 });
    });

    it('should use target.guards when config.guards is undefined', () => {
      const target: Target = { name: 'test-repo', cwd: '/tmp/test', guards: 'refactor' };
      const result = resolveGuards(target, mockConfig, 'normal');
      expect(result).toEqual({ maxFilesChanged: 12, maxLinesChanged: 280 });
    });

    it('should auto-elevate to refactor for testing focus category', () => {
      const result = resolveGuards(mockTarget, mockConfig, 'normal', 'testing');
      expect(result).toEqual({ maxFilesChanged: 12, maxLinesChanged: 280 });
    });

    it('should use architect mode defaults', () => {
      const result = resolveGuards(mockTarget, mockConfig, 'architect');
      expect(result).toEqual({ maxFilesChanged: 20, maxLinesChanged: 500 });
    });

    it('should use sweep mode defaults', () => {
      const result = resolveGuards(mockTarget, mockConfig, 'sweep');
      expect(result).toEqual({ maxFilesChanged: 50, maxLinesChanged: 1000 });
    });

    it('should use normal mode defaults (tight)', () => {
      const result = resolveGuards(mockTarget, mockConfig, 'normal');
      expect(result).toEqual({ maxFilesChanged: 3, maxLinesChanged: 40 });
    });

    it('should handle null guards (atomic)', () => {
      const config: RatchetConfig = { guards: null };
      const result = resolveGuards(mockTarget, config, 'normal');
      expect(result).toBeNull();
    });
  });
});