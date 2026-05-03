import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyFixability, filterByFixability } from "../core/fixability.js";
import { recordRollback } from "../core/feedback.js";
import type { IssueTask } from "../core/issue-backlog.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-fixability-test-"));
}

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

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── classifyFixability ─────────────────────────────────────────────────────

describe("classifyFixability — routing recommendations", () => {
  it("single file + torque + effort 1 → api-agent", () => {
    // 'Empty catches' has effortPerFix=1, fixMode='torque'
    const task = makeTask({ subcategory: "Empty catches", fixMode: "torque", sweepFiles: ["src/a.ts"] });
    const result = classifyFixability(task, 100);
    expect(result.fixabilityScore).toBeGreaterThanOrEqual(0.8);
    expect(result.recommendation).toBe("api-agent");
  });

  it("single file + sweep mode → shell-agent or api-agent", () => {
    // sweep reduces fixability; single file helps
    const task = makeTask({ fixMode: "sweep", sweepFiles: ["src/a.ts"] });
    const result = classifyFixability(task, 100);
    expect(["api-agent", "shell-agent"]).toContain(result.recommendation);
  });

  it("architect mode with multiple files → architect recommendation", () => {
    // Single-file architect can still reach shell-agent; multi-file drops to architect range
    const files = Array.from({ length: 5 }, (_, i) => `src/file-${i}.ts`);
    const task = makeTask({ subcategory: "Duplication", fixMode: "architect", sweepFiles: files });
    const result = classifyFixability(task, 100);
    expect(result.recommendation).toBe("architect");
  });

  it(">10 files + architect → skip", () => {
    const files = Array.from({ length: 15 }, (_, i) => `src/file-${i}.ts`);
    const task = makeTask({ subcategory: "Duplication", fixMode: "architect", sweepFiles: files });
    const result = classifyFixability(task, 100);
    expect(result.recommendation).toBe("skip");
  });
});

describe("classifyFixability — file spread signal", () => {
  it("0 files → treated as 1 file (no spread penalty)", () => {
    const task = makeTask({ sweepFiles: [] });
    const result = classifyFixability(task, 100);
    expect(result.fixabilityScore).toBeGreaterThan(0.6);
  });

  it("1 file → highest spread score", () => {
    const task = makeTask({ sweepFiles: ["src/a.ts"] });
    const single = classifyFixability(task, 100).fixabilityScore;

    const taskMany = makeTask({ sweepFiles: Array.from({ length: 20 }, (_, i) => `src/${i}.ts`) });
    const many = classifyFixability(taskMany, 100).fixabilityScore;
    expect(single).toBeGreaterThan(many);
  });

  it("2-3 files → slightly lower than 1 file", () => {
    const t1 = classifyFixability(makeTask({ sweepFiles: ["src/a.ts"] }), 100);
    const t2 = classifyFixability(makeTask({ sweepFiles: ["src/a.ts", "src/b.ts", "src/c.ts"] }), 100);
    expect(t1.fixabilityScore).toBeGreaterThan(t2.fixabilityScore);
  });

  it("4-10 files → medium spread penalty", () => {
    const t3 = classifyFixability(makeTask({ sweepFiles: ["a", "b", "c"] }), 100);
    const t5 = classifyFixability(makeTask({ sweepFiles: Array.from({ length: 7 }, (_, i) => `${i}`) }), 100);
    expect(t3.fixabilityScore).toBeGreaterThan(t5.fixabilityScore);
  });

  it("100 files → very low fixability", () => {
    const files = Array.from({ length: 100 }, (_, i) => `src/file-${i}.ts`);
    const task = makeTask({ sweepFiles: files });
    const result = classifyFixability(task, 1000);
    expect(result.fixabilityScore).toBeLessThan(0.3);
  });
});

describe("classifyFixability — fix mode signal", () => {
  it("torque > sweep > architect ordering", () => {
    const torque = classifyFixability(makeTask({ fixMode: "torque", sweepFiles: ["src/a.ts"] }), 100);
    const sweep = classifyFixability(makeTask({ fixMode: "sweep", sweepFiles: ["src/a.ts"] }), 100);
    const architect = classifyFixability(makeTask({ fixMode: "architect", sweepFiles: ["src/a.ts"] }), 100);
    expect(torque.fixabilityScore).toBeGreaterThan(sweep.fixabilityScore);
    expect(sweep.fixabilityScore).toBeGreaterThan(architect.fixabilityScore);
  });

  it("undefined fixMode defaults to sweep-level score", () => {
    const sweep = classifyFixability(makeTask({ fixMode: "sweep", sweepFiles: ["src/a.ts"] }), 100);
    const undef = classifyFixability(makeTask({ fixMode: undefined, sweepFiles: ["src/a.ts"] }), 100);
    expect(undef.fixabilityScore).toBe(sweep.fixabilityScore);
  });
});

