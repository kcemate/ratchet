import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import {
  claimFiles,
  isFileClaimed,
  releaseClaim,
  writeDiscovery,
  readDiscoveries,
  cleanupRun,
  purgeStaleClaimsForRun,
  generateRunId,
  claimsDir,
  discoveriesDir,
  parallelRunDir,
  agentClaimPath,
  STALE_CLAIM_MS,
  type ClaimPayload,
  type Discovery,
} from "../core/parallel-ipc.js";

// ─── Helpers

let tmpCwd: string;

beforeEach(() => {
  tmpCwd = join(tmpdir(), `ratchet-ipc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpCwd, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(tmpCwd, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const RUN_ID = "test-run-001";

// ─── generateRunId ─────────────────────────────────────────────────────────

describe("generateRunId", () => {
  it("returns a non-empty string", () => {
    expect(generateRunId()).toBeTruthy();
  });

  it("returns unique IDs on each call", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateRunId()));
    expect(ids.size).toBe(20);
  });

  it("contains only url-safe characters", () => {
    const id = generateRunId();
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});

// ─── Path helpers ──────────────────────────────────────────────────────────

describe("path helpers", () => {
  it("parallelRunDir builds correct path", () => {
    expect(parallelRunDir("/cwd", "run1")).toBe("/cwd/.ratchet/parallel/run1");
  });

  it("claimsDir builds correct path", () => {
    expect(claimsDir("/cwd", "run1")).toBe("/cwd/.ratchet/parallel/run1/claims");
  });

  it("discoveriesDir builds correct path", () => {
    expect(discoveriesDir("/cwd", "run1")).toBe("/cwd/.ratchet/parallel/run1/discoveries");
  });

  it("agentClaimPath builds correct path", () => {
    expect(agentClaimPath("/cwd", "run1", "agent-1")).toBe("/cwd/.ratchet/parallel/run1/claims/agent-agent-1.json");
  });
});

// ─── claimFiles ────────────────────────────────────────────────────────────

describe("claimFiles", () => {
  it("creates the claims directory if it does not exist", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "refactoring");
    expect(existsSync(claimsDir(tmpCwd, RUN_ID))).toBe(true);
  });

  it("writes a JSON claim file for the agent", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "refactoring");
    const claimPath = agentClaimPath(tmpCwd, RUN_ID, "agent-a");
    expect(existsSync(claimPath)).toBe(true);
    const payload = JSON.parse(readFileSync(claimPath, "utf-8")) as ClaimPayload;
    expect(payload.agentId).toBe("agent-a");
    expect(payload.files).toEqual(["src/foo.ts"]);
    expect(payload.action).toBe("refactoring");
    expect(payload.timestamp).toBeGreaterThan(0);
  });

  it("overwrites an existing claim for the same agent", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "refactoring");
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/bar.ts"], "harden");
    const payload = JSON.parse(readFileSync(agentClaimPath(tmpCwd, RUN_ID, "agent-a"), "utf-8")) as ClaimPayload;
    expect(payload.files).toEqual(["src/bar.ts"]);
    expect(payload.action).toBe("harden");
  });

  it("stores a recent timestamp", () => {
    const before = Date.now();
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "normal");
    const after = Date.now();
    const payload = JSON.parse(readFileSync(agentClaimPath(tmpCwd, RUN_ID, "agent-a"), "utf-8")) as ClaimPayload;
    expect(payload.timestamp).toBeGreaterThanOrEqual(before);
    expect(payload.timestamp).toBeLessThanOrEqual(after);
  });
});

// ─── isFileClaimed ─────────────────────────────────────────────────────────

describe("isFileClaimed", () => {
  it("returns false when no claims directory exists", () => {
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(false);
  });

  it("returns false when only the checking agent has a claim", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "refactoring");
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(false);
  });

  it("returns true when another agent claimed the exact file", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-b", ["src/foo.ts"], "refactoring");
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(true);
  });

  it("returns true when another agent claimed a parent directory", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-b", ["src/"], "refactoring");
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(true);
  });

  it("returns true when another agent claimed a child path", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-b", ["src/foo.ts"], "refactoring");
    // checking parent dir of foo.ts
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src")).toBe(true);
  });

  it("returns false for a completely different file", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-b", ["src/bar.ts"], "refactoring");
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(false);
  });

  it("ignores stale claims (>30 min old)", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-b", ["src/foo.ts"], "refactoring");
    // Backdate the timestamp to simulate a stale claim
    const claimPath = agentClaimPath(tmpCwd, RUN_ID, "agent-b");
    const payload = JSON.parse(readFileSync(claimPath, "utf-8")) as ClaimPayload;
    payload.timestamp = Date.now() - STALE_CLAIM_MS - 1000;
    writeFileSync(claimPath, JSON.stringify(payload), "utf-8");

    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(false);
  });

  it("handles claims with backslash paths (Windows-style)", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-b", ["src\\foo.ts"], "normal");
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(true);
  });

  it("ignores unreadable (corrupt) claim files", () => {
    mkdirSync(claimsDir(tmpCwd, RUN_ID), { recursive: true });
    writeFileSync(join(claimsDir(tmpCwd, RUN_ID), "agent-zombie.json"), "NOT JSON", "utf-8");
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(false);
  });
});

// ─── releaseClaim ──────────────────────────────────────────────────────────

describe("releaseClaim", () => {
  it("deletes the agent claim file", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "normal");
    expect(existsSync(agentClaimPath(tmpCwd, RUN_ID, "agent-a"))).toBe(true);
    releaseClaim(tmpCwd, RUN_ID, "agent-a");
    expect(existsSync(agentClaimPath(tmpCwd, RUN_ID, "agent-a"))).toBe(false);
  });

  it("is idempotent — does not throw if claim is already gone", () => {
    expect(() => releaseClaim(tmpCwd, RUN_ID, "agent-x")).not.toThrow();
  });

  it("does not delete other agents claims", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "normal");
    claimFiles(tmpCwd, RUN_ID, "agent-b", ["src/bar.ts"], "normal");
    releaseClaim(tmpCwd, RUN_ID, "agent-a");
    expect(existsSync(agentClaimPath(tmpCwd, RUN_ID, "agent-b"))).toBe(true);
  });

  it("unblocks file access after release", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-b", ["src/foo.ts"], "normal");
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(true);
    releaseClaim(tmpCwd, RUN_ID, "agent-b");
    expect(isFileClaimed(tmpCwd, RUN_ID, "agent-a", "src/foo.ts")).toBe(false);
  });
});

// ─── writeDiscovery ────────────────────────────────────────────────────────

describe("writeDiscovery", () => {
  it("creates the discoveries directory", () => {
    writeDiscovery(tmpCwd, RUN_ID, "agent-a", {
      type: "rename",
      oldPath: "src/foo.ts",
      newPath: "src/bar.ts",
      description: "Renamed foo to bar",
    });
    expect(existsSync(discoveriesDir(tmpCwd, RUN_ID))).toBe(true);
  });

  it("writes a discovery JSON file", () => {
    writeDiscovery(tmpCwd, RUN_ID, "agent-a", {
      type: "delete",
      oldPath: "src/old.ts",
      description: "Deleted dead code",
    });
    const files = require("fs").readdirSync(discoveriesDir(tmpCwd, RUN_ID)) as string[];
    expect(files.length).toBe(1);
    const content = JSON.parse(readFileSync(join(discoveriesDir(tmpCwd, RUN_ID), files[0]!), "utf-8")) as Discovery;
    expect(content.agentId).toBe("agent-a");
    expect(content.type).toBe("delete");
    expect(content.oldPath).toBe("src/old.ts");
    expect(content.description).toBe("Deleted dead code");
    expect(content.timestamp).toBeGreaterThan(0);
  });

  it("writes multiple discoveries without overwriting", () => {
    writeDiscovery(tmpCwd, RUN_ID, "agent-a", { type: "create", description: "Created A" });
    writeDiscovery(tmpCwd, RUN_ID, "agent-a", { type: "create", description: "Created B" });
    const files = require("fs").readdirSync(discoveriesDir(tmpCwd, RUN_ID)) as string[];
    expect(files.length).toBe(2);
  });
});

// ─── readDiscoveries ───────────────────────────────────────────────────────

describe("readDiscoveries", () => {
  it("returns empty array when no discoveries directory exists", () => {
    expect(readDiscoveries(tmpCwd, RUN_ID, "agent-a")).toEqual([]);
  });

  it("excludes the calling agent own discoveries", () => {
    writeDiscovery(tmpCwd, RUN_ID, "agent-a", { type: "modify", description: "My own change" });
    expect(readDiscoveries(tmpCwd, RUN_ID, "agent-a")).toEqual([]);
  });

  it("returns discoveries from other agents", () => {
    writeDiscovery(tmpCwd, RUN_ID, "agent-b", { type: "rename", description: "Agent B renamed" });
    const results = readDiscoveries(tmpCwd, RUN_ID, "agent-a");
    expect(results.length).toBe(1);
    expect(results[0]!.agentId).toBe("agent-b");
    expect(results[0]!.type).toBe("rename");
  });

  it("returns multiple discoveries from multiple agents", () => {
    writeDiscovery(tmpCwd, RUN_ID, "agent-b", { type: "rename", description: "B renamed" });
    writeDiscovery(tmpCwd, RUN_ID, "agent-c", { type: "delete", description: "C deleted" });
    const results = readDiscoveries(tmpCwd, RUN_ID, "agent-a");
    expect(results.length).toBe(2);
    const types = results.map(r => r.type);
    expect(types).toContain("rename");
    expect(types).toContain("delete");
  });

  it("returns discoveries sorted chronologically", () => {
    // Write with small delays to guarantee different timestamps
    writeDiscovery(tmpCwd, RUN_ID, "agent-b", { type: "create", description: "First" });
    writeDiscovery(tmpCwd, RUN_ID, "agent-c", { type: "delete", description: "Second" });
    const results = readDiscoveries(tmpCwd, RUN_ID, "agent-a");
    expect(results.length).toBe(2);
    expect(results[0]!.timestamp).toBeLessThanOrEqual(results[1]!.timestamp);
  });

  it("ignores corrupt discovery files", () => {
    mkdirSync(discoveriesDir(tmpCwd, RUN_ID), { recursive: true });
    writeFileSync(join(discoveriesDir(tmpCwd, RUN_ID), "discovery-agent-b-12345.json"), "CORRUPT", "utf-8");
    expect(readDiscoveries(tmpCwd, RUN_ID, "agent-a")).toEqual([]);
  });
});

// ─── cleanupRun ────────────────────────────────────────────────────────────

describe("cleanupRun", () => {
  it("removes the entire run directory", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "normal");
    writeDiscovery(tmpCwd, RUN_ID, "agent-a", { type: "modify", description: "Changed foo" });
    expect(existsSync(parallelRunDir(tmpCwd, RUN_ID))).toBe(true);
    cleanupRun(tmpCwd, RUN_ID);
    expect(existsSync(parallelRunDir(tmpCwd, RUN_ID))).toBe(false);
  });

  it("is idempotent — does not throw if directory is already gone", () => {
    expect(() => cleanupRun(tmpCwd, "nonexistent-run")).not.toThrow();
  });

  it("does not remove directories for other run IDs", () => {
    claimFiles(tmpCwd, "run-keep", "agent-a", ["src/foo.ts"], "normal");
    claimFiles(tmpCwd, "run-delete", "agent-a", ["src/bar.ts"], "normal");
    cleanupRun(tmpCwd, "run-delete");
    expect(existsSync(parallelRunDir(tmpCwd, "run-keep"))).toBe(true);
    expect(existsSync(parallelRunDir(tmpCwd, "run-delete"))).toBe(false);
  });
});

// ─── purgeStaleClaimsForRun ────────────────────────────────────────────────

describe("purgeStaleClaimsForRun", () => {
  it("returns 0 when no claims exist", () => {
    expect(purgeStaleClaimsForRun(tmpCwd, RUN_ID)).toBe(0);
  });

  it("does not purge fresh claims", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "normal");
    const purged = purgeStaleClaimsForRun(tmpCwd, RUN_ID);
    expect(purged).toBe(0);
    expect(existsSync(agentClaimPath(tmpCwd, RUN_ID, "agent-a"))).toBe(true);
  });

  it("purges stale claims and returns count", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-a", ["src/foo.ts"], "normal");
    // Backdate the timestamp
    const claimPath = agentClaimPath(tmpCwd, RUN_ID, "agent-a");
    const payload = JSON.parse(readFileSync(claimPath, "utf-8")) as ClaimPayload;
    payload.timestamp = Date.now() - STALE_CLAIM_MS - 5000;
    writeFileSync(claimPath, JSON.stringify(payload), "utf-8");

    const purged = purgeStaleClaimsForRun(tmpCwd, RUN_ID);
    expect(purged).toBe(1);
    expect(existsSync(claimPath)).toBe(false);
  });

  it("purges corrupt claim files (unreadable)", () => {
    mkdirSync(claimsDir(tmpCwd, RUN_ID), { recursive: true });
    const badPath = join(claimsDir(tmpCwd, RUN_ID), "agent-zombie.json");
    writeFileSync(badPath, "NOT JSON", "utf-8");
    const purged = purgeStaleClaimsForRun(tmpCwd, RUN_ID);
    expect(purged).toBe(1);
    expect(existsSync(badPath)).toBe(false);
  });

  it("preserves fresh claims while purging stale ones", () => {
    claimFiles(tmpCwd, RUN_ID, "agent-fresh", ["src/new.ts"], "normal");
    claimFiles(tmpCwd, RUN_ID, "agent-stale", ["src/old.ts"], "normal");

    const stalePath = agentClaimPath(tmpCwd, RUN_ID, "agent-stale");
    const payload = JSON.parse(readFileSync(stalePath, "utf-8")) as ClaimPayload;
    payload.timestamp = Date.now() - STALE_CLAIM_MS - 1000;
    writeFileSync(stalePath, JSON.stringify(payload), "utf-8");

    const purged = purgeStaleClaimsForRun(tmpCwd, RUN_ID);
    expect(purged).toBe(1);
    expect(existsSync(agentClaimPath(tmpCwd, RUN_ID, "agent-fresh"))).toBe(true);
    expect(existsSync(agentClaimPath(tmpCwd, RUN_ID, "agent-stale"))).toBe(false);
  });
});

// ─── Full protocol simulation ──────────────────────────────────────────────

describe("full IPC protocol simulation", () => {
  it("two agents coordinate without conflict when targeting different files", () => {
    const runId = generateRunId();

    // Agent A claims auth.ts
    claimFiles(tmpCwd, runId, "agent-a", ["src/auth.ts"], "refactoring");
    // Agent B claims routes.ts
    claimFiles(tmpCwd, runId, "agent-b", ["src/routes.ts"], "refactoring");

    // Neither should see the other's file as conflicting with theirs
    expect(isFileClaimed(tmpCwd, runId, "agent-a", "src/auth.ts")).toBe(false); // own
    expect(isFileClaimed(tmpCwd, runId, "agent-b", "src/routes.ts")).toBe(false); // own
    // Each should see the other's file as claimed
    expect(isFileClaimed(tmpCwd, runId, "agent-a", "src/routes.ts")).toBe(true);
    expect(isFileClaimed(tmpCwd, runId, "agent-b", "src/auth.ts")).toBe(true);

    // After agent A finishes and writes a discovery
    releaseClaim(tmpCwd, runId, "agent-a");
    writeDiscovery(tmpCwd, runId, "agent-a", {
      type: "rename",
      oldPath: "src/auth.ts",
      newPath: "src/auth-v2.ts",
      description: "Renamed auth.ts to auth-v2.ts",
    });

    // Agent B can now access auth.ts
    expect(isFileClaimed(tmpCwd, runId, "agent-b", "src/auth.ts")).toBe(false);
    // Agent B reads agent A's discovery
    const discoveries = readDiscoveries(tmpCwd, runId, "agent-b");
    expect(discoveries.length).toBe(1);
    expect(discoveries[0]!.type).toBe("rename");
    expect(discoveries[0]!.oldPath).toBe("src/auth.ts");

    // Cleanup
    cleanupRun(tmpCwd, runId);
    expect(existsSync(parallelRunDir(tmpCwd, runId))).toBe(false);
  });
});
