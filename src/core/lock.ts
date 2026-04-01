import { readFileSync, writeFileSync, writeSync, unlinkSync, openSync, closeSync, constants } from 'fs';
import { join } from 'path';

const LOCK_FILE = '.ratchet.lock';

/**
 * Returns the path to the lock file for the given working directory.
 */
export function lockFilePath(cwd: string): string {
  return join(cwd, LOCK_FILE);
}

/**
 * Acquire a run lock. Writes the current PID to .ratchet.lock.
 * Throws if another ratchet process is already running in this directory.
 *
 * Uses O_CREAT | O_EXCL for atomic creation, eliminating the TOCTOU race
 * between checking for the lock and creating it.
 */
export function acquireLock(cwd: string): void {
  const lockPath = lockFilePath(cwd);

  try {
    // O_EXCL ensures atomic create-or-fail — no race window
    const fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') {
      throw err; // Unexpected error (permissions, disk full, etc.)
    }
  }

  // Lock file already exists — check if the owning process is still alive
  let existingPid: number | null = null;
  try {
    existingPid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10);
  } catch {
    // Unreadable lock file — treat as stale
  }

  if (existingPid !== null && !isNaN(existingPid) && isProcessRunning(existingPid)) {
    throw new Error(
      `Another ratchet process (PID ${existingPid}) is already running in this directory.\n` +
        `  Concurrent ratchet runs on the same repo can corrupt git history.\n` +
        `  Wait for it to finish, or remove the lock: rm ${LOCK_FILE}`,
    );
  }

  // Stale lock — overwrite with our PID
  writeFileSync(lockPath, String(process.pid), 'utf-8');
}

/**
 * Release the run lock by deleting .ratchet.lock. Safe to call if lock doesn't exist.
 */
export function releaseLock(cwd: string): void {
  const lockPath = lockFilePath(cwd);
  try {
    unlinkSync(lockPath);
  } catch {
    // Already gone — fine
  }
}

/**
 * Returns true if a process with the given PID is currently running.
 * Uses signal 0 (existence check) which doesn't actually send a signal.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
