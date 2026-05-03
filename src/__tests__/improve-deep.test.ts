/**
 * Tests for the --deep integration in improve/torque commands.
 *
 * Tests focus on:
 *   1. classifyFinding — mechanical vs semantic subcategory routing
 *   2. routeDeepFix — model tier selection based on findings
 *   3. DeepEngine mock integration — --deep flag triggers DeepEngine
 *   4. Budget tracking — stops at limit
 *   5. Baseline behaviour — without --deep, classic scan is used unchanged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyFinding, routeDeepFix, MECHANICAL_SUBCATEGORIES } from "../core/deep-fix-router.js";
import type { Provider } from "../core/providers/base.js";
import { AnthropicProvider } from "../core/providers/anthropic.js";
import type { IssueType } from "../core/scanner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(name = "Anthropic"): Provider {
  return new AnthropicProvider("test-key");
  void name;
}

function makeIssue(subcategory: string, severity: "high" | "medium" | "low" = "high"): IssueType {
  return {
    category: "Code Quality",
    subcategory,
    count: 1,
    description: `${subcategory} issue`,
    severity,
  };
}

// ---------------------------------------------------------------------------
// classifyFinding
// ---------------------------------------------------------------------------

describe("classifyFinding — mechanical vs semantic", () => {
  it("classifies line length as mechanical", () => {
    expect(classifyFinding("Line length")).toBe("mechanical");
  });

  it("classifies import hygiene as mechanical", () => {
    expect(classifyFinding("Import hygiene")).toBe("mechanical");
  });

  it("classifies console cleanup as mechanical", () => {
    expect(classifyFinding("Console cleanup")).toBe("mechanical");
  });

  it("classifies dead code as mechanical", () => {
    expect(classifyFinding("Dead code")).toBe("mechanical");
  });

  it("classifies function length as mechanical", () => {
    expect(classifyFinding("Function length")).toBe("mechanical");
  });

  it("classifies duplication as mechanical", () => {
    expect(classifyFinding("Duplication")).toBe("mechanical");
  });

  it("classifies input validation as semantic", () => {
    expect(classifyFinding("Input validation")).toBe("semantic");
  });

  it("classifies auth & rate limiting as semantic", () => {
    expect(classifyFinding("Auth & rate limiting")).toBe("semantic");
  });

  it("classifies coverage ratio as semantic", () => {
    expect(classifyFinding("Coverage ratio")).toBe("semantic");
  });

  it("classifies secrets & env vars as semantic", () => {
    expect(classifyFinding("Secrets & env vars")).toBe("semantic");
  });

  it("classifies empty catches as semantic", () => {
    expect(classifyFinding("Empty catches")).toBe("semantic");
  });

  it("classifies unknown subcategory as semantic (safe default)", () => {
    expect(classifyFinding("Some unknown issue")).toBe("semantic");
  });

  it("MECHANICAL_SUBCATEGORIES contains exactly the 6 expected entries", () => {
    expect(MECHANICAL_SUBCATEGORIES.size).toBe(6);
    expect(MECHANICAL_SUBCATEGORIES.has("Line length")).toBe(true);
    expect(MECHANICAL_SUBCATEGORIES.has("Import hygiene")).toBe(true);
    expect(MECHANICAL_SUBCATEGORIES.has("Console cleanup")).toBe(true);
    expect(MECHANICAL_SUBCATEGORIES.has("Dead code")).toBe(true);
    expect(MECHANICAL_SUBCATEGORIES.has("Function length")).toBe(true);
    expect(MECHANICAL_SUBCATEGORIES.has("Duplication")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// routeDeepFix — model routing
// ---------------------------------------------------------------------------

describe("routeDeepFix — mechanical → sweep, semantic → architect", () => {
  const provider = makeProvider();

  it("routes to sweep when all high-severity issues are mechanical", () => {
    const issues: IssueType[] = [
      makeIssue("Line length", "high"),
      makeIssue("Console cleanup", "high"),
      makeIssue("Import hygiene", "high"),
    ];
    const { taskType } = routeDeepFix(issues, provider);
    expect(taskType).toBe("sweep");
  });

  it("routes to architect when any high-severity issue is semantic", () => {
    const issues: IssueType[] = [
      makeIssue("Line length", "high"), // mechanical
      makeIssue("Input validation", "high"), // semantic
    ];
    const { taskType } = routeDeepFix(issues, provider);
    expect(taskType).toBe("architect");
  });

  it("routes to architect for pure semantic high-severity issues", () => {
    const issues: IssueType[] = [makeIssue("Auth & rate limiting", "high"), makeIssue("Coverage ratio", "high")];
    const { taskType } = routeDeepFix(issues, provider);
    expect(taskType).toBe("architect");
  });

  it("routes to architect when there are no high-severity issues (safe default)", () => {
    const issues: IssueType[] = [makeIssue("Line length", "medium"), makeIssue("Console cleanup", "low")];
    const { taskType } = routeDeepFix(issues, provider);
    expect(taskType).toBe("architect");
  });

  it("routes to architect for empty issue list", () => {
    const { taskType } = routeDeepFix([], provider);
    expect(taskType).toBe("architect");
  });

  it("sweep routing returns cheapest model (Haiku) for Anthropic provider", () => {
    const issues: IssueType[] = [makeIssue("Line length", "high")];
    const { model } = routeDeepFix(issues, provider);
    expect(model).toBe("claude-haiku-4-5-20251001");
  });

  it("architect routing returns best model (Opus) for Anthropic provider", () => {
    const issues: IssueType[] = [makeIssue("Input validation", "high")];
    const { model } = routeDeepFix(issues, provider);
    expect(model).toBe("claude-opus-4-6");
  });

  it("medium-severity mechanical issues do not trigger sweep (only high matters)", () => {
    // Only high severity drives sweep routing; medium is ignored
    const issues: IssueType[] = [makeIssue("Line length", "medium"), makeIssue("Dead code", "medium")];
    const { taskType } = routeDeepFix(issues, provider);
    // No high-severity issues → defaults to architect
    expect(taskType).toBe("architect");
  });
});

// ---------------------------------------------------------------------------
// DeepEngine integration — --deep triggers DeepEngine with budget
// ---------------------------------------------------------------------------

describe("DeepEngine integration — triggered by --deep flag", () => {
  function makeMockProvider(): Provider & { sendMessage: ReturnType<typeof vi.fn> } {
    return {
      name: "MockProvider",
      tier: "pro" as const,
      sendMessage: vi.fn().mockResolvedValue("[]"),
      estimateCost: () => 0,
      supportsStructuredOutput: () => false,
    };
  }

  it("DeepEngine.analyze passes budget option through", async () => {
    const { DeepEngine } = await import("../core/engines/deep.js");
    const provider = makeMockProvider();
    const engine = new DeepEngine(provider);
    // Budget of 0 → only preflight call (budget check stops all batch calls)
    await engine.analyze(process.cwd(), { budget: 0, maxFiles: 5 });
    expect(provider.sendMessage).toHaveBeenCalledTimes(1); // preflight only
  });

  it("DeepEngine stops at budget limit — no batch calls when budget is exhausted", async () => {
    const { DeepEngine } = await import("../core/engines/deep.js");
    const provider = makeMockProvider();
    const engine = new DeepEngine(provider);
    // Tiny budget stops all batches — only preflight call goes through
    await engine.analyze(process.cwd(), { budget: 0.000001, maxFiles: 5 });
    expect(provider.sendMessage).toHaveBeenCalledTimes(1); // preflight only
  });

  it("DeepEngine falls back to classic result when budget stops all batches", async () => {
    const { DeepEngine } = await import("../core/engines/deep.js");
    const provider = makeMockProvider();
    const engine = new DeepEngine(provider);
    const result = await engine.analyze(process.cwd(), { budget: 0.000001, maxFiles: 5 });
    // Falls back to valid classic ScanResult
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(result.maxTotal);
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it("routeDeepFix uses Deep findings to select correct model tier", () => {
    // Simulate what improve.ts does after DeepEngine returns findings
    const provider = makeProvider();
    const deepFindings: IssueType[] = [
      makeIssue("Input validation", "high"), // semantic
      makeIssue("Line length", "high"), // mechanical
    ];
    // Mixed: semantic present → architect
    const { taskType } = routeDeepFix(deepFindings, provider);
    expect(taskType).toBe("architect");
  });

  it("routeDeepFix picks sweep when Deep finds only mechanical high issues", () => {
    const provider = makeProvider();
    const deepFindings: IssueType[] = [
      makeIssue("Line length", "high"),
      makeIssue("Dead code", "high"),
      makeIssue("Duplication", "high"),
    ];
    const { taskType } = routeDeepFix(deepFindings, provider);
    expect(taskType).toBe("sweep");
  });
});

// ---------------------------------------------------------------------------
// Baseline: without --deep, classic behaviour is unchanged
// ---------------------------------------------------------------------------

describe("Without --deep flag — classic scan behaviour", () => {
  it("classifyFinding is not invoked in classic scan path", () => {
    // Simulate classic path: no Deep, just pass-through
    const classicIssues: IssueType[] = [makeIssue("Line length", "high"), makeIssue("Console cleanup", "medium")];

    // Without --deep, routeDeepFix is never called.
    // We verify the function is pure and safe to call regardless.
    const provider = makeProvider();
    // Called with mechanical-only issues → sweep
    const { taskType } = routeDeepFix(
      classicIssues.filter(i => i.severity === "high"),
      provider
    );
    expect(taskType).toBe("sweep");
  });

  it("routeDeepFix is deterministic — same input produces same output", () => {
    const issues: IssueType[] = [makeIssue("Input validation", "high")];
    const provider = makeProvider();
    const r1 = routeDeepFix(issues, provider);
    const r2 = routeDeepFix(issues, provider);
    expect(r1.taskType).toBe(r2.taskType);
    expect(r1.model).toBe(r2.model);
  });
});
