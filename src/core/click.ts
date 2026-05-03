import type {
  Click,
  Target,
  RatchetConfig,
  BuildResult,
  HardenPhase,
  ClickGuards,
  ClickEconomics,
  RollbackReason,
} from "../types.js";
import { GUARD_PROFILES } from "../types.js";
import type { Agent } from "./agents/base.js";
import { createAgentContext } from "./agents/base.js";
import type { IssueTask } from "./issue-backlog.js";
import { progressiveGates } from "./test-isolation.js";
import * as git from "./git.js";
import type { ClickPhase } from "./engine.js";
import { RedTeamAgent, detectTestFile, getOriginalCode } from "./adversarial.js";
import type { RedTeamResult } from "./adversarial.js";
import { readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { execFileSync } from "child_process";
import { getImpact } from "./gitnexus.js";
import { prevalidate } from "./prevalidate.js";
import type { PrevalidateResult, PrevalidateOptions } from "./prevalidate.js";
import { buildClickContext } from "./context-pruner.js";
import { logger } from "../lib/logger.js";
import { selectModel } from "../lib/model-router.js";
import { applyTransforms } from "./transforms/base.js";
import { transformRegistry, tagFindingsWithTransforms } from "./transforms/registry.js";
import type { Finding } from "./normalize.js";
import { validatePlan } from "./plan-first.js";
import type { IntentPlan } from "./smart-applier.js";
import type { RepoContext } from "./familiarize.js";

interface ClickGuardedAgent extends Agent {
  clickGuards: ClickGuards;
}

function hasClickGuards(agent: Agent): agent is ClickGuardedAgent {
  return "clickGuards" in agent;
}

const UNKNOWN_REPO_CONTEXT: RepoContext = {
  importStyle: "unknown",
  indentation: "unknown",
  quoteStyle: "unknown",
  semicolons: null,
  errorHandling: "unknown",
  testPattern: "unknown",
  testDir: null,
  testRunnerName: null,
  sourceDirs: [],
  entryPoint: null,
  hotFiles: [],
  detectedAt: new Date(0).toISOString(),
};

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
  /**
   * Pre-resolved guards for this click. null = atomic (no limits).
   * When set, overrides config.guards and mode-based defaults.
   * Set by the engine using resolveGuards() based on CLI flag > target config > mode defaults.
   */
  resolvedGuards?: ClickGuards | null;
  /** Main repo cwd for GitNexus lookups (worktrees don't have .gitnexus) */
  gitnexusCwd?: string;
  /** Execution plan from click 0 (--plan-first) — injected into agent context */
  planContext?: string;
  /** Pre-existing test failures captured at baseline — exempt from rollback decisions */
  baselineFailures?: string[];
  /** When true, use context pruning to build a focused prompt instead of full codebase analysis */
  contextPruning?: boolean;
  /** Scan result for context pruning — required when contextPruning is true */
  scanResult?: import("../core/scanner").ScanResult;
  /** Repo-level style and structure hints used by deterministic transforms. */
  repoContext?: RepoContext;
  /**
   * AST-only mode (free tier): skip LLM path entirely, only apply deterministic transforms.
   */
  astOnlyMode?: boolean;
  onPhase?: (phase: ClickPhase) => void | Promise<void>;
}

export interface ClickOutcome {
  click: Click;
  rolled_back: boolean;
  /** True if the risk gate determined this file needs swarm mode */
  requiresSwarm?: boolean;
  economics: ClickEconomics;
}

// Cost lookup table: input/output price per 1M tokens (USD)
const MODEL_COSTS: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  sonnet: { inputPer1M: 3, outputPer1M: 15 },
  opus: { inputPer1M: 15, outputPer1M: 75 },
  haiku: { inputPer1M: 0.25, outputPer1M: 1.25 },
};

