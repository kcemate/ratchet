import type { Click, Target, RatchetConfig, BuildResult, HardenPhase } from '../types.js';
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

export interface ClickContext {
  clickNumber: number;
  target: Target;
  config: RatchetConfig;
  agent: Agent;
  cwd: string;
  hardenPhase?: HardenPhase;
  issues?: IssueTask[];
  adversarial?: boolean;
  onPhase?: (phase: ClickPhase) => void | Promise<void>;
}

export interface ClickOutcome {
  click: Click;
  rolled_back: boolean;
}

/**
 * Execute a single click: analyze → propose → build → test → commit (or rollback).
 * This is the Pawl: on test failure we revert, leaving the codebase only ever better.
 */
export async function executeClick(ctx: ClickContext): Promise<ClickOutcome> {
  const { clickNumber, target, config, agent, cwd, hardenPhase, issues, onPhase } = ctx;
  const timestamp = new Date();

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

  try {
    // 1. Analyze
    await onPhase?.('analyzing');
    const context = createAgentContext(target, clickNumber, hardenPhase);
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
      await rollback(cwd, clickNumber, stashCreated);
      rolledBack = true;
    } else {
      // DEBUG: Capture git diff before testing
      try {
        const { execFileSync } = await import('child_process');
        const diff = execFileSync('git', ['diff', '--stat'], { cwd, encoding: 'utf8' });
        console.error(`[DEBUG] Files changed after build:\n${diff || '(no changes)'}`);
      } catch { /* ignore */ }

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
        await rollback(cwd, clickNumber, stashCreated);
        rolledBack = true;
      } else if (config.defaults.autoCommit) {
        // 5. Commit on success
        await onPhase?.('committing');
        const message = buildCommitMessage(clickNumber, target, proposal);
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
    }
  } catch (err: unknown) {
    // Unexpected error — roll back to be safe
    await rollback(cwd, clickNumber, stashCreated).catch(() => {});
    rolledBack = true;
    const error = err as Error;
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
  };

  return { click, rolled_back: rolledBack };
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

function buildCommitMessage(clickNumber: number, target: Target, proposal: string): string {
  // Trim proposal to first 60 chars for commit subject
  const subject = proposal.split('\n')[0].slice(0, 60).trim();
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
