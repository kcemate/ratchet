import { spawn } from 'child_process';
import { join } from 'path';
import type { Target, BuildResult, HardenPhase } from '../../types.js';
import type { ScanResult } from '../../commands/scan.js';
import type { Agent, AgentOptions } from './base.js';
import { createAgentContext } from './base.js';
import { parseModifiedFiles, buildAnalyzePrompt, buildHardenAnalyzePrompt, buildProposePrompt, buildHardenProposePrompt } from './api.js';
import type { IssueTask } from '../issue-backlog.js';
import { formatIssuesForPrompt } from '../issue-backlog.js';
import { buildIntelligenceBriefing, queryFlowsTargeted } from '../gitnexus.js';

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
  /** Tracks whether current click is issue-driven (single-shot) */
  private _issueDrivenClick = false;
  /** Working directory — set during build(), used for GitNexus lookups */
  private _cwd: string = process.cwd();
  /** Override cwd for GitNexus lookups (worktrees don't have .gitnexus) */
  gitnexusCwd?: string;

  constructor(config: ShellAgentConfig = {}) {
    this.command = config.command ?? 'claude';
    const baseArgs = config.extraArgs ?? ['--print', '--permission-mode', 'bypassPermissions'];
    // Wire up --model if provided and not already in extraArgs
    if (config.model && !baseArgs.some((a) => a.startsWith('--model'))) {
      baseArgs.push('--model', config.model);
    }
    this.extraArgs = baseArgs;
    this.timeout = config.timeout ?? 600_000; // 10 minutes
    if (config.cwd) this._cwd = config.cwd;
  }

  async analyze(context: string, hardenPhase?: HardenPhase, issues?: IssueTask[]): Promise<string> {
    // Shell agent collapses analyze+propose+build into a single call for issue-driven clicks
    if (issues && issues.length > 0) {
      this._issueDrivenClick = true;
      return buildIssuePlanPrompt(context, issues, this.gitnexusCwd ?? this._cwd);
    }
    this._issueDrivenClick = false;
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
    this._cwd = cwd; // keep in sync for future GitNexus lookups
    // Issue-driven clicks: the proposal IS the single-shot prompt — send it directly
    // without wrapping in buildBuildPrompt (which would double-wrap instructions)
    const prompt = this._issueDrivenClick ? proposal : buildBuildPrompt(proposal);

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

  /** Run a prompt directly without any wrapping — used for plan/read-only clicks */
  runDirect(prompt: string, cwd: string): Promise<string> {
    return this.runPromptInDir(prompt, cwd);
  }

  private runPromptInDir(prompt: string, cwd: string): Promise<string> {
    const args = [...this.extraArgs, prompt];
    const maxBuffer = 10 * 1024 * 1024; // 10MB

    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutBuf = '';
      let stderrBuf = '';
      let totalBytes = 0;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.timeout);

      child.stdout.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBuffer) {
          child.kill('SIGTERM');
          return;
        }
        stdoutBuf += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBuffer) {
          child.kill('SIGTERM');
          return;
        }
        stderrBuf += chunk.toString();
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error(
            `Agent command not found: \`${this.command}\`\n` +
            `  Make sure the agent CLI is installed and available in your PATH.\n` +
            `  For the default shell agent: npm install -g @anthropic-ai/claude-code`,
          ));
        } else {
          reject(err);
        }
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);

        if (timedOut || totalBytes > maxBuffer) {
          const timeoutSecs = Math.round(this.timeout / 1000);
          reject(new Error(
            `Agent timed out after ${timeoutSecs}s — the \`${this.command}\` process did not respond in time.\n` +
            `  Possible causes: the agent is unresponsive, rate-limited, or the network is slow.\n` +
            `  Try increasing the timeout or checking that \`${this.command}\` works from the command line.`,
          ));
          return;
        }

        const output = [stdoutBuf, stderrBuf].filter(Boolean).join('\n').trim();

        if (code === 0) {
          resolve(output);
          return;
        }

        // Non-zero exit but produced output — still return it
        if (output) {
          resolve(output);
          return;
        }

        reject(new Error(`Agent exited with code ${code}`));
      });
    });
  }
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
 * Returns a self-contained instruction that is sent DIRECTLY to the agent
 * (not wrapped in buildBuildPrompt). The agent reads files, makes changes,
 * and reports what it modified — all in one call.
 *
 * When GitNexus is available, injects dependency/caller intelligence so the
 * agent knows the blast radius before editing.
 */
