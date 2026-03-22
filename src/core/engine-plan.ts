import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import type { RatchetRun, Target, PlanResult } from '../types.js';
import type { Agent } from './agents/base.js';
import type { ScanResult } from '../commands/scan.js';
import { buildPlanPrompt } from './agents/shell.js';
import { logger } from '../lib/logger.js';

/**
 * Run the read-only planning click 0 before execution clicks.
 * Generates a structured plan and saves it to .ratchet/plans/<timestamp>-<target>.json.
 * Non-fatal — if plan generation fails, execution continues without a plan.
 */
export async function runPlanFirst(
  run: RatchetRun,
  target: Target,
  currentScan: ScanResult | undefined,
  agent: Agent,
  cwd: string,
  callbacks: {
    onPlanStart?: () => Promise<void> | void;
    onPlanComplete?: (plan: PlanResult) => Promise<void> | void;
  },
): Promise<void> {
  await callbacks.onPlanStart?.();
  try {
    const scanSummary = currentScan
      ? `Score: ${currentScan.total}/${currentScan.maxTotal}, ${currentScan.totalIssuesFound} issues found`
      : '';
    const planPrompt = buildPlanPrompt(scanSummary, target.path, target.description);
    const agentWithDirect = agent as { runDirect?: (p: string, cwd: string) => Promise<string> };
    const planOutput = agentWithDirect.runDirect
      ? await agentWithDirect.runDirect(planPrompt, cwd)
      : '';

    if (planOutput) {
      // Extract JSON from agent output (may be wrapped in markdown code fences)
      const jsonMatch = planOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Omit<PlanResult, 'generatedAt'>;
        const planResult: PlanResult = { ...parsed, generatedAt: new Date() };
        run.planResult = planResult;

        // Save plan to .ratchet/plans/<timestamp>-<target>.json
        const plansDir = join(cwd, '.ratchet', 'plans');
        await mkdir(plansDir, { recursive: true });
        const planFileName = `${Date.now()}-${target.name}.json`;
        await writeFile(join(plansDir, planFileName), JSON.stringify(planResult, null, 2), 'utf-8');

        await callbacks.onPlanComplete?.(planResult);
      }
    }
  } catch {
    // Non-fatal — if plan generation fails, continue without plan
    logger.error('Plan generation failed — continuing without plan');
  }
}
