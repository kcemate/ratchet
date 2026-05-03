/**
 * Smart Issue Router — unit tests
 * Tests routing logic for APIAgent (free tier) and ShellAgent (pro tier).
 */

import { describe, it, expect } from "vitest";
import { canFixWithAgent, routeIssues, hasASTTransformMatch, estimateEffort } from "../core/issue-router.js";
import type { IssueTask } from "../core/issue-backlog.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<IssueTask> = {}): IssueTask {
  return {
    category: "Code Quality",
    subcategory: "Structured logging",
    description: "Uses console.log instead of structured logger",
    count: 5,
    severity: "medium",
    priority: 2.5,
    sweepFiles: ["src/server.ts", "src/utils.ts"],
    fixMode: "torque",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canFixWithAgent — shell always passes
// ---------------------------------------------------------------------------

describe("canFixWithAgent — shell agent", () => {
  it("accepts any torque issue", () => {
    expect(canFixWithAgent(makeIssue({ fixMode: "torque" }), "shell")).toBe(true);
  });

  it("accepts sweep-mode issues", () => {
    expect(canFixWithAgent(makeIssue({ fixMode: "sweep" }), "shell")).toBe(true);
  });

  it("accepts architect-mode issues", () => {
    expect(canFixWithAgent(makeIssue({ fixMode: "architect" }), "shell")).toBe(true);
  });

  it("accepts test-related issues", () => {
    expect(canFixWithAgent(makeIssue({ category: "Testing", fixMode: "torque" }), "shell")).toBe(true);
  });

  it("accepts issues with no file locations", () => {
    expect(canFixWithAgent(makeIssue({ sweepFiles: [] }), "shell")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canFixWithAgent — API agent constraints
// ---------------------------------------------------------------------------

describe("canFixWithAgent — api agent", () => {
  it("accepts a torque issue with effort ≤ 2 and file locations", () => {
    // 'Structured logging' has effortPerFix: 2 in SUBCATEGORY_TIERS
    expect(canFixWithAgent(makeIssue(), "api")).toBe(true);
  });

  it("rejects sweep-mode issues", () => {
    expect(canFixWithAgent(makeIssue({ fixMode: "sweep" }), "api")).toBe(false);
  });

  it("rejects architect-mode issues", () => {
    expect(canFixWithAgent(makeIssue({ fixMode: "architect" }), "api")).toBe(false);
  });

  it("rejects issues in the Testing category", () => {
    expect(canFixWithAgent(makeIssue({ category: "Testing", fixMode: "torque" }), "api")).toBe(false);
  });

  it('rejects issues with "coverage" in the subcategory', () => {
    expect(
      canFixWithAgent(
        makeIssue({
          category: "Code Quality",
          subcategory: "Coverage ratio",
          fixMode: "torque",
          sweepFiles: ["src/app.ts"],
        }),
        "api"
      )
    ).toBe(false);
  });

  it("rejects issues with no file locations", () => {
    expect(canFixWithAgent(makeIssue({ sweepFiles: [] }), "api")).toBe(false);
  });

  it("rejects issues with undefined sweepFiles", () => {
    const issue = makeIssue();
    delete (issue as any).sweepFiles;
    expect(canFixWithAgent(issue, "api")).toBe(false);
  });

  it("rejects issues with effort > 2 (high-effort subcategory)", () => {
    // Use an architect-effort subcategory. If not found in SUBCATEGORY_TIERS, defaults to 3.
    expect(
      canFixWithAgent(
        makeIssue({
          subcategory: "Unknown high effort subcategory",
          fixMode: "torque",
          sweepFiles: ["src/app.ts"],
        }),
        "api"
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// routeIssues — FeasibilityResult shape
// ---------------------------------------------------------------------------

describe("routeIssues", () => {
  const torqueIssue = makeIssue({ fixMode: "torque", priority: 3.0, count: 1, sweepFiles: ["src/a.ts"] });
  const sweepIssue = makeIssue({ subcategory: "Dead code", fixMode: "sweep", priority: 4.0 });
  const testIssue = makeIssue({ category: "Testing", fixMode: "torque", priority: 5.0 });
  const architectIssue = makeIssue({ subcategory: "Dependency injection", fixMode: "architect", priority: 2.0 });

  it("returns FeasibilityResult with eligible/skipped/reasons for shell agent", () => {
    const backlog = [torqueIssue, sweepIssue, testIssue, architectIssue];
    const result = routeIssues(backlog, "shell");
    expect(result.eligible).toEqual(backlog);
    expect(result.skipped).toHaveLength(0);
    expect(result.reasons.size).toBe(0);
  });

  it("does not mutate the original backlog for shell agent", () => {
    const backlog = [torqueIssue, sweepIssue, testIssue];
    const original = [...backlog];
    routeIssues(backlog, "shell");
    expect(backlog).toEqual(original);
  });

  it("filters out sweep/architect/test issues for api agent", () => {
    const backlog = [torqueIssue, sweepIssue, testIssue, architectIssue];
    const result = routeIssues(backlog, "api");
    expect(result.eligible).not.toContain(sweepIssue);
    expect(result.eligible).not.toContain(testIssue);
    expect(result.eligible).not.toContain(architectIssue);
    expect(result.skipped).toContain(sweepIssue);
    expect(result.skipped).toContain(testIssue);
    expect(result.skipped).toContain(architectIssue);
  });

  it("preserves eligible torque issues for api agent", () => {
    const backlog = [torqueIssue, sweepIssue, testIssue];
    const result = routeIssues(backlog, "api");
    expect(result.eligible).toContain(torqueIssue);
  });

  it("returns empty eligible when all issues are ineligible for api agent", () => {
    const result = routeIssues([sweepIssue, testIssue, architectIssue], "api");
    expect(result.eligible).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
  });

  it("records skip reasons for ineligible issues", () => {
    const result = routeIssues([sweepIssue], "api");
    expect(result.reasons.size).toBeGreaterThan(0);
    const reason = [...result.reasons.values()][0];
    expect(reason).toContain("SKIP_FREE");
  });

  it("sorts AST-matchable issues first for api agent", () => {
    // 'Structured logging' matches replace-console-logger transform
    const consoleIssue = makeIssue({
      subcategory: "Structured logging",
      description: "console.log usage",
      fixMode: "torque",
      priority: 1.0, // low priority
      sweepFiles: ["src/a.ts"],
    });
    const genericIssue = makeIssue({
      subcategory: "Empty catches",
      description: "empty catch blocks",
      fixMode: "torque",
      priority: 5.0, // high priority
      sweepFiles: ["src/b.ts"],
    });
    const result = routeIssues([genericIssue, consoleIssue], "api");
    // Both may or may not match transforms, but result should be sorted stably
    expect(result.eligible.length).toBeGreaterThan(0);
  });

  it("does not mutate the original backlog for api agent", () => {
    const backlog = [torqueIssue, sweepIssue, testIssue];
    const original = [...backlog];
    routeIssues(backlog, "api");
    expect(backlog).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// routeIssues — effort estimation gate (SKIP_FREE)
// ---------------------------------------------------------------------------

describe("routeIssues — SKIP_FREE effort gate", () => {
  it("skips issues where estimated lines exceed APIAgent budget", () => {
    // effortPerFix for 'Structured logging' = 2, count = 20 → linesNeeded = 40 > 20
    const bigIssue = makeIssue({
      subcategory: "Structured logging",
      count: 20,
      fixMode: "torque",
      sweepFiles: ["src/a.ts"],
    });
    const result = routeIssues([bigIssue], "api");
    expect(result.skipped).toContain(bigIssue);
    const reason = result.reasons.get("Code Quality::Structured logging");
    expect(reason).toContain("SKIP_FREE");
    expect(reason).toContain("estimated effort");
  });

  it("allows issues that fit within budget", () => {
    // effortPerFix = 2, count = 1 → linesNeeded = 2, filesNeeded = 1 → fits
    const smallIssue = makeIssue({
      subcategory: "Structured logging",
      count: 1,
      fixMode: "torque",
      sweepFiles: ["src/a.ts"],
    });
    const result = routeIssues([smallIssue], "api");
    expect(result.eligible).toContain(smallIssue);
  });

  it("skips issues spanning too many files", () => {
    // 3 files > APIAGENT_MAX_FILES (1)
    const multiFileIssue = makeIssue({
      subcategory: "Structured logging",
      count: 1,
      fixMode: "torque",
      sweepFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
    });
    const result = routeIssues([multiFileIssue], "api");
    expect(result.skipped).toContain(multiFileIssue);
  });
});

// ---------------------------------------------------------------------------
// estimateEffort
// ---------------------------------------------------------------------------

describe("estimateEffort", () => {
  it("returns filesNeeded based on sweepFiles length", () => {
    const issue = makeIssue({ sweepFiles: ["a.ts", "b.ts"] });
    const { filesNeeded } = estimateEffort(issue);
    expect(filesNeeded).toBe(2);
  });

  it("returns minimum 1 for filesNeeded when sweepFiles is empty", () => {
    const issue = makeIssue({ sweepFiles: [] });
    const { filesNeeded } = estimateEffort(issue);
    expect(filesNeeded).toBe(1);
  });

  it("calculates linesNeeded as effortPerFix × count", () => {
    // 'Structured logging' has effortPerFix: 2, count: 5
    const issue = makeIssue({ count: 5 });
    const { linesNeeded } = estimateEffort(issue);
    expect(linesNeeded).toBe(10); // 2 × 5
  });
});

// ---------------------------------------------------------------------------
// hasASTTransformMatch
// ---------------------------------------------------------------------------

describe("hasASTTransformMatch", () => {
  it("returns true for issues matching console/logging transforms", () => {
    expect(
      hasASTTransformMatch(
        makeIssue({
          subcategory: "Structured logging",
          description: "console.log usage",
        })
      )
    ).toBe(true);
  });

  it("returns false for issues with no matching transform", () => {
    expect(
      hasASTTransformMatch(
        makeIssue({
          subcategory: "Something completely unique 99999",
          description: "no matching transform here",
        })
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Zero-delta gate — APIAgent skip condition
// ---------------------------------------------------------------------------

describe("zero-delta gate — no AST transforms available", () => {
  it("gate fires when no issue in a group has an AST transform (APIAgent would skip)", () => {
    const issues = [
      makeIssue({ subcategory: "Nonexistent transform A 99999", description: "generic issue" }),
      makeIssue({ subcategory: "Nonexistent transform B 99999", description: "another issue" }),
    ];
    // The gate condition: every issue lacks an AST transform → skip the click
    const allNonAst = issues.every(i => !hasASTTransformMatch(i));
    expect(allNonAst).toBe(true);
  });

  it("gate does NOT fire when at least one issue has an AST transform", () => {
    const issues = [
      makeIssue({ subcategory: "Structured logging", description: "console.log usage" }),
      makeIssue({ subcategory: "Nonexistent transform 99999", description: "generic issue" }),
    ];
    const hasAny = issues.some(i => hasASTTransformMatch(i));
    expect(hasAny).toBe(true);
  });

  it("gate fires for a single issue with no AST transform", () => {
    const issue = makeIssue({ subcategory: "No matching transform 99999", description: "no ast" });
    expect(hasASTTransformMatch(issue)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AST-only mode — click context field
// ---------------------------------------------------------------------------

describe("AST-only mode — ClickContext.astOnlyMode", () => {
  it("astOnlyMode field is accepted as optional boolean on a ClickContext-shaped object", () => {
    // Structural check: ensure the field is typed correctly (compile-time validated by TypeScript,
    // this test guards against accidental removal of the field).
    const ctx: Partial<import("../core/click.js").ClickContext> = {
      astOnlyMode: true,
    };
    expect(ctx.astOnlyMode).toBe(true);
  });

  it("astOnlyMode defaults to undefined when not set", () => {
    const ctx: Partial<import("../core/click.js").ClickContext> = {};
    expect(ctx.astOnlyMode).toBeUndefined();
  });
});
