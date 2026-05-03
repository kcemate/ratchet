import { describe, it, expect } from "vitest";
import { checkDiminishingReturns } from "../core/engine.js";

describe("checkDiminishingReturns", () => {
  it("returns stop=false when totalClicks < 3", () => {
    const result = checkDiminishingReturns([0, 0, 0], 2);
    expect(result.stop).toBe(false);
  });

  it("returns stop=false when recentScoreDeltas has < 3 entries", () => {
    const result = checkDiminishingReturns([0, 0], 5);
    expect(result.stop).toBe(false);
  });

  it("returns stop=true when last 3 deltas are all zero and totalClicks >= 3", () => {
    const result = checkDiminishingReturns([0, 0, 0], 3);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toBe("diminishing returns — 3 consecutive zero-delta clicks");
  });

  it("returns stop=true with 4+ deltas when last 3 are zero", () => {
    const result = checkDiminishingReturns([5, 0, 0, 0], 4);
    expect(result.stop).toBe(true);
  });

  it("returns stop=false when last 3 deltas have a non-zero entry", () => {
    const result = checkDiminishingReturns([0, 1, 0], 3);
    expect(result.stop).toBe(false);
  });

  it("returns stop=false when last delta is non-zero", () => {
    const result = checkDiminishingReturns([0, 0, 5], 3);
    expect(result.stop).toBe(false);
  });

  it("returns stop=false when first of last 3 is non-zero", () => {
    const result = checkDiminishingReturns([3, 0, 0], 3);
    expect(result.stop).toBe(false);
  });

  it("returns stop=false when all deltas are positive", () => {
    const result = checkDiminishingReturns([1, 2, 3], 3);
    expect(result.stop).toBe(false);
  });

  it("returns stop=false with empty recentScoreDeltas", () => {
    const result = checkDiminishingReturns([], 5);
    expect(result.stop).toBe(false);
  });

  it("returns stop=true at exactly 3 total clicks with 3 zero deltas", () => {
    const result = checkDiminishingReturns([0, 0, 0], 3);
    expect(result.stop).toBe(true);
  });

  it("returns stop=false at exactly totalClicks=2 (boundary)", () => {
    const result = checkDiminishingReturns([0, 0, 0], 2);
    expect(result.stop).toBe(false);
  });

  it("returns stop=true with more than 3 deltas and last 3 are zero", () => {
    const result = checkDiminishingReturns([10, 8, 3, 0, 0, 0], 6);
    expect(result.stop).toBe(true);
    expect(result.earlyStopReason).toContain("diminishing returns");
  });

  it("returns stop=false with negative deltas (regression guard handles those)", () => {
    // Negative deltas are not zero — should not trigger diminishing returns
    const result = checkDiminishingReturns([-1, -1, -1], 3);
    expect(result.stop).toBe(false);
  });

  it("includes reason string when stopping", () => {
    const result = checkDiminishingReturns([0, 0, 0], 5);
    expect(result.earlyStopReason).toBeDefined();
    expect(typeof result.earlyStopReason).toBe("string");
  });

  it("does not stop when totalClicks is exactly 1", () => {
    const result = checkDiminishingReturns([0, 0, 0], 1);
    expect(result.stop).toBe(false);
  });
});
