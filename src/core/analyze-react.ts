import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative } from 'path';
import { logger } from '../lib/logger.js';
import { getImpact, getContext, queryFlows, isIndexed } from './gitnexus.js';
import type { ScanResult } from '../core/scanner';
import type { Target } from '../types.js';

// ── Types

export interface ReactTurn {
  index: number;
  phase: 'read' | 'investigate' | 'plan';
  reasoning: string;
  actions: string[];
  observations: string[];
}

export interface ProposedChange {
  filePath: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ReactAnalysis {
  /** 0–1 overall confidence that the proposed changes will improve the score. */
  confidence: number;
  /** Risk level derived from blast-radius analysis. */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Ordered list of proposed changes. */
  proposedChanges: ProposedChange[];
  /** Execution order — files to touch and in what sequence. */
  executionOrder: string[];
  /** Top blast-radius concerns (files with many dependents). */
  blastRadiusConcerns: string[];
  /** Key observations from each turn. */
  turns: ReactTurn[];
  /** Total tool invocations used. */
  toolCallsUsed: number;
  /** Human-readable summary for logging. */
  summary: string;
}

// ── Constants

const MAX_TURNS = 6;
const MAX_TOOL_CALLS_PER_TURN = 3;
const MAX_FILE_BYTES = 8_000; // read first 8 KB of each file

// ── Helpers

async function safeReadFile(absPath: string): Promise<string> {
  try {
    const buf = await readFile(absPath);
    const text = buf.toString('utf-8');
    return text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) + '\n... [truncated]' : text;
  } catch {
    return '';
  }
}

function topIssueFiles(scan: ScanResult, limit: number): string[] {
  const seen = new Set<string>();
  const files: string[] = [];

  for (const issue of scan.issuesByType) {
    for (const loc of (issue.locations ?? [])) {
      const f = loc;
      if (f && !seen.has(f)) {
        seen.add(f);
        files.push(f);
        if (files.length >= limit) return files;
      }
    }
  }

  return files;
}

function computeConfidence(
  blastConcerns: string[],
  riskLevel: string,
  proposedChanges: ProposedChange[],
  toolCallsUsed: number,
): number {
  let score = 0.7; // base

  // More proposed changes with clear priority = higher confidence
  const highPri = proposedChanges.filter(c => c.priority === 'high').length;
  score += Math.min(highPri * 0.05, 0.15);

  // Blast radius concerns reduce confidence
  score -= Math.min(blastConcerns.length * 0.05, 0.2);

  // High/critical risk reduces confidence
  if (riskLevel === 'high') score -= 0.1;
  if (riskLevel === 'critical') score -= 0.2;

  // More tool calls = more thorough analysis = slightly higher confidence
  score += Math.min(toolCallsUsed * 0.01, 0.05);

  return Math.max(0.1, Math.min(1.0, score));
}

function deriveRiskLevel(blastConcerns: string[], maxDirectCallers: number): ReactAnalysis['riskLevel'] {
  if (maxDirectCallers >= 10 || blastConcerns.length >= 5) return 'critical';
  if (maxDirectCallers >= 5 || blastConcerns.length >= 3) return 'high';
  if (maxDirectCallers >= 2 || blastConcerns.length >= 1) return 'medium';
  return 'low';
}

// ── Turn Executors

/**
 * Turn 1 — Read: examine target files and reason about top issues.
 * Max 3 file reads.
 */
export async function runReadTurn(
  scan: ScanResult,
  target: Target,
  cwd: string,
): Promise<{ turn: ReactTurn; topFiles: string[]; toolCalls: number }> {
  const actions: string[] = [];
  const observations: string[] = [];
  let toolCalls = 0;

  // Collect top issue files (up to 3)
  const topFiles = topIssueFiles(scan, MAX_TOOL_CALLS_PER_TURN);

  // If the scan didn't surface file locations, fall back to the target path
  if (topFiles.length === 0 && target.path) {
    topFiles.push(target.path);
  }

  for (const filePath of topFiles.slice(0, MAX_TOOL_CALLS_PER_TURN)) {
    const absPath = existsSync(filePath) ? filePath : join(cwd, filePath);
    if (!existsSync(absPath)) continue;

    toolCalls++;
    actions.push(`read:${relative(cwd, absPath)}`);
    const content = await safeReadFile(absPath);
    const lineCount = content.split('\n').length;
    observations.push(`${relative(cwd, absPath)}: ${lineCount} lines read`);
  }

  const issueTypes = scan.issuesByType.slice(0, 5).map(i => `${i.subcategory}(${i.count})`);

  const reasoning =
    `Target: ${target.path} | Score: ${scan.total}/${scan.maxTotal} | ` +
    `Top issues: ${issueTypes.join(', ')}. ` +
    `Read ${topFiles.length} file(s) to understand current state.`;

  return {
    turn: { index: 1, phase: 'read', reasoning, actions, observations },
    topFiles,
    toolCalls,
  };
}

