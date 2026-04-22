/**
 * Shared utility functions used by engine.ts and all specialized engine variants
 * (engine-architect, engine-feature, engine-sweep, tier-engine).
 *
 * Kept in a separate module to avoid circular imports — engine.ts re-exports
 * from engine-architect.ts and engine-sweep.ts, so helpers must live outside engine.ts.
 */

import { randomUUID } from 'crypto';
import type { RatchetRun, Target, Click, ClickGuards, ClickEconomics } from '../types.js';
import type { IssueTask } from './issue-backlog.js';
import type { ScanResult } from './scanner/index.js';
import type { LearningStore } from './learning.js';
import type { Agent } from './agents/base.js';
import type { RunEconomics, CircuitBreakerState, ClickPhase } from './engine-core.js';
import type { HardenPhase } from '../types.js';
import * as git from './git.js';
import { runTests } from './runner.js';

/**
 * Create the initial RatchetRun object for a new engine invocation.
 * All engine variants use this to avoid repeating the same 7-line initialization block.
 */
export function createInitialRun(target: Target): RatchetRun {
  return {
    id: randomUUID(),
    target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };
}

/**
 * Throw a standardized error if the git repo is in detached HEAD state.
 * Specialized engines call this before creating a branch.
 */
export async function requireNamedBranch(cwd: string): Promise<void> {
  if (await git.isDetachedHead(cwd)) {
    throw new Error('Git repository is in detached HEAD state. Ratchet requires a named branch.');
  }
}

// ── Engine interfaces ──────────────────────────────────────────────────────

export interface EngineCallbacks {
  onClickStart?: (clickNumber: number, total: number, hardenPhase?: HardenPhase) => Promise<void> | void;
  onClickPhase?: (phase: ClickPhase, clickNumber: number) => Promise<void> | void;
  onClickComplete?: (click: Click, rolledBack: boolean) => Promise<void> | void;
  onRunComplete?: (run: RatchetRun) => Promise<void> | void;
  onError?: (err: Error, clickNumber: number) => Promise<void> | void;
  onScanComplete?: (scan: ScanResult) => Promise<void> | void;
  onClickScoreUpdate?: (
    clickNumber: number, scoreBefore: number, scoreAfter: number, delta: number,
  ) => Promise<void> | void;
  onEscalate?: (reason: string) => Promise<void> | void;
  onArchitectEscalate?: (reason: string) => Promise<void> | void;
  onSweepEscalate?: (reason: string, subcategory: string) => Promise<void> | void;
  onPlanStart?: () => Promise<void> | void;
  onPlanComplete?: (plan: import('../types.js').PlanResult) => Promise<void> | void;
  onRunEconomics?: (economics: RunEconomics) => Promise<void> | void;
  /** Fires immediately after the run object is created, before any clicks run. */
  onRunInit?: (run: RatchetRun) => void;
  /** Fires after each successfully landed click (tests passed, committed). */
  onCheckpoint?: (run: RatchetRun) => Promise<void> | void;
}

export interface EngineRunOptions {
  target: Target;
  clicks: number;
  config: import('../types.js').RatchetConfig;
  cwd: string;
  agent: Agent;
  createBranch?: boolean;
  hardenMode?: boolean;
  adversarial?: boolean;
  sweep?: boolean;
  callbacks?: EngineCallbacks;
  /** If provided, skip the initial scan and use this result instead */
  scanResult?: ScanResult;
  /** If provided, record outcomes for cross-run learning */
  learningStore?: LearningStore;
  /** Use score-optimized prioritization instead of severity-based (default: false) */
  scoreOptimized?: boolean;
  /** Filter sweep to a specific issue category or subcategory (e.g. 'line-length', 'console-cleanup') */
  category?: string;
  /** Enable adaptive escalation to cross-file sweep on stall (default: true) */
  escalate?: boolean;
  /** Auto-escalate to architect mode when smart stop detects architect-only issues remain (default: true) */
  architectEscalation?: boolean;
  /** Auto-bump guard profile after consecutive guard-rejection rollbacks (default: true) */
  guardEscalation?: boolean;
  /** Offset added to click numbering (used when architect engine is called mid-run) */
  clickOffset?: number;
  /** Run a read-only planning click 0 before execution clicks (default: false) */
  planFirst?: boolean;
  /** Resolved scope file paths (absolute). When provided, clicks touching files outside this list are rolled back. */
  scope?: string[];
  /** Raw --scope argument for display purposes. */
  scopeArg?: string;
  /** Enable context pruning — inject focused issue context into agent prompts for faster clicks */
  contextPruning?: boolean;
  /** Stop the run if wall time exceeds this many milliseconds (checked between clicks). */
  timeoutMs?: number;
  /** Stop the run before the next click if cumulative estimated cost >= this value (USD). */
  budgetUsd?: number;
  /** Stop immediately when a score regression is detected (the regressing click is still rolled back). */
  stopOnRegression?: boolean;
  /** If true, skip loading and evolving strategy for this run */
  noStrategy?: boolean;
  /** Force torque to target only subcategories within this score category */
  focusCategory?: string;
  /**
   * Run a multi-turn ReACT analysis loop before the first click.
   * Reads files, queries GitNexus for blast radius, and produces a structured
   * analysis with confidence scores and risk assessment.
   */
  deepAnalyze?: boolean;
  /**
   * The Deep pre-scan result to persist across clicks.
   * When provided, postClickRescan will merge the incremental Classic rescan
   * with this result (filtered for resolved files) so Deep findings drive the
   * authoritative score throughout the run.
   */
  deepScanResult?: ScanResult;
}

