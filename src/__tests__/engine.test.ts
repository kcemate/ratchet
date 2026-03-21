import { describe, it, expect } from 'vitest';
import {
  diffCategories,
  generateRecommendations,
  computeRunEconomics,
  summarizeRun,
} from '../core/engine.js';
import type { ClickEconomics, Click, RatchetRun } from '../types.js';



const makeScanCategory = (name: string, score: number, max: number, subcategories: Array<{ name: string; issuesFound: number; locations?: string[] }>) => ({
  name,
  score,
  max,
  subcategories: subcategories.map(s => ({
    name: s.name,
    score: 0,
    max: 10,
    issuesFound: s.issuesFound,
    issuesDescription: s.issuesFound > 0 ? 'issues' : undefined,
    locations: s.locations ?? [],
  })),
});

const makeScanResult = (categories: ReturnType<typeof makeScanCategory>[], total: number, totalIssuesFound: number) => ({
  categories,
  total,
  totalIssuesFound,
  issuesByType: [],
});

describe('diffCategories', () => {
  it('computes delta between two scans', () => {
    const before = makeScanResult([
      makeScanCategory('Testing', 40, 100, [{ name: 'Coverage', issuesFound: 10 }]),
    ], 40, 10);

    const after = makeScanResult([
      makeScanCategory('Testing', 55, 100, [{ name: 'Coverage', issuesFound: 5 }]),
    ], 55, 5);

    const deltas = diffCategories(before as any, after as any);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta).toBe(15);
    expect(deltas[0].before).toBe(40);
    expect(deltas[0].after).toBe(55);
    expect(deltas[0].issuesFixed).toBe(5);
  });

  it('reports zero delta when scores unchanged', () => {
    const scan = makeScanResult([
      makeScanCategory('Testing', 50, 100, [{ name: 'Coverage', issuesFound: 10 }]),
    ], 50, 10);
    const deltas = diffCategories(scan as any, scan as any);
    expect(deltas[0].delta).toBe(0);
  });

  it('includes categories only in the before scan', () => {
    const before = makeScanResult([
      makeScanCategory('Testing', 40, 100, [{ name: 'Coverage', issuesFound: 5 }]),
    ], 40, 5);
    const after = makeScanResult([], 0, 0);
    const deltas = diffCategories(before as any, after as any);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].category).toBe('Testing');
    expect(deltas[0].after).toBe(0);
    expect(deltas[0].delta).toBe(-40);
  });

  it('includes categories only in the after scan', () => {
    const before = makeScanResult([], 0, 0);
    const after = makeScanResult([
      makeScanCategory('Testing', 30, 100, [{ name: 'Coverage', issuesFound: 8 }]),
    ], 30, 8);
    const deltas = diffCategories(before as any, after as any);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta).toBe(30);
  });

  it('marks wastedEffort when issues fixed but score did not increase', () => {
    const before = makeScanResult([
      makeScanCategory('Testing', 100, 100, [{ name: 'Coverage', issuesFound: 5 }]),
    ], 100, 5);
    const after = makeScanResult([
      makeScanCategory('Testing', 100, 100, [{ name: 'Coverage', issuesFound: 0 }]),
    ], 100, 0);
    const deltas = diffCategories(before as any, after as any);
    expect(deltas[0].delta).toBe(0);
    expect(deltas[0].wastedEffort).toBe(true);
  });

  it('uses max from available category', () => {
    const before = makeScanResult([
      makeScanCategory('Testing', 40, 100, [{ name: 'Coverage', issuesFound: 5 }]),
    ], 40, 5);
    const after = makeScanResult([], 0, 0);
    const deltas = diffCategories(before as any, after as any);
    expect(deltas[0].max).toBe(100);
  });

  it('handles missing subcategory data gracefully', () => {
    const before = { categories: [], total: 0, totalIssuesFound: 0, issuesByType: [] };
    const after = before;
    const deltas = diffCategories(before as any, after as any);
    expect(deltas).toHaveLength(0);
  });
});

