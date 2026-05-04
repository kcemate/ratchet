import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInitialRun, requireNamedBranch, formatRollbackMessage } from "../core/engine-utils.js";
import type { Target } from "../types.js";

// ── Mock git module for requireNamedBranch tests ─────────────────────────────
vi.mock("../core/git.js", () => ({
  isDetachedHead: vi.fn(),
}));

// Dynamic import after mock — lazy-load so vi.mock wins
async function getGitMock() {
  const git = await import("../core/git.js");
  return git as unknown as { isDetachedHead: ReturnType<typeof vi.fn> };
}

describe("engine-utils.ts", () => {
  // ── createInitialRun() ─────────────────────────────────────────────────────
  describe("createInitialRun()", () => {
    it("returns a RatchetRun with the correct target", () => {
      const target: Target = { name: "test", path: "/tmp/test-repo", description: "Test repo" };
      const run = createInitialRun(target);
      expect(run.target).toBe(target);
    });

    it("assigns a valid UUID id", () => {
      const target: Target = { name: "test", path: "/tmp/test-repo", description: "Test repo" };
      const run = createInitialRun(target);
      expect(run.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("initializes status to running and empty clicks array", () => {
      const target: Target = { name: "test", path: "/tmp/test-repo", description: "Test repo" };
      const run = createInitialRun(target);
      expect(run.status).toBe("running");
      expect(run.clicks).toEqual([]);
    });

    it("sets startedAt to a recent Date", () => {
      const before = new Date().getTime();
      const run = createInitialRun({ name: "test", path: "/tmp/test-repo", description: "Test repo" });
      const after = new Date().getTime();
      expect(run.startedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(run.startedAt.getTime()).toBeLessThanOrEqual(after);
    });
  });

  // ── requireNamedBranch() ───────────────────────────────────────────────────
  describe("requireNamedBranch()", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("resolves when the repo is NOT in detached HEAD state", async () => {
      const git = await getGitMock();
      git.isDetachedHead.mockResolvedValue(false);
      await expect(requireNamedBranch("/tmp/repo")).resolves.toBeUndefined();
    });

    it("throws a clear error when the repo IS in detached HEAD state", async () => {
      const git = await getGitMock();
      git.isDetachedHead.mockResolvedValue(true);
      await expect(requireNamedBranch("/tmp/repo")).rejects.toThrow(
        "Git repository is in detached HEAD state. Ratchet requires a named branch."
      );
    });
  });

  // ── formatRollbackMessage() ────────────────────────────────────────────────
  describe("formatRollbackMessage()", () => {
    it("formats a minimal rollback message", () => {
      const msg = formatRollbackMessage(3, undefined);
      expect(msg).toBe("[ratchet] click 3 ROLLED BACK — tests failed or build errored");
    });

    it("includes elapsed time when provided", () => {
      const msg = formatRollbackMessage(3, undefined, "4.2");
      expect(msg).toBe("[ratchet] click 3 ROLLED BACK (4.2s) — tests failed or build errored");
    });

    it("includes the reason string when provided", () => {
      const msg = formatRollbackMessage(5, "build failed");
      expect(msg).toBe("[ratchet] click 5 ROLLED BACK — build failed");
    });

    it("includes detail on a new indented line when provided", () => {
      const msg = formatRollbackMessage(7, "tests failed", "1.3", "3 assertions failed");
      expect(msg).toBe("[ratchet] click 7 ROLLED BACK (1.3s) — tests failed\n  3 assertions failed");
    });

    it("combines all optional fields correctly", () => {
      const msg = formatRollbackMessage(12, "guard rejection", "2.1", "score dropped below baseline");
      expect(msg).toBe("[ratchet] click 12 ROLLED BACK (2.1s) — guard rejection\n  score dropped below baseline");
    });
  });
});
