import type { Click, Target, RatchetConfig, BuildResult, HardenPhase, ClickGuards } from '../types.js';
import type { Agent } from './agents/base.js';
import { createAgentContext } from './agents/base.js';
import type { IssueTask } from './issue-backlog.js';
import { runTests } from './runner.js';
import * as git from './git.js';
import type { ClickPhase } from './engine.js';
import { RedTeamAgent, detectTestFile, getOriginalCode } from './adversarial.js';
import type { RedTeamResult } from './adversarial.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { getImpact } from './gitnexus.js';
import { prevalidate } from './prevalidate.js';
import type { PrevalidateResult, PrevalidateOptions } from './prevalidate.js';

export interface ClickContext {
  clickNumber: number;
  target: Target;
  config: RatchetConfig;
  agent: Agent;
  cwd: string;
  hardenPhase?: HardenPhase;
  issues?: IssueTask[];
  adversarial?: boolean;
  sweepMode?: boolean;
  architectMode?: boolean;
  /**
   * Atomic sweep mode — one prompt, all files, no per-file/total line guards.
   * Used for effort-1 mechanical fixes (console removal, dead code, line breaks)
   * where the test suite is the only correctness gate. Bypasses file count +
   * total line guards but keeps the Pawl (rollback on test failure).
   */
  atomicSweep?: boolean;
  /** Main repo cwd for GitNexus lookups (worktrees don't have .gitnexus) */
  gitnexusCwd?: string;
  /** Execution plan from click 0 (--plan-first) — injected into agent context */
  planContext?: string;
  onPhase?: (phase: ClickPhase) => void | Promise<void>;
}

export interface ClickOutcome {
  click: Click;
  rolled_back: boolean;
  /** True if the risk gate determined this file needs swarm mode */
  requiresSwarm?: boolean;
}

/**
 * Execute a single click: analyze → propose → build → test → commit (or rollback).
 * This is the Pawl: on test failure we revert, leaving the codebase only ever better.
 */