describe('generateRecommendations', () => {
  const click = (outcome: ClickEconomics['outcome'], scoreDelta: number, wallTimeMs = 1000): ClickEconomics =>
    ({ clickIndex: 0, wallTimeMs, agentTimeMs: 500, testTimeMs: 400, estimatedCost: 0.01, outcome, rollbackReason: undefined, issuesFixed: 0, scoreDelta });

  it('returns empty array for no clicks', () => {
    expect(generateRecommendations([])).toHaveLength(0);
  });

  it('recommends --plan-first when rollback rate > 30%', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1),
      click('rolled-back', 0),
      click('rolled-back', 0),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.some(r => r.includes('--plan-first'))).toBe(true);
  });

  it('recommends --timeout when timeout rate > 15%', () => {
    const clicks: ClickEconomics[] = [
      click('timeout', 0),
      click('timeout', 0),
      click('timeout', 0),
      click('landed', 1),
      click('landed', 1),
      click('landed', 1),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.some(r => r.includes('--timeout'))).toBe(true);
  });

  it('recommends --architect when score delta is zero despite clicks', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 0),
      click('landed', 0),
      click('landed', 0),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.some(r => r.includes('--architect'))).toBe(true);
  });

  it('returns multiple recommendations when multiple problems detected', () => {
    const clicks: ClickEconomics[] = [
      click('timeout', 0),
      click('timeout', 0),
      click('rolled-back', 0),
      click('landed', 0),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.length).toBeGreaterThan(1);
  });

  it('returns empty array for healthy run', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1),
      click('landed', 2),
      click('landed', 3),
    ];
    expect(generateRecommendations(clicks)).toHaveLength(0);
  });
});

describe('computeRunEconomics', () => {
  const click = (outcome: ClickEconomics['outcome'], wallTimeMs: number, cost: number, scoreDelta: number, issuesFixed: number): ClickEconomics =>
    ({ clickIndex: 0, wallTimeMs, agentTimeMs: wallTimeMs / 2, testTimeMs: wallTimeMs / 4, estimatedCost: cost, outcome, rollbackReason: undefined, issuesFixed, scoreDelta });

  it('computes total wall time correctly', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 5, 2),
      click('landed', 2000, 0.02, 3, 1),
    ];
    const result = computeRunEconomics(clicks, 3000);
    expect(result.totalWallTimeMs).toBe(3000);
  });

  it('counts landed vs rolled back clicks', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 5, 2),
      click('rolled-back', 500, 0, 0, 0),
      click('timeout', 500, 0, 0, 0),
    ];
    const result = computeRunEconomics(clicks, 2000);
    expect(result.landed).toBe(1);
    expect(result.rolledBack).toBe(2);
    expect(result.timedOut).toBe(1);
  });

  it('computes rollback rate correctly', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 5, 2),
      click('rolled-back', 500, 0, 0, 0),
    ];
    const result = computeRunEconomics(clicks, 1500);
    expect(result.rollbackRate).toBeCloseTo(0.5, 2);
  });

  it('computes timeout rate correctly', () => {
    const clicks: ClickEconomics[] = [
      click('timeout', 1000, 0, 0, 0),
      click('timeout', 1000, 0, 0, 0),
      click('landed', 1000, 0.01, 1, 0),
    ];
    const result = computeRunEconomics(clicks, 3000);
    expect(result.timeoutRate).toBeCloseTo(2 / 3, 2);
  });

  it('computes efficiency as effective/wall time ratio', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 5, 2),   // 1000 effective
      click('rolled-back', 1000, 0, 0, 0), // 1000 wasted
    ];
    const result = computeRunEconomics(clicks, 2000);
    expect(result.efficiency).toBeCloseTo(0.5, 2);
  });

  it('sums total cost across clicks', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 5, 2),
      click('landed', 1000, 0.02, 3, 1),
    ];
    const result = computeRunEconomics(clicks, 2000);
    expect(result.totalCost).toBeCloseTo(0.03, 4);
  });

  it('sums scoreDelta across clicks', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 5, 2),
      click('landed', 1000, 0.01, 3, 1),
    ];
    const result = computeRunEconomics(clicks, 2000);
    expect(result.scoreDelta).toBe(8);
  });

  it('sums issuesFixed across clicks', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 5, 2),
      click('landed', 1000, 0.01, 3, 1),
    ];
    const result = computeRunEconomics(clicks, 2000);
    expect(result.issuesFixed).toBe(3);
  });

  it('returns 0 efficiency when totalWallTimeMs is 0', () => {
    const clicks: ClickEconomics[] = [click('landed', 0, 0, 0, 0)];
    const result = computeRunEconomics(clicks, 0);
    expect(result.efficiency).toBe(0);
  });

  it('includes recommendations from generateRecommendations', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 0, 0),
      click('rolled-back', 500, 0, 0, 0),
      click('rolled-back', 500, 0, 0, 0),
    ];
    const result = computeRunEconomics(clicks, 2000);
    expect(result.recommendations.some(r => r.includes('--plan-first'))).toBe(true);
  });

  it('wastedTimeMs sums rolled-back click times', () => {
    const clicks: ClickEconomics[] = [
      click('landed', 1000, 0.01, 5, 2),
      click('rolled-back', 500, 0, 0, 0),
      click('timeout', 300, 0, 0, 0),
    ];
    const result = computeRunEconomics(clicks, 1800);
    expect(result.wastedTimeMs).toBe(800);
    expect(result.effectiveTimeMs).toBe(1000);
  });
});