/**
 * Turn 2 — Investigate: use GitNexus to assess blast radius.
 * Max 3 calls (impact + context + queryFlows).
 */
function runInvestigateTurn(
  topFiles: string[],
  target: Target,
  cwd: string,
): { turn: ReactTurn; blastConcerns: string[]; maxDirectCallers: number; toolCalls: number } {
  const actions: string[] = [];
  const observations: string[] = [];
  const blastConcerns: string[] = [];
  let toolCalls = 0;
  let maxDirectCallers = 0;

  if (!isIndexed(cwd)) {
    return {
      turn: {
        index: 2,
        phase: 'investigate',
        reasoning: 'GitNexus index not found — skipping blast-radius analysis.',
        actions: [],
        observations: ['GitNexus not indexed for this repo'],
      },
      blastConcerns: [],
      maxDirectCallers: 0,
      toolCalls: 0,
    };
  }

  // Tool call 1: impact on primary target
  const primaryTarget = topFiles[0] ?? target.path;
  if (primaryTarget) {
    toolCalls++;
    actions.push(`impact:${primaryTarget}`);
    const impact = getImpact(primaryTarget, cwd);
    if (impact) {
      maxDirectCallers = Math.max(maxDirectCallers, impact.directCallers.length);
      const obs = `Impact(${primaryTarget}): ${impact.directCallers.length} direct callers, risk=${impact.riskLevel}`;
      observations.push(obs);
      if (impact.directCallers.length >= 3) {
        blastConcerns.push(primaryTarget);
      }
    } else {
      observations.push(`Impact(${primaryTarget}): not indexed`);
    }
  }

  // Tool call 2: context on secondary file (if available)
  if (topFiles.length >= 2 && toolCalls < MAX_TOOL_CALLS_PER_TURN) {
    const secondFile = topFiles[1]!;
    toolCalls++;
    actions.push(`context:${secondFile}`);
    const ctx = getContext(secondFile, cwd);
    if (ctx) {
      const incomingCount = Object.values(ctx.incoming).flat().length;
      const obs = `Context(${secondFile}): ${incomingCount} incoming refs`;
      observations.push(obs);
      if (incomingCount >= 5) blastConcerns.push(secondFile);
    } else {
      observations.push(`Context(${secondFile}): not indexed`);
    }
  }

  // Tool call 3: query execution flows for the top issue type
  if (toolCalls < MAX_TOOL_CALLS_PER_TURN) {
    const concept = target.description ?? target.name;
    toolCalls++;
    actions.push(`queryFlows:${concept}`);
    const flows = queryFlows(concept, cwd, 3);
    if (flows.length > 0) {
      observations.push(`Flows for "${concept}": ${flows.slice(0, 3).join(', ')}`);
    } else {
      observations.push(`No execution flows indexed for "${concept}"`);
    }
  }

  const reasoning =
    `Blast-radius analysis: ${blastConcerns.length} high-risk file(s), ` +
    `max direct callers = ${maxDirectCallers}. ` +
    (blastConcerns.length > 0 ? `Concerns: ${blastConcerns.join(', ')}.` : 'No major concerns found.');

  return {
    turn: { index: 2, phase: 'investigate', reasoning, actions, observations },
    blastConcerns,
    maxDirectCallers,
    toolCalls,
  };
}

/**
 * Turn 3 — Plan: synthesize observations into ordered proposed changes.
 * No additional tool calls — pure reasoning.
 */
function runPlanTurn(
  scan: ScanResult,
  topFiles: string[],
  blastConcerns: string[],
  riskLevel: ReactAnalysis['riskLevel'],
  confidence: number,
): { turn: ReactTurn; proposedChanges: ProposedChange[]; executionOrder: string[] } {
  const proposedChanges: ProposedChange[] = [];

  // Build proposed changes from top issue types + affected files
  const issuesByFile = new Map<string, string[]>();
  for (const issue of scan.issuesByType.slice(0, 6)) {
    for (const loc of (issue.locations ?? [])) {
      const f = loc;
      if (!f) continue;
      if (!issuesByFile.has(f)) issuesByFile.set(f, []);
      issuesByFile.get(f)!.push(issue.subcategory);
    }
  }

  for (const [file, issues] of issuesByFile) {
    const isHighRisk = blastConcerns.includes(file);
    proposedChanges.push({
      filePath: file,
      description: `Fix ${issues.join(', ')} in ${file}`,
      priority: isHighRisk ? 'medium' : 'high',
    });
    if (proposedChanges.length >= MAX_TOOL_CALLS_PER_TURN) break;
  }

  // Fallback: if no location data, create entries from top files
  if (proposedChanges.length === 0) {
    for (const file of topFiles.slice(0, 3)) {
      proposedChanges.push({
        filePath: file,
        description: `Fix issues in ${file}`,
        priority: 'medium',
      });
    }
  }

  // Execution order: high-blast-radius files last (safer to touch dependents first)
  const executionOrder = [
    ...proposedChanges.filter(c => !blastConcerns.includes(c.filePath)).map(c => c.filePath),
    ...proposedChanges.filter(c => blastConcerns.includes(c.filePath)).map(c => c.filePath),
  ];

  const confPct = Math.round(confidence * 100);
  const reasoning =
    `Plan: ${proposedChanges.length} change(s) proposed, risk=${riskLevel}, ` +
    `confidence=${confPct}%. ` +
    `Execution order prioritizes low-blast-radius files first.`;

  const observations = proposedChanges.map(c => `→ [${c.priority}] ${c.description}`);

  return {
    turn: { index: 3, phase: 'plan', reasoning, actions: [], observations },
    proposedChanges,
    executionOrder: [...new Set(executionOrder)],
  };
}

