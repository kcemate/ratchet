import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { mkdirSync, existsSync, symlinkSync } from 'fs';
import type { SwarmConfig, SwarmResult, SwarmAgentResult, RatchetConfig } from '../types.js';
import type { LearningStore } from './learning.js';
import type { ClickContext, ClickOutcome } from './click.js';
import { executeClick } from './click.js';
import { createSpecializedAgent } from './agents/specialized.js';
import { toErrorMessage } from './utils.js';
import type { Specialization } from './agents/specialized.js';
import { DEFAULT_SPECIALIZATIONS, isValidSpecialization } from './agents/specialized.js';
import {
  assignPersonalities,
  getPersonality,
  buildPersonalityPrompt,
  getAllPersonalities,
} from './agents/personalities.js';
import type { AgentPersonality } from './agents/personalities.js';
import { runDebate, shouldDebate } from './swarm-debate.js';
import type { AgentProposal, DebateConfig } from './swarm-debate.js';
import {
  loadSwarmMemory,
  saveSwarmMemory,
  recordSwarmOutcome,
  recommendPersonalities,
} from './swarm-memory.js';
import { runTests } from './runner.js';
import type { ScanResult } from '../core/scanner';
import { runScan } from '../core/scanner';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);
const log = logger;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

// ─── Extended SwarmAgentResult with personality
export interface SwarmAgentResultV2 extends SwarmAgentResult {
  personality: string;
  personalityObj?: AgentPersonality;
}

/**
 * SwarmExecutor — runs N agents in parallel worktrees, picks the best result.
 *
 * Each agent gets its own git worktree forked from HEAD so they can make
 * changes without interfering with each other. After all agents finish,
 * we run a DEBATE round (judge picks winner), then apply the winning diff
 * to the main cwd. Social learning records outcomes for future runs.
 */
export class SwarmExecutor {
  private readonly agentCount: number;
  private readonly specializations: Specialization[];
  private readonly personalities: AgentPersonality[];
  private readonly parallel: boolean;
  private readonly worktreeDir: string;
  private readonly debateEnabled: boolean;
  private readonly model?: string;

  constructor(config: Partial<SwarmConfig> = {}, learningStore?: LearningStore) {
    this.agentCount = config.agentCount ?? 3;
    this.parallel = config.parallel ?? true;
    this.worktreeDir = config.worktreeDir ?? '/tmp/ratchet-swarm';
    this.debateEnabled = (config as { debate?: boolean }).debate !== false;
    this.model = (config as { model?: string }).model;

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

    // Weight toward historically-winning specializations
    if (learningStore) {
      const weights = learningStore.getSpecializationWeights();
      if (weights.size > 0) {
        this.specializations.sort((a, b) => {
          const wA = weights.get(a) ?? 1.0;
          const wB = weights.get(b) ?? 1.0;
          return wB - wA; // higher weight first
        });
      }
    }

    // Assign personalities (override from config or use intelligent defaults)
    const personalityOverrides = (config as { personalities?: string[] }).personalities;
    if (personalityOverrides && personalityOverrides.length > 0) {
      const resolved = personalityOverrides.map((name) => getPersonality(name)).filter(Boolean) as AgentPersonality[];
      this.personalities = resolved.length > 0 ? resolved : assignPersonalities(this.agentCount);
      while (this.personalities.length < this.agentCount) {
        this.personalities.push(...assignPersonalities(1));
      }
      this.personalities = this.personalities.slice(0, this.agentCount);
    } else {
      this.personalities = assignPersonalities(this.agentCount);
    }
  }