/** Mutable state threaded through per-click helpers. */
export interface RunState {
  currentScan: ScanResult | undefined;
  backlogGroups: IssueTask[][];
  previousTotal: number;
  /** Score at the very beginning of this run (before any click). Used to detect net-negative runs. */
  initialTotalScore: number;
  consecutiveRollbacks: number;
  /** Snapshot of consecutiveRollbacks taken before processClickOutcome; used by postClickRescan. */
  prevConsecutiveRollbacks: number;
  consecutiveGuardRejections: number;
  totalLanded: number;
  totalRolled: number;
  scoreAtMidpoint: number | undefined;
  escalated: boolean;
  currentGuards: ClickGuards | null;
  currentGuardProfileName: string;
  allEconomics: ClickEconomics[];
  target: Target;
  /** Tracks consecutive clicks with zero score delta for plateau detection. */
  consecutiveZeroDeltaClicks: number;
  /**
   * Global diminishing-returns detector: tracks score deltas for the last 3 clicks.
   * When all 3 are zero AND totalClicks >= 3, triggers smart-stop.
   */
  recentScoreDeltas: number[];
  /** Running total of estimated cost across all clicks (USD). */
  cumulativeCost: number;
  /**
   * When true, postClickRescan will roll back any click that causes the total
   * score to drop BELOW state.initialTotalScore (net-negative run guard).
   * Default: true.
   */
  netRegressionGuardEnabled: boolean;
  /**
   * Subcategories the engine has given up on (rolled back 2+ times or 3+
   * zero-delta lands). Groups whose tasks are all blacklisted are skipped in
   * the main click loop.
   */
  blacklistedSubcategories: Set<string>;
  /** Per-subcategory rollback / zero-delta-land counters for blacklist logic. */
  subcategoryStats: Map<string, { rollbacks: number; zeroDeltaLands: number }>;
  /**
   * Persistent Deep scan result (from DeepEngine pre-scan).
   * Present only when --deep is active. Used by postClickRescan to produce an
   * authoritative merged score after each click; findings for touched files are
   * progressively filtered out as the run advances.
   */
  deepScanResult?: ScanResult;
  /** Repo context string for injection into agent prompts. */
  repoContext?: string;
  /** Circuit breaker state — tracks consecutive failures per strategy for the escalation ladder. */
  circuitBreaker: CircuitBreakerState;
}

/**
 * Format a consistent rollback message for logger.error output.
 */
export function formatRollbackMessage(
  clickNumber: number,
  reason: string | undefined,
  elapsedSec?: string,
  detail?: string,
): string {
  const timeStr = elapsedSec ? ` (${elapsedSec}s)` : '';
  const reasonStr = reason ? ` — ${reason}` : ' — tests failed or build errored';
  const detailStr = detail ? `\n  ${detail}` : '';
  return `[ratchet] click ${clickNumber} ROLLED BACK${timeStr}${reasonStr}${detailStr}`;
}

/**
 * Pre-flight check: run the configured test command once before starting clicks.
 *
 * Throws an actionable error for the most common "the agent never had a chance" failures:
 *   1. No "test" script in package.json (Missing script)
 *   2. Dependencies not installed (Cannot find module / command not found)
 *   3. Test runner binary missing on PATH
 *
 * Catching these up-front saves a wasted click cycle and gives the user a fix
 * instead of a generic "build failed" rollback message. Other failures (real
 * test failures, flakes) fall through to baseline capture and per-click handling.
 */
