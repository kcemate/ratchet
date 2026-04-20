import { describe, it, expect } from 'vitest';
import { classifyFinding, routeDeepFix, MECHANICAL_SUBCATEGORIES } from '../core/deep-fix-router.js';
import type { IssueType } from '../core/scanner/index.js';

describe('deep-fix-router', () => {
  describe('classifyFinding', () => {
    it('should classify mechanical subcategories', () => {
      for (const subcat of MECHANICAL_SUBCATEGORIES) {
        expect(classifyFinding(subcat)).toBe('mechanical');
      }
    });

    it('should classify semantic subcategories', () => {
      expect(classifyFinding('Error handling')).toBe('semantic');
      expect(classifyFinding('Security')).toBe('semantic');
      expect(classifyFinding('Logic bug')).toBe('semantic');
    });
  });

  describe('routeDeepFix', () => {
    const mockProvider = {
      name: 'test-provider',
      tier: 'architect',
      model: 'test-model',
    } as unknown as import('../core/providers/base.js').Provider;

    it('should route to sweep tier when only mechanical high-severity issues', () => {
      const issues: IssueType[] = [
        { severity: 'high', subcategory: 'Line length', file: 'src/a.ts', line: 1, column: 1, message: 'Long line' },
        { severity: 'high', subcategory: 'Console cleanup', file: 'src/b.ts', line: 1, column: 1, message: 'console.log' },
      ];
      const result = routeDeepFix(issues, mockProvider);
      expect(result.taskType).toBe('sweep');
    });

    it('should route to architect tier when semantic high-severity issues', () => {
      const issues: IssueType[] = [
        { severity: 'high', subcategory: 'Error handling', file: 'src/a.ts', line: 1, column: 1, message: 'Missing error handling' },
      ];
      const result = routeDeepFix(issues, mockProvider);
      expect(result.taskType).toBe('architect');
    });

    it('should route to architect tier when no high-severity issues', () => {
      const issues: IssueType[] = [
        { severity: 'low', subcategory: 'Line length', file: 'src/a.ts', line: 1, column: 1, message: 'Long line' },
      ];
      const result = routeDeepFix(issues, mockProvider);
      expect(result.taskType).toBe('architect');
    });

    it('should route to architect tier when mixed high-severity issues (semantic present)', () => {
      const issues: IssueType[] = [
        { severity: 'high', subcategory: 'Line length', file: 'src/a.ts', line: 1, column: 1, message: 'Long line' },
        { severity: 'high', subcategory: 'Error handling', file: 'src/b.ts', line: 1, column: 1, message: 'Missing error handling' },
      ];
      const result = routeDeepFix(issues, mockProvider);
      expect(result.taskType).toBe('architect');
    });
  });
});
