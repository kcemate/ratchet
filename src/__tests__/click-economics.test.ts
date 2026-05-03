import { describe, it, expect } from "vitest";
import { estimateCost, determineOutcome, classifyRollbackReason } from "../core/click.js";
import { computeRunEconomics, generateRecommendations } from "../core/engine.js";
import type { ClickEconomics } from "../types.js";

// --- estimateCost ---

describe("estimateCost", () => {
  it("returns 0 for 0 lines changed", () => {
    expect(estimateCost(0, "sonnet")).toBe(0);
  });

  it("uses sonnet pricing by default (no model specified)", () => {
    // 100 lines → 2000 input tokens + 1000 output tokens
    // sonnet: $3/$15 per 1M → (2000*3 + 1000*15) / 1_000_000
    const expected = (2000 * 3 + 1000 * 15) / 1_000_000;
    expect(estimateCost(100)).toBeCloseTo(expected, 10);
  });

  it('uses sonnet pricing when model contains "sonnet"', () => {
    const withModel = estimateCost(100, "claude-sonnet-4-6");
    const withDefault = estimateCost(100);
    expect(withModel).toBeCloseTo(withDefault, 10);
  });

  it('uses opus pricing when model contains "opus"', () => {
    // 100 lines → 2000 input + 1000 output
    // opus: $15/$75 per 1M
    const expected = (2000 * 15 + 1000 * 75) / 1_000_000;
    expect(estimateCost(100, "claude-opus-4-6")).toBeCloseTo(expected, 10);
  });

  it('uses haiku pricing when model contains "haiku"', () => {
    // 100 lines → 2000 input + 1000 output
    // haiku: $0.25/$1.25 per 1M
    const expected = (2000 * 0.25 + 1000 * 1.25) / 1_000_000;
    expect(estimateCost(100, "claude-haiku-4-5")).toBeCloseTo(expected, 10);
  });

  it("opus costs more than sonnet costs more than haiku for same lines", () => {
    const haiku = estimateCost(500, "claude-haiku-4-5");
    const sonnet = estimateCost(500, "claude-sonnet-4-6");
    const opus = estimateCost(500, "claude-opus-4-6");
    expect(haiku).toBeLessThan(sonnet);
    expect(sonnet).toBeLessThan(opus);
  });

  it("scales linearly with lines changed", () => {
    const cost100 = estimateCost(100, "sonnet");
    const cost200 = estimateCost(200, "sonnet");
    expect(cost200).toBeCloseTo(cost100 * 2, 10);
  });
});

// --- determineOutcome ---

describe("determineOutcome", () => {
  it('returns "landed" when not rolled back', () => {
    expect(determineOutcome(false)).toBe("landed");
    expect(determineOutcome(false, "irrelevant reason")).toBe("landed");
  });

  it('returns "rolled-back" when rolled back with no reason', () => {
    expect(determineOutcome(true)).toBe("rolled-back");
  });

  it('returns "timeout" for timeout-related reasons', () => {
    expect(determineOutcome(true, "timed out after 600s")).toBe("timeout");
    expect(determineOutcome(true, "timeout exceeded")).toBe("timeout");
  });

  it('returns "guard-rejected" for guard rejection reasons', () => {
    expect(determineOutcome(true, "Too many lines changed: 350 > 280 max")).toBe("guard-rejected");
    expect(determineOutcome(true, "Too many files changed: 15 > 8 max")).toBe("guard-rejected");
    expect(determineOutcome(true, "Single file changed too many lines in sweep mode")).toBe("guard-rejected");
  });

  it('returns "scope-rejected" for scope-exceeded reasons', () => {
    expect(determineOutcome(true, "scope-exceeded: diff too large")).toBe("scope-rejected");
  });

  it('returns "rolled-back" for generic test failures', () => {
    expect(determineOutcome(true, "tests failed (full): api.test.ts")).toBe("rolled-back");
  });
});

// --- classifyRollbackReason ---

describe("classifyRollbackReason", () => {
  it("returns undefined for no reason", () => {
    expect(classifyRollbackReason()).toBeUndefined();
    expect(classifyRollbackReason(undefined)).toBeUndefined();
  });

  it("classifies timeout reasons", () => {
    expect(classifyRollbackReason("timed out after 600s")).toBe("timeout");
    expect(classifyRollbackReason("timeout exceeded")).toBe("timeout");
  });

  it("classifies guard rejections", () => {
    expect(classifyRollbackReason("Too many lines changed: 350 > 280 max")).toBe("guard-rejected");
    expect(classifyRollbackReason("Too many files changed: 15 > 8 max")).toBe("guard-rejected");
    expect(classifyRollbackReason("Single file changed too many lines in sweep mode")).toBe("guard-rejected");
  });

  it("classifies scope-exceeded reasons", () => {
    expect(classifyRollbackReason("scope-exceeded: diff too large")).toBe("scope-exceeded");
  });

  it("classifies score regression reasons", () => {
    expect(classifyRollbackReason("score regression: 86 → 84 (-2pts)")).toBe("score-regression");
  });

  it("classifies lint/typecheck reasons", () => {
    expect(classifyRollbackReason("lint check failed: tsc --noEmit")).toBe("lint-error");
    expect(classifyRollbackReason("typecheck failed")).toBe("lint-error");
  });

  it("defaults to test-related for generic failures", () => {
    expect(classifyRollbackReason("tests failed (full): api.test.ts")).toBe("test-related");
    expect(classifyRollbackReason("build failed")).toBe("test-related");
  });
});

// --- computeRunEconomics ---