export async function executeClick(ctx: ClickContext): Promise<ClickOutcome> {
  const { clickNumber, target, config, agent, cwd, hardenPhase, issues, onPhase } = ctx;
  const timestamp = new Date();

  // Pre-click risk gate: if file has >10 direct dependents and change is structural,
  // signal that swarm mode is required instead of single-agent
  if (!config.swarm?.enabled && !ctx.sweepMode) {
    const riskGate = checkRiskGate(target.path, ctx.gitnexusCwd ?? cwd);
    if (riskGate.requiresSwarm) {
      console.error(`[ratchet] Risk gate: ${target.path} has ${riskGate.dependentCount} dependents — escalating to swarm`);
      return {
        click: {
          number: clickNumber,
          target: target.name,
          analysis: '',
          proposal: `risk-gate: ${riskGate.dependentCount} dependents require swarm mode`,
          filesModified: [],
          testsPassed: false,
          riskScore: riskGate.riskScore,
          timestamp,
        },
        rolled_back: false,
        requiresSwarm: true,
      };
    }
  }

  // Stash current state so we can roll back if tests fail.
  // stashCreated tracks whether git actually created a stash entry — if the working tree
  // was already clean, git exits 0 but creates nothing. Popping a non-existent stash
  // would silently pop the user's prior saved work.
  const stashCreated = await git.stash(cwd, `ratchet-pre-click-${clickNumber}`);

  let analysis = '';
  let proposal = '';
  let buildResult: BuildResult = { success: false, output: '', filesModified: [] };
  let testsPassed = false;
  let commitHash: string | undefined;
  let rolledBack = false;
  let rollbackReason: string | undefined;

  try {
    // Pass GitNexus cwd to the agent so worktree agents can look up intelligence
    if (ctx.gitnexusCwd && 'gitnexusCwd' in agent) {
      (agent as { gitnexusCwd?: string }).gitnexusCwd = ctx.gitnexusCwd;
    }

    // 1. Analyze
    await onPhase?.('analyzing');
    let context = createAgentContext(target, clickNumber, hardenPhase);
    if (ctx.planContext) {
      context += '\n\n## Execution Plan\n' + ctx.planContext;
    }
    analysis = await agent.analyze(context, hardenPhase, issues);

    // 2. Propose
    await onPhase?.('proposing');
    proposal = await agent.propose(analysis, target, hardenPhase, issues);

    if (!proposal.trim()) {
      throw new Error(
        'Agent returned an empty proposal — nothing to implement.\n' +
          '  The agent may be rate-limited, misconfigured, or unresponsive.\n' +
          '  Check that the agent command works from the command line.',
      );
    }

    // 3. Build (apply code change)
    await onPhase?.('building');
    buildResult = await agent.build(proposal, cwd);

    if (!buildResult.success) {
      console.error(`[DEBUG] Build failed. Output: ${buildResult.output?.slice(0, 500)}`);
      rollbackReason = 'build failed';
      await rollback(cwd, clickNumber, stashCreated);
      rolledBack = true;
    } else {
      // Click guards: reject over-aggressive changes before running tests
      const guardResult = checkClickGuards(cwd, config.guards, ctx.sweepMode, ctx.architectMode);
      if (!guardResult.passed && !ctx.atomicSweep) {
        console.error(`[ratchet] Click ${clickNumber} REJECTED by guards: ${guardResult.reason}`);
        console.error(`[ratchet]   ${guardResult.detail}`);
        rollbackReason = guardResult.reason;
        await rollback(cwd, clickNumber, stashCreated);
        rolledBack = true;
      } else if (!guardResult.passed && ctx.atomicSweep) {
        console.error(`[ratchet] Click ${clickNumber} guard exceeded (${guardResult.reason}) — proceeding in atomic mode, test suite is the gate`);
      }

      if (!rolledBack) {
      // 3.5. Pre-commit validation (runs before tests to catch bad changes early)
      let prevalidateResult: PrevalidateResult | undefined;
      try {
        const prevalidateOpts: PrevalidateOptions = { strict: false };
        prevalidateResult = await prevalidate(cwd, config.model, prevalidateOpts);
        if (prevalidateResult.concerns.length > 0) {
          console.error(`[ratchet] Prevalidate click ${clickNumber}: confidence=${prevalidateResult.confidence.toFixed(2)}, recommendation=${prevalidateResult.recommendation}`);
          for (const concern of prevalidateResult.concerns.slice(0, 3)) {
            console.error(`[ratchet]   concern: ${concern}`);
          }
        }
      } catch {
        // Non-fatal — if prevalidation errors, proceed
      }

      if (prevalidateResult?.recommendation === 'reject') {
        console.error(`[ratchet] Click ${clickNumber} REJECTED by prevalidate (confidence=${prevalidateResult.confidence.toFixed(2)}) — rolling back without tests`);
        rollbackReason = `prevalidate rejected (confidence ${prevalidateResult.confidence.toFixed(2)})`;
        await rollback(cwd, clickNumber, stashCreated);
        rolledBack = true;
      } else if (prevalidateResult?.recommendation === 'escalate-swarm') {
        // Signal swarm escalation — tests will still run, but caller will know
        console.error(`[ratchet] Prevalidate: escalating click ${clickNumber} to swarm (confidence=${prevalidateResult.confidence.toFixed(2)})`);
      }
      } // end prevalidate block

      if (!rolledBack) {
      // 4. Test (the Pawl)
      await onPhase?.('testing');
      const testResult = await runTests({
        command: config.defaults.testCommand,
        cwd,
      });

      testsPassed = testResult.passed;

      if (!testsPassed) {
        console.error(`[DEBUG] Tests FAILED. Exit output (last 500 chars): ${testResult.output?.slice(-500)}`);
        console.error(`[DEBUG] Test error: ${testResult.error}`);
        const failingNames = extractFailingTestNames(testResult.output ?? '');
        const failMatch = testResult.output?.match(/(\d+)\s+failing/i) ?? testResult.output?.match(/(\d+)\s+failed/i);
        if (failingNames.length > 0) {
          rollbackReason = `tests failed: ${failingNames.join(', ')}`;
        } else if (failMatch) {
          rollbackReason = `${failMatch[1]} tests failed`;
        } else {
          const lastLine = testResult.output?.split('\n').filter(l => l.trim()).at(-1)?.trim().slice(0, 80);
          rollbackReason = lastLine ?? testResult.error?.slice(0, 80) ?? 'tests failed';
        }
        await rollback(cwd, clickNumber, stashCreated);
        rolledBack = true;
      } else if (config.defaults.autoCommit) {
        // 5. Commit on success
        await onPhase?.('committing');
        const message = buildCommitMessage(clickNumber, target, proposal, buildResult.filesModified);
        commitHash = await git.commit(message, cwd);
        // Drop the stash since we committed successfully (only if we created one)
        if (stashCreated) {
          await git.gitDropStash(cwd).catch(() => {});
        }

        // 6. Adversarial QA — challenge the committed change
        if (ctx.adversarial && commitHash && buildResult.filesModified.length > 0) {
          const redTeamResult = await runAdversarialChallenge(
            buildResult.filesModified,
            cwd,
            config,
          );

          if (redTeamResult?.rollbackRecommended) {
            console.error(
              `[ratchet] Red team challenge FAILED — reverting commit ${commitHash.slice(0, 7)}`,
            );
            console.error(`[ratchet] Reason: ${redTeamResult.reasoning}`);
            // Revert the commit (soft reset to undo the commit, then hard reset to undo changes)
            await git.revert(cwd).catch(() => {});
            rolledBack = true;
            testsPassed = false;
            commitHash = undefined;
          }
        }
      }
      } // end if (!rolledBack) — click guards
    }
  } catch (err: unknown) {
    // Unexpected error — roll back to be safe
    await rollback(cwd, clickNumber, stashCreated).catch(() => {});
    rolledBack = true;
    const error = err as Error;
    rollbackReason = error.message?.slice(0, 80) ?? 'unexpected error';
    buildResult = {
      success: false,
      output: error.message ?? 'Unknown error',
      filesModified: [],
      error: error.message,
    };
  }

  const click: Click = {
    number: clickNumber,
    target: target.name,
    analysis,
    proposal,
    filesModified: buildResult.filesModified,
    testsPassed,
    commitHash,
    timestamp,
    rollbackReason,
  };

  return { click, rolled_back: rolledBack };
}

