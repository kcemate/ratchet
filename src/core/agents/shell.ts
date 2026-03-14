import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import type { Target, BuildResult, HardenPhase } from '../../types.js';
import type { Agent, AgentOptions } from './base.js';
import { createAgentContext } from './base.js';
import type { IssueTask } from '../issue-backlog.js';
import { formatIssuesForPrompt } from '../issue-backlog.js';

const execFileAsync = promisify(execFile);

export interface ShellAgentConfig extends AgentOptions {
  /** Command to run for analysis/proposal (defaults to: claude --print) */
  command?: string;
  /** Additional args prepended before the prompt */
  extraArgs?: string[];
}

export class ShellAgent implements Agent {
  private command: string;
  private extraArgs: string[];
  private timeout: number;

  constructor(config: ShellAgentConfig = {}) {
    this.command = config.command ?? 'claude';
    const baseArgs = config.extraArgs ?? ['--print', '--permission-mode', 'bypassPermissions'];
    // Wire up --model if provided and not already in extraArgs
    if (config.model && !baseArgs.some((a) => a.startsWith('--model'))) {
      baseArgs.push('--model', config.model);
    }
    this.extraArgs = baseArgs;
    this.timeout = config.timeout ?? 300_000; // 5 minutes
  }

  async analyze(context: string, hardenPhase?: HardenPhase, issues?: IssueTask[]): Promise<string> {
    // Shell agent collapses analyze+propose into a single call to cut latency
    if (issues && issues.length > 0) {
      return buildIssuePlanPrompt(context, issues);
    }
    let prompt: string;
    if (hardenPhase === 'harden:tests') {
      prompt = buildHardenAnalyzePrompt(context);
    } else {
      prompt = buildAnalyzePrompt(context);
    }
    return this.runPrompt(prompt);
  }

  async propose(analysis: string, target: Target, hardenPhase?: HardenPhase, issues?: IssueTask[]): Promise<string> {
    // When we already have a plan (issues path), analysis IS the proposal — skip the extra call
    if (issues && issues.length > 0) {
      return analysis; // pass straight through to build
    }
    let prompt: string;
    if (hardenPhase === 'harden:tests') {
      prompt = buildHardenProposePrompt(analysis, target);
    } else {
      prompt = buildProposePrompt(analysis, target);
    }
    return this.runPrompt(prompt);
  }

  async build(proposal: string, cwd: string): Promise<BuildResult> {
    const prompt = buildBuildPrompt(proposal);
    const start = Date.now();

    try {
      const output = await this.runPromptInDir(prompt, cwd);
      const filesModified = parseModifiedFiles(output);
      return {
        success: true,
        output,
        filesModified,
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        success: false,
        output: error.message ?? '',
        filesModified: [],
        error: error.message,
      };
    }
  }

  private async runPrompt(prompt: string): Promise<string> {
    return this.runPromptInDir(prompt, process.cwd());
  }

  private async runPromptInDir(prompt: string, cwd: string): Promise<string> {
    const args = [...this.extraArgs, prompt];
    try {
      const { stdout, stderr } = await execFileAsync(this.command, args, {
        cwd,
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      });
      return [stdout, stderr].filter(Boolean).join('\n').trim();
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        signal?: string;
      };

      // Timeout: Node kills the process with SIGTERM after the timeout elapses
      if (error.killed || error.signal === 'SIGTERM') {
        const timeoutSecs = Math.round(this.timeout / 1000);
        throw new Error(
          `Agent timed out after ${timeoutSecs}s — the \`${this.command}\` process did not respond in time.\n` +
            `  Possible causes: the agent is unresponsive, rate-limited, or the network is slow.\n` +
            `  Try increasing the timeout or checking that \`${this.command}\` works from the command line.`,
        );
      }

      // Command not found
      if (error.code === 'ENOENT') {
        throw new Error(
          `Agent command not found: \`${this.command}\`\n` +
            `  Make sure the agent CLI is installed and available in your PATH.\n` +
            `  For the default shell agent: npm install -g @anthropic-ai/claude-code`,
        );
      }

      // If the command exits non-zero but produced output, still return it
      const output = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
      if (output) return output;
      throw error;
    }
  }
}

function buildAnalyzePrompt(context: string): string {
  return (
    `You are a code improvement assistant. Analyze the following target and provide a concise analysis of what can be improved.\n\n` +
    `${context}\n\n` +
    `Focus on: code quality, error handling, performance, maintainability. ` +
    `Be specific and actionable. List the top 3 improvement opportunities.`
  );
}