function buildIssuePlanPrompt(context: string, issues: IssueTask[], cwd?: string): string {
  // Architect mode: if the first issue carries a pre-built prompt, use it verbatim
  if (issues[0]?.architectPrompt) {
    return issues[0].architectPrompt;
  }

  // Sweep mode: if top issue has sweepFiles, use sweep-specific prompt
  if (issues[0]?.sweepFiles && issues[0].sweepFiles.length > 0) {
    return buildSweepPrompt(issues[0].description, issues[0].sweepFiles.slice(0, 8));
  }

  const issueList = formatIssuesForPrompt(issues);
  // Parse path from context (format: "Path: ./server/routes/groups.ts")
  const pathMatch = context.match(/^Path:\s*(.+)$/m);
  const targetPath = pathMatch ? pathMatch[1].trim() : '';

  // GitNexus intelligence: dependency graph + blast radius + execution flows
  let graphIntel = '';
  if (cwd && targetPath) {
    graphIntel = buildIntelligenceBriefing(targetPath, cwd);
    // Note: execution flows are now injected asynchronously via buildIssuePlanPromptAsync
    // Sync path keeps backward compat — flows added when cwd not provided
  }

  return (
    `You are a code improvement assistant. Fix the top issue in ${targetPath}.\n\n` +
    (graphIntel ? `${graphIntel}\n\n` : '') +
    `ISSUES FOUND:\n${issueList}\n\n` +
    `HARD CONSTRAINTS (violating these will cause rollback):\n` +
    `- Change AT MOST 30 lines total (insertions + deletions combined)\n` +
    `- Modify AT MOST 2 files\n` +
    `- Do NOT refactor, restructure, or rewrite functions\n` +
    `- Do NOT rename variables, extract helpers, or "improve" unrelated code\n` +
    `- Do NOT add new dependencies or change public function signatures\n` +
    `- Do NOT change formatting, whitespace, or style in untouched lines\n` +
    `- All existing tests MUST still pass\n\n` +
    `INSTRUCTIONS:\n` +
    `1. Read the target file to understand the code\n` +
    `2. Fix ONLY the single highest-severity issue\n` +
    `3. Make the smallest possible change that fixes it\n` +
    `4. If the fix would require changing more than 30 lines, pick a smaller sub-issue instead\n\n` +
    `After making changes, output each modified file on its own line:\n` +
    `MODIFIED: <filepath>`
  );
}

/**
 * Sweep prompt: fix one specific issue across a list of files.
 * Used in sweep mode where we target one issue type across the entire codebase.
 */
