import type { RatchetRun, Click } from '../types.js';
import { buildScoreOptimizedBacklog } from './score-optimizer.js';
import { enrichBacklogWithRisk, groupByDependencyCluster } from './issue-backlog.js';
import { executeClick } from './click.js';
import { SwarmExecutor } from './swarm.js';
import * as git from './git.js';
import { runScan } from '../commands/scan.js';
import { clearCache as clearGitNexusCache } from './gitnexus.js';
import { resolveGuards } from './engine-guards.js';
import type { EngineRunOptions, ClickPhase } from './engine.js';
import { createInitialRun, requireNamedBranch } from './engine-utils.js';
import { logger } from '../lib/logger.js';
import { selectModel } from '../lib/model-router.js';

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
  const { clicks, config, cwd, agent, callbacks = {}, createBranch = true, learningStore } = options;

  const run: RatchetRun = createInitialRun(options.target);

  try {
    // Create branch only if requested (when combined with architect phase, branch already exists)
    if (createBranch) {
      await requireNamedBranch(cwd);
      const branch = git.branchName(options.target.name);
      await git.createBranch(branch, cwd);
    }

    // 1. Run scan
    const scanResult = options.scanResult ?? await runScan(cwd);
    await callbacks.onScanComplete?.(scanResult);

    // Clear GitNexus cache for fresh data
    clearGitNexusCache();

    // 2. Build backlog and enrich with risk scores.
    // Sweep always uses score-optimized ordering to pick the highest-ROI subcategory first.
    const backlog = buildScoreOptimizedBacklog(scanResult);
    enrichBacklogWithRisk(backlog, cwd);

    // 3. Filter to sweepable tasks, then optionally narrow by --category
    let sweepable = backlog.filter(t => t.sweepFiles && t.sweepFiles.length > 0);

    if (options.category) {
      const cat = options.category.toLowerCase();
      const filtered = sweepable.filter(
        t => t.subcategory?.toLowerCase() === cat || t.category?.toLowerCase() === cat,
      );
      if (filtered.length > 0) {
        sweepable = filtered;
      } else {
        logger.warn(
          `[ratchet] --category "${options.category}" matched no sweepable issues — running without category filter`,
        );
      }
    }

    if (sweepable.length === 0) {
      logger.warn('[ratchet] No sweepable issues found');
      run.status = 'completed';
      run.finishedAt = new Date();
      await callbacks.onRunComplete?.(run);
      return run;
    }

    // 4. Take top priority sweepable task
    const task = sweepable[0]!;
    logger.warn(`[ratchet] Sweep target: ${task.description} (${task.sweepFiles!.length} files)`);

    // 5. Group files by dependency cluster (tightly-coupled files together),
    // falling back to plain chunking if GitNexus is not available
    const batches = groupByDependencyCluster(task.sweepFiles!, cwd, 25);
    const clicksToRun = Math.min(clicks, batches.length);

    for (let i = 0; i < clicksToRun; i++) {
      const clickNumber = i + 1;
      const batch = batches[i]!;

      await callbacks.onClickStart?.(clickNumber, clicksToRun);

      // Create a modified task with only the current batch of files
      const batchTask = { ...task, sweepFiles: batch };

      try {
        const clickStartMs = Date.now();

        // Sweep mode uses the mechanical (cheap) model tier
        const sweepConfig = { ...config, model: selectModel('mechanical', config) };

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
            resolvedGuards: resolveGuards(options.target, config, 'sweep'),
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
            config: sweepConfig,
            agent,
            cwd,
            sweepMode: true,
            resolvedGuards: resolveGuards(options.target, config, 'sweep'),
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
          logger.error({ clickNumber, elapsedSec }, 'sweep click ROLLED BACK');
        } else {
          logger.info({ clickNumber, elapsedSec }, 'sweep click LANDED');
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
