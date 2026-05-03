import { describe, it, expect } from "vitest";
import { checkRollbackEscalation, checkTotalScoreRegression } from "../core/engine.js";

// ── checkRollbackEscalation ───────────────────────────────────────────────────

describe("checkRollbackEscalation", () => {
  // (a) escalation triggers after 3 consecutive rollbacks
  it("escalates after 3 consecutive rollbacks", () => {
    const result = checkRollbackEscalation(3, 0, 3, true);
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toBe("3 consecutive rollbacks");
  });

  it("escalates after more than 3 consecutive rollbacks", () => {
    const result = checkRollbackEscalation(5, 0, 5, true);
    expect(result.shouldEscalate).toBe(true);
  });

  it("does not escalate at 2 consecutive rollbacks", () => {
    const result = checkRollbackEscalation(2, 0, 2, true);
    expect(result.shouldEscalate).toBe(false);
  });

  it("does not escalate at 1 consecutive rollback", () => {
    const result = checkRollbackEscalation(1, 0, 1, true);
    expect(result.shouldEscalate).toBe(false);
  });

  // (b) --no-escalate prevents escalation
  it("does not escalate when architectEscalationEnabled is false (--no-escalate)", () => {
    const result = checkRollbackEscalation(3, 0, 3, false);
    expect(result.shouldEscalate).toBe(false);
  });

  it("does not escalate for zero-landing stall when disabled", () => {
    const result = checkRollbackEscalation(0, 0, 5, false);
    expect(result.shouldEscalate).toBe(false);
  });

  // (c) escalation resets if a click lands (consecutiveRollbacks resets to 0)
  it("does not escalate when consecutiveRollbacks is 0 (a click landed)", () => {
    const result = checkRollbackEscalation(0, 1, 0, true);
    expect(result.shouldEscalate).toBe(false);
  });

  it("does not escalate when consecutiveRollbacks resets mid-run after landing", () => {
    // Simulate: 3 rollbacks, then 1 landed (resets counter), then 0 new rollbacks
    const result = checkRollbackEscalation(0, 1, 3, true);
    expect(result.shouldEscalate).toBe(false);
  });

  // Zero-landing secondary condition
  it("escalates when 0 clicks landed after 3+ total rollbacks", () => {
    const result = checkRollbackEscalation(0, 0, 3, true);
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toBe("all clicks stalled with 0 landed");
  });

  it("does not escalate when 0 landed but fewer than 3 total rollbacks", () => {
    const result = checkRollbackEscalation(0, 0, 2, true);
    expect(result.shouldEscalate).toBe(false);
  });

  it("does not escalate zero-landing condition when a click has already landed", () => {
    // totalLanded > 0, so zero-landing condition doesn't apply
    const result = checkRollbackEscalation(0, 1, 4, true);
    expect(result.shouldEscalate).toBe(false);
  });

  // (d) 50% rollback rate after 3+ attempts triggers escalation
  it("escalates when 50%+ of attempts were rolled back and last click also rolled back", () => {
    // 1 landed, 2 rolled back → 3 total, rate=2/3≈67%, consecutiveRollbacks=1
    const result = checkRollbackEscalation(1, 1, 2, true);
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toBe("50% rollback rate");
  });

  it("escalates at exactly 50% rollback rate with 4 attempts", () => {
    // 2 landed, 2 rolled back → 4 total, rate=50%, consecutiveRollbacks=1
    const result = checkRollbackEscalation(1, 2, 2, true);
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toBe("50% rollback rate");
  });

  it("does not escalate at 50%+ rate when last click landed (consecutiveRollbacks=0)", () => {
    // The most recent click succeeded — don't escalate on a positive signal
    const result = checkRollbackEscalation(0, 1, 3, true);
    expect(result.shouldEscalate).toBe(false);
  });

  it("does not escalate at 50%+ rate when fewer than 3 total attempts", () => {
    // totalAttempted=2, below threshold
    const result = checkRollbackEscalation(1, 1, 1, true);
    expect(result.shouldEscalate).toBe(false);
  });

  it("does not apply 50% rate rule when disabled", () => {
    const result = checkRollbackEscalation(1, 1, 2, false);
    expect(result.shouldEscalate).toBe(false);
  });
});

// ── checkTotalScoreRegression ─────────────────────────────────────────────────

describe("checkTotalScoreRegression", () => {
  // (a) click rolled back when subcategory improves but total drops
  it("rolls back when total score drops even if a subcategory improved", () => {
    // prevTotal=80, newTotal=78: auth subcategory may have improved but overall dropped
    const result = checkTotalScoreRegression(78, 80);
    expect(result.shouldRollback).toBe(true);
    expect(result.reason).toContain("Total score regression");
    expect(result.reason).toContain("80 → 78");
  });

  it('includes "rolling back" in the reason message', () => {
    const result = checkTotalScoreRegression(70, 85);
    expect(result.reason).toContain("rolling back");
  });

  it("does not roll back when total score is unchanged", () => {
    const result = checkTotalScoreRegression(80, 80);
    expect(result.shouldRollback).toBe(false);
  });

  it("does not roll back when total score improves", () => {
    const result = checkTotalScoreRegression(82, 80);
    expect(result.shouldRollback).toBe(false);
  });
});
