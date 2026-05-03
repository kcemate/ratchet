import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HistoryEntry } from "../core/history.js";
import type { RatchetRun } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRun(overrides: Partial<RatchetRun> = {}): RatchetRun {
  return {
    id: "test-run-id",
    target: { name: "src", path: "src/", description: "test" },
    clicks: [],
    startedAt: new Date(),
    status: "interrupted",
    resumeState: {
      completedClicks: 2,
      totalClicks: 5,
      target: "src",
      interruptedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function makeEntry(run: RatchetRun): HistoryEntry {
  return { run, savedAt: new Date().toISOString() };
}

// ── Auto-resume selection logic ───────────────────────────────────────────────
//
// These tests exercise the logic that decides whether to auto-resume,
// mirroring the conditions in torque.ts:
//   - no explicit --resume
//   - no explicit --target
//   - autoResume !== false
//   - listRuns() returns an interrupted run

describe("auto-resume selection", () => {
  function shouldAutoResume(opts: {
    resume?: string;
    target?: string;
    autoResume: boolean;
    interrupted: HistoryEntry | undefined;
  }): { resumeId: string | undefined } {
    if (opts.resume || opts.target || opts.autoResume === false) {
      return { resumeId: undefined };
    }
    return { resumeId: opts.interrupted?.run.id };
  }

  it("auto-resumes when interrupted run exists and no flags set", () => {
    const entry = makeEntry(makeRun());
    const result = shouldAutoResume({ autoResume: true, interrupted: entry });
    expect(result.resumeId).toBe("test-run-id");
  });

  it("skips auto-resume when --resume is already set", () => {
    const entry = makeEntry(makeRun());
    const result = shouldAutoResume({ resume: "explicit-id", autoResume: true, interrupted: entry });
    expect(result.resumeId).toBeUndefined();
  });

  it("skips auto-resume when --target is set", () => {
    const entry = makeEntry(makeRun());
    const result = shouldAutoResume({ target: "api", autoResume: true, interrupted: entry });
    expect(result.resumeId).toBeUndefined();
  });

  it("skips auto-resume when --no-auto-resume is set", () => {
    const entry = makeEntry(makeRun());
    const result = shouldAutoResume({ autoResume: false, interrupted: entry });
    expect(result.resumeId).toBeUndefined();
  });

  it("skips auto-resume when no interrupted run exists", () => {
    const result = shouldAutoResume({ autoResume: true, interrupted: undefined });
    expect(result.resumeId).toBeUndefined();
  });

  it("skips auto-resume for completed runs", () => {
    const completedEntry = makeEntry(makeRun({ status: "completed" }));
    // listRuns filter: only find entries with status='interrupted'
    const interrupted = completedEntry.run.status === "interrupted" ? completedEntry : undefined;
    const result = shouldAutoResume({ autoResume: true, interrupted });
    expect(result.resumeId).toBeUndefined();
  });
});

// ── onCheckpoint callback ─────────────────────────────────────────────────────

describe("onCheckpoint", () => {
  it("saves run after each landed click", async () => {
    const saveRun = vi.fn().mockResolvedValue(undefined);

    const onCheckpoint = async (run: RatchetRun) => {
      await saveRun("/cwd", run);
    };

    const run = makeRun({ status: "running" });
    await onCheckpoint(run);

    expect(saveRun).toHaveBeenCalledOnce();
    expect(saveRun).toHaveBeenCalledWith("/cwd", run);
  });

  it("does not throw when saveRun fails", async () => {
    const saveRun = vi.fn().mockRejectedValue(new Error("disk full"));

    const onCheckpoint = async (run: RatchetRun) => {
      try {
        await saveRun("/cwd", run);
      } catch {
        // Non-fatal
      }
    };

    const run = makeRun({ status: "running" });
    await expect(onCheckpoint(run)).resolves.toBeUndefined();
  });
});
