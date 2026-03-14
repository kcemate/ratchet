import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { acquireLock, releaseLock, lockFilePath } from '../src/core/lock.js';

describe('lock', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-lock-'));
  });

  afterEach(() => {
    releaseLock(dir); // clean up any leftover lock
    rmSync(dir, { recursive: true, force: true });
  });

  it('acquires lock by writing current PID', () => {
    acquireLock(dir);
    expect(existsSync(lockFilePath(dir))).toBe(true);
  });

  it('releases lock by removing lock file', () => {
    acquireLock(dir);
    releaseLock(dir);
    expect(existsSync(lockFilePath(dir))).toBe(false);
  });

  it('throws when another live process holds the lock', () => {
    // Use current process PID — it's definitely running
    const { writeFileSync } = require('fs');
    writeFileSync(lockFilePath(dir), String(process.pid), 'utf-8');

    expect(() => acquireLock(dir)).toThrow('already running in this directory');
  });

  it('cleans up a stale lock (dead PID) and acquires successfully', () => {
    // PID 0 is never a valid user process — kill(0, 0) throws EINVAL on Linux/macOS
    const { writeFileSync } = require('fs');
    writeFileSync(lockFilePath(dir), '99999999', 'utf-8'); // almost certainly dead

    // Should not throw — stale lock is cleared
    expect(() => acquireLock(dir)).not.toThrow();
    expect(existsSync(lockFilePath(dir))).toBe(true);
  });

  it('releaseLock is safe when no lock exists', () => {
    expect(() => releaseLock(dir)).not.toThrow();
  });
});
