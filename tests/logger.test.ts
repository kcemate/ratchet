import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { RatchetLogger } from '../src/core/logger.js';
import type { RatchetRun, Click } from '../src/types.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ratchet-logger-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function makeRun(overrides: Partial<RatchetRun> = {}): RatchetRun {
  return {
    id: 'run-abc-123',
    target: {
      name: 'error-handling',
      path: 'src/api/',
      description: 'Improve error handling across all API routes',
    },
    clicks: [],
    startedAt: new Date('2026-01-01T10:00:00Z'),
    status: 'running',
    ...overrides,
  };
}

function makeClick(overrides: Partial<Click> = {}): Click {
  return {
    number: 1,
    target: 'error-handling',
    analysis: 'Missing try/catch in route handlers',
    proposal: 'Add error boundaries to GET /users route',
    filesModified: ['src/api/users.ts'],
    testsPassed: true,
    commitHash: 'deadbeef1234567',
    timestamp: new Date('2026-01-01T10:01:00Z'),
    ...overrides,
  };
}

describe('RatchetLogger', () => {
  describe('initLog', () => {
    it('creates the log file with correct header', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun();
      await logger.initLog(run);

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('# Ratchet Log: `error-handling`');
      expect(content).toContain('Improve error handling across all API routes');
      expect(content).toContain('run-abc-123');
      expect(content).toContain('src/api/');
    });

    it('creates the docs/ directory if it does not exist', async () => {
      const logger = new RatchetLogger('my-target', tmp);
      await logger.initLog(makeRun());

      const content = await readFile(join(tmp, 'docs', 'my-target-ratchet.md'), 'utf-8');
      expect(content).toBeDefined();
    });

    it('includes run status in header', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      await logger.initLog(makeRun({ status: 'running' }));

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('running');
    });
  });

  describe('logClick', () => {
    it('appends a passed click section', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun();
      await logger.initLog(run);

      const click = makeClick({ testsPassed: true, commitHash: 'deadbeef123' });
      await logger.logClick(run, click);

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('## Click 1 ✅');
      expect(content).toContain('deadbee'); // first 7 chars of 'deadbeef123'
      expect(content).toContain('src/api/users.ts');
      expect(content).toContain('Missing try/catch in route handlers');
      expect(content).toContain('Add error boundaries to GET /users route');
    });

    it('marks failed clicks with ❌', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun();
      await logger.initLog(run);

      const click = makeClick({ testsPassed: false, commitHash: undefined });
      await logger.logClick(run, click);

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('## Click 1 ❌');
      expect(content).toContain('rolled back');
    });

    it('appends multiple clicks in order', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun();
      await logger.initLog(run);

      await logger.logClick(run, makeClick({ number: 1, testsPassed: true }));
      await logger.logClick(run, makeClick({ number: 2, testsPassed: false }));
      await logger.logClick(run, makeClick({ number: 3, testsPassed: true }));

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('## Click 1 ✅');
      expect(content).toContain('## Click 2 ❌');
      expect(content).toContain('## Click 3 ✅');

      // Order: click 1 before click 2 before click 3
      expect(content.indexOf('## Click 1')).toBeLessThan(content.indexOf('## Click 2'));
      expect(content.indexOf('## Click 2')).toBeLessThan(content.indexOf('## Click 3'));
    });

    it('creates the file if it does not exist yet', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun();
      // Skip initLog — logClick should still work
      const click = makeClick();
      await logger.logClick(run, click);

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('## Click 1');
    });

    it('handles empty filesModified gracefully', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun();
      await logger.initLog(run);

      const click = makeClick({ filesModified: [] });
      await logger.logClick(run, click);

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('*none*');
    });
  });

  describe('finalizeLog', () => {
    it('appends a footer with run summary', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun({
        status: 'completed',
        finishedAt: new Date('2026-01-01T10:10:00Z'),
        clicks: [makeClick({ testsPassed: true }), makeClick({ number: 2, testsPassed: false })],
      });

      await logger.initLog(run);
      await logger.logClick(run, run.clicks[0]);
      await logger.logClick(run, run.clicks[1]);
      await logger.finalizeLog(run);

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('Generated by [Ratchet]');
      expect(content).toContain('1/2 clicks landed');
    });

    it('does not duplicate footer on multiple finalize calls', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun({
        status: 'completed',
        finishedAt: new Date('2026-01-01T10:05:00Z'),
        clicks: [],
      });

      await logger.initLog(run);
      await logger.finalizeLog(run);
      await logger.finalizeLog(run);

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      const footerCount = (content.match(/Generated by \[Ratchet\]/g) ?? []).length;
      expect(footerCount).toBe(1);
    });

    it('creates file from scratch if missing', async () => {
      const logger = new RatchetLogger('error-handling', tmp);
      const run = makeRun({
        status: 'completed',
        finishedAt: new Date('2026-01-01T10:05:00Z'),
        clicks: [],
      });

      // No initLog call — finalizeLog should still succeed
      await logger.finalizeLog(run);

      const content = await readFile(join(tmp, 'docs', 'error-handling-ratchet.md'), 'utf-8');
      expect(content).toContain('Generated by [Ratchet]');
    });
  });

  describe('path property', () => {
    it('returns the expected log file path', () => {
      const logger = new RatchetLogger('my-target', '/some/cwd');
      expect(logger.path).toBe('/some/cwd/docs/my-target-ratchet.md');
    });
  });
});