export async function preflightTestCommand(testCommand: string, cwd: string): Promise<void> {
  const result = await runTests({ command: testCommand, cwd, timeout: 30_000 });
  if (result.passed) return;

  const output = (result.output ?? '') + '\n' + (result.error ?? '');

  // 1. Missing test script in package.json
  const isMissingScript =
    /Missing script[:\s]/i.test(output) ||
    /npm error Missing script/i.test(output) ||
    /no test specified/i.test(output) ||
    (result.error?.includes('Missing script') ?? false);
  if (isMissingScript) {
    throw new Error(
      `No working test command — add a test script to package.json before running ratchet improve.\n` +
      `  Current command: ${testCommand}\n` +
      `  Fix: add a "test" script to package.json (e.g. "vitest run" or "jest")`,
    );
  }

  // 2. Dependencies not installed — covers npm/pnpm/yarn JS, pip Python, cargo Rust, etc.
  //    The exact phrasing varies by ecosystem; we match the high-signal phrases.
  const isMissingDeps =
    /Cannot find module/i.test(output) ||
    /MODULE_NOT_FOUND/i.test(output) ||
    /Error: Cannot find package/i.test(output) ||
    /command not found.*node_modules/i.test(output) ||
    /sh: .*: command not found/i.test(output) && /node_modules|vitest|jest|mocha/i.test(testCommand) ||
    /ModuleNotFoundError/i.test(output) ||                       // Python
    /No module named/i.test(output) ||                            // Python
    /could not find `Cargo\.lock`/i.test(output) ||              // Rust
    /go: .* no required module provides/i.test(output);          // Go
  if (isMissingDeps) {
    const installHint = detectInstallHint(testCommand, cwd);
    throw new Error(
      `Dependencies are not installed — ratchet improve needs a working test suite to gate clicks.\n` +
      `  Current command: ${testCommand}\n` +
      `  Fix: ${installHint}\n` +
      `  Then re-run "ratchet improve".`,
    );
  }

  // 3. Test runner binary itself is missing (ENOENT from runner.ts already returns a friendly
  //    message — re-throw so improve doesn't silently roll back the first click).
  const isBinaryMissing =
    /Test command not found:/i.test(output) ||
    /ENOENT/i.test(output);
  if (isBinaryMissing) {
    throw new Error(
      `Test runner not on PATH — cannot run "${testCommand}".\n` +
      `  Fix: install the test runner, or update test_command in .ratchet.yml to a binary that exists.\n` +
      `  Tip: run "${testCommand}" yourself first to confirm it works before retrying ratchet improve.`,
    );
  }

  // Otherwise: real test failures. Let baseline capture / per-click test gate handle it.
}

/**
 * Heuristic install-command suggestion based on the project's lockfile / test command.
 * Best-effort — never throws, always returns something actionable.
 */
function detectInstallHint(testCommand: string, cwd: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path');
    if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'run "pnpm install" to install dependencies';
    if (existsSync(join(cwd, 'yarn.lock'))) return 'run "yarn install" to install dependencies';
    if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) {
      return 'run "bun install" to install dependencies';
    }
    if (existsSync(join(cwd, 'package-lock.json')) || existsSync(join(cwd, 'package.json'))) {
      return 'run "npm install" to install dependencies';
    }
    if (existsSync(join(cwd, 'pyproject.toml'))) return 'run "pip install -e ." or "poetry install" to install dependencies';
    if (existsSync(join(cwd, 'requirements.txt'))) return 'run "pip install -r requirements.txt" to install dependencies';
    if (existsSync(join(cwd, 'Cargo.toml'))) return 'run "cargo build" to fetch dependencies';
    if (existsSync(join(cwd, 'go.mod'))) return 'run "go mod download" to fetch dependencies';
  } catch {
    /* ignore — fall through to generic hint */
  }
  // Fallback hint based on test command
  if (/npm/i.test(testCommand)) return 'run "npm install" to install dependencies';
  if (/pnpm/i.test(testCommand)) return 'run "pnpm install" to install dependencies';
  if (/yarn/i.test(testCommand)) return 'run "yarn install" to install dependencies';
  if (/pytest|python/i.test(testCommand)) return 'install your project dependencies (pip / poetry / uv) and try again';
  return 'install your project dependencies and try again';
}
