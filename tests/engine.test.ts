import { describe, it, expect, vi } from 'vitest';
import { summarizeRun } from '../src/core/engine.js';
import type { RatchetRun, Target, Click } from '../src/types.js';

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    name: 'test-target',
    path: 'src/',
    description: 'Test target',
    ...overrides,
  };
}

function makeClick(overrides: Partial<Click> = {}): Click {
  return {
    number: 1,
    target: 'test-target',
    analysis: 'Analysis text',
    proposal: 'Proposal text',
    filesModified: ['src/foo.ts'],
    testsPassed: true,
    commitHash: 'abc123',
    timestamp: new Date(),
    ...overrides,
  };
}

function makeRun(overrides: Partial<RatchetRun> = {}): RatchetRun {
  return {
    id: 'test-run-id',
    target: makeTarget(),
    clicks: [],
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:05:00Z'),
    status: 'completed',
    ...overrides,
  };
}

describe('summarizeRun', () => {
  it('summarizes an empty run', () => {
    const run = makeRun({ clicks: [] });
    const summary = summarizeRun(run);
    expect(summary.totalClicks).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.commits).toHaveLength(0);
  });

  it('counts passed and failed clicks', () => {
    const clicks: Click[] = [
      makeClick({ number: 1, testsPassed: true, commitHash: 'aaa' }),
      makeClick({ number: 2, testsPassed: false, commitHash: undefined }),
      makeClick({ number: 3, testsPassed: true, commitHash: 'bbb' }),
    ];
    const run = makeRun({ clicks });
    const summary = summarizeRun(run);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.totalClicks).toBe(3);
    expect(summary.commits).toEqual(['aaa', 'bbb']);
  });

  it('calculates duration from startedAt/finishedAt', () => {
    const run = makeRun({
      startedAt: new Date('2026-01-01T00:00:00Z'),
      finishedAt: new Date('2026-01-01T00:02:30Z'),
    });
    const summary = summarizeRun(run);
    expect(summary.duration).toBe(150_000); // 2.5 minutes in ms
  });

  it('returns duration 0 when finishedAt is undefined', () => {
    const run = makeRun({ finishedAt: undefined });
    const summary = summarizeRun(run);
    expect(summary.duration).toBe(0);
  });

  it('preserves run status', () => {
    expect(summarizeRun(makeRun({ status: 'completed' })).status).toBe('completed');
    expect(summarizeRun(makeRun({ status: 'failed' })).status).toBe('failed');
    expect(summarizeRun(makeRun({ status: 'running' })).status).toBe('running');
  });

  it('excludes clicks without commit hash from commits array', () => {
    const clicks: Click[] = [
      makeClick({ commitHash: 'abc' }),
      makeClick({ commitHash: undefined }),
    ];
    const summary = summarizeRun(makeRun({ clicks }));
    expect(summary.commits).toEqual(['abc']);
  });
});
