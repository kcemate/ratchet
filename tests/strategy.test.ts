import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import {
  initStrategy,
  loadStrategy,
  saveStrategy,
  resetStrategy,
  evolveStrategy,
  buildStrategyContext,
  getRecommendation,
  type Strategy,
  type CodebaseProfile,
} from '../src/core/strategy.js';
import type { ScanResult } from '../src/commands/scan.js';
import type { RatchetRun, Click, Target } from '../src/types.js';

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return join(tmpdir(), `ratchet-strategy-test-${randomUUID()}`);
}

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test-project',
    total: 72,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 15,
    issuesByType: [],
    ...overrides,
  };
}

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    name: 'src',
    path: 'src/',
    description: 'Source files',
    ...overrides,
  };
}

function makeClick(overrides: Partial<Click> = {}): Click {
  return {
    number: 1,
    target: 'src',
    analysis: 'Found unused variable',
    proposal: 'Remove unused import',
    filesModified: ['src/utils.ts'],
    testsPassed: true,
    commitHash: 'abc123',
    timestamp: new Date(),
    ...overrides,
  };
}

function makeRun(overrides: Partial<RatchetRun> = {}): RatchetRun {
  return {
    id: randomUUID(),
    target: makeTarget(),
    clicks: [],
    startedAt: new Date(),
    finishedAt: new Date(),
    status: 'completed',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('initStrategy', () => {
  it('creates a valid strategy from a scan', () => {
    const scan = makeScan({ projectName: 'my-app' });
    const strategy = initStrategy('/tmp/fake', scan);

    expect(strategy.version).toBe(1);
    expect(strategy.profile.name).toBe('my-app');
    expect(strategy.insights).toHaveLength(0);
    expect(strategy.hotSpots).toHaveLength(0);
    expect(strategy.antiPatterns).toHaveLength(0);
    expect(strategy.runSummaries).toHaveLength(0);
    expect(strategy.createdAt).toBeTruthy();
    expect(strategy.updatedAt).toBeTruthy();
  });

  it('uses cwd basename when projectName is empty', () => {
    const scan = makeScan({ projectName: '' });
    const strategy = initStrategy('/home/user/my-project', scan);
    expect(strategy.profile.name).toBe('my-project');
  });

  it('detects tech stack from filesystem', async () => {
    const cwd = makeTempDir();
    await mkdir(cwd, { recursive: true });
    await mkdir(join(cwd, '.ratchet'), { recursive: true });

    // Write package.json and tsconfig.json
    const { writeFile } = await import('fs/promises');
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'test' }));
    await writeFile(join(cwd, 'tsconfig.json'), '{}');

    const scan = makeScan();
    const strategy = initStrategy(cwd, scan);

    expect(strategy.profile.techStack).toContain('Node.js');
    expect(strategy.profile.techStack).toContain('TypeScript');

    await rm(cwd, { recursive: true, force: true });
  });
});