describe("classifyFixability — effort signal", () => {
  it("effort 1 subcategory scores higher than effort 5", () => {
    // Empty catches → effort 1, Duplication → effort 5
    const low = classifyFixability(
      makeTask({ subcategory: "Empty catches", fixMode: "torque", sweepFiles: ["src/a.ts"] }),
      100
    );
    const high = classifyFixability(
      makeTask({ subcategory: "Duplication", fixMode: "architect", sweepFiles: ["src/a.ts"] }),
      100
    );
    expect(low.fixabilityScore).toBeGreaterThan(high.fixabilityScore);
  });

  it("unknown subcategory defaults to effort 3 (medium)", () => {
    const unknown = classifyFixability(makeTask({ subcategory: "Nonexistent subcategory XYZ" }), 100);
    expect(unknown.fixabilityScore).toBeGreaterThan(0);
    expect(unknown.fixabilityScore).toBeLessThan(1);
  });
});

describe("classifyFixability — cross-cutting penalty", () => {
  it("11 files applies additional cross-cutting penalty vs 10 files", () => {
    const t10 = classifyFixability(makeTask({ sweepFiles: Array.from({ length: 10 }, (_, i) => `${i}`) }), 100);
    const t11 = classifyFixability(makeTask({ sweepFiles: Array.from({ length: 11 }, (_, i) => `${i}`) }), 100);
    expect(t10.fixabilityScore).toBeGreaterThan(t11.fixabilityScore);
  });

  it("cross-cutting penalty scales with file count", () => {
    const t11 = classifyFixability(makeTask({ sweepFiles: Array.from({ length: 11 }, (_, i) => `${i}`) }), 100);
    const t50 = classifyFixability(makeTask({ sweepFiles: Array.from({ length: 50 }, (_, i) => `${i}`) }), 100);
    expect(t11.fixabilityScore).toBeGreaterThan(t50.fixabilityScore);
  });
});

describe("classifyFixability — feedback loop signal", () => {
  it("returns 0.0 when issue+strategy has 3+ failures", () => {
    const task = makeTask({ subcategory: "Dead code", fixMode: "torque", sweepFiles: ["src/a.ts"] });
    for (let i = 0; i < 3; i++) {
      recordRollback(tmpDir, {
        issueId: "Dead code",
        strategy: "torque",
        filesTargeted: ["src/a.ts"],
        rollbackReason: "test_fail",
        model: "claude-sonnet-4-6",
        timestamp: new Date().toISOString(),
      });
    }
    const result = classifyFixability(task, 100, tmpDir);
    expect(result.fixabilityScore).toBe(0);
    expect(result.recommendation).toBe("skip");
  });

  it("does not zero out score when only 2 failures recorded", () => {
    const task = makeTask({ subcategory: "Dead code", fixMode: "torque", sweepFiles: ["src/a.ts"] });
    for (let i = 0; i < 2; i++) {
      recordRollback(tmpDir, {
        issueId: "Dead code",
        strategy: "torque",
        filesTargeted: ["src/a.ts"],
        rollbackReason: "test_fail",
        model: "claude-sonnet-4-6",
        timestamp: new Date().toISOString(),
      });
    }
    const result = classifyFixability(task, 100, tmpDir);
    expect(result.fixabilityScore).toBeGreaterThan(0);
  });

  it("skips feedback check when cwd is not provided", () => {
    // Even if there were 10 failures, no cwd → no feedback check → normal score
    const task = makeTask({ subcategory: "Dead code", fixMode: "torque", sweepFiles: ["src/a.ts"] });
    const result = classifyFixability(task, 100); // no cwd
    expect(result.fixabilityScore).toBeGreaterThan(0);
  });

  it("failure for different strategy does not blacklist current strategy", () => {
    const task = makeTask({ subcategory: "Dead code", fixMode: "torque", sweepFiles: ["src/a.ts"] });
    // 3 failures for 'sweep', not 'torque'
    for (let i = 0; i < 3; i++) {
      recordRollback(tmpDir, {
        issueId: "Dead code",
        strategy: "sweep",
        filesTargeted: ["src/a.ts"],
        rollbackReason: "test_fail",
        model: "claude-sonnet-4-6",
        timestamp: new Date().toISOString(),
      });
    }
    const result = classifyFixability(task, 100, tmpDir);
    expect(result.fixabilityScore).toBeGreaterThan(0);
  });
});

