import { describe, it, expect } from 'vitest';
import {
  shouldSoftSkipSubcategory,
  shouldEscalateOnTotalZeroDelta,
  diffCategories,
  generateRecommendations,
  computeRunEconomics,
  summarizeRun,
  resolveEscalationMode,
  checkRollbackEscalation,
  checkTotalScoreRegression,
  checkTimeoutStop,
  checkBudgetStop,
  checkDiminishingReturns,
  checkPlateauStop,
  checkRegressionStop,
  getConsecutiveTrailingRollbacks,
  checkCircuitBreaker,
} from '../core/engine-core.js';
import type { CategoryDelta, ClickEconomics, RatchetRun } from '../types.js';
import type { CircuitBreakerState } from '../core/engine-core.js';
import type { ScanResult } from '../core/scanner/types.js';

// ── shouldSoftSkipSubcategory ─────────────────────────────────────────────────

describe('shouldSoftSkipSubcategory', () => {
  it('returns true when zeroDeltaLands >= 2', () => {
    expect(shouldSoftSkipSubcategory(2)).toBe(true);
    expect(shouldSoftSkipSubcategory(3)).toBe(true);
  });

  it('returns false when zeroDeltaLands < 2', () => {
    expect(shouldSoftSkipSubcategory(0)).toBe(false);
    expect(shouldSoftSkipSubcategory(1)).toBe(false);
  });
});

// ── shouldEscalateOnTotalZeroDelta ────────────────────────────────────────────

describe('shouldEscalateOnTotalZeroDelta', () => {
  it('returns true when totalZeroDeltaLands >= 3', () => {
    expect(shouldEscalateOnTotalZeroDelta(3)).toBe(true);
    expect(shouldEscalateOnTotalZeroDelta(4)).toBe(true);
  });

  it('returns false when totalZeroDeltaLands < 3', () => {
    expect(shouldEscalateOnTotalZeroDelta(0)).toBe(false);
    expect(shouldEscalateOnTotalZeroDelta(1)).toBe(false);
    expect(shouldEscalateOnTotalZeroDelta(2)).toBe(false);
  });
});

// ── diffCategories ───────────────────────────────────────────────────────────

