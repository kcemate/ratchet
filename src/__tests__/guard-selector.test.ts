import { describe, it, expect } from "vitest";
import { selectGuards } from "../core/guard-selector.js";
import { GUARD_PROFILES } from "../types.js";
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

function makeFixability(
  recommendation: FixabilityScore["recommendation"],
  overrides: Partial<FixabilityScore> = {}
): FixabilityScore {
  return {
    issueId: "Dead code",
    impactScore: 0.5,
    fixabilityScore: 0.9,
    recommendation,
    reason: "test",
    ...overrides,
  };
}

// ── api-agent routing ────────────────────────────────────────────────────────

describe("selectGuards — api-agent", () => {
  it("api-agent + torque → tight (3/40)", () => {
    const result = selectGuards(makeTask({ fixMode: "torque" }), makeFixability("api-agent"));
    expect(result.profileName).toBe("tight");
    expect(result.guards).toEqual(GUARD_PROFILES.tight);
    expect(result.guards?.maxFilesChanged).toBe(3);
    expect(result.guards?.maxLinesChanged).toBe(40);
  });

  it("api-agent + sweep → api-sweep (3/60)", () => {
    const result = selectGuards(makeTask({ fixMode: "sweep" }), makeFixability("api-agent"));
    expect(result.profileName).toBe("api-sweep");
    expect(result.guards?.maxFilesChanged).toBe(3);
    expect(result.guards?.maxLinesChanged).toBe(60);
  });

  it("api-agent + undefined fixMode → tight (defaults to torque path)", () => {
    const result = selectGuards(makeTask({ fixMode: undefined }), makeFixability("api-agent"));
    expect(result.profileName).toBe("tight");
    expect(result.guards).toEqual(GUARD_PROFILES.tight);
  });

  it("api-agent + architect fixMode → tight (only torque/sweep branching; architect is separate recommendation)", () => {
    const result = selectGuards(makeTask({ fixMode: "architect" }), makeFixability("api-agent"));
    expect(result.profileName).toBe("tight");
  });
});

// ── shell-agent routing ──────────────────────────────────────────────────────

describe("selectGuards — shell-agent", () => {
  it("shell-agent + torque → refactor (12/280)", () => {
    const result = selectGuards(makeTask({ fixMode: "torque" }), makeFixability("shell-agent"));
    expect(result.profileName).toBe("refactor");
    expect(result.guards).toEqual(GUARD_PROFILES.refactor);
    expect(result.guards?.maxFilesChanged).toBe(12);
    expect(result.guards?.maxLinesChanged).toBe(280);
  });

  it("shell-agent + sweep → broad (20/500)", () => {
    const result = selectGuards(makeTask({ fixMode: "sweep" }), makeFixability("shell-agent"));
    expect(result.profileName).toBe("broad");
    expect(result.guards).toEqual(GUARD_PROFILES.broad);
    expect(result.guards?.maxFilesChanged).toBe(20);
    expect(result.guards?.maxLinesChanged).toBe(500);
  });

  it("shell-agent + undefined fixMode → refactor", () => {
    const result = selectGuards(makeTask({ fixMode: undefined }), makeFixability("shell-agent"));
    expect(result.profileName).toBe("refactor");
  });
});

// ── architect routing ────────────────────────────────────────────────────────

describe("selectGuards — architect", () => {
  it("architect → broad (20/500)", () => {
    const result = selectGuards(makeTask({ fixMode: "torque" }), makeFixability("architect"));
    expect(result.profileName).toBe("broad");
    expect(result.guards).toEqual(GUARD_PROFILES.broad);
  });

  it("architect + sweep fixMode → broad (recommendation wins)", () => {
    const result = selectGuards(makeTask({ fixMode: "sweep" }), makeFixability("architect"));
    expect(result.profileName).toBe("broad");
  });
});

// ── skip routing ─────────────────────────────────────────────────────────────

describe("selectGuards — skip", () => {
  it("skip → tight (safe default)", () => {
    const result = selectGuards(makeTask(), makeFixability("skip"));
    expect(result.profileName).toBe("tight");
    expect(result.guards).toEqual(GUARD_PROFILES.tight);
  });

  it("skip reason mentions safe default", () => {
    const result = selectGuards(makeTask(), makeFixability("skip"));
    expect(result.reason).toMatch(/safe default/i);
  });
});