/** Estimate API cost from lines changed (1 line ≈ 20 input tokens + 10 output tokens). */
export function estimateCost(linesChanged: number, model?: string): number {
  const key = model?.toLowerCase().includes("opus")
    ? "opus"
    : model?.toLowerCase().includes("haiku")
      ? "haiku"
      : "sonnet";
  const { inputPer1M, outputPer1M } = MODEL_COSTS[key];
  const inputTokens = linesChanged * 20;
  const outputTokens = linesChanged * 10;
  return (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
}

/** Map a free-form rollback reason string to a typed RollbackReason. */
export function classifyRollbackReason(reason?: string): RollbackReason | undefined {
  if (!reason) return undefined;
  if (/timeout|timed.?out/i.test(reason)) return "timeout";
  if (/scope.exceed/i.test(reason)) return "scope-exceeded";
  if (/score.regress/i.test(reason)) return "score-regression";
  if (/lint|typecheck|tsc|noEmit/i.test(reason)) return "lint-error";
  if (
    reason.startsWith("Too many lines changed:") ||
    reason.startsWith("Too many files changed:") ||
    reason.startsWith("Single file changed too many lines")
  )
    return "guard-rejected";
  return "test-related";
}

/** Determine the ClickEconomics outcome from rolled_back state and reason. */
/**
 * Sort AST-transformable findings by file density (most issues per file first),
 * then limit to the top N files to maximise score impact per click.
 */
function rankFilesByDensity(findings: Finding[], topN = 3): Finding[] {
  if (findings.length === 0) return findings;
  const fileCounts = new Map<string, number>();
  for (const f of findings) {
    if (f.file) fileCounts.set(f.file, (fileCounts.get(f.file) ?? 0) + 1);
  }
  const topFiles = new Set(
    [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([file]) => file)
  );
  return findings.filter(f => f.file && topFiles.has(f.file));
}

export function determineOutcome(rolledBack: boolean, rollbackReason?: string): ClickEconomics["outcome"] {
  if (!rolledBack) return "landed";
  if (!rollbackReason) return "rolled-back";
  if (/timeout|timed.?out/i.test(rollbackReason)) return "timeout";
  if (
    rollbackReason.startsWith("Too many lines changed:") ||
    rollbackReason.startsWith("Too many files changed:") ||
    rollbackReason.startsWith("Single file changed too many lines")
  )
    return "guard-rejected";
  if (/scope.exceed/i.test(rollbackReason)) return "scope-rejected";
  return "rolled-back";
}

/**
 * Execute a single click: analyze → propose → build → test → commit (or rollback).
 * This is the Pawl: on test failure we revert, leaving the codebase only ever better.
 */
export async function executeClick(ctx: ClickContext): Promise<ClickOutcome> {
  const { clickNumber, target, config, agent, cwd, hardenPhase, issues, onPhase } = ctx;
  const timestamp = new Date();

  // Route to the appropriate model tier based on click mode
  const effectiveModel = selectModel(ctx.architectMode ? "complex" : ctx.sweepMode ? "mechanical" : "standard", config);
  const wallStartMs = Date.now();
  let agentStartMs = wallStartMs;
  let agentEndMs = wallStartMs;
  let testStartMs = wallStartMs;
  let testEndMs = wallStartMs;
  let linesChanged = 0;

  // Pre-click risk gate: if file has >10 direct dependents and change is structural,
  // signal that swarm mode is required instead of single-agent
  if (!config.swarm?.enabled && !ctx.sweepMode) {
    const riskGate = checkRiskGate(target.path, ctx.gitnexusCwd ?? cwd);
    if (riskGate.requiresSwarm) {
      logger.warn(
        `[ratchet] ⚠ Risk gate: ${target.path} has ${riskGate.dependentCount} dependents — escalating to swarm`
      );
      return {
        click: {
          number: clickNumber,
          target: target.name,
          analysis: "",
          proposal: `risk-gate: ${riskGate.dependentCount} dependents require swarm mode`,
          filesModified: [],
          testsPassed: false,
          riskScore: riskGate.riskScore,
          timestamp,
        },
        rolled_back: false,
        requiresSwarm: true,
        economics: {
          clickIndex: clickNumber,
          wallTimeMs: Date.now() - wallStartMs,
          agentTimeMs: 0,
          testTimeMs: 0,
          estimatedCost: 0,
          outcome: "rolled-back",
          issuesFixed: 0,
          scoreDelta: 0,
        },
      };
    }
  }

  // Stash current state so we can roll back if tests fail.
  // stashCreated tracks whether git actually created a stash entry — if the working tree
  // was already clean, git exits 0 but creates nothing. Popping a non-existent stash
  // would silently pop the user's prior saved work.
  const stashCreated = await git.stash(cwd, `ratchet-pre-click-${clickNumber}`);

  let analysis = "";
  let proposal = "";
  let buildResult: BuildResult = { success: false, output: "", filesModified: [] };
  let testsPassed = false;
  let commitHash: string | undefined;
  let rolledBack = false;
  let rollbackReason: string | undefined;

  try {
    // Pass GitNexus cwd to the agent so worktree agents can look up intelligence
    if (ctx.gitnexusCwd && "gitnexusCwd" in agent) {
      (agent as { gitnexusCwd?: string }).gitnexusCwd = ctx.gitnexusCwd;
    }

    // 0. AST Transform pass (Layer 1) — deterministic, zero-LLM fixes.
    //    If any issues match a registered transform, apply them before the agent.
    //    All-AST clicks skip the LLM entirely ('ast' click type).
    const astHandledIssueKeys = new Set<string>();
    let astIsAstOnlyClick = false;
    if (ctx.scanResult && issues && issues.length > 0) {
      try {
        // Build synthetic Finding objects from IssueTask + IssueType locations
        const syntheticFindings: Finding[] = [];
        for (const issue of issues) {
          const issueType = ctx.scanResult.issuesByType.find(
            it => it.category === issue.category && it.subcategory === issue.subcategory
          );
          const locations = issueType?.locations ?? [];
          if (locations.length === 0) {
            // No file locations — create a location-less finding for registry tag check
            syntheticFindings.push({
              category: issue.category,
              subcategory: issue.subcategory,
              severity: issue.severity,
              message: issue.description,
              confidence: 0.8,
              source: "classic",
            });
          } else {
            for (const loc of locations) {
              syntheticFindings.push({
                category: issue.category,
                subcategory: issue.subcategory,
                severity: issue.severity,
                message: issue.description,
                confidence: 0.8,
                source: "classic",
                file: loc,
              });
            }
          }
        }

        tagFindingsWithTransforms(syntheticFindings);

        const transformableFindings = rankFilesByDensity(
          syntheticFindings.filter(f => f.fixStrategy === "ast" && f.file)
        );

        if (transformableFindings.length > 0) {
          // Read file contents for all relevant files
          const filePaths = [...new Set(transformableFindings.map(f => f.file!))];
          const fileContents = new Map<string, string>();
          for (const fp of filePaths) {
            const absPath = resolve(cwd, fp);
            try {
              fileContents.set(fp, await readFile(absPath, "utf8"));
            } catch {
              // File not found — skip
            }
          }

          const repoCtx = ctx.repoContext ?? UNKNOWN_REPO_CONTEXT;
          const astResult = applyTransforms(
            transformableFindings,
            fileContents,
            {
              repoContext: repoCtx,
              testRunner: null,
              hasStructuredLogger: false,
              loggerImportPath: null,
              loggerVarName: "logger",
            },
            transformRegistry
          );

          if (astResult.modifiedFiles.size > 0) {
            // Write modified files back to disk
            for (const [fp, content] of astResult.modifiedFiles) {
              await writeFile(resolve(cwd, fp), content, "utf8");
            }

            const modifiedPaths = [...astResult.modifiedFiles.keys()];
            logger.info(
              `[ratchet] ⚡ AST transforms applied to ${modifiedPaths.length} file(s) ` +
                `(${astResult.handledFindings.length} findings)`
            );

            // Record which issue keys were handled so we can filter them from LLM issues
            for (const f of astResult.handledFindings) {
              astHandledIssueKeys.add(`${f.category}::${f.subcategory}`);
            }

            // Check if ALL issues were handled by AST transforms (pure ast click)
            const allHandled = issues.every(iss => astHandledIssueKeys.has(`${iss.category}::${iss.subcategory}`));

            if (allHandled) {
              astIsAstOnlyClick = true;
              analysis = "AST transforms applied (no LLM required)";
              proposal = `ast: applied ${astResult.handledFindings.length} deterministic fixes to ${modifiedPaths.length} file(s)`;
              buildResult = { success: true, output: "ast transforms", filesModified: modifiedPaths };
              agentEndMs = Date.now();
            }
          }
        }
      } catch (err) {
        logger.debug({ err }, "[ratchet] AST transform pass error — falling through to LLM");
      }
    }

    // AST-only mode (free tier): skip LLM path if AST couldn't handle everything.
    // Detect APIAgent by checking for clickGuards property (free engine marker).
    const isAstOnlyMode = ctx.astOnlyMode ?? "clickGuards" in ctx.agent;
    if (!astIsAstOnlyClick && isAstOnlyMode) {
      if (astHandledIssueKeys.size > 0) {
        astIsAstOnlyClick = true;
        analysis = "AST transforms applied (partial — astOnlyMode skipped LLM for remaining issues)";
      } else {
        analysis = "AST-only mode: no applicable transforms for remaining issues";
        proposal = "ast-only: no transforms matched";
        buildResult = { success: true, output: "no-op", filesModified: [] };
        agentEndMs = Date.now();
        astIsAstOnlyClick = true;
      }
    }

    if (astIsAstOnlyClick) {
      // Skip LLM path — fall through to test/commit gates below
    } else {
      // 1. Analyze
      agentStartMs = Date.now();
      await onPhase?.("analyzing");
      let context = createAgentContext(target, clickNumber, hardenPhase);
      if (ctx.planContext) {
        context += "\n\n## Execution Plan\n" + ctx.planContext;
      }
      // Context pruning: inject focused issue context so agent skips full re-scan
      if (ctx.contextPruning && ctx.scanResult && issues && issues.length > 0) {
        const pruned = buildClickContext(ctx.scanResult, issues, cwd);
        context += "\n\n" + pruned.summary;
      }
      analysis = await agent.analyze(context, hardenPhase, issues);

      // 2. Propose
      await onPhase?.("proposing");
      proposal = await agent.propose(analysis, target, hardenPhase, issues);

      if (!proposal.trim()) {
        throw new Error(
          "Agent returned an empty proposal — nothing to implement.\n" +
            "  The agent may be rate-limited, misconfigured, or unresponsive.\n" +
            "  Check that the agent command works from the command line."
        );
      }

      // 3. Build (apply code change)
      await onPhase?.("building");
      // Inject click guards into APIAgent so the LLM prompt includes size constraints.
      // APIAgent always gets tight guards (1 file, 20 lines) regardless of mode — it can
      // only do atomic single-file edits and must never receive sweep/refactor/broad constraints.
      if (hasClickGuards(agent)) {
        agent.clickGuards = { maxFilesChanged: 1, maxLinesChanged: 20 };
      }
      buildResult = await agent.build(proposal, cwd);
      agentEndMs = Date.now();

      if (!buildResult.success) {
        logger.debug(`[ratchet] Build failed. Output: ${buildResult.output?.slice(0, 500)}`);
        rollbackReason = "build failed";
        await rollback(cwd, clickNumber, stashCreated);
        rolledBack = true;
      } else if (buildResult.filesModified.length === 0) {
        // Agent reported no files modified — confirm via git before treating as no-op.
        // A clean working tree means the agent genuinely made no changes.
        const gitSt = await git.status(cwd).catch(() => null);
        if (gitSt?.clean) {
          logger.info(`[ratchet] ⏭ Click ${clickNumber} — agent found nothing to change`);
          if (stashCreated) {
            await git.gitDropStash(cwd).catch(() => {});
          }
          testsPassed = true; // no changes = no regression
        } else {
          // Git shows changes that the agent didn't report in filesModified.
          // Filter out ratchet-owned paths — if only metadata changed, treat as a no-op.
          const rawUnstaged = gitSt?.unstaged ?? [];
          const sourceChanges = rawUnstaged.filter(
            f =>
              !git.RATCHET_PATHS.some(rp => {
                const pattern = rp.endsWith("/") ? rp.slice(0, -1) : rp;
                // glob-style: patterns containing * are prefix-matched, others exact
                if (pattern.includes("*")) {
                  const prefix = pattern.split("*")[0];
                  return f.startsWith(prefix);
                }
                return f === pattern || f.startsWith(rp);
              })
          );
          if (sourceChanges.length === 0) {
            // Only ratchet metadata changed — treat as no-op
            logger.info(`[ratchet] ⏭ Click ${clickNumber} — only ratchet metadata changed, treating as no-op`);
            if (stashCreated) {
              await git.gitDropStash(cwd).catch(() => {});
            }
            testsPassed = true;
          } else {
            // Real source changes present — fall through to normal test-gate path
            buildResult = { ...buildResult, filesModified: sourceChanges };
          }
        }
      }
    } // end LLM agent path (else branch of astIsAstOnlyClick)

    // Plan-first validation: verify that all files the agent claims to have modified
    // actually exist on disk. Guards against agents that report phantom file changes.
    if (!rolledBack && buildResult.success && buildResult.filesModified.length > 0) {
      const minPlan: IntentPlan = {
        action: "replace",
        targetLines: [1, 1],
        description: "",
        pattern: "",
        replacement_intent: "",
        imports_needed: [],
        confidence: 1.0,
      };
      for (const fp of buildResult.filesModified) {
        const validation = await validatePlan(minPlan, cwd, fp);
        if (!validation.valid) {
          logger.warn(`[ratchet] ⚠ Plan-first: modified file not found on disk: ${fp} — rolling back`);
          rollbackReason = "plan-first: file not found";
          await rollback(cwd, clickNumber, stashCreated);
          rolledBack = true;
          break;
        }
      }
    }

    if (!rolledBack && buildResult.success && !testsPassed) {
      // Click guards: reject over-aggressive changes before running tests
      // Use pre-resolved guards from context if available; otherwise fall back to config + mode defaults
      const effectiveGuards =
        ctx.resolvedGuards !== undefined
          ? ctx.resolvedGuards
          : resolveGuardsFromConfig(config.guards, ctx.sweepMode, ctx.architectMode);
      const guardResult = checkClickGuards(cwd, effectiveGuards, ctx.sweepMode);
      if (guardResult.linesChanged) linesChanged = guardResult.linesChanged;
      if (!guardResult.passed && !ctx.atomicSweep && effectiveGuards !== null) {
        logger.warn(`[ratchet] 🛡 Click ${clickNumber} rejected by guards: ${guardResult.reason}`);
        logger.warn(`[ratchet]   ${guardResult.detail}`);
        rollbackReason = guardResult.reason;
        await rollback(cwd, clickNumber, stashCreated);
        rolledBack = true;
      } else if (!guardResult.passed && (ctx.atomicSweep || effectiveGuards === null)) {
        logger.warn(
          `[ratchet] Click ${clickNumber} guard exceeded (${guardResult.reason})` +
            ` — proceeding in atomic mode, test suite is the gate`
        );
      }

      if (!rolledBack) {
        // 3.5. Pre-commit validation (runs before tests to catch bad changes early)
        let prevalidateResult: PrevalidateResult | undefined;
        try {
          const prevalidateOpts: PrevalidateOptions = { strict: false };
          prevalidateResult = await prevalidate(cwd, effectiveModel, prevalidateOpts);
          if (prevalidateResult.concerns.length > 0) {
            logger.warn(
              `[ratchet] 🔍 Prevalidate click ${clickNumber}: confidence=${prevalidateResult.confidence.toFixed(2)}, ` +
                `recommendation=${prevalidateResult.recommendation}`
            );
            for (const concern of prevalidateResult.concerns.slice(0, 3)) {
              logger.warn(`[ratchet]   concern: ${concern}`);
            }
          }
        } catch (err) {
          logger.debug({ err }, "prevalidation");
        }

        if (prevalidateResult?.recommendation === "reject") {
          logger.warn(
            `[ratchet] Click ${clickNumber} REJECTED by prevalidate` +
              ` (confidence=${prevalidateResult.confidence.toFixed(2)}) — rolling back without tests`
          );
          rollbackReason = `prevalidate rejected (confidence ${prevalidateResult.confidence.toFixed(2)})`;
          await rollback(cwd, clickNumber, stashCreated);
          rolledBack = true;
        } else if (prevalidateResult?.recommendation === "escalate-swarm") {
          // Signal swarm escalation — tests will still run, but caller will know
          logger.warn(
            `[ratchet] Prevalidate: escalating click ${clickNumber} to swarm ` +
              `(confidence=${prevalidateResult.confidence.toFixed(2)})`
          );
        }
      } // end prevalidate block

      if (!rolledBack) {
        // 4. Test (the Pawl) — progressive gates if testIsolation is enabled
        testStartMs = Date.now();
        await onPhase?.("testing");
        const gateResult = await progressiveGates(config, cwd, ctx.baselineFailures ?? []);
        testEndMs = Date.now();

        testsPassed = gateResult.passed;

        if (!testsPassed) {
          logger.debug(
            `[ratchet] Tests FAILED at gate=${gateResult.gate}. ` +
              `Output (last 500 chars): ${gateResult.output.slice(-500)}`
          );
          if (gateResult.failedTests.length > 0) {
            rollbackReason = `tests failed (${gateResult.gate}): ${gateResult.failedTests.join(", ")}`;
          } else {
            const lastLine = gateResult.output
              .split("\n")
              .filter(l => l.trim())
              .at(-1)
              ?.trim()
              .slice(0, 80);
            rollbackReason = lastLine ?? `${gateResult.gate} gate failed`;
          }
          await rollback(cwd, clickNumber, stashCreated);
          rolledBack = true;
        } else {
          if (gateResult.landedWithWarning && gateResult.warningMessage) {
            logger.warn(`[ratchet] ⚠ Click ${clickNumber}: ${gateResult.warningMessage}`);
          }
          if (config.defaults.autoCommit) {
            // 5. Commit on success
            await onPhase?.("committing");
            const message = buildCommitMessage(clickNumber, target, proposal, buildResult.filesModified);
            const maybeHash = await git.commitSourceOnly(message, cwd);
            if (maybeHash === null) {
              logger.warn(
                `[ratchet] ⚠ Click ${clickNumber} — no source changes to commit after filtering ratchet metadata`
              );
            } else {
              commitHash = maybeHash;
            }
            // Drop the stash since we committed successfully (only if we created one)
            if (stashCreated) {
              await git.gitDropStash(cwd).catch(() => {});
            }

            // 6. Adversarial QA — challenge the committed change
            if (ctx.adversarial && commitHash && buildResult.filesModified.length > 0) {
              const redTeamResult = await runAdversarialChallenge(buildResult.filesModified, cwd, config);

              if (redTeamResult?.rollbackRecommended) {
                logger.warn(`[ratchet] Red team challenge FAILED — reverting commit ${commitHash.slice(0, 7)}`);
                logger.warn(`[ratchet] Reason: ${redTeamResult.reasoning}`);
                // Revert the commit (soft reset to undo the commit, then hard reset to undo changes)
                await git.revert(cwd).catch(() => {});
                rolledBack = true;
                testsPassed = false;
                commitHash = undefined;
              }
            }
          } // end if (config.defaults.autoCommit)
        } // end else (tests passed)
      } // end if (!rolledBack) — click guards
    }
  } catch (err: unknown) {
    // Unexpected error — roll back to be safe
    await rollback(cwd, clickNumber, stashCreated).catch(() => {});
    rolledBack = true;
    const error = err as Error;
    rollbackReason = error.message?.slice(0, 80) ?? "unexpected error";
    buildResult = {
      success: false,
      output: error.message ?? "Unknown error",
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

  const economics: ClickEconomics = {
    clickIndex: clickNumber,
    wallTimeMs: Date.now() - wallStartMs,
    agentTimeMs: agentEndMs - agentStartMs,
    testTimeMs: testEndMs - testStartMs,
    estimatedCost: estimateCost(linesChanged, effectiveModel),
    outcome: determineOutcome(rolledBack, rollbackReason),
    rollbackReason: classifyRollbackReason(rollbackReason),
    issuesFixed: 0, // updated by engine after re-scan
    scoreDelta: 0, // updated by engine after re-scan
  };

  return { click, rolled_back: rolledBack, economics };
}

/**
 * Parse test runner output to extract up to 3 failing test file names.
 * Handles Vitest, Jest, and common generic patterns.
 */
function extractFailingTestNames(output: string): string[] {
  const names: string[] = [];
  const lines = output.split("\n");

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

/**
 * Resolve guards from a config value + mode flags (legacy fallback for callers
 * that don't pass pre-resolved guards via ClickContext.resolvedGuards).
 */
function resolveGuardsFromConfig(
  guards?: import("../types.js").GuardProfileName | ClickGuards,
  sweepMode?: boolean,
  architectMode?: boolean
): ClickGuards | null {
  if (architectMode) return GUARD_PROFILES.refactor;
  if (sweepMode) {
    // If guards is an explicit ClickGuards object, enforce sweep floor; otherwise use refactor profile
    if (guards && typeof guards === "object") {
      return {
        maxFilesChanged: Math.max(guards.maxFilesChanged, 10),
        maxLinesChanged: Math.max(guards.maxLinesChanged, 120),
      };
    }
    return GUARD_PROFILES.refactor;
  }
  if (!guards) return GUARD_PROFILES.tight;
  if (typeof guards === "string") return GUARD_PROFILES[guards];
  return guards;
}

/**
 * Check click guards: reject over-aggressive changes before running tests.
 * Measures actual git diff to count lines and files changed.
 * In sweep mode, also enforces a per-file line limit.
 * Pass null for resolvedGuards to skip all guard checks (atomic mode).
 */
function checkClickGuards(cwd: string, resolvedGuards: ClickGuards | null, sweepMode?: boolean): GuardResult {
  if (resolvedGuards === null) return { passed: true };
  const { maxLinesChanged, maxFilesChanged } = resolvedGuards;

  try {
    // Count lines changed (insertions + deletions)
    const numstatStaged = execFileSync("git", ["diff", "--numstat", "--cached"], { cwd, encoding: "utf8" }).trim();
    const numstatUnstaged = execFileSync("git", ["diff", "--numstat"], { cwd, encoding: "utf8" }).trim();
    const allNumstat = [numstatStaged, numstatUnstaged].filter(Boolean).join("\n");

    let totalLines = 0;
    const filesSet = new Set<string>();

    for (const line of allNumstat.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
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
          detail:
            `File ${parts[2]} changed ${fileLines} lines (added=${added}, removed=${removed}). ` +
            `Sweep mode allows at most 120 lines per file.`,
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
        detail:
          `Agent changed ${totalLines} lines across ${filesChanged} file(s). ` +
          `This is too aggressive for a single click. ` +
          `The change was rolled back to prevent test failures from broad refactors.`,
        linesChanged: totalLines,
        filesChanged,
      };
    }

    if (filesChanged > maxFilesChanged) {
      return {
        passed: false,
        reason: `Too many files changed: ${filesChanged} > ${maxFilesChanged} max`,
        detail:
          `Agent modified ${filesChanged} files (${totalLines} lines). ` +
          `Clicks should be surgical — ${maxFilesChanged} files max.`,
        linesChanged: totalLines,
        filesChanged,
      };
    }

    return { passed: true, linesChanged: totalLines, filesChanged };
  } catch (err) {
    logger.debug({ err }, "git diff guard");
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
    const impact = getImpact(targetPath.replace(/^\.\//, ""), cwd);
    if (!impact) return { requiresSwarm: false, riskScore: 0, dependentCount: 0 };

    const dependentCount = impact.directCallers.length;
    const riskScore = Math.min(1, dependentCount / 10);

    return {
      requiresSwarm: dependentCount > RISK_GATE_THRESHOLD,
      riskScore,
      dependentCount,
    };
  } catch (err) {
    logger.debug({ err }, "risk gate check");
    return { requiresSwarm: false, riskScore: 0, dependentCount: 0 };
  }
}

async function rollback(cwd: string, clickNumber: number, stashCreated: boolean): Promise<void> {
  if (stashCreated) {
    try {
      await git.stashPop(cwd);
    } catch (err) {
      logger.debug({ err }, "stash pop failed");
      await git.revert(cwd).catch(() => {});
    }
  } else {
    // No stash was created (tree was clean before click), use hard reset instead
    await git.revert(cwd).catch(() => {});
  }
}

function buildCommitMessage(clickNumber: number, target: Target, proposal: string, filesModified?: string[]): string {
  let subject = proposal.split("\n")[0].slice(0, 60).trim();
  // Strip leaked agent system prompts from commit messages
  if (/^You are (a |an |the )/i.test(subject)) {
    subject = filesModified?.length
      ? `Modified ${filesModified.length} file${filesModified.length > 1 ? "s" : ""}: ` +
        `${filesModified
          .map(f => f.split("/").pop())
          .slice(0, 3)
          .join(", ")}${filesModified.length > 3 ? "…" : ""}`
      : "Applied code improvements";
  }
  return `ratchet(${target.name}): click ${clickNumber} — ${subject}`;
}

/**
 * Run adversarial challenge against the first modified file that has a matching test file.
 */
async function runAdversarialChallenge(
  filesModified: string[],
  cwd: string,
  config: RatchetConfig
): Promise<RedTeamResult | undefined> {
  const redTeam = new RedTeamAgent({ model: config.model });

  for (const file of filesModified) {
    const testFile = await detectTestFile(file, cwd);
    if (!testFile) continue;

    const originalCode = await getOriginalCode(file, cwd);
    let newCode: string;
    try {
      newCode = await readFile(join(cwd, file), "utf-8");
    } catch (err) {
      logger.debug({ err }, "read modified file");
      continue;
    }

    return redTeam.challenge(originalCode, newCode, testFile, cwd);
  }

  // No test files found for any modified file — skip silently
  return undefined;
}
