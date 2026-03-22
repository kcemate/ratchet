import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import type { RatchetRun, FeaturePlan, FeatureStep } from '../types.js';
import type { IssueTask } from './issue-backlog.js';
import { buildFeaturePlanPrompt, buildFeatureClickPrompt } from './agents/shell.js';
import { executeClick } from './click.js';
import * as git from './git.js';
import { clearCache as clearGitNexusCache } from './gitnexus.js';
import { resolveGuards } from './engine-guards.js';
import type { EngineRunOptions } from './engine.js';
import { logger } from '../lib/logger.js';

export interface FeatureEngineOptions extends EngineRunOptions {
  /** Feature specification — either inline text or file contents already loaded */
  spec: string;
}

/**
 * Parse a FeaturePlan from agent output.
 * The agent is instructed to output only JSON, but may include markdown fences.
 */
export function parseFeaturePlan(output: string): FeaturePlan | null {
  // Strip markdown code fences if present
  const stripped = output.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  // Find JSON object in output
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!isFeaturePlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isFeaturePlan(value: unknown): value is FeaturePlan {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj['spec'] !== 'string') return false;
  if (!Array.isArray(obj['steps'])) return false;
  if (!Array.isArray(obj['completedSteps'])) return false;
  if (!Array.isArray(obj['filesCreated'])) return false;
  if (!Array.isArray(obj['filesModified'])) return false;
  return true;
}

/**
 * Get all steps whose dependencies have been satisfied.
 */
export function getReadySteps(plan: FeaturePlan): FeatureStep[] {
  const completed = new Set(plan.completedSteps);
  return plan.steps.filter(step => {
    if (step.status === 'completed' || step.status === 'in-progress') return false;
    if (step.status === 'failed') return false;
    return step.dependencies.every(dep => completed.has(dep));
  });
}

/**
 * Check if all steps in the plan are resolved (completed or failed).
 */
export function isPlanComplete(plan: FeaturePlan): boolean {
  return plan.steps.every(s => s.status === 'completed' || s.status === 'failed');
}

/**
 * Generate a markdown progress document for docs/<target>-feature-plan.md
 */
