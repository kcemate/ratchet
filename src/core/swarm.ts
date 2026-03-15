import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { mkdirSync, existsSync, symlinkSync } from 'fs';
import type { SwarmConfig, SwarmResult, SwarmAgentResult, RatchetConfig } from '../types.js';
import type { ClickContext, ClickOutcome } from './click.js';
import { executeClick } from './click.js';
import { createSpecializedAgent } from './agents/specialized.js';
import type { Specialization } from './agents/specialized.js';
import { DEFAULT_SPECIALIZATIONS, isValidSpecialization } from './agents/specialized.js';
import { runTests } from './runner.js';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

/**
 * SwarmExecutor — runs N agents in parallel worktrees, picks the best result.
 *
 * Each agent gets its own git worktree forked from HEAD so they can make
 * changes without interfering with each other. After all agents finish,
 * we test and score each result, then apply the winning diff to the main cwd.
 */
export class SwarmExecutor {
  private readonly agentCount: number;
  private readonly specializations: Specialization[];
  private readonly parallel: boolean;
  private readonly worktreeDir: string;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.agentCount = config.agentCount ?? 3;
    this.parallel = config.parallel ?? true;
    this.worktreeDir = config.worktreeDir ?? '/tmp/ratchet-swarm';

    // Resolve specializations — validate and fall back to defaults
    const specNames = config.specializations ?? [...DEFAULT_SPECIALIZATIONS];
    const valid = specNames.filter(isValidSpecialization);
    this.specializations = valid.length > 0
      ? valid.slice(0, this.agentCount)
      : [...DEFAULT_SPECIALIZATIONS].slice(0, this.agentCount);