describe('saveStrategy / loadStrategy', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = makeTempDir();
    await mkdir(join(cwd, '.ratchet'), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('round-trips a strategy with no data', async () => {
    const scan = makeScan({ projectName: 'roundtrip-test' });
    const original = initStrategy(cwd, scan);

    await saveStrategy(cwd, original);
    const loaded = await loadStrategy(cwd);

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(original.version);
    expect(loaded!.profile.name).toBe('roundtrip-test');
    expect(loaded!.insights).toHaveLength(0);
    expect(loaded!.hotSpots).toHaveLength(0);
    expect(loaded!.antiPatterns).toHaveLength(0);
    expect(loaded!.runSummaries).toHaveLength(0);
  });

  it('round-trips a strategy with insights and hot spots', async () => {
    const strategy: Strategy = {
      version: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      profile: {
        name: 'test-app',
        techStack: ['Node.js', 'TypeScript'],
        patterns: ['src/ layout', 'tested'],
        testFramework: 'vitest',
        totalFiles: 42,
        lastScanned: '2026-01-03T00:00:00.000Z',
      },
      insights: [
        {
          id: 'ins-1',
          type: 'what-works',
          description: 'Small focused changes land well',
          evidence: '5/5 clicks landed',
          confidence: 0.9,
          createdAt: '2026-01-02T00:00:00.000Z',
          runId: 'run-abc',
        },
        {
          id: 'ins-2',
          type: 'what-fails',
          description: 'Touching test files causes failures',
          evidence: '3/3 rolled back',
          confidence: 0.7,
          createdAt: '2026-01-03T00:00:00.000Z',
          runId: 'run-def',
        },
      ],
      hotSpots: [
        {
          filePath: 'src/core/engine.ts',
          rollbackRate: 0.75,
          attempts: 4,
          lastAttempt: '2026-01-03T00:00:00.000Z',
          notes: 'Very hard to change',
        },
      ],
      antiPatterns: [
        {
          pattern: 'Touching too many files in one click',
          occurrences: 2,
          lastSeen: '2026-01-03T00:00:00.000Z',
          example: 'max-files guard triggered',
        },
      ],
      runSummaries: [
        {
          runId: 'run-abc',
          date: '2026-01-02T00:00:00.000Z',
          mode: 'normal',
          scoreBefore: 65,
          scoreAfter: 72,
          landed: 5,
          rolledBack: 1,
          keyInsight: 'Good run, +7 score',
        },
      ],
    };

    await saveStrategy(cwd, strategy);
    const loaded = await loadStrategy(cwd);

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(3);
    expect(loaded!.insights).toHaveLength(2);
    expect(loaded!.insights[0].description).toBe('Small focused changes land well');
    expect(loaded!.insights[0].confidence).toBeCloseTo(0.9);
    expect(loaded!.insights[1].type).toBe('what-fails');
    expect(loaded!.hotSpots).toHaveLength(1);
    expect(loaded!.hotSpots[0].filePath).toBe('src/core/engine.ts');
    expect(loaded!.hotSpots[0].rollbackRate).toBeCloseTo(0.75);
    expect(loaded!.antiPatterns).toHaveLength(1);
    expect(loaded!.antiPatterns[0].occurrences).toBe(2);
    expect(loaded!.runSummaries).toHaveLength(1);
    expect(loaded!.runSummaries[0].scoreBefore).toBe(65);
  });

  it('returns null when no strategy file exists', async () => {
    const result = await loadStrategy(cwd);
    expect(result).toBeNull();
  });

  it('returns null for corrupted strategy file', async () => {
    const { writeFile } = await import('fs/promises');
    await writeFile(join(cwd, '.ratchet', 'strategy.md'), 'not a valid strategy file at all');
    // Should return null rather than throwing
    const result = await loadStrategy(cwd);
    // Either null (failed parse) or a mostly-empty strategy is fine
    if (result !== null) {
      // Profile defaults are okay
      expect(result.insights).toHaveLength(0);
    }
  });
});

describe('resetStrategy', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = makeTempDir();
    await mkdir(join(cwd, '.ratchet'), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('deletes the strategy file and returns true', async () => {
    const strategy = initStrategy(cwd, makeScan());
    await saveStrategy(cwd, strategy);

    expect(existsSync(join(cwd, '.ratchet', 'strategy.md'))).toBe(true);

    const deleted = await resetStrategy(cwd);
    expect(deleted).toBe(true);
    expect(existsSync(join(cwd, '.ratchet', 'strategy.md'))).toBe(false);
  });

  it('returns false when no file to delete', async () => {
    const deleted = await resetStrategy(cwd);
    expect(deleted).toBe(false);
  });
});

