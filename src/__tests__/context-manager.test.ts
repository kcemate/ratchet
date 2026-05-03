import { describe, it, expect } from "vitest";
import {
  ContextManager,
  ContextRound,
  STALE_THRESHOLD_MS,
  DEFAULT_KEEP_RECENT_ROUNDS,
  formatRound,
  formatRoundsSummary,
} from "../core/context-manager.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRound(clickNumber: number, overrides: Partial<ContextRound> = {}): ContextRound {
  return {
    clickNumber,
    endedAt: Date.now(),
    outcome: "landed",
    scoreDelta: 1.5,
    filesModified: [`src/file${clickNumber}.ts`],
    issueCategories: ["console-cleanup"],
    ...overrides,
  };
}

const FAR_PAST = Date.now() - STALE_THRESHOLD_MS - 1_000; // >10 min ago
const RECENT = Date.now() - 1_000; // 1 sec ago

// ── Constants ─────────────────────────────────────────────────────────────

describe("constants", () => {
  it("STALE_THRESHOLD_MS is 10 minutes", () => {
    expect(STALE_THRESHOLD_MS).toBe(600_000);
  });

  it("DEFAULT_KEEP_RECENT_ROUNDS is 2", () => {
    expect(DEFAULT_KEEP_RECENT_ROUNDS).toBe(2);
  });
});

// ── recordRound ───────────────────────────────────────────────────────────

describe("recordRound", () => {
  it("adds a round to the manager", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    expect(cm.getRounds()).toHaveLength(1);
  });

  it("accumulates multiple rounds in order", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    cm.recordRound(makeRound(3));
    expect(cm.getRounds()).toHaveLength(3);
    expect(cm.getRounds()[0]!.clickNumber).toBe(1);
    expect(cm.getRounds()[2]!.clickNumber).toBe(3);
  });

  it("records rolled-back rounds too", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { outcome: "rolled-back", scoreDelta: 0 }));
    expect(cm.getRounds()[0]!.outcome).toBe("rolled-back");
  });
});

// ── shouldCompact — Tier 1 time-based detection ────────────────────────────

describe("shouldCompact (Tier 1)", () => {
  it("returns false when there are 0 rounds", () => {
    const cm = new ContextManager();
    expect(cm.shouldCompact()).toBe(false);
  });

  it("returns false when rounds === keepRecentRounds (exactly at limit)", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { endedAt: FAR_PAST }));
    cm.recordRound(makeRound(2, { endedAt: FAR_PAST }));
    // 2 rounds, keepRecentRounds=2 — nothing to compact
    expect(cm.shouldCompact()).toBe(false);
  });

  it("returns false when rounds < keepRecentRounds", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { endedAt: FAR_PAST }));
    expect(cm.shouldCompact()).toBe(false);
  });

  it("returns false when >keepRecentRounds rounds but last ended recently", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { endedAt: FAR_PAST }));
    cm.recordRound(makeRound(2, { endedAt: FAR_PAST }));
    cm.recordRound(makeRound(3, { endedAt: RECENT })); // last round is recent
    expect(cm.shouldCompact()).toBe(false);
  });

  it("returns true when >keepRecentRounds rounds and last ended >threshold ago", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { endedAt: FAR_PAST }));
    cm.recordRound(makeRound(2, { endedAt: FAR_PAST }));
    cm.recordRound(makeRound(3, { endedAt: FAR_PAST })); // 3 rounds, last is stale
    expect(cm.shouldCompact()).toBe(true);
  });

  it("respects custom staleThresholdMs", () => {
    const cm = new ContextManager({ staleThresholdMs: 1_000 }); // 1 sec
    const justOverThreshold = Date.now() - 2_000; // 2 sec ago
    cm.recordRound(makeRound(1, { endedAt: justOverThreshold }));
    cm.recordRound(makeRound(2, { endedAt: justOverThreshold }));
    cm.recordRound(makeRound(3, { endedAt: justOverThreshold }));
    expect(cm.shouldCompact()).toBe(true);
  });

  it("returns false immediately after recording (not stale yet)", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    cm.recordRound(makeRound(3));
    // All rounds just recorded — endedAt ≈ now
    expect(cm.shouldCompact(Date.now())).toBe(false);
  });
});

