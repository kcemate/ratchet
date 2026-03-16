import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';
import type { RatchetRun, Target, RatchetConfig, Click, HardenPhase } from '../types.js';
import type { Agent } from './agents/base.js';
import type { IssueTask } from './issue-backlog.js';
import { buildBacklog, groupBacklogBySubcategory, enrichBacklogWithRisk, groupByDependencyCluster } from './issue-backlog.js';
import { buildScoreOptimizedBacklog } from './score-optimizer.js';
import { buildArchitectPrompt } from './agents/shell.js';
import { executeClick } from './click.js';
import { SwarmExecutor } from './swarm.js';
import * as git from './git.js';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';
import type { LearningStore } from './learning.js';
import { clearCache as clearGitNexusCache } from './gitnexus.js';
import { IncrementalScanner } from './scan-cache.js';

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
  adversarial?: boolean;
  sweep?: boolean;
  callbacks?: EngineCallbacks;
  /** If provided, skip the initial scan and use this result instead */
  scanResult?: ScanResult;
  /** If provided, record outcomes for cross-run learning */
  learningStore?: LearningStore;
  /** Use score-optimized prioritization instead of severity-based (default: false) */
  scoreOptimized?: boolean;
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
  const { target, clicks, config, cwd, agent, createBranch = true, hardenMode = false, adversarial = false, callbacks = {}, scanResult: providedScan, learningStore, scoreOptimized = false } = options;

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

  // Clear GitNexus cache at the start of each run for fresh data
  clearGitNexusCache();

  // Incremental scanner — used for re-scans after each successful click
  const incrementalScanner = new IncrementalScanner(cwd);

  if (currentScan) {
    await callbacks.onScanComplete?.(currentScan);
    previousTotal = currentScan.total;
    const backlog = scoreOptimized
      ? buildScoreOptimizedBacklog(currentScan)
      : buildBacklog(currentScan);
    // Enrich backlog with blast-radius risk scores from GitNexus
    enrichBacklogWithRisk(backlog, cwd);
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
        const clickStartMs = Date.now();

        let click: Click;
        let rolled_back: boolean;

        if (config.swarm?.enabled) {
          // Swarm mode: run N agents in parallel worktrees, pick best
          const swarm = new SwarmExecutor(config.swarm, learningStore ?? options.learningStore);
          const clickCtx = {
            clickNumber: i,
            target,
            config,
            agent,
            cwd,
            hardenPhase,
            issues: clickIssues,
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, i)
              : undefined,
          };
          const swarmResult = await swarm.execute(clickCtx, cwd);

          if (swarmResult.winner) {
            click = swarmResult.winner.click;
            rolled_back = swarmResult.winner.rolled_back;
            // Attach winning specialization metadata
            const winnerAgent = swarmResult.allResults.find(
              r => !r.outcome.rolled_back && r.outcome.click.testsPassed,
            );
            if (winnerAgent) {
              click.swarmSpecialization = winnerAgent.specialization;
            }
          } else {
            // All agents failed — create a dummy failed click
            click = {
              number: i,
              target: target.name,
              analysis: '',
              proposal: 'swarm: all agents failed',
              filesModified: [],
              testsPassed: false,
              timestamp: new Date(),
            };
            rolled_back = true;
          }
        } else {
          // Normal single-agent mode
          const result = await executeClick({
            clickNumber: i,
            target,
            config,
            agent,
            cwd,
            hardenPhase,
            adversarial,
            issues: clickIssues,
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, i)
              : undefined,
          });

          // Risk gate escalation: if single-agent was blocked, retry with swarm
          if (result.requiresSwarm) {
            console.error(`[ratchet] Escalating click ${i} to swarm mode (risk gate triggered)`);
            const swarm = new SwarmExecutor({ agentCount: 3, parallel: true }, learningStore);
            const swarmResult = await swarm.execute({
              clickNumber: i, target, config, agent, cwd, hardenPhase,
              issues: clickIssues,
              onPhase: callbacks.onClickPhase
                ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, i)
                : undefined,
            }, cwd);

            if (swarmResult.winner) {
              click = swarmResult.winner.click;
              rolled_back = swarmResult.winner.rolled_back;
              click.riskScore = result.click.riskScore;
            } else {
              click = result.click;
              rolled_back = true;
            }
          } else {
            click = result.click;
            rolled_back = result.rolled_back;
          }
        }

        const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);

        if (rolled_back) {
          console.error(`[ratchet] click ${i} ROLLED BACK (${elapsedSec}s) — tests failed or build errored`);
        } else {
          console.error(`[ratchet] click ${i} LANDED (${elapsedSec}s)${click.commitHash ? ` — commit ${click.commitHash.slice(0, 7)}` : ''}`);
        }

        // After a successful click, re-scan for live scoring (incremental for speed)
        if (click.testsPassed && !rolled_back && currentScan) {
          try {
            const newScan = await incrementalScanner.incrementalScan(currentScan);
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
            const newBacklog = scoreOptimized
              ? buildScoreOptimizedBacklog(newScan)
              : buildBacklog(newScan);
            backlogGroups = groupBacklogBySubcategory(newBacklog);
          } catch {
            // Non-fatal — skip live scoring for this click
          }
        }

        run.clicks.push(click);
        await callbacks.onClickComplete?.(click, rolled_back);

        // Cross-run learning: record the outcome for future recommendations
        if (learningStore && clickIssues && clickIssues.length > 0) {
          const elapsedMs = Date.now() - clickStartMs;
          const scoreDelta = click.scoreAfterClick != null ? click.scoreAfterClick - previousTotal : 0;
          const specName = config.swarm?.enabled
            ? (config.swarm.specializations?.[0] ?? 'default')
            : 'default';
          await Promise.all(
            clickIssues.flatMap((issue) =>
              (issue.sweepFiles ?? click.filesModified).map((file) =>
                learningStore.recordOutcome({
                  issueType: issue.subcategory || issue.category,
                  filePath: file,
                  specialization: specName,
                  success: click.testsPassed && !rolled_back,
                  fixTimeMs: elapsedMs,
                  scoreDelta,
                  failureReason: rolled_back ? 'click rolled back' : undefined,
                }).catch(() => {
                  // Non-fatal — don't let learning failures break the engine
                }),
              ),
            ),
          );
        }
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

    // Diagnostic: if every click rolled back, surface a hint
    if (run.clicks.length > 0 && run.clicks.every((c) => !c.testsPassed)) {
      console.error(
        '[ratchet] All clicks rolled back. Possible causes:\n' +
        '  • Tests are failing before ratchet starts — run the test command manually to check\n' +
        '  • The agent is not making changes (check build output above)\n' +
        '  • Test suite is flaky or has a long timeout — check test output for details',
      );
    }
  } catch (err: unknown) {
    run.status = 'failed';
    throw err;
  } finally {
    run.finishedAt = new Date();
    await callbacks.onRunComplete?.(run);
  }

  return run;
}