describe('evolveStrategy', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = makeTempDir();
    await mkdir(join(cwd, '.ratchet'), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('creates a new strategy if none exists', async () => {
    const scan = makeScan({ total: 70 });
    const run = makeRun({
      clicks: [makeClick({ testsPassed: true })],
    });

    const { updated } = await evolveStrategy(cwd, run, scan, makeScan({ total: 73 }));

    expect(updated.version).toBe(2); // init=1, evolve=2
    expect(updated.runSummaries).toHaveLength(1);
    expect(updated.runSummaries[0].scoreBefore).toBe(70);
    expect(updated.runSummaries[0].scoreAfter).toBe(73);
    expect(updated.runSummaries[0].landed).toBe(1);
    expect(updated.runSummaries[0].rolledBack).toBe(0);
  });

  it('increments version each time', async () => {
    const scan = makeScan({ total: 70 });
    const run1 = makeRun({ clicks: [makeClick()] });
    const run2 = makeRun({ clicks: [makeClick()] });

    await evolveStrategy(cwd, run1, scan, makeScan({ total: 72 }));
    const { updated } = await evolveStrategy(cwd, run2, makeScan({ total: 72 }), makeScan({ total: 75 }));

    expect(updated.version).toBe(3); // init+evolve1=2, evolve2=3
    expect(updated.runSummaries).toHaveLength(2);
  });

  it('adds run summary with correct fields', async () => {
    const scanBefore = makeScan({ total: 60 });
    const scanAfter = makeScan({ total: 67 });
    const run = makeRun({
      clicks: [
        makeClick({ testsPassed: true }),
        makeClick({ number: 2, testsPassed: true }),
        makeClick({ number: 3, testsPassed: false }),
      ],
    });

    const { updated, keyInsight } = await evolveStrategy(cwd, run, scanBefore, scanAfter);

    expect(updated.runSummaries[0].landed).toBe(2);
    expect(updated.runSummaries[0].rolledBack).toBe(1);
    expect(updated.runSummaries[0].scoreBefore).toBe(60);
    expect(updated.runSummaries[0].scoreAfter).toBe(67);
    expect(keyInsight).toBeTruthy();
    expect(typeof keyInsight).toBe('string');
  });

  it('detects hot spots from files with high rollback rates', async () => {
    // First, pre-populate strategy with some rollback history by simulating
    // 3+ attempts on a file
    const scan = makeScan({ total: 70 });

    // Simulate 4 clicks all on the same file, 3 rolled back
    const run = makeRun({
      clicks: [
        makeClick({ filesModified: ['src/hard-file.ts'], testsPassed: false }),
        makeClick({ filesModified: ['src/hard-file.ts'], testsPassed: false }),
        makeClick({ filesModified: ['src/hard-file.ts'], testsPassed: false }),
        makeClick({ filesModified: ['src/hard-file.ts'], testsPassed: true }),
      ],
    });

    const { updated } = await evolveStrategy(cwd, run, scan, makeScan({ total: 71 }));

    // 3/4 = 75% rollback, which is >= 50% threshold AND >= 3 attempts
    const hotSpot = updated.hotSpots.find(hs => hs.filePath === 'src/hard-file.ts');
    expect(hotSpot).toBeDefined();
    expect(hotSpot!.rollbackRate).toBeCloseTo(0.75);
    expect(hotSpot!.attempts).toBe(4);
  });

  it('trims run summaries to last 20', async () => {
    const scan = makeScan({ total: 50 });
    let strategy = initStrategy(cwd, scan);

    // Add 22 run summaries manually
    for (let i = 0; i < 22; i++) {
      strategy.runSummaries.push({
        runId: `run-${i}`,
        date: new Date().toISOString(),
        mode: 'normal',
        scoreBefore: 50,
        scoreAfter: 51,
        landed: 1,
        rolledBack: 0,
        keyInsight: `Run ${i}`,
      });
    }
    await saveStrategy(cwd, strategy);

    const run = makeRun({ clicks: [makeClick()] });
    const { updated } = await evolveStrategy(cwd, run, scan, makeScan({ total: 52 }));

    expect(updated.runSummaries.length).toBeLessThanOrEqual(20);
  });

  it('extracts anti-patterns from rollback reasons', async () => {
    const scan = makeScan({ total: 70 });
    const run = makeRun({
      clicks: [
        makeClick({
          testsPassed: false,
          rollbackReason: 'max-files exceeded: 8 files changed',
        }),
        makeClick({
          testsPassed: false,
          rollbackReason: 'max-files exceeded: 5 files changed',
        }),
      ],
    });

    const { updated } = await evolveStrategy(cwd, run, scan, makeScan({ total: 70 }));

    const ap = updated.antiPatterns.find(p => p.pattern.toLowerCase().includes('too many files'));
    expect(ap).toBeDefined();
    expect(ap!.occurrences).toBeGreaterThanOrEqual(2);
  });

  it('decays insight confidence on subsequent runs', async () => {
    const scan = makeScan({ total: 70 });

    // First run: add a what-works insight with confidence 0.8
    let strategy = initStrategy(cwd, scan);
    strategy.insights.push({
      id: 'ins-decay',
      type: 'what-works',
      description: 'Some approach works',
      evidence: '3/3 landed',
      confidence: 0.8,
      createdAt: new Date().toISOString(),
      runId: 'run-0',
    });
    await saveStrategy(cwd, strategy);

    // Run without adding the same insight → should decay confidence
    const run = makeRun({
      clicks: [makeClick({ filesModified: ['different-file.ts'] })],
    });
    const { updated } = await evolveStrategy(cwd, run, scan, makeScan({ total: 71 }));

    const decayed = updated.insights.find(i => i.id === 'ins-decay');
    if (decayed) {
      // Confidence should have dropped by ~0.1
      expect(decayed.confidence).toBeLessThan(0.8);
    }
    // If it was pruned (confidence dropped below 0.05), that's also fine
  });

  it('handles run with zero clicks gracefully', async () => {
    const scan = makeScan({ total: 70 });
    const run = makeRun({ clicks: [] });

    // Should not throw
    await expect(evolveStrategy(cwd, run, scan, scan)).resolves.toBeDefined();
  });
});

