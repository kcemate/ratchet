import { randomUUID } from 'crypto';
import type { RatchetRun, Target, RatchetConfig, Click } from '../types.js';
import type { Agent } from './agents/base.js';
import { executeClick } from './click.js';
import * as git from './git.js';

export interface EngineCallbacks {
  onClickStart?: (clickNumber: number, total: number) => void;
  onClickComplete?: (click: Click, rolledBack: boolean) => void;
  onRunComplete?: (run: RatchetRun) => void;
  onError?: (err: Error, clickNumber: number) => void;
}

export interface EngineRunOptions {
  target: Target;
  clicks: number;
  config: RatchetConfig;
  cwd: string;
  agent: Agent;
  createBranch?: boolean;
  callbacks?: EngineCallbacks;
}

/**
 * The Click Loop Engine.
 * Runs N clicks sequentially on a target, applying the Pawl (rollback on failure).
 */
export async function runEngine(options: EngineRunOptions): Promise<RatchetRun> {
  const { target, clicks, config, cwd, agent, createBranch = true, callbacks = {} } = options;

  const run: RatchetRun = {
    id: randomUUID(),
    target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  // Create a ratchet branch
  if (createBranch) {
    const branch = git.branchName(target.name);
    await git.createBranch(branch, cwd);
  }

  try {
    for (let i = 1; i <= clicks; i++) {
      callbacks.onClickStart?.(i, clicks);

      try {
        const { click, rolled_back } = await executeClick({
          clickNumber: i,
          target,
          config,
          agent,
          cwd,
        });

        run.clicks.push(click);
        callbacks.onClickComplete?.(click, rolled_back);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        callbacks.onError?.(error, i);
        // Continue with next click rather than aborting the whole run
      }
    }

    run.status = 'completed';
  } catch (err: unknown) {
    run.status = 'failed';
    throw err;
  } finally {
    run.finishedAt = new Date();
    callbacks.onRunComplete?.(run);
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
