import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

import {
  createWorkerPool,
  parseSpecsFile,
  buildParallelReport,
  type ParallelTask,
  type ParallelConfig,
  type ParallelResult,
  type ParallelTaskResult,
} from '../src/core/parallel.js';

// ── parseSpecsFile ────────────────────────────────────────────────────────────

describe('parseSpecsFile', () => {
  it('parses multiple ## headings into separate specs', () => {
    const md = `## Add authentication
JWT-based auth with refresh tokens.

## Add caching layer
Redis caching for hot endpoints.

## Add rate limiting
Per-user rate limiting with sliding window.
`;
    const specs = parseSpecsFile(md);
    expect(specs).toHaveLength(3);
    expect(specs[0]).toContain('Add authentication');
    expect(specs[0]).toContain('JWT-based auth');
    expect(specs[1]).toContain('Add caching layer');
    expect(specs[2]).toContain('Add rate limiting');
  });

  it('handles single spec', () => {
    const md = `## Build the thing
Just one task.
`;
    const specs = parseSpecsFile(md);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toContain('Build the thing');
  });

  it('returns empty array for no headings', () => {
    const specs = parseSpecsFile('Just a paragraph with no headings.');
    expect(specs).toEqual([]);
  });

  it('handles empty string', () => {
    const specs = parseSpecsFile('');
    expect(specs).toEqual([]);
  });

  it('ignores # and ### headings, only uses ##', () => {
    const md = `# Title
Some intro.

## Real task
Do this.

### Sub-heading
More detail.
`;
    const specs = parseSpecsFile(md);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toContain('Real task');
  });

  it('trims whitespace from each spec', () => {
    const md = `## Task One
  
Content here.

## Task Two

More content.
`;
    const specs = parseSpecsFile(md);
    expect(specs).toHaveLength(2);
    // Specs should not have excessive leading/trailing whitespace
    for (const s of specs) {
      expect(s).toBe(s.trim());
    }
  });
});

// ── createWorkerPool ──────────────────────────────────────────────────────────

describe('createWorkerPool', () => {
  it('creates a pool and acquire returns a release function', async () => {
    const pool = createWorkerPool(3);
    const release = await pool.acquire();
    expect(typeof release).toBe('function');
    release();
  });

  it('acquire resolves immediately when under capacity', async () => {
    const pool = createWorkerPool(2);
    const r1 = await pool.acquire();
    const r2 = await pool.acquire();
    expect(typeof r1).toBe('function');
    expect(typeof r2).toBe('function');
    r1();
    r2();
  });

  it('acquire blocks when at capacity and resolves on release', async () => {
    const pool = createWorkerPool(1);
    const release1 = await pool.acquire();

    let acquired = false;
    const pending = pool.acquire().then((r) => { acquired = true; return r; });

    // Should still be blocked
    await new Promise(r => setTimeout(r, 10));
    expect(acquired).toBe(false);

    release1();
    const release2 = await pending;
    expect(acquired).toBe(true);
    release2();
  });

  it('handles concurrent acquire/release correctly', async () => {
    const pool = createWorkerPool(2);
    const results: number[] = [];

    const task = async (id: number, delayMs: number) => {
      const release = await pool.acquire();
      results.push(id);
      await new Promise(r => setTimeout(r, delayMs));
      release();
    };

    await Promise.all([
      task(1, 10),
      task(2, 10),
      task(3, 10),
      task(4, 10),
    ]);

    expect(results).toHaveLength(4);
  });
});

// ── buildParallelReport ───────────────────────────────────────────────────────

describe('buildParallelReport', () => {
  const makeResult = (overrides?: Partial<ParallelResult>): ParallelResult => ({
    tasks: [
      {
        taskId: 'task-1',
        status: 'completed' as const,
        scoreDelta: 5,
        clicksLanded: 4,
        clicksTotal: 7,
        wallTimeMs: 60000,
      },
      {
        taskId: 'task-2',
        status: 'completed' as const,
        scoreDelta: 3,
        clicksLanded: 3,
        clicksTotal: 7,
        wallTimeMs: 45000,
      },
    ],
    totalWallTimeMs: 65000,
    totalClicks: 14,
    totalLanded: 7,
    totalRolledBack: 7,
    scoreBefore: 80,
    scoreAfter: 88,
    ...overrides,
  });

  it('produces a string report', () => {
    const report = buildParallelReport(makeResult());
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(0);
  });

  it('includes score before and after', () => {
    const report = buildParallelReport(makeResult());
    expect(report).toContain('80');
    expect(report).toContain('88');
  });

  it('includes task IDs', () => {
    const report = buildParallelReport(makeResult());
    expect(report).toContain('task-1');
    expect(report).toContain('task-2');
  });

  it('handles failed tasks', () => {
    const report = buildParallelReport(makeResult({
      tasks: [
        {
          taskId: 'task-1',
          status: 'failed',
          scoreDelta: 0,
          clicksLanded: 0,
          clicksTotal: 7,
          error: 'Agent crashed',
          wallTimeMs: 5000,
        },
      ],
    }));
    expect(report).toContain('task-1');
    expect(report).toContain('failed');
  });

  it('handles empty tasks array', () => {
    const report = buildParallelReport(makeResult({ tasks: [] }));
    expect(typeof report).toBe('string');
  });

  it('handles timeout tasks', () => {
    const report = buildParallelReport(makeResult({
      tasks: [
        {
          taskId: 'slow-task',
          status: 'timeout',
          scoreDelta: 1,
          clicksLanded: 2,
          clicksTotal: 7,
          wallTimeMs: 300000,
        },
      ],
    }));
    expect(report).toContain('slow-task');
  });
});

// ── ParallelTask interface ────────────────────────────────────────────────────

describe('ParallelTask', () => {
  it('valid task has all required fields', () => {
    const task: ParallelTask = {
      id: 'test-1',
      spec: 'Add authentication',
      mode: 'feature',
      clicks: 7,
    };
    expect(task.id).toBe('test-1');
    expect(task.mode).toBe('feature');
  });

  it('task can have target instead of spec', () => {
    const task: ParallelTask = {
      id: 'scan-1',
      target: 'src/core/',
      mode: 'normal',
      clicks: 5,
    };
    expect(task.target).toBe('src/core/');
    expect(task.spec).toBeUndefined();
  });

  it('ParallelConfig holds multiple tasks', () => {
    const config: ParallelConfig = {
      maxWorkers: 3,
      tasks: [
        { id: '1', spec: 'Auth', mode: 'feature', clicks: 7 },
        { id: '2', spec: 'Cache', mode: 'feature', clicks: 7 },
        { id: '3', target: 'api', mode: 'harden', clicks: 5 },
      ],
      debate: true,
      strategy: true,
    };
    expect(config.tasks).toHaveLength(3);
    expect(config.maxWorkers).toBe(3);
  });
});
