import { describe, it, expect } from 'vitest';
import { planTierTargets, buildAtomicSweepPrompt, buildTierBatchPrompt } from '../src/core/tier-engine.js';
import type { ScanResult } from '../src/commands/scan.js';
import type { TierGap } from '../src/core/score-optimizer.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test',
    total: 83,
    maxTotal: 100,
    totalIssuesFound: 675,
    categories: [
      {
        name: 'Error Handling',
        emoji: '⚠️',
        score: 16,
        max: 20,
        summary: '',
        subcategories: [
          {
            name: 'Structured logging',
            score: 3,
            max: 7,
            summary: '',
            issuesFound: 97,
            locations: Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`),
          },
          { name: 'Empty catches', score: 5, max: 5, summary: '', issuesFound: 0 },
          { name: 'Coverage', score: 8, max: 8, summary: '', issuesFound: 0 },
        ],
      },
      {
        name: 'Performance',
        emoji: '⚡',
        score: 7,
        max: 10,
        summary: '',
        subcategories: [
          {
            name: 'Console cleanup',
            score: 1,
            max: 5,
            summary: '',
            issuesFound: 46,
            locations: Array.from({ length: 20 }, (_, i) => `src/mod${i}.ts`),
          },
          {
            name: 'Async patterns',
            score: 2,
            max: 3,
            summary: '',
            issuesFound: 4,
            locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
          },
          { name: 'Import hygiene', score: 2, max: 2, summary: '', issuesFound: 0 },
        ],
      },
      {
        name: 'Code Quality',
        emoji: '📖',
        score: 9,
        max: 15,
        summary: '',
        subcategories: [
          {
            name: 'Line length',
            score: 1,
            max: 4,
            summary: '',
            issuesFound: 252,
            locations: Array.from({ length: 40 }, (_, i) => `src/long${i}.ts`),
          },
          {
            name: 'Dead code',
            score: 2,
            max: 4,
            summary: '',
            issuesFound: 8,
            locations: Array.from({ length: 8 }, (_, i) => `src/dead${i}.ts`),
          },
          {
            name: 'Duplication',
            score: 1,
            max: 3,
            summary: '',
            issuesFound: 333,
            locations: Array.from({ length: 25 }, (_, i) => `src/dup${i}.ts`),
          },
          { name: 'Function length', score: 4, max: 4, summary: '', issuesFound: 0 },
        ],
      },
      {
        name: 'Security',
        emoji: '🔒',
        score: 13,
        max: 15,
        summary: '',
        subcategories: [
          {
            name: 'Auth & rate limiting',
            score: 4,
            max: 6,
            summary: '',
            issuesFound: 1,
            locations: ['src/auth.ts'],
          },
          { name: 'Input validation', score: 6, max: 6, summary: '', issuesFound: 0 },
          { name: 'Secrets & env vars', score: 3, max: 3, summary: '', issuesFound: 0 },
        ],
      },
      {
        name: 'Testing',
        emoji: '🧪',
        score: 23,
        max: 25,
        summary: '',
        subcategories: [
          { name: 'Test quality', score: 6, max: 8, summary: '', issuesFound: 0 },
          { name: 'Coverage ratio', score: 8, max: 8, summary: '', issuesFound: 0 },
          { name: 'Edge case depth', score: 9, max: 9, summary: '', issuesFound: 0 },
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
    issuesByType: [
      {
        category: 'Error Handling',
        subcategory: 'Structured logging',
        count: 97,
        description: 'console calls with logger present',
        severity: 'low',
        locations: Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`),
      },
      {
        category: 'Performance',
        subcategory: 'Console cleanup',
        count: 46,
        description: 'console.log calls in src',
        severity: 'low',
        locations: Array.from({ length: 20 }, (_, i) => `src/mod${i}.ts`),
      },
      {
        category: 'Performance',
        subcategory: 'Async patterns',
        count: 4,
        description: 'await-in-loop patterns',
        severity: 'medium',
        locations: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      },
      {
        category: 'Code Quality',
        subcategory: 'Line length',
        count: 252,
        description: 'lines >120 chars',
        severity: 'low',
        locations: Array.from({ length: 40 }, (_, i) => `src/long${i}.ts`),
      },
      {
        category: 'Code Quality',
        subcategory: 'Dead code',
        count: 8,
        description: 'dead code indicators',
        severity: 'low',
        locations: Array.from({ length: 8 }, (_, i) => `src/dead${i}.ts`),
      },
      {
        category: 'Code Quality',
        subcategory: 'Duplication',
        count: 333,
        description: 'repeated code lines',
        severity: 'medium',
        locations: Array.from({ length: 25 }, (_, i) => `src/dup${i}.ts`),
      },
      {
        category: 'Security',
        subcategory: 'Auth & rate limiting',
        count: 1,
        description: 'missing auth/security controls',
        severity: 'medium',
        locations: ['src/auth.ts'],
      },
    ],
    ...overrides,
  };
}

function makeGap(overrides: Partial<TierGap> = {}): TierGap {
  return {
    subcategory: 'Console cleanup',
    currentScore: 1,
    maxScore: 5,
    pointsAvailable: 4,
    currentCount: 46,
    issuesToNextTier: 21,
    pointsAtNextTier: 1,
    issuesToMax: 46,
    pointsAtMax: 4,
    roi: 0.07,
    roiToMax: 0.02,
    effortPerFix: 1,
    sweepable: true,
    fixInstruction: 'Remove console.log calls.',
    files: Array.from({ length: 20 }, (_, i) => `src/mod${i}.ts`),
    ...overrides,
  };
}

