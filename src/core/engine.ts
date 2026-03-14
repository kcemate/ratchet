import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';
import type { RatchetRun, Target, RatchetConfig, Click, HardenPhase } from '../types.js';
import type { Agent } from './agents/base.js';
import type { IssueTask } from './issue-backlog.js';
import { buildBacklog, groupBacklogBySubcategory } from './issue-backlog.js';
import { executeClick } from './click.js';
import * as git from './git.js';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';

export type ClickPhase = 'analyzing' | 'proposing' | 'building' | 'testing' | 'committing';
export type { HardenPhase };

export interface EngineCallbacks {
  onClickStart?: (clickNumber: number, total: number, hardenPhase?: HardenPhase) => Promise<void> | void;
  onClickPhase?: (phase: ClickPhase, clickNumber: number) => Promise<void> | void;
  onClickComplete?: (click: Click, rolledBack: boolean) => Promise<void> | void;
  onRunComplete?: (run: RatchetRun) => Promise<void> | void;
  onError?: (err: Error, clickNumber: number) => Promise<void> | void;
  onScanComplete?: (scan: ScanResult) => Promise<void> | void;
  onClickScoreUpdate?: (clickNumber: number, scoreBefore: number, scoreAfter: number, delta: number) => Promise<void> | void;
}

export interface EngineRunOptions {
  target: Target;
  clicks: number;
  config: RatchetConfig;
  cwd: string;
  agent: Agent;
  createBranch?: boolean;
  hardenMode?: boolean;
  callbacks?: EngineCallbacks;
  /** If provided, skip the initial scan and use this result instead */
  scanResult?: ScanResult;
}

const TEST_FILE_PATTERNS = [
  /\.test\.[a-z]+$/i,
  /\.spec\.[a-z]+$/i,
  /^test_.*\.[a-z]+$/i,
  /.*_test\.[a-z]+$/i,
];

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache']);

function countTestFiles(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          count += countTestFiles(join(dir, entry.name));
        }
      } else if (TEST_FILE_PATTERNS.some((p) => p.test(entry.name))) {
        count++;
      }
    }
  } catch {
    // ignore permission errors
  }
  return count;
}

/**
 * The Click Loop Engine.
 * Runs N clicks sequentially on a target, applying the Pawl (rollback on failure).
 *
 * Scan-driven: at the start, runs a scan to get the current score and build an issue backlog.
 * Each click is given specific issues to fix (compound click). After each successful click,
 * re-scans to measure progress and update the backlog.
 */
export async function runEngine(options: EngineRunOptions): Promise<RatchetRun> {
  const { target, clicks, config, cwd, agent, createBranch = true, hardenMode = false, callbacks = {}, scanResult: providedScan } = options;

  const run: RatchetRun = {
    id: randomUUID(),
    target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  // Guard: detached HEAD means the user checked out a commit hash or tag directly.
  // Ratchet can still run, but it's likely unintentional — emit a clear error.
  if (await git.isDetachedHead(cwd)) {
    throw new Error(
      'Git repository is in detached HEAD state.\n' +
        '  Ratchet requires a named branch to track changes safely.\n' +
        '  Fix: git checkout -b my-branch',
    );
  }

  // Create a ratchet branch
  if (createBranch) {
    const branch = git.branchName(target.name);
    await git.createBranch(branch, cwd);
  }

  // --- Scan-driven: get initial scan and build issue backlog ---
  let currentScan: ScanResult | undefined = providedScan;
  let backlogGroups: IssueTask[][] = [];
  let previousTotal = 0;

  if (!currentScan) {
    try {
      currentScan = await runScan(cwd);
    } catch {
      // Non-fatal — fall back to blind-click mode
    }
  }

  if (currentScan) {
    await callbacks.onScanComplete?.(currentScan);
    previousTotal = currentScan.total;
    const backlog = buildBacklog(currentScan);
    backlogGroups = groupBacklogBySubcategory(backlog);
  }

  // Harden mode: track initial test file count to detect when tests are written
  let initialTestFileCount = 0;
  let phaseTransitioned = false;

  if (hardenMode) {
    initialTestFileCount = countTestFiles(cwd);
  }

  try {
    for (let i = 1; i <= clicks; i++) {
      // Determine harden phase for this click
      let hardenPhase: HardenPhase | undefined;
      if (hardenMode) {
        if (!phaseTransitioned && i <= 3) {
          hardenPhase = 'harden:tests';
        } else {
          hardenPhase = 'improve';
        }
      }

      await callbacks.onClickStart?.(i, clicks, hardenPhase);

      // Pop the next group of issues from the backlog
      // In harden mode, don't use backlog (focus on test writing)
      let clickIssues: IssueTask[] | undefined;
      if (!hardenMode && backlogGroups.length > 0) {
        clickIssues = backlogGroups.shift();
      }

      try {
        const { click, rolled_back } = await executeClick({
          clickNumber: i,
          target,
          config,
          agent,
          cwd,
          hardenPhase,
          issues: clickIssues,
          onPhase: callbacks.onClickPhase
            ? (phase) => callbacks.onClickPhase!(phase, i)
            : undefined,
        });

        // After a successful click, re-scan for live scoring
        if (click.testsPassed && !rolled_back && currentScan) {
          try {
            const newScan = await runScan(cwd);
            const newTotal = newScan.total;
            const delta = newTotal - previousTotal;

            // Count how many issues were resolved
            const prevIssueCount = currentScan.totalIssuesFound;
            const newIssueCount = newScan.totalIssuesFound;
            const issuesFixedCount = Math.max(0, prevIssueCount - newIssueCount);

            click.scoreAfterClick = newTotal;
            click.issuesFixedCount = issuesFixedCount;

            await callbacks.onClickScoreUpdate?.(i, previousTotal, newTotal, delta);

            // Update backlog from fresh scan
            previousTotal = newTotal;
            currentScan = newScan;
            const newBacklog = buildBacklog(newScan);
            backlogGroups = groupBacklogBySubcategory(newBacklog);
          } catch {
            // Non-fatal — skip live scoring for this click
          }
        }

        run.clicks.push(click);
        await callbacks.onClickComplete?.(click, rolled_back);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        await callbacks.onError?.(error, i);
        // Continue with next click rather than aborting the whole run
      }

      // Harden mode: check after click 2 whether test files appeared.
      // If yes, transition to improve phase. After click 3, always transition.
      if (hardenMode && !phaseTransitioned) {
        if (i === 2) {
          const currentCount = countTestFiles(cwd);
          if (currentCount > initialTestFileCount) {
            phaseTransitioned = true;
          }
        } else if (i === 3) {
          // Force transition after 3rd test-writing click regardless of outcome
          phaseTransitioned = true;
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