export function buildSweepPrompt(issueDescription: string, filePaths: string[]): string {
  return `You are a code improvement assistant fixing one specific issue across multiple files.

ISSUE: ${issueDescription}

FILES TO FIX (touch ONLY these files, no others):
${filePaths.map(f => `  - ${f}`).join('\n')}

HARD CONSTRAINTS:
- Fix ONLY the described issue in ONLY the listed files
- Do NOT refactor, rename variables, or change logic
- Do NOT touch any file not in the list above  
- Change AT MOST 10 lines per file
- All existing tests MUST still pass

For each file: read it, find the issue, make the minimal fix.

After making changes, output each modified file:
MODIFIED: <filepath>`;
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


/**
 * Build a single-shot architect prompt that instructs the agent to make ONE
 * high-leverage structural improvement — extracting shared modules, consolidating
 * duplicated logic, splitting god files — that eliminates many issues at once.
 *
 * Injects GitNexus codebase intelligence and top issues by volume so the agent
 * can identify the highest-ROI architectural change.
 */
export function buildArchitectPrompt(scanResult: ScanResult, cwd: string): string {
  let intel = '';
  try {
    intel = buildIntelligenceBriefing('.', cwd);
  } catch {
    // Non-fatal — GitNexus may not be available
  }

  const topIssues = scanResult.issuesByType
    .filter(i => i.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const issuesList = topIssues.map(i => {
    const locs = i.locations?.slice(0, 4).join(', ') ?? '';
    return `  - [${i.severity}] ${i.description}: ${i.count} occurrences${locs ? ` — in ${locs}` : ''}`;
  }).join('\n');

  return (
    `You are an expert software architect. Make ONE high-leverage structural improvement that eliminates as many issues as possible at once.\n\n` +
    (intel ? `CODEBASE INTELLIGENCE:\n${intel}\n\n` : '') +
    `TOP ISSUES BY VOLUME (score: ${scanResult.total}/100, ${scanResult.totalIssuesFound} total issues):\n${issuesList}\n\n` +
    `ARCHITECTURAL OPPORTUNITIES TO CONSIDER:\n` +
    `  - If multiple files share duplicated logic → extract a shared module/utility\n` +
    `  - If a file is a god class/module → split it into focused modules\n` +
    `  - If many files import the same pattern differently → consolidate with a shared abstraction\n` +
    `  - If error handling is scattered → centralize error types/handlers\n` +
    `  - If types are duplicated across files → extract to a shared types module\n\n` +
    `RELAXED CONSTRAINTS (architect mode):\n` +
    `  - You may change up to 20 files and 500 lines total\n` +
    `  - You MAY create new files (shared modules, utilities, type definitions)\n` +
    `  - You MUST update all import paths when extracting or moving code\n` +
    `  - All existing tests MUST still pass — if tests break, the change will be rolled back\n` +
    `  - Make ONE cohesive structural change, not many unrelated fixes\n\n` +
    `INSTRUCTIONS:\n` +
    `1. Analyze the top issues and identify the highest-leverage architectural improvement\n` +
    `2. Make the structural change (extract module, consolidate, refactor)\n` +
    `3. Update all import paths throughout the codebase\n` +
    `4. Verify the change is cohesive and tests would pass\n\n` +
    `After making changes, output each modified or created file:\n` +
    `MODIFIED: <filepath>`
  );
}

export function createShellAgent(options: ShellAgentConfig = {}): ShellAgent {
  return new ShellAgent(options);
}

/**
 * Build a read-only planning prompt (click 0).
 * The agent must output ONLY valid JSON matching the PlanResult schema.
 * No code changes, no commits — pure structured planning.
 */
export function buildPlanPrompt(scanSummary: string, targetPath: string, targetDescription: string): string {
  return (
    `You are a code planning assistant. Analyze the target and produce a structured execution plan.\n\n` +
    `TARGET: ${targetPath}\n` +
    `DESCRIPTION: ${targetDescription}\n\n` +
    (scanSummary ? `SCAN SUMMARY:\n${scanSummary}\n\n` : '') +
    `INSTRUCTIONS:\n` +
    `- Read the files in ${targetPath} to understand the current state\n` +
    `- Identify which files will need to be touched to improve this target\n` +
    `- Identify any extraction targets (shared modules, utilities, type definitions)\n` +
    `- Determine the safest dependency order for changes\n` +
    `- Estimate how many execution clicks will be needed\n\n` +
    `DO NOT make any code changes. DO NOT create or modify any files.\n\n` +
    `Output ONLY valid JSON matching this schema (no markdown, no explanation):\n` +
    `{\n` +
    `  "filesToTouch": ["path/to/file1.ts", "path/to/file2.ts"],\n` +
    `  "extractionTargets": [{ "name": "shared-utils", "files": ["src/a.ts", "src/b.ts"], "pattern": "duplicated helper" }],\n` +
    `  "dependencyOrder": ["path/to/file1.ts", "path/to/file2.ts"],\n` +
    `  "estimatedClicks": 3\n` +
    `}`
  );
}
