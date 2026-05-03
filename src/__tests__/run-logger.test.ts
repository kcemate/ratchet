import { describe, it, expect, beforeEach } from "vitest";
import { RunLogger } from "../../src/lib/run-logger.js";
import { readFile } from "fs/promises";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("RunLogger", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "run-logger-test-"));
  });

  async function cleanup() {
    await rm(tmpDir, { recursive: true, force: true });
  }

  it("creates the .ratchet/runs directory automatically", async () => {
    const logger = new RunLogger("test-run-id", tmpDir);
    await logger.log("click_start", 1, {});
    const content = await readFile(join(tmpDir, ".ratchet", "runs", "test-run-id.jsonl"), "utf8");
    expect(content).toBeTruthy();
    await cleanup();
  });

  it("writes valid JSON lines", async () => {
    const logger = new RunLogger("run-abc", tmpDir);
    await logger.log("click_start", 1, { target: "src" });
    await logger.log("click_end", 1, { testsPassed: true, rolled_back: false });

    const content = await readFile(join(tmpDir, ".ratchet", "runs", "run-abc.jsonl"), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!);
    expect(first.event).toBe("click_start");
    expect(first.clickNumber).toBe(1);
    expect(first.data).toEqual({ target: "src" });
    expect(typeof first.timestamp).toBe("string");

    const second = JSON.parse(lines[1]!);
    expect(second.event).toBe("click_end");
    await cleanup();
  });

  it("logClickStart convenience method sets correct event", async () => {
    const logger = new RunLogger("run-start", tmpDir);
    await logger.logClickStart(3, { mode: "sweep" });

    const content = await readFile(join(tmpDir, ".ratchet", "runs", "run-start.jsonl"), "utf8");
    const event = JSON.parse(content.trim());
    expect(event.event).toBe("click_start");
    expect(event.clickNumber).toBe(3);
    await cleanup();
  });

  it("logRollback writes rollback event with reason", async () => {
    const logger = new RunLogger("run-rollback", tmpDir);
    await logger.logRollback(2, "tests failed");

    const content = await readFile(join(tmpDir, ".ratchet", "runs", "run-rollback.jsonl"), "utf8");
    const event = JSON.parse(content.trim());
    expect(event.event).toBe("rollback");
    expect(event.data.reason).toBe("tests failed");
    await cleanup();
  });

  it("logScoreDelta writes before/after/delta", async () => {
    const logger = new RunLogger("run-score", tmpDir);
    await logger.logScoreDelta(4, { before: 70, after: 75, delta: 5 });

    const content = await readFile(join(tmpDir, ".ratchet", "runs", "run-score.jsonl"), "utf8");
    const event = JSON.parse(content.trim());
    expect(event.event).toBe("score_delta");
    expect(event.data).toEqual({ before: 70, after: 75, delta: 5 });
    await cleanup();
  });

  it("appends multiple events to same file", async () => {
    const logger = new RunLogger("run-multi", tmpDir);
    for (let i = 1; i <= 5; i++) {
      await logger.log("click_start", i, {});
    }

    const content = await readFile(join(tmpDir, ".ratchet", "runs", "run-multi.jsonl"), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(5);
    await cleanup();
  });
});