  /**
   * Execute a swarm click: fork worktrees, run agents, debate, pick winner, apply patch.
   */
  async execute(clickCtx: ClickContext, cwd: string): Promise<SwarmResult> {
    // Ensure worktree base dir exists
    if (!existsSync(this.worktreeDir)) {
      mkdirSync(this.worktreeDir, { recursive: true });
    }

    // Load swarm memory for social learning
    const memory = await loadSwarmMemory(cwd);

    // Override personality assignments from memory if we have enough history
    const recommended = recommendPersonalities(memory, this.agentCount);
    if (recommended) {
      const resolved = recommended.map((name) => getPersonality(name)).filter(Boolean) as AgentPersonality[];
      if (resolved.length === this.agentCount) {
        log.info({ personalities: recommended }, 'swarm: using memory-recommended personalities');
        // Use recommended personalities (mutation-safe copy)
        this.personalities.splice(0, this.personalities.length, ...resolved);
      }
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
        personality: this.personalities[i],
        worktree: worktrees[i],
        index: i,
      }));

      let outcomes: Array<{
        spec: Specialization;
        personality: AgentPersonality;
        worktree: string;
        outcome: ClickOutcome | null;
        error?: string;
      }>;

      if (this.parallel) {
        const settled = await Promise.allSettled(
          agentTasks.map((task) =>
            this.runAgentInWorktree(task.spec, task.personality, task.worktree, clickCtx),
          ),
        );

        outcomes = settled.map((result, i) => {
          const task = agentTasks[i];
          if (result.status === 'fulfilled') {
            return {
              spec: task.spec,
              personality: task.personality,
              worktree: task.worktree,
              outcome: result.value,
            };
          }
          return {
            spec: task.spec,
            personality: task.personality,
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
            const outcome = await this.runAgentInWorktree(
              task.spec,
              task.personality,
              task.worktree,
              clickCtx,
            );
            outcomes.push({ spec: task.spec, personality: task.personality, worktree: task.worktree, outcome });
          } catch (err: unknown) {
            const error = toErrorMessage(err);
            outcomes.push({
              spec: task.spec,
              personality: task.personality,
              worktree: task.worktree,
              outcome: null,
              error,
            });
          }
        }
      }

      // 3. Score each successful outcome
      const allResults: SwarmAgentResultV2[] = [];

      for (const entry of outcomes) {
        if (!entry.outcome || entry.outcome.rolled_back) {
          allResults.push({
            agentName: `swarm-${entry.personality.name}-${entry.spec}`,
            specialization: entry.spec,
            personality: entry.personality.name,
            personalityObj: entry.personality,
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
          const baselineScan = await runScan(cwd);
          scoreDelta = scan.total - baselineScan.total;
        } catch {
          // If scoring fails, treat as 0 delta
        }

        allResults.push({
          agentName: `swarm-${entry.personality.name}-${entry.spec}`,
          specialization: entry.spec,
          personality: entry.personality.name,
          personalityObj: entry.personality,
          outcome: entry.outcome,
          scoreDelta,
          worktreePath: entry.worktree,
        });
      }

      // 4. Pick winner — via debate or raw score
      const candidates = allResults.filter(
        (r) => !r.outcome.rolled_back && r.outcome.click.testsPassed,
      );

      let winner: SwarmAgentResultV2 | null = null;

      if (candidates.length > 0) {
        // Build proposals for potential debate
        const proposals: AgentProposal[] = candidates.map((agent) => ({
          agentName: agent.agentName,
          personality: agent.personality,
          specialization: agent.specialization,
          filesChanged: agent.outcome.click.filesModified,
          scoreDelta: agent.scoreDelta,
          summary: agent.outcome.click.proposal ?? agent.outcome.click.analysis ?? '',
          diffStats: { additions: 0, deletions: 0 }, // populated from git stats if available
        }));

        // Populate diff stats from git
        for (const proposal of proposals) {
          const agent = candidates.find((a) => a.agentName === proposal.agentName);
          if (agent) {
            try {
              const diffStat = await git(['diff', '--shortstat', 'HEAD~1', 'HEAD'], agent.worktreePath).catch(() => '');
              const addMatch = diffStat.match(/(\d+) insertion/);
              const delMatch = diffStat.match(/(\d+) deletion/);
              proposal.diffStats.additions = addMatch ? parseInt(addMatch[1], 10) : 0;
              proposal.diffStats.deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
            } catch {
              // ignore
            }
          }
        }

        if (this.debateEnabled && shouldDebate(proposals)) {
          try {
            const debateConfig: DebateConfig = {
              model: this.model,
              strategyContext: clickCtx.config.defaults ? undefined : undefined,
            };

            const debate = await runDebate(proposals, debateConfig);

            if (debate.verdict.confidence >= 0.6) {
              // Use debate winner
              winner = candidates.find((c) => c.agentName === debate.verdict.winner) ?? null;
              log.info(
                {
                  winner: debate.verdict.winner,
                  confidence: debate.verdict.confidence,
                  reasoning: debate.verdict.reasoning,
                },
                'swarm: debate verdict applied',
              );
            } else {
              // Low confidence — fall back to score-based
              log.info(
                { confidence: debate.verdict.confidence },
                'swarm: debate confidence too low, using score-based winner',
              );
              candidates.sort((a, b) => b.scoreDelta - a.scoreDelta);
              winner = candidates[0];
            }

            // Record outcome in swarm memory
            const result: SwarmResult = { winner: winner?.outcome ?? null, allResults, timedOut: false };
            const updatedMemory = recordSwarmOutcome(memory, result, debate);
            await saveSwarmMemory(cwd, updatedMemory);
          } catch (err) {
            log.warn({ err }, 'swarm: debate failed, falling back to score-based winner');
            candidates.sort((a, b) => b.scoreDelta - a.scoreDelta);
            winner = candidates[0];
          }
        } else {
          // No debate — pick by score
          candidates.sort((a, b) => b.scoreDelta - a.scoreDelta);
          winner = candidates[0];

          // Still record in memory
          const result: SwarmResult = { winner: winner?.outcome ?? null, allResults, timedOut: false };
          const updatedMemory = recordSwarmOutcome(memory, result);
          await saveSwarmMemory(cwd, updatedMemory);
        }
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
   * Run a single specialized agent with personality in a worktree.
   */
  private async runAgentInWorktree(
    spec: Specialization,
    personality: AgentPersonality,
    worktreePath: string,
    clickCtx: ClickContext,
  ): Promise<ClickOutcome> {
    const personalityPrompt = buildPersonalityPrompt(personality, spec);

    const agent = createSpecializedAgent(spec, {
      model: clickCtx.config.model,
      personalityPrompt,
    });

    return executeClick({
      ...clickCtx,
      agent,
      cwd: worktreePath,
      gitnexusCwd: clickCtx.gitnexusCwd ?? clickCtx.cwd,
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
   */
  private async applyWinnerToMain(winnerWorktree: string, mainCwd: string): Promise<void> {
    let changedFiles: string[] = [];

    try {
      const committed = await git(['diff', '--name-only', 'HEAD~1', 'HEAD'], winnerWorktree).catch(() => '');
      const unstaged = await git(['diff', '--name-only'], winnerWorktree).catch(() => '');
      const staged = await git(['diff', '--name-only', '--cached'], winnerWorktree).catch(() => '');

      changedFiles = [...new Set([
        ...committed.split('\n'),
        ...unstaged.split('\n'),
        ...staged.split('\n'),
      ])].filter(Boolean);
    } catch {
      const diff = await git(['diff', 'HEAD'], winnerWorktree).catch(() => '');
      if (!diff) return;
    }

    if (changedFiles.length === 0) {
      return;
    }

    const { copyFile } = await import('fs/promises');
    const { dirname } = await import('path');
    const { mkdirSync: mkdirSyncFn } = await import('fs');

    await Promise.all(
      changedFiles.map(async (file) => {
        const src = join(winnerWorktree, file);
        const dst = join(mainCwd, file);
        try {
          mkdirSyncFn(dirname(dst), { recursive: true });
          await copyFile(src, dst);
        } catch {
          // Skip files that don't exist in worktree (deleted files, etc.)
        }
      }),
    );
  }

  /**
   * Remove all worktrees and their temp branches. Best-effort — never throws.
   */
  private async cleanupWorktrees(worktrees: string[], mainCwd: string): Promise<void> {
    for (const wt of worktrees) {
      try {
        let branchName: string | undefined;
        try {
          branchName = await git(['rev-parse', '--abbrev-ref', 'HEAD'], wt);
        } catch {
          // Worktree may already be gone
        }

        await git(['worktree', 'remove', '--force', wt], mainCwd);

        if (branchName && branchName.startsWith('ratchet-swarm-')) {
          await git(['branch', '-D', branchName], mainCwd).catch(() => {});
        }
      } catch {
        try {
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
  debate?: boolean;
  personalities?: string[];
  model?: string;
}): SwarmConfig | undefined {
  if (!opts.swarm) return undefined;

  return {
    enabled: true,
    agentCount: opts.agents ?? 3,
    specializations: opts.focus ?? [...DEFAULT_SPECIALIZATIONS],
    parallel: true,
    worktreeDir: '/tmp/ratchet-swarm',
    // Extended fields (cast through as any to stay compatible with base SwarmConfig)
    ...({ debate: opts.debate ?? true } as object),
    ...({ personalities: opts.personalities } as object),
    ...({ model: opts.model } as object),
  } as SwarmConfig;
}