function makeEconomics(overrides: Partial<ClickEconomics> & { clickIndex: number }): ClickEconomics {
  return {
    wallTimeMs: 10_000,
    agentTimeMs: 8_000,
    testTimeMs: 2_000,
    estimatedCost: 0.001,
    outcome: "landed",
    issuesFixed: 1,
    scoreDelta: 1,
    ...overrides,
  };
}

describe("computeRunEconomics", () => {
  it("handles empty clicks array", () => {
    const result = computeRunEconomics([], 0);
    expect(result.landed).toBe(0);
    expect(result.rolledBack).toBe(0);
    expect(result.efficiency).toBe(0);
    expect(result.recommendations).toEqual([]);
  });

  it("counts landed and rolled-back correctly", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed" }),
      makeEconomics({ clickIndex: 2, outcome: "rolled-back" }),
      makeEconomics({ clickIndex: 3, outcome: "timeout" }),
    ];
    const result = computeRunEconomics(clicks, 30_000);
    expect(result.landed).toBe(1);
    expect(result.rolledBack).toBe(2);
    expect(result.timedOut).toBe(1);
  });

  it("computes rollbackRate and timeoutRate", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed" }),
      makeEconomics({ clickIndex: 2, outcome: "rolled-back" }),
      makeEconomics({ clickIndex: 3, outcome: "rolled-back" }),
      makeEconomics({ clickIndex: 4, outcome: "timeout" }),
    ];
    const result = computeRunEconomics(clicks, 40_000);
    expect(result.rollbackRate).toBeCloseTo(3 / 4, 5);
    expect(result.timeoutRate).toBeCloseTo(1 / 4, 5);
  });

  it("effectiveTimeMs is sum of landed click wall times", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed", wallTimeMs: 15_000 }),
      makeEconomics({ clickIndex: 2, outcome: "rolled-back", wallTimeMs: 5_000 }),
      makeEconomics({ clickIndex: 3, outcome: "landed", wallTimeMs: 20_000 }),
    ];
    const result = computeRunEconomics(clicks, 40_000);
    expect(result.effectiveTimeMs).toBe(35_000);
    expect(result.wastedTimeMs).toBe(5_000);
  });

  it("efficiency = effectiveTimeMs / totalWallTimeMs", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed", wallTimeMs: 20_000 }),
      makeEconomics({ clickIndex: 2, outcome: "rolled-back", wallTimeMs: 20_000 }),
    ];
    const result = computeRunEconomics(clicks, 60_000);
    expect(result.efficiency).toBeCloseTo(20_000 / 60_000, 5);
  });

  it("sums scoreDelta and issuesFixed across clicks", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed", scoreDelta: 2, issuesFixed: 3 }),
      makeEconomics({ clickIndex: 2, outcome: "landed", scoreDelta: 1, issuesFixed: 1 }),
      makeEconomics({ clickIndex: 3, outcome: "rolled-back", scoreDelta: 0, issuesFixed: 0 }),
    ];
    const result = computeRunEconomics(clicks, 30_000);
    expect(result.scoreDelta).toBe(3);
    expect(result.issuesFixed).toBe(4);
  });

  it("sums totalCost", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, estimatedCost: 0.001 }),
      makeEconomics({ clickIndex: 2, estimatedCost: 0.002 }),
    ];
    const result = computeRunEconomics(clicks, 20_000);
    expect(result.totalCost).toBeCloseTo(0.003, 10);
  });
});

// --- generateRecommendations ---

describe("generateRecommendations", () => {
  it("returns empty array for empty clicks", () => {
    expect(generateRecommendations([])).toEqual([]);
  });

  it("suggests --plan-first when rollback rate > 30%", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed" }),
      makeEconomics({ clickIndex: 2, outcome: "rolled-back" }),
      makeEconomics({ clickIndex: 3, outcome: "rolled-back" }),
      makeEconomics({ clickIndex: 4, outcome: "rolled-back" }),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.some(r => r.includes("--plan-first"))).toBe(true);
  });

  it("does not suggest --plan-first when rollback rate <= 30%", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed" }),
      makeEconomics({ clickIndex: 2, outcome: "landed" }),
      makeEconomics({ clickIndex: 3, outcome: "landed" }),
      makeEconomics({ clickIndex: 4, outcome: "rolled-back" }),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.some(r => r.includes("--plan-first"))).toBe(false);
  });

  it("suggests --timeout when timeout rate > 15%", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed" }),
      makeEconomics({ clickIndex: 2, outcome: "timeout" }),
      makeEconomics({ clickIndex: 3, outcome: "landed" }),
      makeEconomics({ clickIndex: 4, outcome: "landed" }),
      makeEconomics({ clickIndex: 5, outcome: "landed" }),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.some(r => r.includes("--timeout"))).toBe(true);
  });

  it("suggests --architect when score delta is zero", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed", scoreDelta: 0 }),
      makeEconomics({ clickIndex: 2, outcome: "landed", scoreDelta: 0 }),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.some(r => r.includes("--architect"))).toBe(true);
  });

  it("does not suggest --architect when score improved", () => {
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "landed", scoreDelta: 2 }),
      makeEconomics({ clickIndex: 2, outcome: "landed", scoreDelta: 1 }),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.some(r => r.includes("--architect"))).toBe(false);
  });

  it("can return multiple recommendations", () => {
    // High rollback rate + timeouts + zero score
    const clicks = [
      makeEconomics({ clickIndex: 1, outcome: "timeout", scoreDelta: 0 }),
      makeEconomics({ clickIndex: 2, outcome: "rolled-back", scoreDelta: 0 }),
      makeEconomics({ clickIndex: 3, outcome: "rolled-back", scoreDelta: 0 }),
    ];
    const recs = generateRecommendations(clicks);
    expect(recs.length).toBeGreaterThanOrEqual(2);
  });
});