// ── compact — Tier 2 round grouping ──────────────────────────────────────

describe("compact (Tier 2)", () => {
  it("is a no-op with 0 rounds", () => {
    const cm = new ContextManager();
    cm.compact();
    expect(cm.getRounds()).toHaveLength(0);
    expect(cm.getSummary()).toBe("");
  });

  it("is a no-op with exactly keepRecentRounds rounds", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    cm.compact();
    expect(cm.getRounds()).toHaveLength(2);
    expect(cm.getSummary()).toBe("");
  });

  it("is a no-op with fewer than keepRecentRounds rounds", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    cm.compact();
    expect(cm.getRounds()).toHaveLength(1);
    expect(cm.getSummary()).toBe("");
  });

  it("compresses older rounds and keeps last 2", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    cm.recordRound(makeRound(3));
    cm.compact();
    // Only rounds 2 and 3 remain
    expect(cm.getRounds()).toHaveLength(2);
    expect(cm.getRounds()[0]!.clickNumber).toBe(2);
    expect(cm.getRounds()[1]!.clickNumber).toBe(3);
  });

  it("never splits a round — each click is atomic", () => {
    const cm = new ContextManager();
    for (let i = 1; i <= 5; i++) cm.recordRound(makeRound(i));
    cm.compact();
    // After compact, last 2 rounds (4 & 5) are always intact
    const rounds = cm.getRounds();
    expect(rounds).toHaveLength(2);
    expect(rounds[0]!.clickNumber).toBe(4);
    expect(rounds[1]!.clickNumber).toBe(5);
  });

  it("produces a non-empty summary after compaction", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    cm.recordRound(makeRound(3));
    cm.compact();
    expect(cm.getSummary().length).toBeGreaterThan(0);
  });

  it("summary contains prior click info", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { issueCategories: ["error-handling"] }));
    cm.recordRound(makeRound(2, { issueCategories: ["auth"] }));
    cm.recordRound(makeRound(3));
    cm.compact();
    const summary = cm.getSummary();
    expect(summary).toContain("Click 1");
    expect(summary).toContain("error-handling");
  });

  it("second compact call accumulates history without losing data", () => {
    const cm = new ContextManager();
    // First compact: rounds 1, 2, 3 → keep 2 and 3
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    cm.recordRound(makeRound(3));
    cm.compact();
    // Add 2 more rounds then compact again: keeps 4 and 5, compresses 2 and 3
    cm.recordRound(makeRound(4));
    cm.recordRound(makeRound(5));
    cm.compact();
    // Summary should mention click 1 from first compact AND clicks 2,3 from second
    const summary = cm.getSummary();
    expect(summary).toContain("Click 1");
    expect(summary).toContain("Click 2");
    expect(cm.getRounds()).toHaveLength(2);
    expect(cm.getRounds()[0]!.clickNumber).toBe(4);
  });

  it("respects custom keepRecentRounds=1", () => {
    const cm = new ContextManager({ keepRecentRounds: 1 });
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    cm.compact();
    expect(cm.getRounds()).toHaveLength(1);
    expect(cm.getRounds()[0]!.clickNumber).toBe(2);
    expect(cm.getSummary()).toContain("Click 1");
  });
});

// ── getCompactableRounds ───────────────────────────────────────────────────

describe("getCompactableRounds", () => {
  it("returns empty array when rounds <= keepRecentRounds", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    expect(cm.getCompactableRounds()).toHaveLength(0);
  });

  it("returns the compactable rounds when rounds > keepRecentRounds", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1));
    cm.recordRound(makeRound(2));
    cm.recordRound(makeRound(3));
    const compactable = cm.getCompactableRounds();
    expect(compactable).toHaveLength(1);
    expect(compactable[0]!.clickNumber).toBe(1);
  });

  it("returns multiple compactable rounds when many rounds tracked", () => {
    const cm = new ContextManager();
    for (let i = 1; i <= 6; i++) cm.recordRound(makeRound(i));
    const compactable = cm.getCompactableRounds();
    expect(compactable).toHaveLength(4); // 6 - 2 = 4 compactable
  });
});

// ── getPromptContext ───────────────────────────────────────────────────────

