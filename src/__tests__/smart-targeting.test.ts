/**
 * Tests for smart issue targeting with fix-mode awareness and improved blacklist logic.
 *
 * Covers:
 * - filterBacklogByMode: removes issues requiring a higher mode than current
 * - SUBCATEGORY_TIERS fixMode assignments
 * - New blacklist thresholds: soft-skip at 2 same-subcategory zero-delta, escalate at 3 total
 */
import { describe, it, expect } from "vitest";
import { filterBacklogByMode } from "../core/issue-backlog.js";
import { SUBCATEGORY_TIERS } from "../core/score-optimizer.js";
import { shouldSoftSkipSubcategory, shouldEscalateOnTotalZeroDelta } from "../core/engine.js";
import type { IssueTask } from "../core/issue-backlog.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(subcategory: string, fixMode?: IssueTask["fixMode"]): IssueTask {
  return {
    category: "test",
    subcategory,
    description: `Fix ${subcategory}`,
    count: 5,
    severity: "medium",
    priority: 10,
    fixMode,
  };
}

// ── filterBacklogByMode ───────────────────────────────────────────────────────

describe("filterBacklogByMode", () => {
  const backlog: IssueTask[] = [
    makeTask("Coverage", "torque"),
    makeTask("Empty catches", "torque"),
    makeTask("Structured logging", "sweep"),
    makeTask("Line length", "sweep"),
    makeTask("Auth & rate limiting", "architect"),
    makeTask("Duplication", "architect"),
    makeTask("Unknown subcategory", undefined),
  ];

  it("torque mode: keeps only torque-mode issues (and unknown)", () => {
    const result = filterBacklogByMode(backlog, "torque");
    expect(result.map(t => t.subcategory)).toEqual(["Coverage", "Empty catches", "Unknown subcategory"]);
  });

  it("torque mode: removes architect-mode issues", () => {
    const result = filterBacklogByMode(backlog, "torque");
    expect(result.some(t => t.fixMode === "architect")).toBe(false);
  });

  it("torque mode: removes sweep-mode issues", () => {
    const result = filterBacklogByMode(backlog, "torque");
    expect(result.some(t => t.fixMode === "sweep")).toBe(false);
  });

  it("sweep mode: keeps sweep + torque but removes architect", () => {
    const result = filterBacklogByMode(backlog, "sweep");
    expect(result.map(t => t.subcategory)).toEqual([
      "Coverage",
      "Empty catches",
      "Structured logging",
      "Line length",
      "Unknown subcategory",
    ]);
  });

  it("sweep mode: removes architect-mode issues", () => {
    const result = filterBacklogByMode(backlog, "sweep");
    expect(result.some(t => t.fixMode === "architect")).toBe(false);
  });

  it("architect mode: returns all issues unchanged", () => {
    const result = filterBacklogByMode(backlog, "architect");
    expect(result).toHaveLength(backlog.length);
  });

  it("returns all issues when backlog is empty", () => {
    expect(filterBacklogByMode([], "torque")).toEqual([]);
    expect(filterBacklogByMode([], "sweep")).toEqual([]);
    expect(filterBacklogByMode([], "architect")).toEqual([]);
  });

  it("includes tasks with no fixMode in all modes", () => {
    const noModeOnly = [makeTask("Unknown", undefined)];
    expect(filterBacklogByMode(noModeOnly, "torque")).toHaveLength(1);
    expect(filterBacklogByMode(noModeOnly, "sweep")).toHaveLength(1);
    expect(filterBacklogByMode(noModeOnly, "architect")).toHaveLength(1);
  });
});

// ── SUBCATEGORY_TIERS fixMode assignments ─────────────────────────────────────

