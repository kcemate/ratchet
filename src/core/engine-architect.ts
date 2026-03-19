import { randomUUID } from 'crypto';
import type { RatchetRun } from '../types.js';
import type { IssueTask } from './issue-backlog.js';
import { buildArchitectPrompt } from './agents/shell.js';
import { executeClick } from './click.js';
import * as git from './git.js';
import { runScan } from '../commands/scan.js';
import { clearCache as clearGitNexusCache } from './gitnexus.js';
import { resolveGuards } from './engine-guards.js';
import type { EngineRunOptions, ClickPhase } from './engine.js';

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

    const clickOffset = options.clickOffset ?? 0;

    for (let i = 1; i <= clicks; i++) {
      const clickNumber = i + clickOffset;
      await callbacks.onClickStart?.(clickNumber, clicks + clickOffset);

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
          resolvedGuards: resolveGuards(options.target, config, 'architect'),
          adversarial: options.adversarial,
          issues: [architectTask],
          onPhase: callbacks.onClickPhase
            ? (phase: ClickPhase) => callbacks.onClickPhase!(phase, clickNumber)
            : undefined,
        });

        const { click } = result;
        let rolled_back = result.rolled_back;
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
            const newTotal = newScan.total;

            // Score regression guard: if score dropped, revert the commit
            if (newTotal < previousTotal && click.commitHash) {
              const regressionDelta = previousTotal - newTotal;
              console.error(`[ratchet] architect click ${clickNumber} ROLLED BACK — score regression: ${previousTotal} → ${newTotal} (-${regressionDelta}pts)`);
              await git.revertLastCommit(cwd).catch(() => {});
              click.testsPassed = false;
              click.rollbackReason = `score regression: ${previousTotal} → ${newTotal} (-${regressionDelta}pts)`;
              click.commitHash = undefined;
              rolled_back = true;
            } else {
              const delta = newTotal - previousTotal;
              click.scoreAfterClick = newTotal;
              click.issuesFixedCount = Math.max(0, currentScan.totalIssuesFound - newScan.totalIssuesFound);
              await callbacks.onClickScoreUpdate?.(clickNumber, previousTotal, newTotal, delta);
              previousTotal = newTotal;
              currentScan = newScan;
              // Rebuild prompt with fresh scan data for the next click
              architectPrompt = buildArchitectPrompt(currentScan, cwd);
            }
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