describe('diffCategories', () => {
  const before: ScanResult = {
    projectName: 'test',
    total: 0,
    maxTotal: 100,
    totalIssuesFound: 0,
    issuesByType: [],
    categories: [
      {
        name: 'auth',
        emoji: '',
        summary: 'auth',
        score: 70,
        max: 100,
        subcategories: [
          { name: 'auth-basic', score: 0, max: 10, summary: 'auth-basic', issuesFound: 5 },
          { name: 'auth-oauth', score: 0, max: 10, summary: 'auth-oauth', issuesFound: 3 },
        ],
      },
      {
        name: 'security',
        emoji: '',
        summary: 'security',
        score: 80,
        max: 100,
        subcategories: [
          { name: 'security-cors', score: 0, max: 10, summary: 'security-cors', issuesFound: 2 },
        ],
      },
    ],
  };

  const after: ScanResult = {
    projectName: 'test',
    total: 0,
    maxTotal: 100,
    totalIssuesFound: 0,
    issuesByType: [],
    categories: [
      {
        name: 'auth',
        emoji: '',
        summary: 'auth',
        score: 85,
        max: 100,
        subcategories: [
          { name: 'auth-basic', score: 0, max: 10, summary: 'auth-basic', issuesFound: 3 }, // Fixed 2 issues (5-3)
          { name: 'auth-oauth', score: 0, max: 10, summary: 'auth-oauth', issuesFound: 2 }, // Fixed 1 issue (3-2)
        ],
      },
      {
        name: 'security',
        emoji: '',
        summary: 'security',
        score: 85,
        max: 100,
        subcategories: [
          { name: 'security-cors', score: 0, max: 10, summary: 'security-cors', issuesFound: 1 }, // Fixed 1 issue (2-1)
        ],
      },
      {
        name: 'performance',
              emoji: '',
              summary: 'performance',
        score: 60,
        max: 100,
        subcategories: [
          { name: 'performance-cache', score: 0, max: 10, summary: 'performance-cache', issuesFound: 4 },
        ],
      },
    ],
  };

  it('calculates correct deltas for existing categories', () => {
    const deltas = diffCategories(before, after);
    
    const authDelta = deltas.find(d => d.category === 'auth');
    expect(authDelta).toBeDefined();
    expect(authDelta?.delta).toBe(15); // 85 - 70
    expect(authDelta?.issuesFixed).toBe(3); // (5+3) - (3+2) = 3
    expect(authDelta?.wastedEffort).toBe(false);

    const securityDelta = deltas.find(d => d.category === 'security');
    expect(securityDelta).toBeDefined();
    expect(securityDelta?.delta).toBe(5); // 85 - 80
    expect(securityDelta?.issuesFixed).toBe(1); // 2 - 1
  });

  it('includes new categories in results', () => {
    const deltas = diffCategories(before, after);
    const performanceDelta = deltas.find(d => d.category === 'performance');
    expect(performanceDelta).toBeDefined();
    expect(performanceDelta?.before).toBe(0);
    expect(performanceDelta?.after).toBe(60);
    expect(performanceDelta?.delta).toBe(60);
  });

  it('handles categories that exist only in before scan', () => {
    const onlyBefore: ScanResult = {
      projectName: 'test',
    total: 0,
    maxTotal: 100,
    totalIssuesFound: 0,
    issuesByType: [],
    categories: [
        {
          name: 'legacy',
                emoji: '',
                summary: 'legacy',
          score: 50,
          max: 100,
          subcategories: [
            { name: 'legacy-code', score: 0, max: 20, summary: 'legacy-code', issuesFound: 10 },
          ],
        },
      ],
    };

    const emptyAfter: ScanResult = { projectName: 'test', total: 0, maxTotal: 100, totalIssuesFound: 0, categories: [], issuesByType: [] };
    const deltas = diffCategories(onlyBefore, emptyAfter);
    
    const legacyDelta = deltas.find(d => d.category === 'legacy');
    expect(legacyDelta).toBeDefined();
    expect(legacyDelta?.before).toBe(50);
    expect(legacyDelta?.after).toBe(0);
    expect(legacyDelta?.delta).toBe(-50);
    expect(legacyDelta?.issuesFixed).toBe(10);
  });

  it('identifies wasted effort when issues fixed but delta is zero', () => {
    const beforeWasted: ScanResult = {
      projectName: 'test',
    total: 0,
    maxTotal: 100,
    totalIssuesFound: 0,
    issuesByType: [],
    categories: [
        {
          name: 'test',
                emoji: '',
                summary: 'test',
          score: 75,
          max: 100,
          subcategories: [
            { name: 'test-basic', score: 0, max: 10, summary: 'test-basic', issuesFound: 5 },
          ],
        },
      ],
    };

    const afterWasted: ScanResult = {
      projectName: 'test',
    total: 0,
    maxTotal: 100,
    totalIssuesFound: 0,
    issuesByType: [],
    categories: [
        {
          name: 'test',
                emoji: '',
                summary: 'test',
          score: 75, // Same score
          max: 100,
          subcategories: [
            { name: 'test-basic', score: 0, max: 10, summary: 'test-basic', issuesFound: 2 }, // Fixed 3 issues
          ],
        },
      ],
    };

    const deltas = diffCategories(beforeWasted, afterWasted);
    const testDelta = deltas.find(d => d.category === 'test');
    expect(testDelta?.wastedEffort).toBe(true);
    expect(testDelta?.issuesFixed).toBe(3);
    expect(testDelta?.delta).toBe(0);
  });
});

// ── generateRecommendations ─────────────────────────────────────────────────

