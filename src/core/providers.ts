// Provider integrations and external service interfaces
// This module consolidates provider-related imports and logic

export { runScan } from "../core/scanner";
export { executeClick } from "./click.js";
export { SwarmExecutor } from "./swarm.js";
export * as git from "./git.js";
export { clearCache as clearGitNexusCache, detectChanges, reindex } from "./gitnexus.js";
export { mergeResults, removeResolvedFindings } from "./normalize.js";
export { IncrementalScanner } from "./scan-cache.js";
export { resolveGuards, nextGuardProfile, isGuardRejection } from "./engine-guards.js";
export { validateScope } from "./scope.js";
export { captureBaseline } from "./test-isolation.js";
export { runPlanFirst } from "./engine-plan.js";
export { runArchitectEngine } from "./engine-architect.js";
export { runSweepEngine, chunk } from "./engine-sweep.js";
export { runDeepAnalyze } from "./analyze-react.js";
export type { ReactAnalysis } from "./analyze-react.js";
export { countTestFiles } from "./detect.js";
export { logger } from "../lib/logger.js";
export { prevalidateIssues } from "./issue-prevalidation.js";
export { familiarize, buildFamiliarizationContext } from "./familiarize.js";
export { probeRepo } from "./repo-probe.js";
export { runTests } from "./runner.js";
export { scanForProtectedPaths, logSafetyEvent } from "./safety.js";
