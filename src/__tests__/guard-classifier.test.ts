import { describe, it, expect } from "vitest";
import { classifyRisk, selectGuards } from "../core/guard-selector.js";
import type { IssueTask } from "../core/issue-backlog.js";
import type { FixabilityScore } from "../core/fixability.js";

function makeTask(overrides: Partial<IssueTask> = {}): IssueTask {
  return {
    category: "Code Quality",
    subcategory: "Dead code",
    description: "Unused code",
    count: 2,
    severity: "low",
    priority: 50,
    fixMode: "torque",
    sweepFiles: ["src/foo.ts"],
    ...overrides,
  };
}

function makeFixability(recommendation: FixabilityScore["recommendation"] = "api-agent"): FixabilityScore {
  return {
    issueId: "test-issue",
    impactScore: 0.5,
    fixabilityScore: 0.8,
    recommendation,
    reason: "test",
  };
}

// ── classifyRisk ─────────────────────────────────────────────────────────────

describe("classifyRisk", () => {
  it('returns "high" for architect fixMode (cross-cutting)', () => {
    const task = makeTask({ fixMode: "architect" });
    expect(classifyRisk(task)).toBe("high");
  });

  it('returns "high" when file count > 5', () => {
    const task = makeTask({
      sweepFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
    });
    expect(classifyRisk(task)).toBe("high");
  });

  it('returns "medium" when file count is exactly 5', () => {
    const task = makeTask({
      sweepFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
    });
    expect(classifyRisk(task)).toBe("medium");
  });

  it('returns "high" for tsconfig.json file', () => {
    const task = makeTask({ sweepFiles: ["tsconfig.json"] });
    expect(classifyRisk(task)).toBe("high");
  });

  it('returns "high" for package.json file', () => {
    const task = makeTask({ sweepFiles: ["package.json"] });
    expect(classifyRisk(task)).toBe("high");
  });

  it('returns "high" for vite.config.ts file', () => {
    const task = makeTask({ sweepFiles: ["vite.config.ts"] });
    expect(classifyRisk(task)).toBe("high");
  });

  it('returns "high" for webpack.config.js file', () => {
    const task = makeTask({ sweepFiles: ["webpack.config.js"] });
    expect(classifyRisk(task)).toBe("high");
  });

  it('returns "low" when all files are test files (.test.ts)', () => {
    const task = makeTask({
      sweepFiles: ["src/foo.test.ts", "src/bar.test.ts"],
    });
    expect(classifyRisk(task)).toBe("low");
  });

  it('returns "low" when all files are spec files (.spec.ts)', () => {
    const task = makeTask({
      sweepFiles: ["src/foo.spec.ts"],
    });
    expect(classifyRisk(task)).toBe("low");
  });

  it('returns "low" when all files are in __tests__ directory', () => {
    const task = makeTask({
      sweepFiles: ["src/__tests__/foo.ts", "src/__tests__/bar.ts"],
    });
    expect(classifyRisk(task)).toBe("low");
  });

  it('returns "low" for formatting subcategory', () => {
    const task = makeTask({ subcategory: "formatting", sweepFiles: ["src/foo.ts"] });
    expect(classifyRisk(task)).toBe("low");
  });

  it('returns "low" for unused-import description', () => {
    const task = makeTask({ description: "Remove unused imports", sweepFiles: ["src/foo.ts"] });
    expect(classifyRisk(task)).toBe("low");
  });

  it('returns "low" for lint subcategory', () => {
    const task = makeTask({ subcategory: "lint errors", sweepFiles: ["src/foo.ts"] });
    expect(classifyRisk(task)).toBe("low");
  });

  it('returns "medium" for a normal task with 1 non-config file', () => {
    const task = makeTask({
      subcategory: "Error handling",
      sweepFiles: ["src/service.ts"],
      fixMode: "torque",
    });
    expect(classifyRisk(task)).toBe("medium");
  });

  it('returns "medium" for 3 regular source files', () => {
    const task = makeTask({
      sweepFiles: ["a.ts", "b.ts", "c.ts"],
    });
    expect(classifyRisk(task)).toBe("medium");
  });

  it('returns "high" when task has no sweepFiles but fixMode is architect', () => {
    const task = makeTask({ sweepFiles: undefined, fixMode: "architect" });
    expect(classifyRisk(task)).toBe("high");
  });
});

// ── selectGuards integration with classifyRisk ────────────────────────────────

describe("selectGuards with risk classification", () => {
  it("api-agent + torque + low risk → api-sweep (broader guards)", () => {
    const task = makeTask({
      subcategory: "formatting",
      sweepFiles: ["src/foo.test.ts"],
      fixMode: "torque",
    });
    const result = selectGuards(task, makeFixability("api-agent"));
    expect(result.profileName).toBe("api-sweep");
    expect(result.reason).toContain("low risk");
  });

  it("api-agent + sweep + high risk → tight (tighter guards)", () => {
    const task = makeTask({
      sweepFiles: ["tsconfig.json"],
      fixMode: "sweep",
    });
    const result = selectGuards(task, makeFixability("api-agent"));
    expect(result.profileName).toBe("tight");
    expect(result.reason).toContain("high risk");
  });

  it("shell-agent + torque + high risk → tight (tighter guards)", () => {
    const task = makeTask({
      sweepFiles: ["package.json"],
      fixMode: "torque",
    });
    const result = selectGuards(task, makeFixability("shell-agent"));
    expect(result.profileName).toBe("tight");
    expect(result.reason).toContain("high risk");
  });

  it("shell-agent + torque + low risk → broad (broader guards)", () => {
    const task = makeTask({
      subcategory: "formatting",
      sweepFiles: ["src/foo.test.ts"],
      fixMode: "torque",
    });
    const result = selectGuards(task, makeFixability("shell-agent"));
    expect(result.profileName).toBe("broad");
    expect(result.reason).toContain("low risk");
  });

  it("shell-agent + sweep + high risk → refactor (tighter guards)", () => {
    const task = makeTask({
      sweepFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
      fixMode: "sweep",
    });
    const result = selectGuards(task, makeFixability("shell-agent"));
    expect(result.profileName).toBe("refactor");
    expect(result.reason).toContain("high risk");
  });

  it("api-agent + torque + medium risk → tight (standard guards)", () => {
    const task = makeTask({
      subcategory: "Error handling",
      sweepFiles: ["src/service.ts"],
      fixMode: "torque",
    });
    const result = selectGuards(task, makeFixability("api-agent"));
    expect(result.profileName).toBe("tight");
    expect(result.reason).toContain("api-agent + torque → tight");
  });
});
