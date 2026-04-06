import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    openSync: vi.fn().mockReturnValue(42),
    closeSync: vi.fn(),
  };
});

import { spawn } from 'child_process';
import { startBackgroundRun, updateProgress, readProgress, isProcessAlive, bgRunDir } from '../core/background.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeChild(pid: number) {
  return {
    pid,
    unref: vi.fn(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('startBackgroundRun', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'ratchet-bg-test-'));
    vi.clearAllMocks();
    vi.mocked(spawn).mockReturnValue(makeFakeChild(12345) as unknown as ReturnType<typeof spawn>);
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('spawns a detached child process', async () => {
    await startBackgroundRun(tmpDir, ['torque', '--target', 'src']);

    expect(spawn).toHaveBeenCalledOnce();
    const [, , spawnOpts] = vi.mocked(spawn).mock.calls[0]!;
    expect((spawnOpts as { detached?: boolean }).detached).toBe(true);
  });

  it('passes RATCHET_BACKGROUND env to child', async () => {
    await startBackgroundRun(tmpDir, ['torque']);

    const [, , spawnOpts] = vi.mocked(spawn).mock.calls[0]!;
    const env = (spawnOpts as { env?: Record<string, string> }).env!;
    expect(env['RATCHET_BACKGROUND']).toBe('true');
  });

  it('passes RATCHET_BG_RUN_ID env to child', async () => {
    const result = await startBackgroundRun(tmpDir, ['torque']);

    const [, , spawnOpts] = vi.mocked(spawn).mock.calls[0]!;
    const env = (spawnOpts as { env?: Record<string, string> }).env!;
    expect(env['RATCHET_BG_RUN_ID']).toBe(result.runId);
  });

  it('calls child.unref() so parent can exit', async () => {
    await startBackgroundRun(tmpDir, ['torque']);

    const child = vi.mocked(spawn).mock.results[0]!.value as ReturnType<typeof makeFakeChild>;
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('writes PID file', async () => {
    const result = await startBackgroundRun(tmpDir, ['torque']);

    const pidContent = await fsp.readFile(join(bgRunDir(tmpDir, result.runId), 'pid'), 'utf-8');
    expect(pidContent).toBe('12345');
  });

  it('writes progress.json with initial state', async () => {
    const result = await startBackgroundRun(tmpDir, ['torque']);

    const progress = await readProgress(tmpDir, result.runId);
    expect(progress).not.toBeNull();
    expect(progress!.status).toBe('running');
    expect(progress!.clicksCompleted).toBe(0);
    expect(progress!.pid).toBe(12345);
    expect(progress!.runId).toBe(result.runId);
  });

  it('returns runId, pid, logPath, progressPath', async () => {
    const result = await startBackgroundRun(tmpDir, ['torque']);

    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.pid).toBe(12345);
    expect(result.logPath).toContain('output.log');
    expect(result.progressPath).toContain('progress.json');
  });
});

describe('updateProgress', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'ratchet-bg-progress-'));
    vi.mocked(spawn).mockReturnValue(makeFakeChild(99) as unknown as ReturnType<typeof spawn>);
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('updates clicksCompleted and score', async () => {
    const result = await startBackgroundRun(tmpDir, ['torque']);

    await updateProgress(tmpDir, result.runId, { clicksCompleted: 3, clicksTotal: 7, score: 72 });

    const progress = await readProgress(tmpDir, result.runId);
    expect(progress!.clicksCompleted).toBe(3);
    expect(progress!.clicksTotal).toBe(7);
    expect(progress!.score).toBe(72);
  });

  it('updates status to interrupted', async () => {
    const result = await startBackgroundRun(tmpDir, ['torque']);

    await updateProgress(tmpDir, result.runId, { status: 'interrupted' });

    const progress = await readProgress(tmpDir, result.runId);
    expect(progress!.status).toBe('interrupted');
  });

  it('does not throw if progress.json missing', async () => {
    await expect(updateProgress(tmpDir, 'nonexistent-id', { clicksCompleted: 1 })).resolves.toBeUndefined();
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a dead PID', () => {
    // PID 0 is not a valid target for kill in this context; use a very high number
    expect(isProcessAlive(999999999)).toBe(false);
  });
});

describe('progress.json format', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'ratchet-bg-format-'));
    vi.mocked(spawn).mockReturnValue(makeFakeChild(555) as unknown as ReturnType<typeof spawn>);
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('has required fields', async () => {
    const result = await startBackgroundRun(tmpDir, ['torque', '--target', 'api']);
    const progress = await readProgress(tmpDir, result.runId);

    expect(progress).toMatchObject({
      runId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      pid: 555,
      startedAt: expect.any(String),
      clicksCompleted: 0,
      clicksTotal: 0,
      status: 'running',
      lastUpdatedAt: expect.any(String),
    });
  });
});
