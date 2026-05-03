/**
 * engine.ts — thin re-export facade.
 *
 * All implementation has been moved to focused modules:
 *   engine-core.ts  — pure data types, stop conditions, circuit breaker, confidence gating
 *   engine-utils.ts — interfaces (EngineCallbacks, EngineRunOptions, RunState), helpers
 *   engine-run.ts   — initializeRun, per-click helpers, runEngine
 *
 * Every symbol that was previously exported from engine.ts remains accessible here.
 */

// ── engine-core ────────────────────────────────────────────────────────────
export type { CircuitBreakerState, RunEconomics, RunSummary, ClickPhase } from "./engine-core.js";

export {
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
  runConfidenceGating,
} from "./engine-core.js";

// HardenPhase is a type re-export from types.js via engine-core.ts
export type { HardenPhase } from "./engine-core.js";

// ── engine-utils ───────────────────────────────────────────────────────────
export type { EngineCallbacks, EngineRunOptions } from "./engine-utils.js";

export { preflightTestCommand } from "./engine-utils.js";

// ── engine-run ─────────────────────────────────────────────────────────────
export { runEngine } from "./engine-run.js";

// ── sub-module re-exports ──────────────────────────────────────────────────
export { nextGuardProfile, isGuardRejection } from "./engine-guards.js";
export { runArchitectEngine } from "./engine-architect.js";
export { runSweepEngine, chunk } from "./engine-sweep.js";