describe('generateRecommendations', () => {
  const baseClick: ClickEconomics = {
    outcome: 'landed',
    clickIndex: 0,
    agentTimeMs: 500,
    testTimeMs: 500,
    wallTimeMs: 1000,
    estimatedCost: 0.1,
    scoreDelta: 10,
    issuesFixed: 2,
  };

  it('recommends --plan-first when rollback rate > 30%', () => {
    const clicks: ClickEconomics[] = [
      { ...baseClick, outcome: 'rolled-back' },
      { ...baseClick, outcome: 'rolled-back' },
      { ...baseClick, outcome: 'rolled-back' },
      { ...baseClick, outcome: 'landed' },
    ];
    // 3/4 = 75% rollback rate
    const recs = generateRecommendations(clicks);
    expect(recs).toContain('3/4 clicks rolled back — consider --plan-first to reduce wasted iterations');
  });

  it('recommends timeout increase when timeout rate > 15%', () => {
    const clicks: ClickEconomics[] = [
      { ...baseClick, outcome: 'timeout' },
      { ...baseClick, outcome: 'timeout' },
      { ...baseClick, outcome: 'landed' },
      { ...baseClick, outcome: 'landed' },
    ];
    // 2/4 = 50% timeout rate
    const recs = generateRecommendations(clicks);
    expect(recs).toContain('2 timeout(s) detected — consider --timeout 900 for complex refactors');
  });

  it('recommends architect mode when score delta is zero', () => {
    const clicks: ClickEconomics[] = [
      { ...baseClick, scoreDelta: 0 },
      { ...baseClick, scoreDelta: 0 },
    ];
    const recs = generateRecommendations(clicks);
    expect(recs).toContain('Score delta is zero — consider --architect --guards refactor for structural improvements');
  });

  it('returns empty array when no issues detected', () => {
    const clicks: ClickEconomics[] = [
      { ...baseClick },
      { ...baseClick },
    ];
    const recs = generateRecommendations(clicks);
    expect(recs).toHaveLength(0);
  });
});

// ── computeRunEconomics ────────────────────────────────────────────────────

describe('computeRunEconomics', () => {
  const baseClick: ClickEconomics = {
    outcome: 'landed',
    clickIndex: 0,
    agentTimeMs: 500,
    testTimeMs: 500,
    wallTimeMs: 1000,
    estimatedCost: 0.1,
    scoreDelta: 10,
    issuesFixed: 2,
  };

  it('calculates correct economics for mixed outcomes', () => {
    const clicks: ClickEconomics[] = [
      { ...baseClick, outcome: 'landed',
    clickIndex: 0,
    agentTimeMs: 500,
    testTimeMs: 500, wallTimeMs: 1000 },
      { ...baseClick, outcome: 'rolled-back',
    clickIndex: 0,
    agentTimeMs: 500,
    testTimeMs: 500, wallTimeMs: 500 },
      { ...baseClick, outcome: 'timeout',
    clickIndex: 0,
    agentTimeMs: 500,
    testTimeMs: 500, wallTimeMs: 300 },
    ];

    const economics = computeRunEconomics(clicks, 1800);
    
    expect(economics.landed).toBe(1);
    expect(economics.rolledBack).toBe(2); // Both rolled-back and timeout are considered rolledBack
    expect(economics.timedOut).toBe(1);
    expect(economics.effectiveTimeMs).toBe(1000);
    expect(economics.wastedTimeMs).toBe(800); // 500 (rolled-back) + 300 (timeout)
    expect(economics.efficiency).toBeCloseTo(1000 / 1800);
    expect(economics.totalCost).toBeCloseTo(0.3);
    expect(economics.scoreDelta).toBe(30);
    expect(economics.issuesFixed).toBe(6);
  });

  it('handles empty clicks array', () => {
    const economics = computeRunEconomics([], 0);
    expect(economics.landed).toBe(0);
    expect(economics.rolledBack).toBe(0);
    expect(economics.timedOut).toBe(0);
    expect(economics.efficiency).toBe(0);
    expect(economics.totalCost).toBe(0);
  });

  it('includes recommendations in result', () => {
    const clicks: ClickEconomics[] = [
      { ...baseClick, outcome: 'rolled-back' },
      { ...baseClick, outcome: 'rolled-back' },
      { ...baseClick, outcome: 'rolled-back' },
      { ...baseClick, outcome: 'landed' },
    ];

    const economics = computeRunEconomics(clicks, 4000);
    expect(economics.recommendations).toContain('3/4 clicks rolled back — consider --plan-first to reduce wasted iterations');
  });
});

// ── summarizeRun ────────────────────────────────────────────────────────────

