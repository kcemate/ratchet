/**
 * parallel-ipc.ts — File-based inter-agent communication for parallel worktree agents.
 *
 * Implements Claude Code's permissionSync.ts pattern: agents coordinate via files
 * so they don't stomp on each other's work during a parallel run.
 *
 * Directory layout:
 *   .ratchet/parallel/{runId}/
 *     claims/
 *       agent-{id}-{timestamp}.json   ← "I'm working on these files"
 *     discoveries/
 *       discovery-{agentId}-{timestamp}.json  ← "I renamed/moved/deleted something"
 *
 * Why file-based: survives agent crashes, works anywhere, no infrastructure dep.
 * Stale claims (>30 min) are auto-expired.
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  readdirSync,
  rmSync,
  existsSync,
  openSync,
  closeSync,
  constants,
} from "fs";
import { join } from "path";

// ─── Constants

export const STALE_CLAIM_MS = 30 * 60 * 1000; // 30 minutes

// ─── Types

export interface ClaimPayload {
  agentId: string;
  files: string[];
  action: string;
  timestamp: number;
}

export type DiscoveryType = "rename" | "move" | "delete" | "create" | "modify";

export interface Discovery {
  agentId: string;
  type: DiscoveryType;
  /** Original path (for rename/move/delete) */
  oldPath?: string;
  /** New path (for rename/move/create) */
  newPath?: string;
  /** Human-readable description */
  description: string;
  timestamp: number;
}

// ─── Path helpers

export function parallelRunDir(cwd: string, runId: string): string {
  return join(cwd, ".ratchet", "parallel", runId);
}

export function claimsDir(cwd: string, runId: string): string {
  return join(parallelRunDir(cwd, runId), "claims");
}

export function discoveriesDir(cwd: string, runId: string): string {
  return join(parallelRunDir(cwd, runId), "discoveries");
}

export function agentClaimPath(cwd: string, runId: string, agentId: string): string {
  return join(claimsDir(cwd, runId), `agent-${agentId}.json`);
}

// ─── Helpers

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isStale(timestamp: number): boolean {
  return Date.now() - timestamp > STALE_CLAIM_MS;
}

/**
 * Attempt an atomic write using O_CREAT | O_EXCL for the lock file,
 * then write the actual payload file. If the lock already exists and
 * is stale, overwrite it.
 */
function atomicWrite(filePath: string, content: string): void {
  const lockPath = filePath + ".lock";
  let fd: number | null = null;
  try {
    fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    closeSync(fd);
    fd = null;
    writeFileSync(filePath, content, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      // Lock held — check if stale
      try {
        const lockContent = readFileSync(lockPath, "utf-8").trim();
        const lockTs = parseInt(lockContent, 10);
        if (!isNaN(lockTs) && isStale(lockTs)) {
          // Stale lock — overwrite
          writeFileSync(lockPath, String(Date.now()), "utf-8");
          writeFileSync(filePath, content, "utf-8");
        }
        // Otherwise lock is live — skip (best-effort)
      } catch {
        // If we can't read lock, just try to write anyway
        writeFileSync(filePath, content, "utf-8");
      }
    } else {
      throw err;
    }
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    // Clean up lock
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

// ─── Claim API

/**
 * Write a claim declaring that agentId is working on the given files.
 * Uses a per-agent file so each agent has exactly one claim at a time.
 */
export function claimFiles(cwd: string, runId: string, agentId: string, files: string[], action: string): void {
  ensureDir(claimsDir(cwd, runId));
  const payload: ClaimPayload = {
    agentId,
    files,
    action,
    timestamp: Date.now(),
  };
  atomicWrite(agentClaimPath(cwd, runId, agentId), JSON.stringify(payload, null, 2));
}

/**
 * Returns true if filePath is claimed by ANOTHER agent (not agentId).
 * Stale claims (>30 min) are ignored.
 */
export function isFileClaimed(cwd: string, runId: string, agentId: string, filePath: string): boolean {
  const dir = claimsDir(cwd, runId);
  if (!existsSync(dir)) return false;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".lock")) continue;

    // Skip our own claim file
    if (entry === `agent-${agentId}.json`) continue;

    const claimPath = join(dir, entry);
    try {
      const raw = readFileSync(claimPath, "utf-8");
      const claim = tryParseJson<ClaimPayload>(raw);
      if (!claim) continue;

      // Skip stale claims
      if (isStale(claim.timestamp)) continue;

      // Check if this claim covers filePath
      const normalized = filePath.replace(/\\/g, "/").replace(/\/$/, "");
      for (const claimedFile of claim.files) {
        const normalizedClaimed = claimedFile.replace(/\\/g, "/").replace(/\/$/, "");
        if (
          normalizedClaimed === normalized ||
          normalized.startsWith(normalizedClaimed + "/") ||
          normalizedClaimed.startsWith(normalized + "/")
        ) {
          return true;
        }
      }
    } catch {
      // Unreadable claim — ignore
    }
  }

  return false;
}