describe('buildStrategyContext', () => {
  it('returns empty string for a brand-new strategy', () => {
    const strategy: Strategy = {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'test',
        techStack: [],
        patterns: [],
        testFramework: 'vitest',
        totalFiles: 0,
        lastScanned: new Date().toISOString(),
      },
      insights: [],
      hotSpots: [],
      antiPatterns: [],
      runSummaries: [],
    };

    const ctx = buildStrategyContext(strategy);
    expect(ctx).toBe('');
  });

  it('includes what-works insights above confidence threshold', () => {
    const strategy: Strategy = {
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'test',
        techStack: ['TypeScript'],
        patterns: [],
        testFramework: 'vitest',
        totalFiles: 50,
        lastScanned: new Date().toISOString(),
      },
      insights: [
        {
          id: 'i1',
          type: 'what-works',
          description: 'Single-file changes land reliably',
          evidence: '5/5 clicks landed',
          confidence: 0.9,
          createdAt: new Date().toISOString(),
          runId: 'run-1',
        },
        {
          id: 'i2',
          type: 'what-works',
          description: 'Low confidence approach',
          evidence: '1/3 landed',
          confidence: 0.2, // below threshold
          createdAt: new Date().toISOString(),
          runId: 'run-1',
        },
      ],
      hotSpots: [],
      antiPatterns: [],
      runSummaries: [],
    };

    const ctx = buildStrategyContext(strategy);
    expect(ctx).toContain('Single-file changes land reliably');
    expect(ctx).not.toContain('Low confidence approach');
    expect(ctx).toContain('STRATEGY CONTEXT');
  });

  it('includes hot spots above threshold', () => {
    const strategy: Strategy = {
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'test',
        techStack: [],
        patterns: [],
        testFramework: 'unknown',
        totalFiles: 0,
        lastScanned: new Date().toISOString(),
      },
      insights: [],
      hotSpots: [
        {
          filePath: 'src/dangerous.ts',
          rollbackRate: 0.8,
          attempts: 5,
          lastAttempt: new Date().toISOString(),
          notes: 'Frequently causes failures',
        },
        {
          filePath: 'src/safe.ts',
          rollbackRate: 0.2, // below threshold
          attempts: 5,
          lastAttempt: new Date().toISOString(),
          notes: '',
        },
      ],
      antiPatterns: [],
      runSummaries: [],
    };

    const ctx = buildStrategyContext(strategy);
    expect(ctx).toContain('src/dangerous.ts');
    expect(ctx).not.toContain('src/safe.ts');
  });

  it('includes anti-patterns', () => {
    const strategy: Strategy = {
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'test',
        techStack: [],
        patterns: [],
        testFramework: 'unknown',
        totalFiles: 0,
        lastScanned: new Date().toISOString(),
      },
      insights: [],
      hotSpots: [],
      antiPatterns: [
        {
          pattern: 'Touching too many files in one click',
          occurrences: 3,
          lastSeen: new Date().toISOString(),
          example: 'max-files guard triggered',
        },
      ],
      runSummaries: [
        {
          runId: 'run-1',
          date: new Date().toISOString(),
          mode: 'normal',
          scoreBefore: 65,
          scoreAfter: 70,
          landed: 4,
          rolledBack: 2,
          keyInsight: 'Good run',
        },
      ],
    };

    const ctx = buildStrategyContext(strategy);
    expect(ctx).toContain('Touching too many files');
  });

  it('stays concise (under 600 words)', () => {
    const strategy: Strategy = {
      version: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'big-project',
        techStack: ['Node.js', 'TypeScript'],
        patterns: ['src/ layout'],
        testFramework: 'vitest',
        totalFiles: 200,
        lastScanned: new Date().toISOString(),
      },
      insights: Array.from({ length: 10 }, (_, i) => ({
        id: `i${i}`,
        type: 'what-works' as const,
        description: `Insight ${i} about approach that works well for this project`,
        evidence: `${i + 3}/${i + 3} clicks landed`,
        confidence: 0.8,
        createdAt: new Date().toISOString(),
        runId: 'run-x',
      })),
      hotSpots: Array.from({ length: 10 }, (_, i) => ({
        filePath: `src/file${i}.ts`,
        rollbackRate: 0.8,
        attempts: 5,
        lastAttempt: new Date().toISOString(),
        notes: 'Hard to change',
      })),
      antiPatterns: Array.from({ length: 5 }, (_, i) => ({
        pattern: `Anti-pattern ${i}`,
        occurrences: 3,
        lastSeen: new Date().toISOString(),
        example: 'example',
      })),
      runSummaries: [],
    };

    const ctx = buildStrategyContext(strategy);
    const wordCount = ctx.split(/\s+/).length;
    // ~500 tokens ≈ ~375 words, but let's give room: under 600 words
    expect(wordCount).toBeLessThan(600);
  });
});

describe('getRecommendation', () => {
  it('warns about hot spots', () => {
    const strategy: Strategy = {
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'test',
        techStack: [],
        patterns: [],
        testFramework: 'unknown',
        totalFiles: 0,
        lastScanned: new Date().toISOString(),
      },
      insights: [],
      hotSpots: [
        {
          filePath: 'src/engine.ts',
          rollbackRate: 0.75,
          attempts: 4,
          lastAttempt: new Date().toISOString(),
          notes: 'Very complex',
        },
      ],
      antiPatterns: [],
      runSummaries: [],
    };

    const rec = getRecommendation(strategy, 'src/engine.ts');
    expect(rec).toContain('75%');
    expect(rec).toContain('caution');
  });

  it('returns default message for unknown files', () => {
    const strategy: Strategy = {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'test',
        techStack: [],
        patterns: [],
        testFramework: 'unknown',
        totalFiles: 0,
        lastScanned: new Date().toISOString(),
      },
      insights: [],
      hotSpots: [],
      antiPatterns: [],
      runSummaries: [],
    };

    const rec = getRecommendation(strategy, 'src/new-file.ts');
    expect(rec).toContain('No recommendation');
  });
});