/**
 * Parse test runner output to extract up to 3 failing test file names.
 * Handles Vitest, Jest, and common generic patterns.
 */
function extractFailingTestNames(output: string): string[] {
  const names: string[] = [];
  const lines = output.split('\n');

  // Vitest/Jest: "FAIL  path/to/file.test.ts" or "× path/to/file.test.ts"
  for (const line of lines) {
    const m = line.match(/(?:^|\s)(?:FAIL|×)\s+([\w./\\-]+\.(?:test|spec)\.[a-z]+)/i);
    if (m) {
      const name = m[1].split(/[/\\]/).pop() ?? m[1];
      if (!names.includes(name)) names.push(name);
      if (names.length >= 3) break;
    }
  }

  if (names.length === 0) {
    // Vitest inline: ✕ or ✗ before test name
    for (const line of lines) {
      const m = line.match(/^\s*[✕✗×]\s+(.+)$/);
      if (m) {
        const name = m[1].trim().slice(0, 60);
        if (!names.includes(name)) names.push(name);
        if (names.length >= 3) break;
      }
    }
  }

  return names;
}

interface GuardResult {
  passed: boolean;
  reason?: string;
  detail?: string;
  linesChanged?: number;
  filesChanged?: number;
}

const DEFAULT_GUARDS: ClickGuards = {
  maxLinesChanged: 40,
  maxFilesChanged: 3,
};

/**
 * Check click guards: reject over-aggressive changes before running tests.
 * Measures actual git diff to count lines and files changed.
 * In sweep mode, uses tighter per-file limits but allows more files/total lines.
 */