describe("SUBCATEGORY_TIERS fixMode", () => {
  const tierMap = new Map(SUBCATEGORY_TIERS.map(t => [t.name, t.fixMode]));

  it("all tier entries have a fixMode set", () => {
    for (const tier of SUBCATEGORY_TIERS) {
      expect(tier.fixMode, `${tier.name} is missing fixMode`).toBeDefined();
    }
  });

  // torque-mode subcategories
  const torqueExpected = [
    "Coverage",
    "Empty catches",
    "Console cleanup",
    "Dead code",
    "Test quality",
    "Function length",
  ];
  for (const name of torqueExpected) {
    it(`${name} has fixMode: 'torque'`, () => {
      expect(tierMap.get(name)).toBe("torque");
    });
  }

  // sweep-mode subcategories
  const sweepExpected = ["Structured logging", "Line length", "Import hygiene", "Async patterns"];
  for (const name of sweepExpected) {
    it(`${name} has fixMode: 'sweep'`, () => {
      expect(tierMap.get(name)).toBe("sweep");
    });
  }

  // architect-mode subcategories
  const architectExpected = ["Auth & rate limiting", "Duplication"];
  for (const name of architectExpected) {
    it(`${name} has fixMode: 'architect'`, () => {
      expect(tierMap.get(name)).toBe("architect");
    });
  }
});

// ── Blacklist threshold helpers ───────────────────────────────────────────────

describe("shouldSoftSkipSubcategory", () => {
  it("returns false for 0 zero-delta lands", () => {
    expect(shouldSoftSkipSubcategory(0)).toBe(false);
  });

  it("returns false for 1 zero-delta land", () => {
    expect(shouldSoftSkipSubcategory(1)).toBe(false);
  });

  it("returns true at 2 zero-delta lands (soft-skip threshold)", () => {
    expect(shouldSoftSkipSubcategory(2)).toBe(true);
  });

  it("returns true at 3+ zero-delta lands", () => {
    expect(shouldSoftSkipSubcategory(3)).toBe(true);
    expect(shouldSoftSkipSubcategory(5)).toBe(true);
  });

  it("soft-skip threshold (2) is below blacklist threshold (3)", () => {
    // Soft-skip triggers at 2 but blacklist at 3, so there is a window
    // where we try alternatives without fully giving up on the subcategory.
    expect(shouldSoftSkipSubcategory(2)).toBe(true);
    // The blacklist threshold is tracked separately in engine state (zeroDeltaLands >= 3)
    expect(shouldSoftSkipSubcategory(2) && 2 < 3).toBe(true);
  });
});

describe("shouldEscalateOnTotalZeroDelta", () => {
  it("returns false for 0 total zero-delta lands", () => {
    expect(shouldEscalateOnTotalZeroDelta(0)).toBe(false);
  });

  it("returns false for 1 total zero-delta land", () => {
    expect(shouldEscalateOnTotalZeroDelta(1)).toBe(false);
  });

  it("returns false for 2 total zero-delta lands", () => {
    expect(shouldEscalateOnTotalZeroDelta(2)).toBe(false);
  });

  it("returns true at 3 total zero-delta lands (escalation threshold)", () => {
    expect(shouldEscalateOnTotalZeroDelta(3)).toBe(true);
  });

  it("returns true above 3 total zero-delta lands", () => {
    expect(shouldEscalateOnTotalZeroDelta(4)).toBe(true);
    expect(shouldEscalateOnTotalZeroDelta(10)).toBe(true);
  });

  it("escalation threshold (3 total) corresponds to 3 zero-delta clicks across different subcategories", () => {
    // Simulate: subcatA has 1, subcatB has 1, subcatC has 1 → total = 3 → escalate
    const stats = new Map([
      ["Auth & rate limiting", { zeroDeltaLands: 1, rollbacks: 0 }],
      ["Duplication", { zeroDeltaLands: 1, rollbacks: 0 }],
      ["Function length", { zeroDeltaLands: 1, rollbacks: 0 }],
    ]);
    const total = [...stats.values()].reduce((sum, s) => sum + s.zeroDeltaLands, 0);
    expect(shouldEscalateOnTotalZeroDelta(total)).toBe(true);
  });
});