function buildProposePrompt(analysis: string, target: Target): string {
  return (
    `You are a code improvement assistant. Based on the following analysis, propose ONE specific, focused improvement.\n\n` +
    `Target path: ${target.path}\n` +
    `Analysis:\n${analysis}\n\n` +
    `Respond with:\n` +
    `1. The specific change to make (one sentence)\n` +
    `2. Which file(s) to modify\n` +
    `3. The exact code change\n\n` +
    `Keep it minimal — one change, one commit.`
  );
}

function buildHardenAnalyzePrompt(context: string): string {
  return (
    `You are a test-writing assistant. Analyze the following target and identify what test coverage is missing.\n\n` +
    `${context}\n\n` +
    `Focus on: untested functions, uncovered edge cases, missing error condition tests. ` +
    `Be specific and actionable. List the top 3 missing test scenarios.`
  );
}

function buildHardenProposePrompt(analysis: string, target: Target): string {
  return (
    `You are a test-writing assistant. Based on the following analysis, propose ONE specific set of tests to write.\n\n` +
    `Target path: ${target.path}\n` +
    `Analysis:\n${analysis}\n\n` +
    `Respond with:\n` +
    `1. The specific test(s) to write (one sentence)\n` +
    `2. Which test file to create or modify\n` +
    `3. The exact test code\n\n` +
    `Write comprehensive tests for the target code. Focus on correctness, not style.`
  );
}

function buildIssueAnalyzePrompt(context: string, issues: IssueTask[]): string {
  const issueList = formatIssuesForPrompt(issues);
  return (
    `You are a code improvement assistant. The following issues were found by automated scanning:\n\n` +
    `${issueList}\n\n` +
    `${context}\n\n` +
    `Focus on the highest-severity issues first. Pick at most 2-3 specific files to fix in this pass. ` +
    `Do NOT try to fix everything — make a small, safe change that will pass all existing tests. ` +
    `Be specific about which files you will touch and what exact changes you will make.`
  );
}

/**
 * Single-shot plan prompt: skips the analyze→propose round-trips.
 * Returns a self-contained build instruction ready for the build step.
 */
function buildIssuePlanPrompt(context: string, issues: IssueTask[]): string {
  const issueList = formatIssuesForPrompt(issues);
  // Parse path from context (format: "Path: ./server/routes/groups.ts")
  const pathMatch = context.match(/^Path:\s*(.+)$/m);
  const targetPath = pathMatch ? pathMatch[1].trim() : '';
  return (
    `Fix the following issue in ${targetPath}:\n\n` +
    `${issueList}\n\n` +
    `RULES:\n` +
    `- Modify at most 2 files\n` +
    `- Surgical change only — do NOT refactor unrelated code\n` +
    `- All existing tests MUST still pass\n` +
    `- Do NOT add new dependencies or change public function signatures\n` +
    `- After making the change, output each modified file as:\n` +
    `  MODIFIED: <filepath>`
  );
}

function buildIssueProposePrompt(analysis: string, target: Target, issues: IssueTask[]): string {
  const issueList = formatIssuesForPrompt(issues);
  return (
    `You are a code improvement assistant. The following issues were found:\n\n` +
    `${issueList}\n\n` +
    `Target path: ${target.path}\n` +
    `Analysis:\n${analysis}\n\n` +
    `IMPORTANT CONSTRAINTS:\n` +
    `- Touch at most 2-3 files in this pass\n` +
    `- Make minimal, surgical changes — do NOT refactor broadly\n` +
    `- All existing tests MUST still pass — if unsure, err on the side of smaller changes\n` +
    `- Do NOT add new dependencies\n` +
    `- Do NOT change function signatures that other code depends on\n\n` +
    `Respond with:\n` +
    `1. What you're fixing (summary — keep it focused)\n` +
    `2. Which 1-3 file(s) to modify\n` +
    `3. The exact code changes`
  );
}

function buildBuildPrompt(proposal: string): string {
  return (
    `You are a code improvement assistant. Implement the following proposed change.\n\n` +
    `${proposal}\n\n` +
    `Make ONLY the described change. Do not refactor unrelated code. ` +
    `After making the change, output the list of modified files in this format:\n` +
    `MODIFIED: <filepath>\n` +
    `(one line per file)`
  );
}

function parseModifiedFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^MODIFIED:\s*(.+)$/);
    if (match) {
      files.push(match[1].trim());
    }
  }
  return files;
}

export function createShellAgent(options: ShellAgentConfig = {}): ShellAgent {
  return new ShellAgent(options);
}
