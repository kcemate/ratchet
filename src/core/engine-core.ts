import type { ScanResult } from './scanner/index.js';
import type { CategoryDelta, ClickEconomics, RatchetRun, HardenPhase } from '../types.js';

/** Circuit breaker tracks consecutive / total failures and current strategy. */
export interface CircuitBreakerState {
  consecutiveFailures: number;
  currentStrategy: 'standard' | 'architect' | 'sweep';
  strategiesExhausted: string[];
  totalFailures: number;
  maxTotalFailures: number;
}

/**
 * Returns true when a subcategory should be soft-skipped in the click loop
 * (2+ zero-delta lands for the same subcategory) — try alternatives first,
 * but do NOT blacklist yet. Blacklist threshold is 3 zero-delta lands.
 */
export function shouldSoftSkipSubcategory(zeroDeltaLands: number): boolean {
  return zeroDeltaLands >= 2;
}

/**
 * Returns true when the total zero-delta lands across ALL subcategories
 * has reached the sweep-escalation threshold (3).
 * At this point, if the top remaining issue is sweepable, escalate to sweep mode.
 */
export function shouldEscalateOnTotalZeroDelta(totalZeroDeltaLands: number): boolean {
  return totalZeroDeltaLands >= 3;
}

/**
 * Compute per-category score deltas between two scan results.
 * Returns entries only for categories that exist in either scan.
 */
export function diffCategories(before: ScanResult, after: ScanResult): CategoryDelta[] {
  const deltas: CategoryDelta[] = [];

  // Build maps keyed by category name
  const beforeMap = new Map(before.categories.map(c => [c.name, c]));
  const afterMap = new Map(after.categories.map(c => [c.name, c]));

  // Union of all category names
  const names = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  for (const name of names) {
    const b = beforeMap.get(name);
    const a = afterMap.get(name);

    const beforeScore = b?.score ?? 0;
    const afterScore = a?.score ?? 0;
    const max = b?.max ?? a?.max ?? 0;

    const beforeIssues = b?.subcategories.reduce((sum, s) => sum + s.issuesFound, 0) ?? 0;
    const afterIssues = a?.subcategories.reduce((sum, s) => sum + s.issuesFound, 0) ?? 0;
    const issuesFixed = Math.max(0, beforeIssues - afterIssues);

    const delta = afterScore - beforeScore;
    const wastedEffort = issuesFixed > 0 && delta === 0;

    deltas.push({ category: name, before: beforeScore, max, after: afterScore, delta, issuesFixed, wastedEffort });
  }

  return deltas;
}

export interface RunEconomics {
  totalWallTimeMs: number;
  /** Sum of wall time for landed clicks only */
  effectiveTimeMs: number;
  /** Sum of wall time for rolled-back clicks */
  wastedTimeMs: number;
  /** effectiveTimeMs / totalWallTimeMs (0–1) */
  efficiency: number;
  totalCost: number;
  landed: number;
  rolledBack: number;
  timedOut: number;
  rollbackRate: number;
  timeoutRate: number;
  scoreDelta: number;
  issuesFixed: number;
  clicks: ClickEconomics[];
  recommendations: string[];
}

function partitionClicks(clicks: ClickEconomics[]) {
  const landed = clicks.filter(c => c.outcome === 'landed');
  const rolledBack = clicks.filter(c => c.outcome !== 'landed');
  const timedOut = clicks.filter(c => c.outcome === 'timeout');
  return { landed, rolledBack, timedOut };
}

/** Generate strategy recommendations from per-click economics. */
export function generateRecommendations(clicks: ClickEconomics[]): string[] {
  if (clicks.length === 0) return [];
  const total = clicks.length;
  const { rolledBack, timedOut } = partitionClicks(clicks);
  const rollbackRate = rolledBack.length / total;
  const timeoutRate = timedOut.length / total;
  const scoreDelta = clicks.reduce((sum, c) => sum + c.scoreDelta, 0);

  const recs: string[] = [];

  if (rollbackRate > 0.30) {
    recs.push(`${rolledBack.length}/${total} clicks rolled back — consider --plan-first to reduce wasted iterations`);
  }
  if (timeoutRate > 0.15) {
    recs.push(`${timedOut.length} timeout(s) detected — consider --timeout 900 for complex refactors`);
  }
  if (scoreDelta === 0 && total > 0) {
    recs.push('Score delta is zero — consider --architect --guards refactor for structural improvements');
  }

  return recs;
}

/** Aggregate per-click economics into a run-level summary. */
export function computeRunEconomics(clicks: ClickEconomics[], totalWallTimeMs: number): RunEconomics {
  const { landed, rolledBack, timedOut } = partitionClicks(clicks);

  const effectiveTimeMs = landed.reduce((sum, c) => sum + c.wallTimeMs, 0);
  const wastedTimeMs = rolledBack.reduce((sum, c) => sum + c.wallTimeMs, 0);
  const efficiency = totalWallTimeMs > 0 ? effectiveTimeMs / totalWallTimeMs : 0;
  const totalCost = clicks.reduce((sum, c) => sum + c.estimatedCost, 0);
  const scoreDelta = clicks.reduce((sum, c) => sum + c.scoreDelta, 0);
  const issuesFixed = clicks.reduce((sum, c) => sum + c.issuesFixed, 0);
  const total = clicks.length;

  return {
    totalWallTimeMs,
    effectiveTimeMs,
    wastedTimeMs,
    efficiency,
    totalCost,
    landed: landed.length,
    rolledBack: rolledBack.length,
    timedOut: timedOut.length,
    rollbackRate: total > 0 ? rolledBack.length / total : 0,
    timeoutRate: total > 0 ? timedOut.length / total : 0,
    scoreDelta,
    issuesFixed,
    clicks,
    recommendations: generateRecommendations(clicks),
  };
}

export interface RunSummary {
  id: string;
  target: string;
  totalClicks: number;
  passed: number;
  failed: number;
  commits: string[];
  duration: number;
  status: RatchetRun['status'];
}

export function summarizeRun(run: RatchetRun): RunSummary {
  const passed = run.clicks.filter((c) => c.testsPassed).length;
  const failed = run.clicks.filter((c) => !c.testsPassed).length;
  const duration = run.finishedAt
    ? run.finishedAt.getTime() - run.startedAt.getTime()
    : 0;

  return {
    id: run.id,
    target: run.target.name,
    totalClicks: run.clicks.length,
    passed,
    failed,
    commits: run.clicks.filter((c) => c.commitHash).map((c) => c.commitHash!),
    duration,
    status: run.status,
  };
}

export type ClickPhase = 'analyzing' | 'proposing' | 'building' | 'testing' | 'committing';
export type { HardenPhase };