    // Pad with defaults if fewer specializations than agents
    while (this.specializations.length < this.agentCount) {
      const next = DEFAULT_SPECIALIZATIONS[this.specializations.length % DEFAULT_SPECIALIZATIONS.length];
      this.specializations.push(next);
    }
  }

  /**
   * Execute a swarm click: fork worktrees, run agents, pick winner, apply patch.
   */
  async execute(clickCtx: ClickContext, cwd: string): Promise<SwarmResult> {
    // Ensure worktree base dir exists
    if (!existsSync(this.worktreeDir)) {
      mkdirSync(this.worktreeDir, { recursive: true });
    }

    const worktrees: string[] = [];
    const timestamp = Date.now();

    try {
      // 1. Fork N worktrees from HEAD
      for (let i = 0; i < this.agentCount; i++) {
        const spec = this.specializations[i];
        const worktreePath = join(this.worktreeDir, `swarm-${timestamp}-${spec}-${i}`);
        const branchName = `ratchet-swarm-${timestamp}-${spec}-${i}`;

        await git(['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], cwd);

        // Symlink node_modules so test commands (vitest, jest, etc.) resolve
        const srcModules = join(cwd, 'node_modules');
        const dstModules = join(worktreePath, 'node_modules');
        if (existsSync(srcModules) && !existsSync(dstModules)) {
          symlinkSync(srcModules, dstModules, 'junction');
        }

        worktrees.push(worktreePath);
      }

      // 2. Run each agent in its worktree
      const agentTasks = this.specializations.map((spec, i) => ({
        spec,
        worktree: worktrees[i],
        index: i,
      }));

      let outcomes: Array<{ spec: Specialization; worktree: string; outcome: ClickOutcome | null; error?: string }>;

      if (this.parallel) {
        const settled = await Promise.allSettled(
          agentTasks.map((task) => this.runAgentInWorktree(task.spec, task.worktree, clickCtx)),
        );

        outcomes = settled.map((result, i) => {
          const task = agentTasks[i];
          if (result.status === 'fulfilled') {
            return { spec: task.spec, worktree: task.worktree, outcome: result.value };
          }
          return {
            spec: task.spec,
            worktree: task.worktree,
            outcome: null,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          };
        });
      } else {
        // Sequential execution
        outcomes = [];
        for (const task of agentTasks) {
          try {
            const outcome = await this.runAgentInWorktree(task.spec, task.worktree, clickCtx);
            outcomes.push({ spec: task.spec, worktree: task.worktree, outcome });
          } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err);
            outcomes.push({ spec: task.spec, worktree: task.worktree, outcome: null, error });
          }
        }
      }

      // 3. Score each successful outcome
      const allResults: SwarmAgentResult[] = [];

      for (const entry of outcomes) {
        if (!entry.outcome || entry.outcome.rolled_back) {
          allResults.push({
            agentName: `swarm-${entry.spec}`,
            specialization: entry.spec,
            outcome: entry.outcome ?? {
              click: {
                number: clickCtx.clickNumber,
                target: clickCtx.target.name,
                analysis: '',
                proposal: '',
                filesModified: [],
                testsPassed: false,
                timestamp: new Date(),
              },
              rolled_back: true,
            },
            scoreDelta: 0,
            worktreePath: entry.worktree,
          });
          continue;
        }

        // Score this worktree
        let scoreDelta = 0;
        try {
          const scan = await runScan(entry.worktree);
          // Compare against a baseline scan of the original cwd
          const baselineScan = await runScan(cwd);
          scoreDelta = scan.total - baselineScan.total;
        } catch {
          // If scoring fails, treat as 0 delta (still valid if tests passed)
        }

        allResults.push({
          agentName: `swarm-${entry.spec}`,
          specialization: entry.spec,
          outcome: entry.outcome,
          scoreDelta,
          worktreePath: entry.worktree,
        });
      }

      // 4. Pick winner — highest score delta among non-rolled-back results
      const candidates = allResults.filter((r) => !r.outcome.rolled_back && r.outcome.click.testsPassed);

      let winner: SwarmAgentResult | null = null;
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.scoreDelta - a.scoreDelta);
        winner = candidates[0];
      }

      // 5. Apply winning diff to main cwd
      if (winner) {
        await this.applyWinnerToMain(winner.worktreePath, cwd);
      }

      return {
        winner: winner ? winner.outcome : null,
        allResults,
        timedOut: false,
      };
    } finally {
      // 6. Cleanup worktrees — always, even on failure
      await this.cleanupWorktrees(worktrees, cwd);
    }
  }

  /**
   * Run a single specialized agent in a worktree.
   */
  private async runAgentInWorktree(
    spec: Specialization,
    worktreePath: string,
    clickCtx: ClickContext,
  ): Promise<ClickOutcome> {
    const agent = createSpecializedAgent(spec, {
      model: clickCtx.config.model,
    });

    return executeClick({
      ...clickCtx,
      agent,
      cwd: worktreePath,
      // Don't auto-commit in worktrees — we apply the winning diff to main
      config: {
        ...clickCtx.config,
        defaults: {
          ...clickCtx.config.defaults,
          autoCommit: false,
        },
      },
    });
  }

  /**
   * Apply the winning agent's changes from its worktree to the main cwd.
   * Uses git diff + git apply for a clean patch transfer.
   */
  private async applyWinnerToMain(winnerWorktree: string, mainCwd: string): Promise<void> {
    // Generate a diff of all changes in the worktree vs its HEAD
    const diff = await git(['diff', 'HEAD'], winnerWorktree);

    if (!diff) {
      return; // No changes to apply
    }

    // Apply the diff to the main working directory
    const { execFile: execFileCb } = await import('child_process');
    await new Promise<void>((resolve, reject) => {
      const child = execFileCb('git', ['apply', '--3way', '-'], { cwd: mainCwd }, (err) => {
        if (err) reject(err);
        else resolve();
      });
      child.stdin?.write(diff);
      child.stdin?.end();
    });
  }

  /**
   * Remove all worktrees and their temp branches. Best-effort — never throws.
   */
  private async cleanupWorktrees(worktrees: string[], mainCwd: string): Promise<void> {
    for (const wt of worktrees) {
      try {
        // Get the branch name before removing the worktree
        let branchName: string | undefined;
        try {
          branchName = await git(['rev-parse', '--abbrev-ref', 'HEAD'], wt);
        } catch {
          // Worktree may already be gone
        }

        await git(['worktree', 'remove', '--force', wt], mainCwd);

        // Clean up the temp branch
        if (branchName && branchName.startsWith('ratchet-swarm-')) {
          await git(['branch', '-D', branchName], mainCwd).catch(() => {});
        }
      } catch {
        // Best-effort cleanup — log but don't throw
        try {
          // Force remove if the worktree is in a bad state
          const { rmSync } = await import('fs');
          rmSync(wt, { recursive: true, force: true });
          await git(['worktree', 'prune'], mainCwd).catch(() => {});
        } catch {
          // Truly best-effort
        }
      }
    }
  }
}

/**
 * Build a SwarmConfig from CLI flags, filling in defaults.
 */
export function buildSwarmConfig(opts: {
  swarm?: boolean;
  agents?: number;
  focus?: string[];
}): SwarmConfig | undefined {
  if (!opts.swarm) return undefined;

  return {
    enabled: true,
    agentCount: opts.agents ?? 3,
    specializations: opts.focus ?? [...DEFAULT_SPECIALIZATIONS],
    parallel: true,
    worktreeDir: '/tmp/ratchet-swarm',
  };
}