describe('summarizeRun', () => {
  const makeClick = (testsPassed: boolean, commitHash?: string): Click => ({
    number: 1,
    target: 'api',
    analysis: '',
    proposal: '',
    filesModified: [],
    testsPassed,
    commitHash,
    timestamp: new Date(),
  });

  const makeRun = (status: RatchetRun['status'], clicks: Click[], startedAt: Date, finishedAt?: Date): RatchetRun => ({
    id: 'run-123',
    target: { name: 'api', path: 'src/', description: 'api target' },
    clicks,
    startedAt,
    status,
    finishedAt,
  } as any);

  it('counts passed and failed clicks', () => {
    const run = makeRun('running', [
      makeClick(true, 'abc123'),
      makeClick(true, 'def456'),
      makeClick(false),
    ], new Date('2024-01-01'));
    const summary = summarizeRun(run);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
  });

  it('computes duration from startedAt to finishedAt', () => {
    const started = new Date('2024-01-01T10:00:00Z');
    const finished = new Date('2024-01-01T10:05:00Z');
    const run = makeRun('completed', [makeClick(true, 'abc')], started, finished);
    const summary = summarizeRun(run);
    expect(summary.duration).toBe(5 * 60 * 1000);
  });

  it('returns duration 0 when finishedAt is undefined', () => {
    const run = makeRun('running', [], new Date());
    const summary = summarizeRun(run);
    expect(summary.duration).toBe(0);
  });

  it('extracts commit hashes from landed clicks', () => {
    const run = makeRun('completed', [
      makeClick(true, 'abc123'),
      makeClick(false),
      makeClick(true, 'def456'),
    ], new Date(), new Date());
    const summary = summarizeRun(run);
    expect(summary.commits).toEqual(['abc123', 'def456']);
  });

  it('includes run id and target name', () => {
    const run = makeRun('completed', [], new Date(), new Date());
    const summary = summarizeRun(run);
    expect(summary.id).toBe('run-123');
    expect(summary.target).toBe('api');
  });

  it('includes total click count', () => {
    const run = makeRun('completed', [
      makeClick(true),
      makeClick(false),
      makeClick(true),
    ], new Date(), new Date());
    const summary = summarizeRun(run);
    expect(summary.totalClicks).toBe(3);
  });

  it('includes run status', () => {
    const run = makeRun('failed', [], new Date(), new Date());
    const summary = summarizeRun(run);
    expect(summary.status).toBe('failed');
  });
});


