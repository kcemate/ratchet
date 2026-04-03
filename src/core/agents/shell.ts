import { spawn } from 'child_process';
import { join } from 'path';
import type { Target, BuildResult, HardenPhase } from '../../types.js';
import type { ScanResult } from '../../core/scanner';
import type { Agent, AgentOptions } from './base.js';
import { createAgentContext } from './base.js';
import {
  parseModifiedFiles, buildAnalyzePrompt, buildHardenAnalyzePrompt, buildProposePrompt, buildHardenProposePrompt,
} from './api.js';
import type { IssueTask } from '../issue-backlog.js';
import { formatIssuesForPrompt } from '../issue-backlog.js';
import { buildIntelligenceBriefing, queryFlowsTargeted, getApiImpact } from '../gitnexus.js';
import { SUBCATEGORY_TIERS } from '../score-optimizer.js';
import { logger } from '../../lib/logger.js';
import { buildGraphToolInstructions } from '../gitnexus-tools.js';
import type { FeaturePlan, FeatureStep } from '../../types.js';

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
  /** Strategy context injected into prompts (set by engine before each run) */
  strategyContext?: string;
  /** Repo context injected into prompts to orient agents in unfamiliar repos */
  repoContext?: string;
  /** Summary of prior click rounds — injected by context-manager before each API call */
  priorRoundsContext?: string;

  constructor(config: ShellAgentConfig = {}) {
    this.command = config.command ?? 'claude';
    const baseArgs = config.extraArgs ?? ['--print', '--permission-mode', 'bypassPermissions'];
    // Wire up --model if provided and not already in extraArgs
    if (config.model && !baseArgs.some((a) => a.startsWith('--model'))) {
      baseArgs.push('--model', config.model);
    }
    this.extraArgs = baseArgs;
    this.timeout = config.timeout ?? 1_200_000; // 20 minutes
    if (config.cwd) this._cwd = config.cwd;
  }

  async analyze(context: string, hardenPhase?: HardenPhase, issues?: IssueTask[]): Promise<string> {
    // Shell agent collapses analyze+propose+build into a single call for issue-driven clicks
    if (issues && issues.length > 0) {
      this._issueDrivenClick = true;
      return await buildIssuePlanPrompt(context, issues, this.gitnexusCwd ?? this._cwd, this.strategyContext, this.repoContext, this.priorRoundsContext);
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
/** Returns true if the file path looks like an API route file. */
function isApiRouteFile(filePath: string): boolean {
  return /\/(routes?|api|endpoints?|handlers?|controllers?)\//i.test(filePath) ||
    /\.(route|api|endpoint|handler|controller)\.[jt]sx?$/.test(filePath);
}

/**
 * Returns constraint text for the HARD CONSTRAINTS section based on issue type.
 * Sweep issues get no line limit; high-count issues get expanded limits; normal issues keep 30/2.
 */
export function buildConstraints(issues: IssueTask[]): string {
  const first = issues[0];
  if (!first) return '- Change AT MOST 30 lines total (insertions + deletions combined)\n- Modify AT MOST 2 files\n- Do NOT refactor unrelated code. All existing tests MUST still pass.';

  if (first.sweepFiles && first.sweepFiles.length > 0) {
    return (
      `- Modify ONLY the listed files. No line limit — fix every instance of the issue in each file.\n` +
      `- Do NOT refactor unrelated code. All existing tests MUST still pass.`
    );
  }

  if (first.count > 10) {
    return (
      `- Change AT MOST 80 lines total (insertions + deletions combined)\n` +
      `- Modify AT MOST 5 files\n` +
      `- Do NOT refactor unrelated code. All existing tests MUST still pass.`
    );
  }

  return (
    `- Change AT MOST 30 lines total (insertions + deletions combined)\n` +
    `- Modify AT MOST 2 files\n` +
    `- Do NOT refactor unrelated code. All existing tests MUST still pass.`
  );
}

/**
 * Generates score context text so the agent knows what points are at stake.
 * Returns empty string if tier info is unavailable or no gain is possible.
 */
export function buildScoreContext(issues: IssueTask[]): string {
  const first = issues[0];
  if (!first) return '';

  const tierDef = SUBCATEGORY_TIERS.find(t => t.name === first.subcategory);
  if (!tierDef) return '';

  const currentScore = first.currentScore ?? 0;
  const maxScore = tierDef.maxScore;

  // Find how many issues to fix to reach the next scoring tier
  const sortedTiers = [...tierDef.tiers].sort((a, b) => a.threshold - b.threshold);
  let issuesNeeded = 0;
  let pointsGained = 0;

  for (const tier of sortedTiers) {
    const effectiveScore = Math.min(tier.score, maxScore);
    if (effectiveScore > currentScore && first.count > tier.threshold) {
      issuesNeeded = first.count - tier.threshold;
      pointsGained = effectiveScore - currentScore;
      break;
    }
  }

  if (issuesNeeded === 0 || pointsGained === 0) return '';

  return (
    `SCORE CONTEXT: ${first.subcategory} is at ${currentScore}/${maxScore}. ` +
    `Fixing ${issuesNeeded} issue${issuesNeeded !== 1 ? 's' : ''} gains +${pointsGained} point${pointsGained !== 1 ? 's' : ''}. ` +
    `Target the highest-severity issue first.`
  );
}

export async function buildIssuePlanPrompt(
  context: string,
  issues: IssueTask[],
  cwd?: string,
  strategyContext?: string,
  repoContext?: string,
  priorRoundsContext?: string,
): Promise<string> {
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

  // API impact: inject route/handler context when working on API files
  let apiIntel = '';
  if (cwd && targetPath && isApiRouteFile(targetPath)) {
    try {
      const apiImpact = await getApiImpact(targetPath, cwd);
      if (apiImpact) {
        const lines: string[] = ['API IMPACT (affected routes):'];
        for (const r of apiImpact.routes.slice(0, 8)) {
          lines.push(`  ${r.methods.join(',')} ${r.path} → ${r.handler}`);
        }
        if (apiImpact.shapeIssues.length > 0) {
          lines.push('  Shape issues:');
          for (const s of apiImpact.shapeIssues.slice(0, 4)) {
            lines.push(`    ${s.route}: expected ${s.expected}, got ${s.actual}`);
          }
        }
        lines.push(`  Risk: ${apiImpact.risk}`);
        apiIntel = lines.join('\n');
      }
    } catch (err) {
      logger.debug({ err }, 'API impact briefing failed (non-fatal)');
    }
  }

  const constraints = buildConstraints(issues);
  const scoreCtx = buildScoreContext(issues);
  const fixGuidance = issues[0]?.fixInstruction;

  return (
    `You are a code improvement assistant. Fix the top issue in ${targetPath}.\n\n` +
    (repoContext ? `${repoContext}\n\n` : '') +
    (graphIntel ? `${graphIntel}\n\n` : '') +
    (apiIntel ? `${apiIntel}\n\n` : '') +
    (strategyContext ? `${strategyContext}\n\n` : '') +
    (scoreCtx ? `${scoreCtx}\n\n` : '') +
    `ISSUES FOUND:\n${issueList}\n\n` +
    (fixGuidance ? `FIX GUIDANCE:\n${fixGuidance}\n\n` : '') +
    `HARD CONSTRAINTS (violating these will cause rollback):\n` +
    `${constraints}\n` +
    `- Do NOT refactor, restructure, or rewrite functions\n` +
    `- Do NOT rename variables, extract helpers, or "improve" unrelated code\n` +
    `- Do NOT add new dependencies or change public function signatures\n` +
    `- Do NOT change formatting, whitespace, or style in untouched lines\n\n` +
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
  } catch (err) {
    logger.debug({ err }, 'GitNexus briefing unavailable for architect prompt');
  }

  const graphTools = buildGraphToolInstructions(cwd);

  const topIssues = scanResult.issuesByType
    .filter(i => i.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const issuesList = topIssues.map(i => {
    const locs = i.locations?.slice(0, 4).join(', ') ?? '';
    return `  - [${i.severity}] ${i.description}: ${i.count} occurrences${locs ? ` — in ${locs}` : ''}`;
  }).join('\n');

  return (
    `You are an expert software architect. Make ONE high-leverage structural improvement ` +
    `that eliminates as many issues as possible at once.\n\n` +
    (intel ? `CODEBASE INTELLIGENCE:\n${intel}\n\n` : '') +
    (graphTools ? `GRAPH QUERY TOOLS (use rename for graph-aware symbol renaming):\n${graphTools}\n\n` : '') +
    `TOP ISSUES BY VOLUME (score: ${scanResult.total}/100, ${scanResult.totalIssuesFound} total issues):\n` +
    `${issuesList}\n\n` +
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
    `  "extractionTargets": [{ "name": "shared-utils", "files": ["src/a.ts", "src/b.ts"],` +
    ` "pattern": "duplicated helper" }],\n` +
    `  "dependencyOrder": ["path/to/file1.ts", "path/to/file2.ts"],\n` +
    `  "estimatedClicks": 3\n` +
    `}`
  );
}

/**
 * Build a planning prompt for feature mode (click 0).
 * Takes the spec + GitNexus codebase intelligence and asks the agent to produce
 * a structured FeaturePlan JSON describing all implementation steps.
 */
export function buildFeaturePlanPrompt(spec: string, cwd: string): string {
  let graphIntel = '';
  try {
    graphIntel = buildIntelligenceBriefing('.', cwd);
  } catch (err) {
    logger.debug({ err }, 'GitNexus briefing unavailable for feature plan prompt');
  }

  const graphTools = buildGraphToolInstructions(cwd);

  return (
    `You are an expert software architect. Your task is to plan the implementation of a new feature.\n\n` +
    `FEATURE SPECIFICATION:\n${spec}\n\n` +
    (graphIntel ? `CODEBASE INTELLIGENCE:\n${graphIntel}\n\n` : '') +
    (graphTools ? `GRAPH QUERY TOOLS (use these to explore the codebase before planning):\n${graphTools}\n\n` : '') +
    `INSTRUCTIONS:\n` +
    `- Explore the codebase to understand existing structure and patterns\n` +
    `- Identify which files need to be created or modified\n` +
    `- Break the feature into discrete, independent implementation steps\n` +
    `- Order steps by dependency (prerequisites first)\n` +
    `- Each step should be implementable in a single focused click\n\n` +
    `DO NOT implement anything. DO NOT create or modify any files.\n\n` +
    `Output ONLY valid JSON matching this schema (no markdown, no explanation):\n` +
    `{\n` +
    `  "spec": "<original spec text>",\n` +
    `  "steps": [\n` +
    `    {\n` +
    `      "id": 1,\n` +
    `      "description": "Create the database schema for user authentication",\n` +
    `      "files": ["src/db/schema.ts", "src/db/migrations/001_users.sql"],\n` +
    `      "dependencies": [],\n` +
    `      "status": "pending"\n` +
    `    },\n` +
    `    {\n` +
    `      "id": 2,\n` +
    `      "description": "Implement JWT token generation and validation",\n` +
    `      "files": ["src/auth/jwt.ts"],\n` +
    `      "dependencies": [1],\n` +
    `      "status": "pending"\n` +
    `    }\n` +
    `  ],\n` +
    `  "completedSteps": [],\n` +
    `  "filesCreated": [],\n` +
    `  "filesModified": []\n` +
    `}`
  );
}

/**
 * Build a click prompt for a specific feature step.
 * Injects the full plan + graph context for the files involved so the agent
 * knows what has been built and what to build next.
 */
export function buildFeatureClickPrompt(
  step: FeatureStep, plan: FeaturePlan, cwd: string, strategyContext?: string,
): string {
  let graphIntel = '';
  try {
    // Get graph context for the files this step will touch
    const filePaths = step.files.length > 0 ? step.files : ['.'];
    graphIntel = filePaths.map(f => {
      try {
        return buildIntelligenceBriefing(f, cwd);
      } catch (err) {
        logger.debug({ err, f }, 'GitNexus briefing failed for file'); return '';
      }
    }).filter(Boolean).join('\n\n');
  } catch (err) {
    logger.debug({ err }, 'GitNexus briefing failed for feature click prompt');
  }

  const graphTools = buildGraphToolInstructions(cwd);

  const completedSteps = plan.steps.filter(s => plan.completedSteps.includes(s.id));
  const remainingSteps = plan.steps.filter(s => !plan.completedSteps.includes(s.id) && s.id !== step.id);

  const completedSummary = completedSteps.length > 0
    ? completedSteps.map(s => `  ✓ Step ${s.id}: ${s.description}`).join('\n')
    : '  (none yet)';

  const remainingSummary = remainingSteps.length > 0
    ? remainingSteps.map(s => `  • Step ${s.id}: ${s.description}`).join('\n')
    : '  (this is the last step)';

  const filesCreated = plan.filesCreated.length > 0
    ? plan.filesCreated.join(', ')
    : '(none yet)';

  const filesModified = plan.filesModified.length > 0
    ? plan.filesModified.join(', ')
    : '(none yet)';

  return (
    `You are implementing a feature. Implement ONLY the current step described below.\n\n` +
    `FEATURE SPEC:\n${plan.spec}\n\n` +
    `CURRENT STEP (Step ${step.id}):\n${step.description}\n` +
    `Files to touch: ${step.files.length > 0 ? step.files.join(', ') : '(determine from context)'}\n\n` +
    `IMPLEMENTATION PROGRESS:\n` +
    `Completed steps:\n${completedSummary}\n\n` +
    `Files created so far: ${filesCreated}\n` +
    `Files modified so far: ${filesModified}\n\n` +
    `Remaining steps (do NOT implement these now):\n${remainingSummary}\n\n` +
    (graphIntel ? `GRAPH CONTEXT FOR AFFECTED FILES:\n${graphIntel}\n\n` : '') +
    (graphTools ? `GRAPH QUERY TOOLS (use to explore dependencies before implementing):\n${graphTools}\n\n` : '') +
    (strategyContext ? `${strategyContext}\n\n` : '') +
    `CONSTRAINTS:\n` +
    `- Implement ONLY Step ${step.id}: "${step.description}"\n` +
    `- Do NOT implement other steps — they will be handled in subsequent clicks\n` +
    `- You may create new files or modify existing ones\n` +
    `- You may touch up to 12 files and 280 lines total\n` +
    `- All existing tests MUST still pass\n` +
    `- Follow existing code patterns and conventions\n` +
    `- Write clean, idiomatic code consistent with the rest of the codebase\n\n` +
    `After making changes, output each file on its own line:\n` +
    `MODIFIED: <filepath>\n` +
    `CREATED: <filepath>`
  );
}
