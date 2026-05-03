/**
 * Tests for the subcategory blacklist mechanism.
 *
 * The engine tracks per-subcategory rollbacks and zero-delta lands. Once a
 * subcategory hits the threshold (2+ rollbacks OR 3+ zero-delta lands), it is
 * added to blacklistedSubcategories and all backlog groups targeting only that
 * subcategory are skipped in the main click loop.
 */
import { describe, it, expect } from "vitest";

// ── Types mirroring the engine's subcategory stats shape ──────────────────────

interface SubcategoryStats {
  rollbacks: number;
  zeroDeltaLands: number;
}

// ── Pure helper: blacklist threshold check ────────────────────────────────────

function shouldBlacklist(stats: SubcategoryStats): boolean {
  return stats.rollbacks >= 2 || stats.zeroDeltaLands >= 3;
}

// ── Pure helper: should a group be skipped? ───────────────────────────────────

function allGroupTasksBlacklisted(group: Array<{ subcategory?: string }>, blacklisted: Set<string>): boolean {
  return group.every(t => blacklisted.has(t.subcategory ?? ""));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("subcategory blacklist threshold", () => {
  it("blacklists after 2 rollbacks", () => {
    expect(shouldBlacklist({ rollbacks: 2, zeroDeltaLands: 0 })).toBe(true);
  });

  it("blacklists after 3 zero-delta lands", () => {
    expect(shouldBlacklist({ rollbacks: 0, zeroDeltaLands: 3 })).toBe(true);
  });

  it("does NOT blacklist at 1 rollback and 2 zero-delta lands", () => {
    expect(shouldBlacklist({ rollbacks: 1, zeroDeltaLands: 2 })).toBe(false);
  });

  it("does NOT blacklist at 0 rollbacks and 0 zero-delta lands", () => {
    expect(shouldBlacklist({ rollbacks: 0, zeroDeltaLands: 0 })).toBe(false);
  });

  it("blacklists at rollbacks=2 even with zero-delta lands < 3", () => {
    expect(shouldBlacklist({ rollbacks: 2, zeroDeltaLands: 1 })).toBe(true);
  });

  it("blacklists at zeroDeltaLands=3 even with rollbacks < 2", () => {
    expect(shouldBlacklist({ rollbacks: 0, zeroDeltaLands: 3 })).toBe(true);
  });
});

describe("backlog group skipping with blacklist", () => {
  it("skips a group where all tasks have a blacklisted subcategory", () => {
    const blacklisted = new Set(["Auth & rate limiting"]);
    const group = [{ subcategory: "Auth & rate limiting" }, { subcategory: "Auth & rate limiting" }];
    expect(allGroupTasksBlacklisted(group, blacklisted)).toBe(true);
  });

  it("does NOT skip a group with at least one non-blacklisted subcategory", () => {
    const blacklisted = new Set(["Auth & rate limiting"]);
    const group = [{ subcategory: "Auth & rate limiting" }, { subcategory: "Input validation" }];
    expect(allGroupTasksBlacklisted(group, blacklisted)).toBe(false);
  });

  it("does NOT skip a group when blacklist is empty", () => {
    const blacklisted = new Set<string>();
    const group = [{ subcategory: "Auth & rate limiting" }];
    expect(allGroupTasksBlacklisted(group, blacklisted)).toBe(false);
  });

  it("skips a mixed-subcategory group when all present subcategories are blacklisted", () => {
    const blacklisted = new Set(["Auth & rate limiting", "Error handling"]);
    const group = [{ subcategory: "Auth & rate limiting" }, { subcategory: "Error handling" }];
    expect(allGroupTasksBlacklisted(group, blacklisted)).toBe(true);
  });
});

describe("subcategory stats accumulation", () => {
  it("accumulates rollbacks per subcategory independently", () => {
    const stats = new Map<string, SubcategoryStats>();

    const track = (subcategory: string, rolledBack: boolean, zeroDelta: boolean) => {
      const s = stats.get(subcategory) ?? { rollbacks: 0, zeroDeltaLands: 0 };
      if (rolledBack) s.rollbacks++;
      else if (zeroDelta) s.zeroDeltaLands++;
      stats.set(subcategory, s);
    };

    track("Auth & rate limiting", true, false);
    track("Auth & rate limiting", true, false);
    track("Input validation", true, false);

    expect(stats.get("Auth & rate limiting")!.rollbacks).toBe(2);
    expect(stats.get("Input validation")!.rollbacks).toBe(1);
    expect(shouldBlacklist(stats.get("Auth & rate limiting")!)).toBe(true);
    expect(shouldBlacklist(stats.get("Input validation")!)).toBe(false);
  });

  it("accumulates zero-delta lands to trigger blacklist", () => {
    const stats = new Map<string, SubcategoryStats>();

    const track = (subcategory: string) => {
      const s = stats.get(subcategory) ?? { rollbacks: 0, zeroDeltaLands: 0 };
      s.zeroDeltaLands++;
      stats.set(subcategory, s);
    };

    track("Auth & rate limiting");
    track("Auth & rate limiting");
    track("Auth & rate limiting");

    expect(shouldBlacklist(stats.get("Auth & rate limiting")!)).toBe(true);
  });
});