/**
 * Delete the agent's own claim file.
 */
export function releaseClaim(cwd: string, runId: string, agentId: string): void {
  const claimPath = agentClaimPath(cwd, runId, agentId);
  try {
    unlinkSync(claimPath);
  } catch {
    // Already gone — fine
  }
  // Clean up any leftover lock
  try {
    unlinkSync(claimPath + ".lock");
  } catch {
    /* ignore */
  }
}

// ─── Discovery API

/**
 * Write a discovery announcing a structural change (rename/move/delete/create).
 * Other agents should read discoveries before each click to update their context.
 */
export function writeDiscovery(
  cwd: string,
  runId: string,
  agentId: string,
  discovery: Omit<Discovery, "agentId" | "timestamp">
): void {
  ensureDir(discoveriesDir(cwd, runId));
  const payload: Discovery = {
    ...discovery,
    agentId,
    timestamp: Date.now(),
  };
  const fileName = `discovery-${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`;
  const filePath = join(discoveriesDir(cwd, runId), fileName);
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

/**
 * Read all discoveries from OTHER agents (not agentId).
 * Returns in chronological order (oldest first).
 */
export function readDiscoveries(cwd: string, runId: string, agentId: string): Discovery[] {
  const dir = discoveriesDir(cwd, runId);
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const discoveries: Discovery[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;

    // Skip our own discoveries
    if (entry.startsWith(`discovery-${agentId}-`)) continue;

    try {
      const raw = readFileSync(join(dir, entry), "utf-8");
      const d = tryParseJson<Discovery>(raw);
      if (d && d.agentId !== agentId) {
        discoveries.push(d);
      }
    } catch {
      // Unreadable discovery — skip
    }
  }

  // Sort chronologically
  discoveries.sort((a, b) => a.timestamp - b.timestamp);
  return discoveries;
}

// ─── Cleanup

/**
 * Remove the entire .ratchet/parallel/{runId} directory after a run completes.
 */
export function cleanupRun(cwd: string, runId: string): void {
  const dir = parallelRunDir(cwd, runId);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort
  }
}

/**
 * Purge stale claim files across ALL agents in a run.
 * Called periodically to prevent abandoned claims from blocking work.
 */
export function purgeStaleClaimsForRun(cwd: string, runId: string): number {
  const dir = claimsDir(cwd, runId);
  if (!existsSync(dir)) return 0;

  let purged = 0;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".json") || entry.endsWith(".lock")) continue;
      const filePath = join(dir, entry);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const claim = tryParseJson<ClaimPayload>(raw);
        if (!claim || isStale(claim.timestamp)) {
          unlinkSync(filePath);
          purged++;
        }
      } catch {
        // If unreadable, treat as stale
        try {
          unlinkSync(filePath);
          purged++;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    // Dir may be gone — fine
  }

  return purged;
}

/**
 * Generate a run ID for a new parallel execution.
 */
export function generateRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