describe('summarizeRun', () => {
  it('correctly summarizes a completed run', () => {
    const now = new Date();
    const startedAt = new Date(now.getTime() - 3600000); // 1 hour ago
    
    const run: RatchetRun = {
      id: 'run-123',
      target: { name: 'test-repo', path: '.', description: 'Test repo' },
      clicks: [
        { number: 1, target: 'test-target', analysis: 'test', proposal: 'test', filesModified: [], timestamp: new Date(), testsPassed: true, commitHash: 'abc123' },
        { number: 1, target: 'test-target', analysis: 'test', proposal: 'test', filesModified: [], timestamp: new Date(), testsPassed: false, commitHash: undefined },
        { number: 1, target: 'test-target', analysis: 'test', proposal: 'test', filesModified: [], timestamp: new Date(), testsPassed: true, commitHash: 'def456' },
      ],
      startedAt,
      finishedAt: now,
      status: 'completed',
    };

    const summary = summarizeRun(run);
    
    expect(summary.id).toBe('run-123');
    expect(summary.target).toBe('test-repo');
    expect(summary.totalClicks).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.commits).toEqual(['abc123', 'def456']);
    expect(summary.duration).toBe(3600000);
    expect(summary.status).toBe('completed');
  });

  it('handles ongoing run without finishedAt', () => {
    const run: RatchetRun = {
      id: 'run-456',
      target: { name: 'ongoing-repo', path: '.', description: 'Ongoing repo' },
      clicks: [
        { number: 1, target: 'test-target', analysis: 'test', proposal: 'test', filesModified: [], timestamp: new Date(), testsPassed: true, commitHash: 'ghi789' },
      ],
      startedAt: new Date(),
      finishedAt: undefined,
      status: 'running',
    };

    const summary = summarizeRun(run);
    expect(summary.duration).toBe(0);
  });
});

// ── resolveEscalationMode ──────────────────────────────────────────────────

describe('resolveEscalationMode', () => {
  // Note: This function depends on isSweepable from score-optimizer
  // For testing purposes, we'll mock the behavior
  
  it('returns sweep for sweepable subcategories', () => {
    // Test with a known sweepable subcategory from the codebase
    const result = resolveEscalationMode('Coverage'); // Known sweepable from score-optimizer.ts
    expect(result).toBe('sweep');
  });

  it('returns architect for non-sweepable subcategories', () => {
    const result = resolveEscalationMode('auth-basic');
    // Assuming auth-basic is not sweepable
    expect(result).toBe('architect');
  });

  it('returns architect when subcategory is undefined', () => {
    const result = resolveEscalationMode(undefined);
    expect(result).toBe('architect');
  });
});

// ── getConsecutiveTrailingRollbacks ────────────────────────────────────────

