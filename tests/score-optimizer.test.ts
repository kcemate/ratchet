import { describe, it, expect } from 'vitest';
import { analyzeScoreGaps, buildScoreOptimizedBacklog, generateScorePlan, SUBCATEGORY_TIERS } from '../src/core/score-optimizer.js';
import type { ScanResult } from '../src/commands/scan.js';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

function makeScanResult(): ScanResult {
  return {
    projectName: 'test-project',
    total: 83,
    maxTotal: 100,
    categories: [
      {
        name: 'Error Handling',
        emoji: '⚠️',
        score: 16,
        max: 20,
        summary: '',
        subcategories: [
          { name: 'Coverage', score: 8, max: 8, summary: '', issuesFound: 0 },
          { name: 'Empty catches', score: 5, max: 5, summary: '', issuesFound: 0 },
          { name: 'Structured logging', score: 3, max: 7, summary: 'logger (7) + console (121)', issuesFound: 121 },
        ],
      },
      {
        name: 'Performance',
        emoji: '⚡',
        score: 7,
        max: 10,
        summary: '',
        subcategories: [
          { name: 'Async patterns', score: 2, max: 3, summary: '4 await-in-loop', issuesFound: 4 },
          { name: 'Console cleanup', score: 1, max: 5, summary: '61 console.log', issuesFound: 61, locations: ['/src/a.ts', '/src/b.ts'] },
          { name: 'Import hygiene', score: 2, max: 2, summary: 'clean', issuesFound: 0 },
        ],
      },
      {
        name: 'Code Quality',
        emoji: '📖',
        score: 9,
        max: 15,
        summary: '',
        subcategories: [
          { name: 'Function length', score: 4, max: 4, summary: '', issuesFound: 0 },
          { name: 'Line length', score: 1, max: 4, summary: '226 long lines', issuesFound: 226, locations: ['/src/c.ts'] },
          { name: 'Dead code', score: 2, max: 4, summary: '7 TODOs', issuesFound: 7 },
          { name: 'Duplication', score: 1, max: 3, summary: '316 repeated', issuesFound: 316 },
        ],
      },
      {
        name: 'Security',
        emoji: '🔒',
        score: 13,
        max: 15,
        summary: '',
        subcategories: [
          { name: 'Secrets & env vars', score: 3, max: 3, summary: '', issuesFound: 0 },
          { name: 'Input validation', score: 6, max: 6, summary: '', issuesFound: 0 },
          { name: 'Auth & rate limiting', score: 4, max: 6, summary: '1 missing auth', issuesFound: 1 },
        ],
      },
      {
        name: 'Testing',
        emoji: '🧪',
        score: 23,
        max: 25,
        summary: '',
        subcategories: [
          { name: 'Coverage ratio', score: 8, max: 8, summary: '', issuesFound: 0 },
          { name: 'Edge case depth', score: 9, max: 9, summary: '', issuesFound: 0 },
          { name: 'Test quality', score: 6, max: 8, summary: '1.7 per test', issuesFound: 1 },
        ],
      },
      {
        name: 'Type Safety',
        emoji: '📝',
        score: 15,
        max: 15,
        summary: '',
        subcategories: [
          { name: 'Strict config', score: 7, max: 7, summary: '', issuesFound: 0 },
          { name: 'Any type count', score: 8, max: 8, summary: '', issuesFound: 0 },
        ],
      },
    ],
    totalIssuesFound: 645,
    issuesByType: [
      { category: 'Performance', subcategory: 'Console cleanup', count: 61, description: 'console.log calls in src', severity: 'low', locations: ['/src/a.ts', '/src/b.ts'] },
      { category: 'Code Quality', subcategory: 'Line length', count: 226, description: 'lines >120 chars', severity: 'low', locations: ['/src/c.ts'] },
      { category: 'Code Quality', subcategory: 'Dead code', count: 7, description: 'dead code indicators', severity: 'low' },
      { category: 'Code Quality', subcategory: 'Duplication', count: 316, description: 'repeated code lines', severity: 'medium' },
      { category: 'Performance', subcategory: 'Async patterns', count: 4, description: 'await-in-loop patterns', severity: 'medium' },
      { category: 'Security', subcategory: 'Auth & rate limiting', count: 1, description: 'missing auth', severity: 'medium' },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('score-optimizer', () => {
  describe('SUBCATEGORY_TIERS', () => {
    it('has tier definitions for key subcategories', () => {
      const names = SUBCATEGORY_TIERS.map(t => t.name);
      expect(names).toContain('Console cleanup');
      expect(names).toContain('Line length');
      expect(names).toContain('Structured logging');
      expect(names).toContain('Duplication');
      expect(names).toContain('Dead code');
      expect(names).toContain('Async patterns');
    });

    it('has tiers sorted from best (lowest threshold) to worst', () => {
      for (const tier of SUBCATEGORY_TIERS) {
        for (let i = 1; i < tier.tiers.length; i++) {
          expect(tier.tiers[i]!.threshold).toBeGreaterThanOrEqual(tier.tiers[i - 1]!.threshold);
        }
      }
    });

    it('has effortPerFix between 1 and 5', () => {
      for (const tier of SUBCATEGORY_TIERS) {
        expect(tier.effortPerFix).toBeGreaterThanOrEqual(1);
        expect(tier.effortPerFix).toBeLessThanOrEqual(5);
      }
    });

    it('has fixInstruction on every tier', () => {
      for (const tier of SUBCATEGORY_TIERS) {
        expect(tier.fixInstruction.length).toBeGreaterThan(0);
      }
    });
  });

  describe('analyzeScoreGaps', () => {
    it('skips already-maxed subcategories', () => {
      const gaps = analyzeScoreGaps(makeScanResult());
      const names = gaps.map(g => g.subcategory);
      expect(names).not.toContain('Coverage');
      expect(names).not.toContain('Empty catches');
      expect(names).not.toContain('Function length');
      expect(names).not.toContain('Import hygiene');
      expect(names).not.toContain('Strict config');
      expect(names).not.toContain('Any type count');
    });

    it('includes below-max subcategories', () => {
      const gaps = analyzeScoreGaps(makeScanResult());
      const names = gaps.map(g => g.subcategory);
      expect(names).toContain('Console cleanup');
      expect(names).toContain('Line length');
      expect(names).toContain('Duplication');
    });

    it('calculates pointsAvailable correctly', () => {
      const gaps = analyzeScoreGaps(makeScanResult());

      const consolGap = gaps.find(g => g.subcategory === 'Console cleanup')!;
      expect(consolGap.pointsAvailable).toBe(4); // max 5, current 1

      const lineLenGap = gaps.find(g => g.subcategory === 'Line length')!;
      expect(lineLenGap.pointsAvailable).toBe(3); // max 4, current 1
    });

    it('sorts by ROI descending', () => {
      const gaps = analyzeScoreGaps(makeScanResult());
      for (let i = 1; i < gaps.length; i++) {
        expect(gaps[i]!.roi).toBeLessThanOrEqual(gaps[i - 1]!.roi + 0.001); // small epsilon for float
      }
    });

    it('includes file locations from scan', () => {
      const gaps = analyzeScoreGaps(makeScanResult());
      const consolGap = gaps.find(g => g.subcategory === 'Console cleanup')!;
      expect(consolGap.files.length).toBeGreaterThan(0);
    });

    it('prefers low-effort over high-effort for equal points', () => {
      const gaps = analyzeScoreGaps(makeScanResult());
      const deadCodeIdx = gaps.findIndex(g => g.subcategory === 'Dead code');
      const dupIdx = gaps.findIndex(g => g.subcategory === 'Duplication');
      // Dead code: effort 1, Duplication: effort 5 — dead code should rank higher
      if (deadCodeIdx >= 0 && dupIdx >= 0) {
        expect(deadCodeIdx).toBeLessThan(dupIdx);
      }
    });

    it('returns empty array for perfect score', () => {
      const scan = makeScanResult();
      for (const cat of scan.categories) {
        for (const sub of cat.subcategories) {
          sub.score = sub.max;
          sub.issuesFound = 0;
        }
      }
      const gaps = analyzeScoreGaps(scan);
      expect(gaps).toHaveLength(0);
    });
  });

  describe('buildScoreOptimizedBacklog', () => {
    it('returns IssueTask items sorted by priority descending', () => {
      const tasks = buildScoreOptimizedBacklog(makeScanResult());
      expect(tasks.length).toBeGreaterThan(0);
      for (let i = 1; i < tasks.length; i++) {
        expect(tasks[i]!.priority).toBeLessThanOrEqual(tasks[i - 1]!.priority + 0.001);
      }
    });

    it('includes ROI info in descriptions', () => {
      const tasks = buildScoreOptimizedBacklog(makeScanResult());
      for (const task of tasks) {
        expect(task.description).toContain('ROI:');
      }
    });

    it('marks high-points tasks as high severity', () => {
      const tasks = buildScoreOptimizedBacklog(makeScanResult());
      const consoleTask = tasks.find(t => t.subcategory === 'Console cleanup');
      expect(consoleTask).toBeDefined();
      expect(consoleTask!.severity).toBe('high'); // 4 pts available
    });

    it('sets sweepFiles from scan locations', () => {
      const tasks = buildScoreOptimizedBacklog(makeScanResult());
      const consoleTask = tasks.find(t => t.subcategory === 'Console cleanup');
      expect(consoleTask!.sweepFiles!.length).toBeGreaterThan(0);
    });

    it('excludes maxed-out subcategories', () => {
      const tasks = buildScoreOptimizedBacklog(makeScanResult());
      const maxedSubs = ['Coverage', 'Empty catches', 'Function length', 'Import hygiene'];
      for (const task of tasks) {
        expect(maxedSubs).not.toContain(task.subcategory);
      }
    });

    it('returns empty array for perfect scan', () => {
      const scan = makeScanResult();
      for (const cat of scan.categories) {
        for (const sub of cat.subcategories) {
          sub.score = sub.max;
          sub.issuesFound = 0;
        }
      }
      const tasks = buildScoreOptimizedBacklog(scan);
      expect(tasks).toHaveLength(0);
    });
  });

  describe('generateScorePlan', () => {
    it('produces a readable plan with score info', () => {
      const plan = generateScorePlan(makeScanResult());
      expect(plan).toContain('Score Optimization Plan');
      expect(plan).toContain('83/100');
      expect(plan).toContain('ROI');
    });

    it('includes numbered priority list', () => {
      const plan = generateScorePlan(makeScanResult());
      expect(plan).toContain('1.');
      expect(plan).toContain('effort:');
    });

    it('returns perfect message for maxed scan', () => {
      const scan = makeScanResult();
      for (const cat of scan.categories) {
        for (const sub of cat.subcategories) {
          sub.score = sub.max;
          sub.issuesFound = 0;
        }
      }
      scan.total = 100;
      const plan = generateScorePlan(scan);
      expect(plan).toContain('100/100');
    });

    it('shows total points available', () => {
      const plan = generateScorePlan(makeScanResult());
      expect(plan).toMatch(/\d+ points available/);
    });
  });
});
