/**
 * Tier-Aware Engine — fixes the "issues fixed but score doesn't move" problem.
 *
 * Root cause analysis:
 *   - Old sweep engine: 1 subcategory per run, batched in small chunks
 *   - 46 console.logs across 20 files, batched as 3 clicks × 7 files → 0 tier crossings
 *   - Every click fixes partial issues, none ever crosses a tier boundary → 0 points
 *
 * This engine:
 *   1. Ranks subcategories by ROI (points per effort unit to cross next tier)
 *   2. For effort=1 mechanical fixes (console, dead code, line breaks):
 *      → ATOMIC MODE: one click, ALL files, no line/file guards — test suite is the only gate
 *   3. For higher-effort fixes: standard batched mode with tier-aware prompts
 *   4. After each atomic commit, re-scans and checks if tier was crossed
 *   5. Moves to next highest-ROI subcategory
 *
 * Atomic mode is only used for truly mechanical changes that are:
 *   - Effort = 1 (trivial: removal, renaming, formatting)
 *   - Sweepable (doesn't require logic changes)
 *   - Have clear tier thresholds (we know exactly how many to remove)
 */

import type { RatchetRun, Target, RatchetConfig, Click } from '../types.js';
import type { Agent } from './agents/base.js';
import type { ScanResult } from '../commands/scan.js';
import type { LearningStore } from './learning.js';
import type { ClickPhase, EngineCallbacks } from './engine.js';
import type { TierGap } from './score-optimizer.js';
import { analyzeScoreGaps } from './score-optimizer.js';
import { executeClick } from './click.js';
import { runScan } from '../commands/scan.js';
import * as git from './git.js';
import { randomUUID } from 'crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Use atomic mode for effort-1 sweepable fixes */
const ATOMIC_EFFORT_THRESHOLD = 1;

/** Max files in a single atomic sweep prompt (agent context window limit) */
const MAX_ATOMIC_FILES = 40;

/** For non-atomic batches, how many files per click */
const STANDARD_BATCH_SIZE = 6;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TierTarget {
  gap: TierGap;
  /** Whether to use atomic mode (one click = all files) */
  atomic: boolean;
  /** How many clicks to allocate */
  clickBudget: number;
  /** Files per click (1 batch for atomic, split for standard) */
  batches: string[][];
}