describe('getConsecutiveTrailingRollbacks', () => {
  const createClick = (passed: boolean): any => ({ testsPassed: passed });

  it('counts consecutive rollbacks at end of array', () => {
    const clicks = [
      createClick(true),
      createClick(false),
      createClick(false),
      createClick(false),
    ];
    expect(getConsecutiveTrailingRollbacks(clicks)).toBe(3);
  });

  it('returns 0 when last click passed', () => {
    const clicks = [
      createClick(false),
      createClick(false),
      createClick(true),
    ];
    expect(getConsecutiveTrailingRollbacks(clicks)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(getConsecutiveTrailingRollbacks([])).toBe(0);
  });

  it('returns full length when all clicks rolled back', () => {
    const clicks = [
      createClick(false),
      createClick(false),
      createClick(false),
      createClick(false),
    ];
    expect(getConsecutiveTrailingRollbacks(clicks)).toBe(4);
  });
});

// ── checkCircuitBreaker ──────────────────────────────────────────────────────

describe('checkCircuitBreaker', () => {
  const baseState = {
    consecutiveFailures: 0,
    currentStrategy: 'standard' as const,
    strategiesExhausted: [] as string[],
    totalFailures: 0,
    maxTotalFailures: 5,
  };

  it('does not trigger when below thresholds', () => {
    const state = { ...baseState, consecutiveFailures: 2, totalFailures: 2 };
    const result = checkCircuitBreaker(state as any);
    expect(result.shouldEscalate).toBe(false);
    expect(result.shouldStop).toBe(false);
  });

  it('escalates from standard to architect on 3 consecutive failures', () => {
    const state = { ...baseState, consecutiveFailures: 3 };
    const result = checkCircuitBreaker(state as any);
    expect(result.shouldEscalate).toBe(true);
    expect(result.nextStrategy).toBe('architect');
    expect(result.shouldStop).toBe(false);
    expect(result.reason).toContain('standard → architect');
  });

  it('escalates from architect to sweep on 3 consecutive failures', () => {
    const state = { ...baseState, currentStrategy: 'architect', consecutiveFailures: 3 };
    const result = checkCircuitBreaker(state as any);
    expect(result.shouldEscalate).toBe(true);
    expect(result.nextStrategy).toBe('sweep');
    expect(result.shouldStop).toBe(false);
    expect(result.reason).toContain('architect → sweep');
  });

  it('stops when sweep fails with 3 consecutive failures', () => {
    const state = { ...baseState, currentStrategy: 'sweep', consecutiveFailures: 3 };
    const result = checkCircuitBreaker(state as any);
    expect(result.shouldEscalate).toBe(false);
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toContain('exhausted all strategies');
  });

  it('stops when total failures reach max limit', () => {
    const state = { ...baseState, totalFailures: 5 };
    const result = checkCircuitBreaker(state as any);
    expect(result.shouldEscalate).toBe(false);
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toContain('hard limit reached');
  });
});

// ── Stop condition helpers ──────────────────────────────────────────────────

describe('checkTimeoutStop', () => {
  it('returns stop=true when elapsed time exceeds timeout', () => {
    const startedAt = new Date(Date.now() - 61000); // 61 seconds ago
    const result = checkTimeoutStop(startedAt, 60000, 5);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toContain('Timeout reached');
  });

  it('returns stop=false when within timeout', () => {
    const startedAt = new Date(Date.now() - 30000); // 30 seconds ago
    const result = checkTimeoutStop(startedAt, 60000, 5);
    expect(result.stop).toBe(false);
  });
});

describe('checkBudgetStop', () => {
  it('returns stop=true when cumulative cost reaches budget', () => {
    const result = checkBudgetStop(100.00, 100.00);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toContain('Budget limit reached');
  });

  it('returns stop=true when cumulative cost exceeds budget', () => {
    const result = checkBudgetStop(105.00, 100.00);
    expect(result.stop).toBe(true);
  });

  it('returns stop=false when under budget', () => {
    const result = checkBudgetStop(95.00, 100.00);
    expect(result.stop).toBe(false);
  });
});

describe('checkDiminishingReturns', () => {
  it('returns stop=true when last 3 deltas are all zero with >= 3 total clicks', () => {
    const result = checkDiminishingReturns([10, 5, 0, 0, 0], 5);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toContain('diminishing returns');
  });

  it('returns stop=false when not enough total clicks', () => {
    const result = checkDiminishingReturns([0, 0], 2);
    expect(result.stop).toBe(false);
  });

  it('returns stop=false when not all last 3 deltas are zero', () => {
    const result = checkDiminishingReturns([10, 0, 5, 0, 0], 5);
    expect(result.stop).toBe(false);
  });
});

describe('checkPlateauStop', () => {
  it('returns stop=true when 3+ consecutive zero delta clicks with > 3 total clicks', () => {
    const result = checkPlateauStop(3, 5);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toContain('Score plateau');
  });

  it('returns stop=false when total clicks <= 3', () => {
    const result = checkPlateauStop(3, 3);
    expect(result.stop).toBe(false);
  });

  it('returns stop=false when consecutive zero deltas < 3', () => {
    const result = checkPlateauStop(2, 5);
    expect(result.stop).toBe(false);
  });
});

describe('checkRegressionStop', () => {
  it('returns stop=true when regression detected', () => {
    const result = checkRegressionStop(true, 'score regression 85 → 80');
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toContain('Score regression detected');
  });

  it('returns stop=false when no regression', () => {
    const result = checkRegressionStop(false);
    expect(result.stop).toBe(false);
  });

  it('includes regression details in reason when available', () => {
    const result = checkRegressionStop(true, 'score regression 90 → 85');
    expect(result.earlyStopReason).toContain('90 → 85');
  });
});