export function renderFeaturePlanMarkdown(plan: FeaturePlan, targetName: string): string {
  const completedCount = plan.steps.filter(s => s.status === 'completed').length;
  const totalCount = plan.steps.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const lines: string[] = [
    `# ${targetName} — Feature Plan`,
    '',
    `> **Spec:** ${plan.spec}`,
    '',
    `**Progress:** ${completedCount}/${totalCount} steps (${progressPct}%)`,
    '',
    '## Steps',
    '',
  ];

  for (const step of plan.steps) {
    const icon = step.status === 'completed' ? '✅'
      : step.status === 'failed' ? '❌'
      : step.status === 'in-progress' ? '🔄'
      : '⬜';
    lines.push(`### ${icon} Step ${step.id}: ${step.description}`);
    lines.push('');
    if (step.files.length > 0) {
      lines.push(`**Files:** ${step.files.join(', ')}`);
      lines.push('');
    }
    if (step.dependencies.length > 0) {
      lines.push(`**Depends on:** Steps ${step.dependencies.join(', ')}`);
      lines.push('');
    }
    lines.push(`**Status:** ${step.status}`);
    lines.push('');
  }

  if (plan.filesCreated.length > 0) {
    lines.push('## Files Created');
    lines.push('');
    for (const f of plan.filesCreated) lines.push(`- ${f}`);
    lines.push('');
  }

  if (plan.filesModified.length > 0) {
    lines.push('## Files Modified');
    lines.push('');
    for (const f of plan.filesModified) lines.push(`- ${f}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Parse MODIFIED: and CREATED: lines from agent output to update the plan.
 */
function extractModifiedFiles(output: string): { modified: string[]; created: string[] } {
  const modified: string[] = [];
  const created: string[] = [];

  for (const line of output.split('\n')) {
    const modMatch = line.match(/^MODIFIED:\s*(.+)$/);
    if (modMatch) modified.push(modMatch[1].trim());
    const createdMatch = line.match(/^CREATED:\s*(.+)$/);
    if (createdMatch) created.push(createdMatch[1].trim());
  }

  return { modified, created };
}

/**
 * Feature engine: builds a feature from a specification.
 *
 * Flow:
 * - Click 0 (plan): agent reads the spec + graph intel → produces a FeaturePlan
 * - Clicks 1-N (build): each click implements ONE step from the plan
 * - Final click (verify): runs full scan to check for regressions
 *
 * Key differences from normal mode:
 * - No scan-driven backlog — driven by spec and plan
 * - Graph intelligence injected at every step
 * - Default guard profile: refactor (12 files, 280 lines)
 * - Creates docs/<target>-feature-plan.md tracking progress
 */
export async function runFeatureEngine(options: FeatureEngineOptions): Promise<RatchetRun> {
  const { clicks, config, cwd, agent, callbacks = {}, createBranch = true, spec } = options;

  const run: RatchetRun = {
    id: randomUUID(),
    target: options.target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };

  // Use refactor guard profile by default for feature mode
  if (!config.guards) {
    config.guards = 'refactor';
  }

  const docsDir = join(cwd, 'docs');
  const planPath = join(docsDir, `${options.target.name}-feature-plan.md`);

  try {
    // Create branch if requested
    if (createBranch) {
      if (await git.isDetachedHead(cwd)) {
        throw new Error('Git repository is in detached HEAD state. Ratchet requires a named branch.');
      }
      const branch = git.branchName(options.target.name + '-feature');
      await git.createBranch(branch, cwd);
    }

    // Clear GitNexus cache for fresh data
    clearGitNexusCache();

    // ── Click 0: Plan
    logger.info('[feature] Starting plan click (click 0)');
    await callbacks.onClickStart?.(0, clicks + 1);

    const planPrompt = buildFeaturePlanPrompt(spec, cwd);

    // Use the agent to generate the plan via a synthetic "analyze" call
    // We pass the plan prompt as a single-shot issue-free analyze
    let planOutput = '';
    try {
      planOutput = await agent.analyze(planPrompt);
    } catch (err) {
      logger.warn({ err }, '[feature] Plan click failed — agent error');
      run.status = 'failed';
      run.finishedAt = new Date();
      await callbacks.onRunComplete?.(run);
      return run;
    }

    const plan = parseFeaturePlan(planOutput);
    if (!plan) {
      logger.warn('[feature] Could not parse feature plan from agent output');
      logger.warn('[feature] Raw output: ' + planOutput.slice(0, 500));
      run.status = 'failed';
      run.finishedAt = new Date();
      await callbacks.onRunComplete?.(run);
      return run;
    }

    // Override spec in case it was truncated in agent output
    plan.spec = spec;

    logger.info(`[feature] Plan ready: ${plan.steps.length} steps`);
    process.stderr.write(`[ratchet] feature plan: ${plan.steps.length} steps\n`);

    // Write initial plan document
    try {
      await mkdir(docsDir, { recursive: true });
      await writeFile(planPath, renderFeaturePlanMarkdown(plan, options.target.name), 'utf-8');
    } catch {
      // Non-fatal
    }

    // ── Clicks 1-N: Build
    let clickNumber = 1;
    const maxBuildClicks = Math.max(1, clicks - 1); // Reserve last click for verify if clicks > 1

    while (clickNumber <= maxBuildClicks && !isPlanComplete(plan)) {
      const readySteps = getReadySteps(plan);
      if (readySteps.length === 0) {
        logger.info('[feature] No ready steps — all steps have unmet dependencies or are done');
        break;
      }

      // Take the first ready step
      const step = readySteps[0]!;
      logger.info(`[feature] Click ${clickNumber}: implementing step ${step.id} — ${step.description}`);
      await callbacks.onClickStart?.(clickNumber, clicks + 1);

      // Mark step as in-progress
      step.status = 'in-progress';

      // Build the click prompt for this step
      const clickPrompt = buildFeatureClickPrompt(step, plan, cwd);

      // Create a synthetic IssueTask that carries the feature click prompt
      const featureTask: IssueTask = {
        category: 'feature',
        subcategory: 'implementation',
        description: `Step ${step.id}: ${step.description}`,
        count: 1,
        severity: 'high',
        priority: 100,
        // Use architectPrompt field to pass the pre-built prompt verbatim
        architectPrompt: clickPrompt,
      };

      try {
        const clickStartMs = Date.now();

        const result = await executeClick({
          clickNumber,
          target: options.target,
          config,
          agent,
          cwd,
          architectMode: true, // Use architect mode to pass the prompt verbatim
          resolvedGuards: resolveGuards(options.target, config, 'architect'),
          adversarial: options.adversarial,
          issues: [featureTask],
          onPhase: callbacks.onClickPhase
            ? (phase) => callbacks.onClickPhase!(phase, clickNumber)
            : undefined,
        });

        const { click } = result;
        const rolled_back = result.rolled_back;
        const elapsedSec = ((Date.now() - clickStartMs) / 1000).toFixed(1);

        if (rolled_back) {
          process.stderr.write(
            `[ratchet] feature click ${clickNumber} (step ${step.id}) ROLLED BACK (${elapsedSec}s)\n`,
          );
          step.status = 'failed';
        } else {
          process.stderr.write(
            `[ratchet] feature click ${clickNumber} (step ${step.id}) LANDED (${elapsedSec}s)` +
            `${click.commitHash ? ` — commit ${click.commitHash.slice(0, 7)}` : ''}\n`,
          );
          step.status = 'completed';
          plan.completedSteps.push(step.id);

          // Extract modified/created files from click output
          const analysisOutput = click.analysis + '\n' + (click.proposal ?? '');
          const { modified, created } = extractModifiedFiles(analysisOutput);

          // Also check filesModified from the click itself
          const allModified = [...new Set([...modified, ...click.filesModified])];
          const allCreated = [...new Set(created)];

          for (const f of allModified) {
            if (!plan.filesModified.includes(f)) plan.filesModified.push(f);
          }
          for (const f of allCreated) {
            if (!plan.filesCreated.includes(f)) plan.filesCreated.push(f);
          }
        }

        run.clicks.push(click);
        await callbacks.onClickComplete?.(click, rolled_back);

        // Update plan document after each click
        try {
          await writeFile(planPath, renderFeaturePlanMarkdown(plan, options.target.name), 'utf-8');
        } catch {
          // Non-fatal
        }

        clickNumber++;
      } catch (err: unknown) {
        step.status = 'failed';
        const error = err instanceof Error ? err : new Error(String(err));
        await callbacks.onError?.(error, clickNumber);
        clickNumber++;
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

/**
 * Read spec from a file path or return the inline spec string.
 * If specArg looks like a file path and the file exists, read it.
 * Otherwise treat it as inline spec text.
 */
export async function resolveSpec(specArg: string): Promise<string> {
  // Heuristic: if it ends with .md, .txt, or contains a path separator, try to read as file
  const looksLikeFile = specArg.includes('/') || specArg.includes('\\') ||
    specArg.endsWith('.md') || specArg.endsWith('.txt');

  if (looksLikeFile && existsSync(specArg)) {
    const contents = await readFile(specArg, 'utf-8');
    return contents.trim();
  }

  return specArg;
}