export interface TierEngineOptions {
  target: Target;
  clicks: number;
  config: RatchetConfig;
  cwd: string;
  agent: Agent;
  createBranch?: boolean;
  adversarial?: boolean;
  scanResult?: ScanResult;
  learningStore?: LearningStore;
  callbacks?: EngineCallbacks;
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

/**
 * Atomic sweep prompt: all files, exact tier target, maximize completeness.
 * The agent must fix EVERY instance across ALL files to cross the tier boundary.
 */
export function buildAtomicSweepPrompt(gap: TierGap, allFiles: string[]): string {
  const targetCount = Math.max(0, gap.currentCount - gap.issuesToNextTier - 1);

  return `You are a code improvement assistant executing an atomic codebase-wide fix.

GOAL: Cross a scoring tier boundary.
  Subcategory: ${gap.subcategory}
  Current issue count: ${gap.currentCount} (current score: ${gap.currentScore}/${gap.maxScore})
  Target count: ≤${targetCount} (this gains +${gap.pointsAtNextTier} point${gap.pointsAtNextTier !== 1 ? 's' : ''})
  Must eliminate: at least ${gap.issuesToNextTier + 1} instances

WHAT TO FIX:
  ${gap.fixInstruction}

ALL AFFECTED FILES (fix EVERY instance in ALL of these — partial fixes do NOT cross tiers):
${allFiles.map(f => `  - ${f}`).join('\n')}

STRATEGY: This is a mechanical, repetitive fix. Go file by file. In each file:
  1. Find every instance of the issue
  2. Fix each one
  3. Move to the next file
  Do NOT stop early. Do NOT skip files. Fix every single instance.

HARD CONSTRAINTS:
  - Fix ONLY this issue type — do NOT change any other code
  - Do NOT refactor, rename, or restructure
  - Do NOT touch any logic
  - All existing tests MUST pass

After making changes, output each modified file:
MODIFIED: <filepath>`;
}

/**
 * Standard batched prompt with tier context — used for effort ≥2.
 */
export function buildTierBatchPrompt(gap: TierGap, batchFiles: string[]): string {
  const targetCount = Math.max(0, gap.currentCount - gap.issuesToNextTier - 1);

  return `You are a code improvement assistant. Fix ONE specific issue type across a batch of files.

SCORING CONTEXT:
  Subcategory: ${gap.subcategory}
  Current count across codebase: ${gap.currentCount} (score: ${gap.currentScore}/${gap.maxScore})
  Tier threshold: ≤${targetCount} instances = +${gap.pointsAtNextTier} points

WHAT TO FIX:
  ${gap.fixInstruction}

FILES IN THIS BATCH:
${batchFiles.map(f => `  - ${f}`).join('\n')}

Fix every instance of this issue in each file above.

HARD CONSTRAINTS:
  - Fix ONLY the described issue type
  - Do NOT refactor, rename, or restructure
  - Change at most 30 lines per file
  - All existing tests MUST pass

After making changes, output each modified file:
MODIFIED: <filepath>`;
}

// ─── Tier planning ────────────────────────────────────────────────────────────

/**
 * Plan which tier crossings to attempt with the available click budget.
 * Effort-1 sweepable gaps become ATOMIC (1 click, all files).
 * Higher-effort gaps get batched clicks.
 */
export function planTierTargets(scan: ScanResult, totalClicks: number): TierTarget[] {
  const gaps = analyzeScoreGaps(scan);
  if (gaps.length === 0 || totalClicks <= 0) return [];

  const targets: TierTarget[] = [];
  let remainingClicks = totalClicks;

  for (const gap of gaps) {
    if (remainingClicks <= 0) break;
    if (gap.pointsAvailable <= 0) continue;

    const isAtomic = gap.effortPerFix <= ATOMIC_EFFORT_THRESHOLD && gap.sweepable;
    const files = gap.files.slice(0, MAX_ATOMIC_FILES);

    if (isAtomic) {
      // One atomic click covers all files
      if (files.length === 0) continue; // can't do anything without file list
      targets.push({
        gap,
        atomic: true,
        clickBudget: 1,
        batches: [files], // single batch = all files
      });
      remainingClicks -= 1;
    } else {
      // Standard: batch into groups, allocate clicks
      if (files.length === 0) {
        // No file list — one speculative click
        targets.push({
          gap,
          atomic: false,
          clickBudget: 1,
          batches: [[]],
        });
        remainingClicks -= 1;
        continue;
      }

      const batches: string[][] = [];
      for (let i = 0; i < files.length; i += STANDARD_BATCH_SIZE) {
        batches.push(files.slice(i, i + STANDARD_BATCH_SIZE));
      }

      const clickBudget = Math.min(batches.length, remainingClicks);
      targets.push({
        gap,
        atomic: false,
        clickBudget,
        batches: batches.slice(0, clickBudget),
      });
      remainingClicks -= clickBudget;
    }
  }

  return targets;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export async function runTierEngine(options: TierEngineOptions): Promise<RatchetRun> {
  const { clicks, config, cwd, agent, callbacks = {}, createBranch = true, learningStore } = options;

  const run: RatchetRun = {
    id: randomUUID(),
    target: options.target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  try {
    if (createBranch) {
      if (await git.isDetachedHead(cwd)) {
        throw new Error('Git repository is in detached HEAD state.');
      }
      const branch = git.branchName(options.target.name + '-tier');
      await git.createBranch(branch, cwd);
    }

    let currentScan = options.scanResult ?? await runScan(cwd);
    await callbacks.onScanComplete?.(currentScan);
    let previousTotal = currentScan.total;

    // Plan initial tier targets
    const tierTargets = planTierTargets(currentScan, clicks);

    if (tierTargets.length === 0) {
      console.error('[ratchet] No tier crossings available');
      run.status = 'completed';
      run.finishedAt = new Date();
      await callbacks.onRunComplete?.(run);
      return run;
    }

    // Log plan
    console.error(`[ratchet] Tier engine plan (${tierTargets.length} targets, ${clicks} clicks):`);
    for (const t of tierTargets) {
      const mode = t.atomic ? '⚡ ATOMIC' : `batched×${t.clickBudget}`;
      console.error(
        `[ratchet]   ${t.gap.subcategory}: ${mode}, ${t.gap.files.length} files, ` +
        `${t.gap.currentScore}→${t.gap.currentScore + t.gap.pointsAtNextTier}/${t.gap.maxScore} ` +
        `(+${t.gap.pointsAtNextTier}pt, ROI=${t.gap.roi.toFixed(2)})`
      );
    }

    let globalClickNum = 0;

    for (const tierTarget of tierTargets) {
      const { gap, atomic, batches, clickBudget } = tierTarget;

      console.error(`[ratchet] ── ${gap.subcategory} (${atomic ? 'atomic' : 'batched'}) ──`);

      for (let bi = 0; bi < Math.min(batches.length, clickBudget); bi++) {
        globalClickNum++;
        const batchFiles = batches[bi]!;

        await callbacks.onClickStart?.(globalClickNum, clicks);

        // Build the right prompt for this mode
        const prompt = atomic
          ? buildAtomicSweepPrompt(gap, batchFiles)
          : buildTierBatchPrompt(gap, batchFiles);

        const tierTask = {
          category: gap.subcategory,
          subcategory: gap.subcategory,
          description: gap.fixInstruction,
          count: gap.currentCount,
          severity: 'high' as const,
          priority: 100,
          sweepFiles: batchFiles,
          // Pass prompt verbatim to agent via architectPrompt field
          architectPrompt: prompt,
        };

        try {
          const clickStartMs = Date.now();

          const result = await executeClick({
            clickNumber: globalClickNum,
            target: options.target,
            config,
            agent,
            cwd,
            sweepMode: true,
            atomicSweep: atomic, // bypass guards for atomic mode
            adversarial: options.adversarial,
            issues: [tierTask],
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, globalClickNum)
              : undefined,
          });

          const { click, rolled_back } = result;
          const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);

          if (rolled_back) {
            console.error(`[ratchet] ✗ click ${globalClickNum} ROLLED BACK (${elapsedSec}s) — ${gap.subcategory}`);
          } else {
            console.error(`[ratchet] ✓ click ${globalClickNum} landed (${elapsedSec}s) — ${gap.subcategory}${click.commitHash ? ` [${click.commitHash.slice(0, 7)}]` : ''}`);
          }

          // Always re-scan after a landed click to measure tier impact
          if (click.testsPassed && !rolled_back) {
            try {
              const newScan = await runScan(cwd);
              const delta = newScan.total - previousTotal;
              click.scoreAfterClick = newScan.total;
              click.issuesFixedCount = Math.max(0, currentScan.totalIssuesFound - newScan.totalIssuesFound);

              if (delta > 0) {
                console.error(`[ratchet] 🎯 Tier crossed: ${previousTotal} → ${newScan.total} (+${delta} pts)`);
              } else {
                console.error(`[ratchet] Score: ${newScan.total} (no tier crossed yet — ${newScan.totalIssuesFound} issues remaining)`);
              }

              previousTotal = newScan.total;
              currentScan = newScan;
            } catch {
              // Non-fatal
            }
          }

          run.clicks.push(click);
          await callbacks.onClickComplete?.(click, rolled_back);

          if (learningStore) {
            const elapsedMs = Date.now() - clickStartMs;
            const scoreDelta = click.scoreAfterClick != null ? click.scoreAfterClick - previousTotal : 0;
            for (const file of batchFiles.slice(0, 5)) {
              try {
                await learningStore.recordOutcome({
                  issueType: gap.subcategory,
                  filePath: file,
                  specialization: atomic ? 'atomic-tier' : 'batched-tier',
                  success: click.testsPassed && !rolled_back,
                  fixTimeMs: elapsedMs,
                  scoreDelta,
                  failureReason: rolled_back ? 'tests failed after tier sweep' : undefined,
                });
              } catch {
                // Non-fatal
              }
            }
          }
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          await callbacks.onError?.(error, globalClickNum);
        }
      }
    }

    run.status = 'completed';
  } catch (err: unknown) {
    run.status = 'failed';
    throw err;
  } finally {
    run.finishedAt = new Date();
    await callbacks.onRunComplete?.(run);
  }

  return run;
}
