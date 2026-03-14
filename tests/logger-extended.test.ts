import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { RatchetLogger } from '../src/core/logger.js';
import type { RatchetRun, Click } from '../src/types.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ratchet-logger-ext-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function makeRun(overrides: Partial<RatchetRun> = {}): RatchetRun {
  return {
    id: 'run-ext-123',
    target: { name: 'perf', path: 'src/perf/', description: 'Improve performance' },
    clicks: [],
    startedAt: new Date('2026-01-01T10:00:00Z'),
    status: 'running',
    ...overrides,
  };
}

function makeClick(overrides: Partial<Click> = {}): Click {
  return {
    number: 1,
    target: 'perf',
    analysis: 'Analysis text',
    proposal: 'Proposal text',
    filesModified: [],
    testsPassed: true,
    commitHash: 'abc1234567890',
    timestamp: new Date('2026-01-01T10:01:00Z'),
    ...overrides,
  };
}

describe('RatchetLogger - formatDuration via finalizeLog', () => {
  it('shows milliseconds for sub-second durations', async () => {
    const logger = new RatchetLogger('perf', tmp);
    const run = makeRun({
      status: 'completed',
      startedAt: new Date('2026-01-01T10:00:00.000Z'),
      finishedAt: new Date('2026-01-01T10:00:00.500Z'), // 500ms
    });
    await logger.finalizeLog(run);
    const content = await readFile(join(tmp, 'docs', 'perf-ratchet.md'), 'utf-8');
    expect(content).toContain('500ms');
  });

  it('shows seconds for sub-minute durations', async () => {
    const logger = new RatchetLogger('perf', tmp);
    const run = makeRun({
      status: 'completed',
      startedAt: new Date('2026-01-01T10:00:00.000Z'),
      finishedAt: new Date('2026-01-01T10:00:30.000Z'), // 30s
    });
    await logger.finalizeLog(run);
    const content = await readFile(join(tmp, 'docs', 'perf-ratchet.md'), 'utf-8');
    expect(content).toContain('30.0s');
  });

  it('shows minutes and seconds for longer durations', async () => {
    const logger = new RatchetLogger('perf', tmp);
    const run = makeRun({
      status: 'completed',
      startedAt: new Date('2026-01-01T10:00:00.000Z'),
      finishedAt: new Date('2026-01-01T10:02:05.000Z'), // 2m 5s
    });
    await logger.finalizeLog(run);
    const content = await readFile(join(tmp, 'docs', 'perf-ratchet.md'), 'utf-8');
    expect(content).toContain('2m 5s');
  });

  it('shows 0ms when finishedAt is undefined', async () => {
    const logger = new RatchetLogger('perf', tmp);
    const run = makeRun({ status: 'completed', finishedAt: undefined });
    await logger.finalizeLog(run);
    const content = await readFile(join(tmp, 'docs', 'perf-ratchet.md'), 'utf-8');
    expect(content).toContain('0ms');
  });
});

describe('RatchetLogger - click section edge cases', () => {
  it('truncates commit hash to 7 chars', async () => {
    const logger = new RatchetLogger('perf', tmp);
    const run = makeRun();
    await logger.initLog(run);
    await logger.logClick(run, makeClick({ commitHash: 'abcdef1234567890' }));
    const content = await readFile(join(tmp, 'docs', 'perf-ratchet.md'), 'utf-8');
    expect(content).toContain('abcdef1');
    expect(content).not.toContain('abcdef1234567890');
  });

  it('shows *none* in analysis when analysis is empty string', async () => {
    const logger = new RatchetLogger('perf', tmp);
    const run = makeRun();
    await logger.initLog(run);
    await logger.logClick(run, makeClick({ analysis: '' }));
    const content = await readFile(join(tmp, 'docs', 'perf-ratchet.md'), 'utf-8');
    expect(content).toContain('*none*');
  });

  it('shows *none* in proposal when proposal is empty string', async () => {
    const logger = new RatchetLogger('perf', tmp);
    const run = makeRun();
    await logger.initLog(run);
    await logger.logClick(run, makeClick({ proposal: '' }));
    const content = await readFile(join(tmp, 'docs', 'perf-ratchet.md'), 'utf-8');
    expect(content).toContain('*none*');
  });

  it('lists multiple modified files', async () => {
    const logger = new RatchetLogger('perf', tmp);
    const run = makeRun();
    await logger.initLog(run);
    await logger.logClick(run, makeClick({ filesModified: ['src/a.ts', 'src/b.ts', 'src/c.ts'] }));
    const content = await readFile(join(tmp, 'docs', 'perf-ratchet.md'), 'utf-8');
    expect(content).toContain('`src/a.ts`');
    expect(content).toContain('`src/b.ts`');
    expect(content).toContain('`src/c.ts`');
  });

  it('includes target name in header for non-default target', async () => {
    const logger = new RatchetLogger('api-routes', tmp);
    const run = makeRun({
      target: { name: 'api-routes', path: 'src/routes/', description: 'API route improvements' },
    });
    await logger.initLog(run);
    const content = await readFile(join(tmp, 'docs', 'api-routes-ratchet.md'), 'utf-8');
    expect(content).toContain('# Ratchet Log: `api-routes`');
    expect(content).toContain('API route improvements');
  });

  it('path property reflects target name', () => {
    const logger1 = new RatchetLogger('target-one', '/project');
    const logger2 = new RatchetLogger('target-two', '/project');
    expect(logger1.path).toContain('target-one-ratchet.md');
    expect(logger2.path).toContain('target-two-ratchet.md');
    expect(logger1.path).not.toBe(logger2.path);
  });
});