// ── Main Export

/**
 * Run a multi-turn ReACT (Reason-Act-Observe) loop for deep pre-click analysis.
 *
 * Phases:
 *   Turn 1 (read):        Read target files, reason about issues
 *   Turn 2 (investigate): Use GitNexus to understand blast radius
 *   Turn 3 (plan):        Formulate plan with confidence score
 *
 * Constraints: max 3 tool calls per turn, max 6 total iterations.
 * Non-fatal — returns a best-effort analysis even if individual turns fail.
 */
export async function runDeepAnalyze(
  scan: ScanResult,
  target: Target,
  cwd: string,
): Promise<ReactAnalysis> {
  logger.info({ target: target.name }, '[react] Starting deep analysis');

  const turns: ReactTurn[] = [];
  let totalToolCalls = 0;
  let topFiles: string[] = [];
  let blastConcerns: string[] = [];
  let maxDirectCallers = 0;

  // Turn 1: Read
  if (totalToolCalls < MAX_TURNS) {
    try {
      const result = await runReadTurn(scan, target, cwd);
      turns.push(result.turn);
      topFiles = result.topFiles;
      totalToolCalls += result.toolCalls;
      logger.debug({ toolCalls: result.toolCalls }, '[react] Turn 1 complete');
    } catch (err) {
      logger.warn({ err }, '[react] Turn 1 failed');
      turns.push({
        index: 1, phase: 'read',
        reasoning: 'Read turn failed — falling back to scan data only.',
        actions: [], observations: ['Error during file reads'],
      });
    }
  }

  // Turn 2: Investigate (GitNexus)
  if (totalToolCalls < MAX_TURNS) {
    try {
      const result = runInvestigateTurn(topFiles, target, cwd);
      turns.push(result.turn);
      blastConcerns = result.blastConcerns;
      maxDirectCallers = result.maxDirectCallers;
      totalToolCalls += result.toolCalls;
      logger.debug({ toolCalls: result.toolCalls }, '[react] Turn 2 complete');
    } catch (err) {
      logger.warn({ err }, '[react] Turn 2 failed');
      turns.push({
        index: 2, phase: 'investigate',
        reasoning: 'Investigation turn failed.',
        actions: [], observations: ['Error during GitNexus queries'],
      });
    }
  }

  // Compute risk + confidence before Turn 3
  const riskLevel = deriveRiskLevel(blastConcerns, maxDirectCallers);

  // Turn 3: Plan
  let proposedChanges: ProposedChange[] = [];
  let executionOrder: string[] = [];

  if (totalToolCalls < MAX_TURNS) {
    const confidence = computeConfidence(blastConcerns, riskLevel, [], totalToolCalls);
    try {
      const result = runPlanTurn(scan, topFiles, blastConcerns, riskLevel, confidence);
      turns.push(result.turn);
      proposedChanges = result.proposedChanges;
      executionOrder = result.executionOrder;
      logger.debug({ changes: proposedChanges.length }, '[react] Turn 3 complete');
    } catch (err) {
      logger.warn({ err }, '[react] Turn 3 failed');
      turns.push({
        index: 3, phase: 'plan',
        reasoning: 'Planning turn failed.',
        actions: [], observations: ['Error during plan synthesis'],
      });
    }
  }

  const finalConfidence = computeConfidence(
    blastConcerns, riskLevel, proposedChanges, totalToolCalls,
  );

  const summary =
    `Deep analysis: ${turns.length} turns, ${totalToolCalls} tool calls, ` +
    `${proposedChanges.length} proposed changes, ` +
    `risk=${riskLevel}, confidence=${Math.round(finalConfidence * 100)}%`;

  logger.info({ summary }, '[react] Analysis complete');

  return {
    confidence: finalConfidence,
    riskLevel,
    proposedChanges,
    executionOrder,
    blastRadiusConcerns: blastConcerns,
    turns,
    toolCallsUsed: totalToolCalls,
    summary,
  };
}
