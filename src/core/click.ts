import type { Click, Target, RatchetConfig, BuildResult } from '../types.js';
import type { Agent } from './agents/base.js';
import { createAgentContext } from './agents/base.js';
import { runTests } from './runner.js';
import * as git from './git.js';

export interface ClickContext {
  clickNumber: number;
  target: Target;
  config: RatchetConfig;
  agent: Agent;
  cwd: string;
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
  const { clickNumber, target, config, agent, cwd } = ctx;
  const timestamp = new Date();

  // Stash current state so we can roll back if tests fail
  await git.stash(cwd, `ratchet-pre-click-${clickNumber}`);

  let analysis = '';
  let proposal = '';
  let buildResult: BuildResult = { success: false, output: '', filesModified: [] };
  let testsPassed = false;
  let commitHash: string | undefined;
  let rolledBack = false;

  try {
    // 1. Analyze
    const context = createAgentContext(target, clickNumber);
    analysis = await agent.analyze(context);

    // 2. Propose
    proposal = await agent.propose(analysis, target);

    // 3. Build (apply code change)
    buildResult = await agent.build(proposal, cwd);

    if (!buildResult.success) {
      await rollback(cwd, clickNumber);
      rolledBack = true;
    } else {
      // 4. Test (the Pawl)
      const testResult = await runTests({
        command: config.defaults.testCommand,
        cwd,
      });

      testsPassed = testResult.passed;

      if (!testsPassed) {
        await rollback(cwd, clickNumber);
        rolledBack = true;
      } else if (config.defaults.autoCommit) {
        // 5. Commit on success
        const message = buildCommitMessage(clickNumber, target, proposal);
        commitHash = await git.commit(message, cwd);
        // Drop the stash since we committed successfully
        await git.gitDropStash(cwd).catch(() => {});
      }
    }
  } catch (err: unknown) {
    // Unexpected error — roll back to be safe
    await rollback(cwd, clickNumber).catch(() => {});
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

async function rollback(cwd: string, clickNumber: number): Promise<void> {
  try {
    await git.stashPop(cwd);
  } catch {
    // If stash pop fails (nothing stashed), hard reset
    await git.revert(cwd).catch(() => {});
  }
}

function buildCommitMessage(clickNumber: number, target: Target, proposal: string): string {
  // Trim proposal to first 60 chars for commit subject
  const subject = proposal.split('\n')[0].slice(0, 60).trim();
  return `ratchet(${target.name}): click ${clickNumber} — ${subject}`;
}