// ─── planTierTargets ──────────────────────────────────────────────────────────

describe('planTierTargets', () => {
  it('marks effort-1 sweepable gaps as atomic', () => {
    const scan = makeScanResult();
    const targets = planTierTargets(scan, 10);

    const consoleTarget = targets.find(t => t.gap.subcategory === 'Console cleanup');
    expect(consoleTarget).toBeDefined();
    expect(consoleTarget!.atomic).toBe(true);
  });

  it('gives atomic targets 1 click budget', () => {
    const scan = makeScanResult();
    const targets = planTierTargets(scan, 10);

    const consoleTarget = targets.find(t => t.gap.subcategory === 'Console cleanup');
    expect(consoleTarget!.clickBudget).toBe(1);
  });

  it('gives atomic targets a single batch with ALL files', () => {
    const scan = makeScanResult();
    const targets = planTierTargets(scan, 10);

    const consoleTarget = targets.find(t => t.gap.subcategory === 'Console cleanup');
    expect(consoleTarget!.batches).toHaveLength(1);
    expect(consoleTarget!.batches[0]!.length).toBe(20); // all 20 files in one batch
  });

  it('marks higher-effort gaps as non-atomic', () => {
    const scan = makeScanResult();
    const targets = planTierTargets(scan, 10);

    const asyncTarget = targets.find(t => t.gap.subcategory === 'Async patterns');
    if (asyncTarget) {
      expect(asyncTarget.atomic).toBe(false);
    }
  });

  it('spreads remaining clicks across multiple subcategories', () => {
    const scan = makeScanResult();
    const targets = planTierTargets(scan, 10);

    expect(targets.length).toBeGreaterThan(1);
    const totalBudget = targets.reduce((s, t) => s + t.clickBudget, 0);
    expect(totalBudget).toBeLessThanOrEqual(10);
  });

  it('returns empty for 0 clicks', () => {
    const scan = makeScanResult();
    expect(planTierTargets(scan, 0)).toHaveLength(0);
  });

  it('handles maxed-out scan gracefully', () => {
    const scan = makeScanResult({ total: 100 });
    for (const cat of scan.categories) {
      cat.score = cat.max;
      for (const sub of cat.subcategories) {
        sub.score = sub.max;
        sub.issuesFound = 0;
      }
    }
    expect(planTierTargets(scan, 5)).toHaveLength(0);
  });

  it('skips gaps with no files for atomic mode', () => {
    const scan = makeScanResult();
    // Remove all locations from console cleanup
    const consoleIssue = scan.issuesByType.find(i => i.subcategory === 'Console cleanup');
    if (consoleIssue) consoleIssue.locations = [];
    const consoleSub = scan.categories
      .flatMap(c => c.subcategories)
      .find(s => s.name === 'Console cleanup');
    if (consoleSub) consoleSub.locations = [];

    const targets = planTierTargets(scan, 10);
    const consoleTarget = targets.find(t => t.gap.subcategory === 'Console cleanup');
    // Should be skipped (atomic mode requires file list)
    expect(consoleTarget).toBeUndefined();
  });
});

// ─── buildAtomicSweepPrompt ───────────────────────────────────────────────────

describe('buildAtomicSweepPrompt', () => {
  it('includes exact tier target count', () => {
    const gap = makeGap();
    const prompt = buildAtomicSweepPrompt(gap, gap.files);

    // target count = 46 - 21 - 1 = 24
    expect(prompt).toContain('≤24');
  });

  it('lists all files', () => {
    const gap = makeGap();
    const prompt = buildAtomicSweepPrompt(gap, gap.files);

    for (const f of gap.files) {
      expect(prompt).toContain(f);
    }
  });

  it('emphasizes completeness over caution', () => {
    const gap = makeGap();
    const prompt = buildAtomicSweepPrompt(gap, gap.files);

    expect(prompt).toMatch(/Do NOT stop early|partial fixes do NOT cross tiers/i);
  });

  it('includes point gain in prompt', () => {
    const gap = makeGap({ pointsAtNextTier: 2 });
    const prompt = buildAtomicSweepPrompt(gap, gap.files);

    expect(prompt).toContain('+2 points');
  });

  it('includes fix instruction', () => {
    const gap = makeGap({ fixInstruction: 'Remove all console.log calls.' });
    const prompt = buildAtomicSweepPrompt(gap, gap.files);

    expect(prompt).toContain('Remove all console.log calls.');
  });
});

// ─── buildTierBatchPrompt ─────────────────────────────────────────────────────

describe('buildTierBatchPrompt', () => {
  it('includes tier context', () => {
    const gap = makeGap({ effortPerFix: 2 });
    const batchFiles = gap.files.slice(0, 5);
    const prompt = buildTierBatchPrompt(gap, batchFiles);

    expect(prompt).toContain('Console cleanup');
    expect(prompt).toContain('46'); // current count
  });

  it('only lists batch files, not all files', () => {
    const gap = makeGap();
    const batchFiles = gap.files.slice(0, 5);
    const prompt = buildTierBatchPrompt(gap, batchFiles);

    // Should have batch files
    for (const f of batchFiles) expect(prompt).toContain(f);
    // Should NOT have files outside the batch
    for (const f of gap.files.slice(5)) expect(prompt).not.toContain(f);
  });
});