// ── test subcategory elevation ───────────────────────────────────────────────

describe("selectGuards — test subcategory elevation", () => {
  it("Coverage ratio → refactor (regardless of recommendation)", () => {
    const result = selectGuards(makeTask({ subcategory: "Coverage ratio" }), makeFixability("api-agent"));
    expect(result.profileName).toBe("refactor");
    expect(result.guards).toEqual(GUARD_PROFILES.refactor);
    expect(result.reason).toMatch(/cross-cutting/i);
  });

  it("Test quality → refactor (regardless of recommendation)", () => {
    const result = selectGuards(makeTask({ subcategory: "Test quality" }), makeFixability("api-agent"));
    expect(result.profileName).toBe("refactor");
  });

  it("Coverage ratio + shell-agent → refactor (not narrowed by recommendation)", () => {
    const result = selectGuards(makeTask({ subcategory: "Coverage ratio" }), makeFixability("shell-agent"));
    expect(result.profileName).toBe("refactor");
  });

  it("Test quality + skip → refactor (elevated above tight)", () => {
    const result = selectGuards(makeTask({ subcategory: "Test quality" }), makeFixability("skip"));
    expect(result.profileName).toBe("refactor");
  });

  it("other subcategory → not elevated", () => {
    const result = selectGuards(makeTask({ subcategory: "Dead code" }), makeFixability("api-agent"));
    expect(result.profileName).toBe("tight");
  });
});

// ── no fixability fallback ───────────────────────────────────────────────────

describe("selectGuards — no fixability provided", () => {
  it("torque fixMode + no fixability → tight", () => {
    const result = selectGuards(makeTask({ fixMode: "torque" }));
    expect(result.profileName).toBe("tight");
    expect(result.guards).toEqual(GUARD_PROFILES.tight);
  });

  it("sweep fixMode + no fixability → sweep", () => {
    const result = selectGuards(makeTask({ fixMode: "sweep" }));
    expect(result.profileName).toBe("sweep");
    expect(result.guards).toEqual(GUARD_PROFILES.sweep);
  });

  it("architect fixMode + no fixability → broad", () => {
    const result = selectGuards(makeTask({ fixMode: "architect" }));
    expect(result.profileName).toBe("broad");
    expect(result.guards).toEqual(GUARD_PROFILES.broad);
  });

  it("undefined fixMode + no fixability → tight (torque default)", () => {
    const result = selectGuards(makeTask({ fixMode: undefined }));
    expect(result.profileName).toBe("tight");
  });

  it("no fixability — reason mentions fallback", () => {
    const result = selectGuards(makeTask({ fixMode: "torque" }));
    expect(result.reason).toMatch(/no fixability/i);
  });
});

// ── output shape ─────────────────────────────────────────────────────────────

describe("selectGuards — output shape", () => {
  it("always returns guards, profileName, and reason", () => {
    const result = selectGuards(makeTask(), makeFixability("api-agent"));
    expect(result).toHaveProperty("guards");
    expect(result).toHaveProperty("profileName");
    expect(result).toHaveProperty("reason");
    expect(typeof result.profileName).toBe("string");
    expect(typeof result.reason).toBe("string");
  });

  it("architect recommendation returns null for atomic-like broad (guards are non-null)", () => {
    const result = selectGuards(makeTask(), makeFixability("architect"));
    // broad profile is non-null (it has limits)
    expect(result.guards).not.toBeNull();
  });

  it("api-sweep guard values are between tight and refactor", () => {
    const tight = GUARD_PROFILES.tight!;
    const refactor = GUARD_PROFILES.refactor!;
    const result = selectGuards(makeTask({ fixMode: "sweep" }), makeFixability("api-agent"));
    expect(result.guards!.maxFilesChanged).toBeGreaterThanOrEqual(tight.maxFilesChanged);
    expect(result.guards!.maxLinesChanged).toBeGreaterThan(tight.maxLinesChanged);
    expect(result.guards!.maxLinesChanged).toBeLessThan(refactor.maxLinesChanged);
  });
});