/**
 * Architect engine: make high-leverage structural improvements that eliminate many issues at once.
 * Unlike sweep (one issue type, many files) or normal (surgical per-file), architect mode
 * targets cross-cutting concerns — extracting shared modules, consolidating duplicated logic,
 * splitting god files — with relaxed guards (up to 20 files / 500 lines per click).
 *
 * Re-scans after each successful click to measure impact and refresh the prompt.
 */
export async function runArchitectEngine(options: EngineRunOptions): Promise<RatchetRun> {
  const { clicks, config, cwd, agent, callbacks = {}, createBranch = true, learningStore } = options;

  const run: RatchetRun = {
    id: randomUUID(),
    target: options.target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  try {
    // 1. Create branch (if requested)
    if (createBranch) {
      if (await git.isDetachedHead(cwd)) {
        throw new Error('Git repository is in detached HEAD state. Ratchet requires a named branch.');
      }
      const branch = git.branchName(options.target.name + '-architect');
      await git.createBranch(branch, cwd);
    }

    // 2. Run scan (or use provided)
    const scanResult = options.scanResult ?? await runScan(cwd);
    await callbacks.onScanComplete?.(scanResult);

    // Clear GitNexus cache for fresh data
    clearGitNexusCache();

    let currentScan = scanResult;
    let previousTotal = scanResult.total;
    let architectPrompt = buildArchitectPrompt(currentScan, cwd);

    for (let i = 1; i <= clicks; i++) {
      const clickNumber = i;
      await callbacks.onClickStart?.(clickNumber, clicks);

      // Synthetic architect task — carries the pre-built prompt verbatim
      const architectTask: IssueTask = {
        category: 'architecture',
        subcategory: 'structural',
        description: 'High-leverage architectural refactoring',
        count: currentScan.totalIssuesFound,
        severity: 'high',
        priority: 100,
        architectPrompt,
      };

      try {
        const clickStartMs = Date.now();

        const result = await executeClick({
          clickNumber,
          target: options.target,
          config,
          agent,
          cwd,
          architectMode: true,
          adversarial: options.adversarial,
          issues: [architectTask],
          onPhase: callbacks.onClickPhase
            ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, clickNumber)
            : undefined,
        });

        const { click, rolled_back } = result;
        const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);

        if (rolled_back) {
          console.error(`[ratchet] architect click ${clickNumber} ROLLED BACK (${elapsedSec}s)`);
        } else {
          console.error(`[ratchet] architect click ${clickNumber} LANDED (${elapsedSec}s)${click.commitHash ? ` — commit ${click.commitHash.slice(0, 7)}` : ''}`);
        }

        // Re-scan after successful click to measure impact and refresh the prompt
        if (click.testsPassed && !rolled_back) {
          try {
            const newScan = await runScan(cwd);
            const delta = newScan.total - previousTotal;
            click.scoreAfterClick = newScan.total;
            click.issuesFixedCount = Math.max(0, currentScan.totalIssuesFound - newScan.totalIssuesFound);
            await callbacks.onClickScoreUpdate?.(clickNumber, previousTotal, newScan.total, delta);
            previousTotal = newScan.total;
            currentScan = newScan;
            // Rebuild prompt with fresh scan data for the next click
            architectPrompt = buildArchitectPrompt(currentScan, cwd);
          } catch {
            // Non-fatal
          }
        }

        run.clicks.push(click);
        await callbacks.onClickComplete?.(click, rolled_back);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        await callbacks.onError?.(error, clickNumber);
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

/**
 * Split an array into chunks of a given size.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Sweep engine: fix one issue type across the entire codebase in batches.
 * Finds the highest-priority sweepable issue and runs clicks against each batch of files.
 */
export async function runSweepEngine(options: EngineRunOptions): Promise<RatchetRun> {
  const { clicks, config, cwd, agent, callbacks = {}, createBranch = true, learningStore, scoreOptimized = false } = options;

  const run: RatchetRun = {
    id: randomUUID(),
    target: options.target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  try {
    // Create branch only if requested (when combined with architect phase, branch already exists)
    if (createBranch) {
      if (await git.isDetachedHead(cwd)) {
        throw new Error('Git repository is in detached HEAD state. Ratchet requires a named branch.');
      }
      const branch = git.branchName(options.target.name);
      await git.createBranch(branch, cwd);
    }

    // 1. Run scan
    const scanResult = options.scanResult ?? await runScan(cwd);
    await callbacks.onScanComplete?.(scanResult);

    // Clear GitNexus cache for fresh data
    clearGitNexusCache();

    // 2. Build backlog and enrich with risk scores
    // Score-optimized mode: prioritize by ROI (points per effort) instead of severity
    const backlog = scoreOptimized
      ? buildScoreOptimizedBacklog(scanResult)
      : buildBacklog(scanResult);
    enrichBacklogWithRisk(backlog, cwd);

    // 3. Filter to sweepable tasks
    const sweepable = backlog.filter(t => t.sweepFiles && t.sweepFiles.length > 0);

    if (sweepable.length === 0) {
      console.error('[ratchet] No sweepable issues found');
      run.status = 'completed';
      run.finishedAt = new Date();
      await callbacks.onRunComplete?.(run);
      return run;
    }

    // 4. Take top priority sweepable task
    const task = sweepable[0]!;
    console.error(`[ratchet] Sweep target: ${task.description} (${task.sweepFiles!.length} files)`);

    // 5. Group files by dependency cluster (tightly-coupled files together),
    // falling back to plain chunking if GitNexus is not available
    const batches = groupByDependencyCluster(task.sweepFiles!, cwd, 6);
    const clicksToRun = Math.min(clicks, batches.length);

    for (let i = 0; i < clicksToRun; i++) {
      const clickNumber = i + 1;
      const batch = batches[i]!;

      await callbacks.onClickStart?.(clickNumber, clicksToRun);

      // Create a modified task with only the current batch of files
      const batchTask = { ...task, sweepFiles: batch };

      try {
        const clickStartMs = Date.now();

        let click: Click;
        let rolled_back: boolean;

        if (config.swarm?.enabled) {
          // Swarm mode: run N agents in parallel worktrees, pick best
          const swarm = new SwarmExecutor(config.swarm, learningStore ?? options.learningStore);
          const clickCtx = {
            clickNumber,
            target: options.target,
            config,
            agent,
            cwd,
            sweepMode: true,
            issues: [batchTask],
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, clickNumber)
              : undefined,
          };
          const swarmResult = await swarm.execute(clickCtx, cwd);

          if (swarmResult.winner) {
            click = swarmResult.winner.click;
            rolled_back = swarmResult.winner.rolled_back;
            // Attach winning specialization metadata
            const winnerAgent = swarmResult.allResults.find(
              r => !r.outcome.rolled_back && r.outcome.click.testsPassed,
            );
            if (winnerAgent) {
              click.swarmSpecialization = winnerAgent.specialization;
            }
          } else {
            click = {
              number: clickNumber,
              target: options.target.name,
              analysis: '',
              proposal: 'swarm: all agents failed',
              filesModified: [],
              testsPassed: false,
              timestamp: new Date(),
            };
            rolled_back = true;
          }
        } else {
          // Normal single-agent mode
          const result = await executeClick({
            clickNumber,
            target: options.target,
            config,
            agent,
            cwd,
            sweepMode: true,
            adversarial: options.adversarial,
            issues: [batchTask],
            onPhase: callbacks.onClickPhase
              ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, clickNumber)
              : undefined,
          });
          click = result.click;
          rolled_back = result.rolled_back;
        }

        const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);
        if (rolled_back) {
          console.error(`[ratchet] sweep click ${clickNumber} ROLLED BACK (${elapsedSec}s)`);
        } else {
          console.error(`[ratchet] sweep click ${clickNumber} LANDED (${elapsedSec}s)`);
        }

        run.clicks.push(click);
        await callbacks.onClickComplete?.(click, rolled_back);

        // Cross-run learning: record sweep outcome
        if (options.learningStore) {
          const elapsedMs = Date.now() - clickStartMs;
          const specName = click.swarmSpecialization ?? 'default';
          await Promise.all(
            batch.map((file) =>
              options.learningStore!.recordOutcome({
                issueType: task.subcategory || task.category,
                filePath: file,
                specialization: specName,
                success: click.testsPassed && !rolled_back,
                fixTimeMs: elapsedMs,
                scoreDelta: 0,
                failureReason: rolled_back ? 'sweep click rolled back' : undefined,
              }).catch(() => {
                // Non-fatal
              }),
            ),
          );
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        await callbacks.onError?.(error, clickNumber);
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