function checkClickGuards(cwd: string, guards?: ClickGuards, sweepMode?: boolean, architectMode?: boolean): GuardResult {
  let { maxLinesChanged, maxFilesChanged } = { ...DEFAULT_GUARDS, ...guards };
  if (architectMode) {
    maxFilesChanged = 20;
    maxLinesChanged = 500;
  } else if (sweepMode) {
    // Use config guards if set (tier engine sets larger limits for mechanical fixes),
    // otherwise use defaults
    maxFilesChanged = guards?.maxFilesChanged ?? 10;
    maxLinesChanged = guards?.maxLinesChanged ?? 120;
    // Enforce a floor for sweep: at least 10 files, 120 lines
    maxFilesChanged = Math.max(maxFilesChanged, 10);
    maxLinesChanged = Math.max(maxLinesChanged, 120);
  }

  try {
    // Count files changed
    const diffStat = execFileSync('git', ['diff', '--stat', '--cached'], { cwd, encoding: 'utf8' }).trim();
    const unstagedStat = execFileSync('git', ['diff', '--stat'], { cwd, encoding: 'utf8' }).trim();
    const combinedStat = [diffStat, unstagedStat].filter(Boolean).join('\n');

    // Count lines changed (insertions + deletions)
    const numstatStaged = execFileSync('git', ['diff', '--numstat', '--cached'], { cwd, encoding: 'utf8' }).trim();
    const numstatUnstaged = execFileSync('git', ['diff', '--numstat'], { cwd, encoding: 'utf8' }).trim();
    const allNumstat = [numstatStaged, numstatUnstaged].filter(Boolean).join('\n');

    let totalLines = 0;
    const filesSet = new Set<string>();

    for (const line of allNumstat.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const added = parseInt(parts[0], 10) || 0;
      const removed = parseInt(parts[1], 10) || 0;
      const fileLines = added + removed;
      totalLines += fileLines;
      filesSet.add(parts[2]);

      // Sweep mode: enforce per-file line limit of 120 (mechanical fixes like breaking long lines
      // or removing console.logs can legitimately touch many lines in a single file)
      if (sweepMode && fileLines > 120) {
        return {
          passed: false,
          reason: `Single file changed too many lines in sweep mode`,
          detail: `File ${parts[2]} changed ${fileLines} lines (added=${added}, removed=${removed}). Sweep mode allows at most 120 lines per file.`,
          linesChanged: totalLines,
          filesChanged: filesSet.size,
        };
      }
    }

    const filesChanged = filesSet.size;

    if (totalLines > maxLinesChanged) {
      return {
        passed: false,
        reason: `Too many lines changed: ${totalLines} > ${maxLinesChanged} max`,
        detail: `Agent changed ${totalLines} lines across ${filesChanged} file(s). This is too aggressive for a single click. The change was rolled back to prevent test failures from broad refactors.`,
        linesChanged: totalLines,
        filesChanged,
      };
    }

    if (filesChanged > maxFilesChanged) {
      return {
        passed: false,
        reason: `Too many files changed: ${filesChanged} > ${maxFilesChanged} max`,
        detail: `Agent modified ${filesChanged} files (${totalLines} lines). Clicks should be surgical — ${maxFilesChanged} files max.`,
        linesChanged: totalLines,
        filesChanged,
      };
    }

    return { passed: true, linesChanged: totalLines, filesChanged };
  } catch {
    // If git diff fails, allow the click to proceed (don't block on guard errors)
    return { passed: true };
  }
}

interface RiskGateResult {
  requiresSwarm: boolean;
  riskScore: number;
  dependentCount: number;
}

const RISK_GATE_THRESHOLD = 10; // >10 direct dependents → require swarm

/**
 * Check if a target file has too many dependents for safe single-agent editing.
 * Returns requiresSwarm=true if the file has >10 direct dependents.
 */
export function checkRiskGate(targetPath: string, cwd: string): RiskGateResult {
  try {
    const impact = getImpact(targetPath.replace(/^\.\//, ''), cwd);
    if (!impact) return { requiresSwarm: false, riskScore: 0, dependentCount: 0 };

    const dependentCount = impact.directCallers.length;
    const riskScore = Math.min(1, dependentCount / 10);

    return {
      requiresSwarm: dependentCount > RISK_GATE_THRESHOLD,
      riskScore,
      dependentCount,
    };
  } catch {
    return { requiresSwarm: false, riskScore: 0, dependentCount: 0 };
  }
}

async function rollback(cwd: string, clickNumber: number, stashCreated: boolean): Promise<void> {
  if (stashCreated) {
    try {
      await git.stashPop(cwd);
    } catch {
      // stash pop failed — fall back to hard reset
      await git.revert(cwd).catch(() => {});
    }
  } else {
    // No stash was created (tree was clean before click), use hard reset instead
    await git.revert(cwd).catch(() => {});
  }
}

function buildCommitMessage(clickNumber: number, target: Target, proposal: string, filesModified?: string[]): string {
  let subject = proposal.split('\n')[0].slice(0, 60).trim();
  // Strip leaked agent system prompts from commit messages
  if (/^You are (a |an |the )/i.test(subject)) {
    subject = filesModified?.length
      ? `Modified ${filesModified.length} file${filesModified.length > 1 ? 's' : ''}: ${filesModified.map(f => f.split('/').pop()).slice(0, 3).join(', ')}${filesModified.length > 3 ? '…' : ''}`
      : 'Applied code improvements';
  }
  return `ratchet(${target.name}): click ${clickNumber} — ${subject}`;
}

/**
 * Run adversarial challenge against the first modified file that has a matching test file.
 */
async function runAdversarialChallenge(
  filesModified: string[],
  cwd: string,
  config: RatchetConfig,
): Promise<RedTeamResult | undefined> {
  const redTeam = new RedTeamAgent({ model: config.model });

  for (const file of filesModified) {
    const testFile = await detectTestFile(file, cwd);
    if (!testFile) continue;

    const originalCode = await getOriginalCode(file, cwd);
    let newCode: string;
    try {
      newCode = await readFile(join(cwd, file), 'utf-8');
    } catch {
      continue;
    }

    return redTeam.challenge(originalCode, newCode, testFile, cwd);
  }

  // No test files found for any modified file — skip silently
  return undefined;
}