describe("classifyFixability — output fields", () => {
  it("issueId equals task.subcategory", () => {
    const task = makeTask({ subcategory: "Coverage" });
    const result = classifyFixability(task, 100);
    expect(result.issueId).toBe("Coverage");
  });

  it("impactScore is clamped to [0, 1]", () => {
    const lowPriority = classifyFixability(makeTask({ priority: 0 }), 100);
    const highPriority = classifyFixability(makeTask({ priority: 9999 }), 100);
    expect(lowPriority.impactScore).toBeGreaterThanOrEqual(0);
    expect(highPriority.impactScore).toBeLessThanOrEqual(1);
  });

  it("fixabilityScore is clamped to [0, 1]", () => {
    const result = classifyFixability(makeTask(), 100);
    expect(result.fixabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.fixabilityScore).toBeLessThanOrEqual(1);
  });

  it("reason is a non-empty string", () => {
    const result = classifyFixability(makeTask(), 100);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("reason mentions cross-cutting when >10 files", () => {
    const files = Array.from({ length: 15 }, (_, i) => `${i}.ts`);
    const result = classifyFixability(makeTask({ sweepFiles: files }), 100);
    expect(result.reason).toMatch(/cross-cutting|files/i);
  });
});

// ── filterByFixability ─────────────────────────────────────────────────────

describe("filterByFixability", () => {
  it("returns all tasks as actionable with threshold=0", () => {
    const tasks = [
      makeTask({
        subcategory: "Duplication",
        fixMode: "architect",
        sweepFiles: Array.from({ length: 20 }, (_, i) => `${i}`),
      }),
      makeTask({ subcategory: "Empty catches", fixMode: "torque", sweepFiles: ["src/a.ts"] }),
    ];
    const { actionable, deferred } = filterByFixability(tasks, 100, 0);
    expect(actionable).toHaveLength(2);
    expect(deferred).toHaveLength(0);
  });

  it("returns all tasks as deferred when threshold exceeds any achievable score", () => {
    // A high-effort architect task with many files cannot reach 0.99
    const files = Array.from({ length: 20 }, (_, i) => `src/file-${i}.ts`);
    const tasks = [makeTask({ subcategory: "Duplication", fixMode: "architect", sweepFiles: files })];
    const { actionable, deferred } = filterByFixability(tasks, 100, 0.99);
    expect(actionable).toHaveLength(0);
    expect(deferred).toHaveLength(1);
  });

  it("correctly splits tasks at threshold=0.8 (api-agent gate)", () => {
    const easy = makeTask({ subcategory: "Empty catches", fixMode: "torque", sweepFiles: ["src/a.ts"] });
    const hard = makeTask({
      subcategory: "Duplication",
      fixMode: "architect",
      sweepFiles: Array.from({ length: 20 }, (_, i) => `${i}`),
    });
    const { actionable, deferred } = filterByFixability([easy, hard], 100, 0.8);
    expect(actionable).toContain(easy);
    expect(deferred).toContain(hard);
  });

  it("returns empty arrays for empty input", () => {
    const { actionable, deferred } = filterByFixability([], 100);
    expect(actionable).toHaveLength(0);
    expect(deferred).toHaveLength(0);
  });

  it("uses default threshold=0.3 (excludes skip-level issues)", () => {
    const skipTask = makeTask({
      subcategory: "Duplication",
      fixMode: "architect",
      sweepFiles: Array.from({ length: 50 }, (_, i) => `${i}`),
    });
    const { actionable, deferred } = filterByFixability([skipTask], 100);
    expect(deferred).toContain(skipTask);
  });

  it("applies feedback blacklist when cwd is provided", () => {
    const task = makeTask({ subcategory: "Dead code", fixMode: "torque", sweepFiles: ["src/a.ts"] });
    for (let i = 0; i < 3; i++) {
      recordRollback(tmpDir, {
        issueId: "Dead code",
        strategy: "torque",
        filesTargeted: ["src/a.ts"],
        rollbackReason: "test_fail",
        model: "claude-sonnet-4-6",
        timestamp: new Date().toISOString(),
      });
    }
    const { actionable, deferred } = filterByFixability([task], 100, 0.3, tmpDir);
    expect(actionable).toHaveLength(0);
    expect(deferred).toHaveLength(1);
  });

  it("preserves task order in both output arrays", () => {
    const tasks = [
      makeTask({ subcategory: "Empty catches", fixMode: "torque", sweepFiles: ["src/a.ts"], priority: 90 }),
      makeTask({ subcategory: "Empty catches", fixMode: "torque", sweepFiles: ["src/b.ts"], priority: 80 }),
      makeTask({ subcategory: "Empty catches", fixMode: "torque", sweepFiles: ["src/c.ts"], priority: 70 }),
    ];
    const { actionable } = filterByFixability(tasks, 100, 0.8);
    expect(actionable[0]?.priority).toBe(90);
    expect(actionable[1]?.priority).toBe(80);
    expect(actionable[2]?.priority).toBe(70);
  });

  it("various thresholds produce different split points", () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({
        subcategory: "Empty catches",
        fixMode: "torque",
        sweepFiles: Array.from({ length: 1 + i * 3 }, (_, j) => `file-${j}.ts`),
        priority: 50,
      })
    );
    const { actionable: a08 } = filterByFixability(tasks, 100, 0.8);
    const { actionable: a03 } = filterByFixability(tasks, 100, 0.3);
    // Lower threshold always produces >= actionable tasks
    expect(a03.length).toBeGreaterThanOrEqual(a08.length);
  });
});