describe("getPromptContext", () => {
  it("returns empty string when no rounds recorded", () => {
    const cm = new ContextManager();
    expect(cm.getPromptContext()).toBe("");
  });

  it("includes recent rounds in the output", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { issueCategories: ["auth"] }));
    const ctx = cm.getPromptContext();
    expect(ctx).toContain("Click 1");
    expect(ctx).toContain("auth");
  });

  it("includes compacted summary after compact()", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { issueCategories: ["error-handling"] }));
    cm.recordRound(makeRound(2));
    cm.recordRound(makeRound(3));
    cm.compact();
    const ctx = cm.getPromptContext();
    expect(ctx).toContain("COMPACTED");
    expect(ctx).toContain("error-handling");
  });

  it("only 1 round — no compaction, context shows the round", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { outcome: "rolled-back", scoreDelta: 0 }));
    const ctx = cm.getPromptContext();
    expect(ctx).toContain("Click 1");
    expect(ctx).toContain("rolled-back");
    // No compacted marker
    expect(ctx).not.toContain("COMPACTED");
  });
});

// ── formatRound ───────────────────────────────────────────────────────────

describe("formatRound", () => {
  it("formats a landed round with score delta", () => {
    const round = makeRound(3, { scoreDelta: 2.5, issueCategories: ["auth", "logging"] });
    const out = formatRound(round);
    expect(out).toContain("Click 3");
    expect(out).toContain("landed");
    expect(out).toContain("+2.5 pts");
    expect(out).toContain("auth");
  });

  it("formats a rolled-back round without score delta", () => {
    const round = makeRound(2, { outcome: "rolled-back", scoreDelta: 0 });
    const out = formatRound(round);
    expect(out).toContain("rolled-back");
    expect(out).not.toContain("pts");
  });

  it("includes file names when present", () => {
    const round = makeRound(1, { filesModified: ["src/auth.ts"] });
    const out = formatRound(round);
    expect(out).toContain("src/auth.ts");
  });

  it("limits file list to 3 files", () => {
    const round = makeRound(1, {
      filesModified: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
    });
    const out = formatRound(round);
    expect(out).toContain("a.ts");
    expect(out).not.toContain("d.ts");
  });
});

// ── formatRoundsSummary ────────────────────────────────────────────────────

describe("formatRoundsSummary", () => {
  it("returns empty string for empty rounds array", () => {
    expect(formatRoundsSummary([])).toBe("");
  });

  it("includes header and footer markers", () => {
    const out = formatRoundsSummary([makeRound(1)]);
    expect(out).toContain("PRIOR CLICKS");
    expect(out).toContain("---");
  });

  it("includes all rounds in the summary", () => {
    const out = formatRoundsSummary([makeRound(1), makeRound(2), makeRound(3)]);
    expect(out).toContain("Click 1");
    expect(out).toContain("Click 2");
    expect(out).toContain("Click 3");
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("only 1 round total — never compact regardless of time", () => {
    const cm = new ContextManager();
    cm.recordRound(makeRound(1, { endedAt: FAR_PAST }));
    // 1 round, keepRecentRounds=2 → cannot compact
    expect(cm.shouldCompact()).toBe(false);
    cm.compact();
    expect(cm.getSummary()).toBe("");
  });

  it("all rounds stale — compact keeps last 2 intact", () => {
    const cm = new ContextManager();
    for (let i = 1; i <= 5; i++) {
      cm.recordRound(makeRound(i, { endedAt: FAR_PAST }));
    }
    expect(cm.shouldCompact()).toBe(true);
    cm.compact();
    expect(cm.getRounds()).toHaveLength(2);
    expect(cm.getRounds()[0]!.clickNumber).toBe(4);
    expect(cm.getRounds()[1]!.clickNumber).toBe(5);
    expect(cm.getSummary()).toContain("Click 1");
    expect(cm.getSummary()).toContain("Click 3");
  });

  it("compact after all rounds stale includes all older rounds in summary", () => {
    const cm = new ContextManager();
    for (let i = 1; i <= 4; i++) {
      cm.recordRound(makeRound(i, { endedAt: FAR_PAST }));
    }
    cm.compact();
    const summary = cm.getSummary();
    expect(summary).toContain("Click 1");
    expect(summary).toContain("Click 2");
  });
});
