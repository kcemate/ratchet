import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { openSync, closeSync } from "fs";
import { logger } from "../lib/logger.js";

export const BG_RUNS_DIR = ".ratchet/runs";

export interface BackgroundRunResult {
  runId: string;
  pid: number;
  logPath: string;
  progressPath: string;
}

export interface ProgressState {
  runId: string;
  pid: number;
  startedAt: string;
  clicksCompleted: number;
  clicksTotal: number;
  score?: number;
  status: "running" | "completed" | "failed" | "interrupted";
  lastUpdatedAt: string;
}

export function bgRunDir(cwd: string, runId: string): string {
  return join(cwd, BG_RUNS_DIR, runId);
}

export async function startBackgroundRun(cwd: string, args: string[]): Promise<BackgroundRunResult> {
  const runId = randomUUID();
  const runDir = bgRunDir(cwd, runId);
  await mkdir(runDir, { recursive: true });

  const logPath = join(runDir, "output.log");
  const pidPath = join(runDir, "pid");
  const progressPath = join(runDir, "progress.json");

  // Open log file so child process can inherit the fd
  const logFd = openSync(logPath, "a");

  const scriptPath = process.argv[1]!;
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      RATCHET_BACKGROUND: "true",
      RATCHET_BG_RUN_ID: runId,
    },
  });

  // Close parent's copy of the fd — child has its own inherited copy
  closeSync(logFd);

  child.unref();

  const pid = child.pid!;

  await writeFile(pidPath, String(pid), "utf-8");

  const progress: ProgressState = {
    runId,
    pid,
    startedAt: new Date().toISOString(),
    clicksCompleted: 0,
    clicksTotal: 0,
    status: "running",
    lastUpdatedAt: new Date().toISOString(),
  };
  await writeFile(progressPath, JSON.stringify(progress, null, 2), "utf-8");

  return { runId, pid, logPath, progressPath };
}

export async function updateProgress(cwd: string, runId: string, updates: Partial<ProgressState>): Promise<void> {
  const progressPath = join(bgRunDir(cwd, runId), "progress.json");
  let current: ProgressState;
  try {
    current = JSON.parse(await readFile(progressPath, "utf-8")) as ProgressState;
  } catch (err) {
    logger.debug({ err }, "read progress file");
    return;
  }
  const updated: ProgressState = { ...current, ...updates, lastUpdatedAt: new Date().toISOString() };
  try {
    await writeFile(progressPath, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    logger.debug({ err }, "write progress file");
  }
}

export async function readProgress(cwd: string, runId: string): Promise<ProgressState | null> {
  const progressPath = join(bgRunDir(cwd, runId), "progress.json");
  try {
    return JSON.parse(await readFile(progressPath, "utf-8")) as ProgressState;
  } catch (err) {
    logger.debug({ err }, "read progress state");
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    logger.debug({ err }, "check process alive");
    return false;
  }
}
