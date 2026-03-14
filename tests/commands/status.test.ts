import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadRunState, STATE_FILE } from '../../src/commands/status.js';
import type { RatchetRun } from '../../src/types.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ratchet-status-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const sampleRun: RatchetRun = {
  id: 'test-run-123',
  target: {
    name: 'error-handling',
    path: 'src/api/',
    description: 'Improve error handling',
  },
  clicks: [
    {
      number: 1,
      target: 'error-handling',
      analysis: 'Found missing try/catch blocks',
      proposal: 'Add error boundaries to routes',
      filesModified: ['src/api/routes.ts'],
      testsPassed: true,
      commitHash: 'abc1234',
      timestamp: new Date('2026-01-01T12:00:00Z'),
    },
    {
      number: 2,
      target: 'error-handling',
      analysis: 'Inconsistent error responses',
      proposal: 'Standardize error format',
      filesModified: [],
      testsPassed: false,
      commitHash: undefined,
      timestamp: new Date('2026-01-01T12:05:00Z'),
    },
  ],
  startedAt: new Date('2026-01-01T12:00:00Z'),
  finishedAt: new Date('2026-01-01T12:10:00Z'),
  status: 'completed',
};

describe('loadRunState', () => {
  it('returns null when state file does not exist', async () => {
    const result = await loadRunState(tmp);
    expect(result).toBeNull();
  });

  it('loads and parses a valid run state file', async () => {
    await writeFile(
      join(tmp, STATE_FILE),
      JSON.stringify(sampleRun, null, 2),
      'utf-8',
    );

    const result = await loadRunState(tmp);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('test-run-123');
    expect(result!.target.name).toBe('error-handling');
    expect(result!.clicks).toHaveLength(2);
    expect(result!.status).toBe('completed');
  });

  it('throws a friendly error for corrupted state file', async () => {
    await writeFile(join(tmp, STATE_FILE), '{ invalid json }', 'utf-8');
    await expect(loadRunState(tmp)).rejects.toThrow(
      '.ratchet-state.json exists but could not be parsed',
    );
  });

  it('preserves click data correctly', async () => {
    await writeFile(join(tmp, STATE_FILE), JSON.stringify(sampleRun), 'utf-8');
    const result = await loadRunState(tmp);

    const click1 = result!.clicks[0];
    expect(click1.number).toBe(1);
    expect(click1.testsPassed).toBe(true);
    expect(click1.commitHash).toBe('abc1234');
    expect(click1.filesModified).toEqual(['src/api/routes.ts']);

    const click2 = result!.clicks[1];
    expect(click2.testsPassed).toBe(false);
    expect(click2.commitHash).toBeUndefined();
  });
});

describe('STATE_FILE constant', () => {
  it('is the expected filename', () => {
    expect(STATE_FILE).toBe('.ratchet-state.json');
  });
});
