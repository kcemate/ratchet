import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { ContextBrain } from '../src/core/context-brain.js';
import type {
  ScanSnapshot,
  RunContext,
  RunResult,
  CrossProjectPattern,
} from '../src/core/context-brain.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-brain-'));
}

describe('ContextBrain', () => {
  let dir: string;
  let globalDir: string;

  beforeEach(() => {
    dir = tmpDir();
    globalDir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  });

  // ── L0 Tests ──────────────────────────────────────────────────────────────

  describe('L0 — Hot context', () => {
    it('starts with null scan and run', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0']);
      expect(brain.getCurrentScan()).toBeNull();
      expect(brain.getActiveRun()).toBeNull();
    });

    it('sets and gets current scan', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0']);

      const scan: ScanSnapshot = {
        score: 72,
        maxScore: 100,
        totalIssues: 14,
        issueCounts: { 'missing-tests': 5, 'empty-catches': 3, 'any-types': 6 },
        timestamp: '2026-03-15T10:00:00Z',
      };
      brain.setCurrentScan(scan);
      expect(brain.getCurrentScan()).toEqual(scan);
    });

    it('sets and gets active run', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0']);

      const run: RunContext = {
        runId: 'run-123',
        target: 'src',
        clickCount: 7,
        currentClick: 3,
        startedAt: '2026-03-15T10:00:00Z',
      };
      brain.setActiveRun(run);
      expect(brain.getActiveRun()).toEqual(run);
    });

    it('persists L0 data across loads', async () => {
      const brain1 = new ContextBrain(dir, globalDir);
      await brain1.load(['l0']);
      brain1.setCurrentScan({
        score: 80,
        maxScore: 100,
        totalIssues: 5,
        issueCounts: { 'lint': 5 },
        timestamp: '2026-03-15T10:00:00Z',
      });
      await brain1.save();

      const brain2 = new ContextBrain(dir, globalDir);
      await brain2.load(['l0']);
      expect(brain2.getCurrentScan()?.score).toBe(80);
    });

    it('saves to .ratchet/brain/l0.json', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0']);
      brain.setCurrentScan({
        score: 50,
        maxScore: 100,
        totalIssues: 10,
        issueCounts: {},
        timestamp: '2026-03-15T10:00:00Z',
      });
      await brain.save();

      const path = join(dir, '.ratchet', 'brain', 'l0.json');
      expect(existsSync(path)).toBe(true);
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      expect(data.currentScan.score).toBe(50);
    });
  });

  // ── L1 Tests ──────────────────────────────────────────────────────────────

  describe('L1 — Project memory', () => {
    it('records run results and tracks score progression', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      const result: RunResult = {
        runId: 'run-001',
        finalScore: 85,
        initialScore: 72,
        issuesFixed: 5,
        clicksLanded: 4,
        clicksRolled: 1,
        duration: 60000,
        strategiesUsed: ['missing-tests:add unit tests', 'errors:add error handling'],
        timestamp: '2026-03-15T10:00:00Z',
      };
      await brain.recordRunResult(result);

      const progression = await brain.getScoreProgression();
      expect(progression).toHaveLength(1);
      expect(progression[0]!.score).toBe(85);
      expect(progression[0]!.runId).toBe('run-001');
    });

    it('computes issue patterns from run results', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      // Record multiple runs with same issue type
      await brain.recordRunResult({
        runId: 'run-001',
        finalScore: 80,
        initialScore: 72,
        issuesFixed: 3,
        clicksLanded: 3,
        clicksRolled: 0,
        duration: 30000,
        strategiesUsed: ['missing-tests:add unit tests'],
        timestamp: '2026-03-15T10:00:00Z',
      });
      await brain.recordRunResult({
        runId: 'run-002',
        finalScore: 88,
        initialScore: 80,
        issuesFixed: 4,
        clicksLanded: 4,
        clicksRolled: 0,
        duration: 45000,
        strategiesUsed: ['missing-tests:add integration tests'],
        timestamp: '2026-03-15T11:00:00Z',
      });

      const patterns = await brain.getIssuePatterns();
      const testPattern = patterns.find((p) => p.issueType === 'missing-tests');
      expect(testPattern).toBeDefined();
      expect(testPattern!.frequency).toBe(2);
      expect(testPattern!.avgFixRate).toBe(1); // 2 successes out of 2
    });

    it('returns effective strategies sorted by success rate', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      // Record runs with different strategies
      await brain.recordRunResult({
        runId: 'run-001',
        finalScore: 80,
        initialScore: 72,
        issuesFixed: 3,
        clicksLanded: 3,
        clicksRolled: 0,
        duration: 30000,
        strategiesUsed: ['errors:add try-catch'],
        timestamp: '2026-03-15T10:00:00Z',
      });
      await brain.recordRunResult({
        runId: 'run-002',
        finalScore: 75,
        initialScore: 72,
        issuesFixed: 1,
        clicksLanded: 0,
        clicksRolled: 3,
        duration: 45000,
        strategiesUsed: ['errors:refactor error flow'],
        timestamp: '2026-03-15T11:00:00Z',
      });

      const strategies = await brain.getEffectiveStrategies('errors');
      expect(strategies).toHaveLength(2);
      // "add try-catch" should rank higher (landed clicks)
      expect(strategies[0]!.description).toBe('add try-catch');
      expect(strategies[0]!.successRate).toBe(1);
      expect(strategies[1]!.description).toBe('refactor error flow');
      expect(strategies[1]!.successRate).toBe(0);
    });

    it('returns empty strategies for unknown issue type', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      const strategies = await brain.getEffectiveStrategies('nonexistent');
      expect(strategies).toHaveLength(0);
    });

    it('tracks file history', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      await brain.recordFileOutcome('src/api.ts', 'missing-tests', true, 80);
      await brain.recordFileOutcome('src/api.ts', 'errors', false, 78);

      const history = await brain.getFileHistory('src/api.ts');
      expect(history.touchCount).toBe(2);
      expect(history.lastScore).toBe(78);
      expect(history.issueTypes).toContain('missing-tests');
      expect(history.issueTypes).toContain('errors');
      expect(history.avgFixRate).toBe(0.5); // 1 success out of 2
    });

    it('returns empty file history for unknown file', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      const history = await brain.getFileHistory('nonexistent.ts');
      expect(history.touchCount).toBe(0);
      expect(history.issueTypes).toHaveLength(0);
    });

    it('persists L1 data across loads', async () => {
      const brain1 = new ContextBrain(dir, globalDir);
      await brain1.load(['l0', 'l1']);
      await brain1.recordRunResult({
        runId: 'run-001',
        finalScore: 85,
        initialScore: 72,
        issuesFixed: 5,
        clicksLanded: 4,
        clicksRolled: 1,
        duration: 60000,
        strategiesUsed: ['quality:improve naming'],
        timestamp: '2026-03-15T10:00:00Z',
      });

      const brain2 = new ContextBrain(dir, globalDir);
      await brain2.load(['l0', 'l1']);
      const progression = await brain2.getScoreProgression();
      expect(progression).toHaveLength(1);
      expect(progression[0]!.score).toBe(85);
    });
  });

  // ── L2 Tests ──────────────────────────────────────────────────────────────

  describe('L2 — Cross-project wisdom', () => {
    it('records and retrieves cross-project patterns', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l2']);

      const pattern: CrossProjectPattern = {
        issueType: 'missing-tests',
        projectName: 'project-alpha',
        fixRate: 0.8,
        topStrategies: ['add unit tests', 'add integration tests'],
      };
      await brain.recordCrossProjectPattern(pattern);

      await brain.recordCrossProjectPattern({
        issueType: 'missing-tests',
        projectName: 'project-beta',
        fixRate: 0.6,
        topStrategies: ['add unit tests'],
      });

      const insights = await brain.getCrossProjectInsights('missing-tests');
      expect(insights.length).toBeGreaterThan(0);
      expect(insights[0]!.source).toBe('l2');
      expect(insights[0]!.text).toContain('2 projects');
    });

    it('returns empty insights for unknown issue type', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l2']);

      const insights = await brain.getCrossProjectInsights('nonexistent');
      expect(insights).toHaveLength(0);
    });

    it('tracks global specialization stats', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l2']);

      await brain.recordSpecOutcome('security', 'project-alpha', true, 5);
      await brain.recordSpecOutcome('security', 'project-beta', false, -1);
      await brain.recordSpecOutcome('quality', 'project-alpha', true, 3);

      const stats = await brain.getGlobalSpecializationStats();
      expect(stats).toHaveLength(2);

      const secStats = stats.find((s) => s.specialization === 'security');
      expect(secStats).toBeDefined();
      expect(secStats!.totalWins).toBe(1);
      expect(secStats!.totalRuns).toBe(2);
      expect(secStats!.projectCount).toBe(2);
    });

    it('persists L2 data across loads (including Set serialization)', async () => {
      const brain1 = new ContextBrain(dir, globalDir);
      await brain1.load(['l2']);
      await brain1.recordSpecOutcome('security', 'project-x', true, 5);

      const brain2 = new ContextBrain(dir, globalDir);
      await brain2.load(['l2']);
      const stats = await brain2.getGlobalSpecializationStats();
      const sec = stats.find((s) => s.specialization === 'security');
      expect(sec).toBeDefined();
      expect(sec!.projectCount).toBe(1);
      expect(sec!.totalWins).toBe(1);
    });
  });

  // ── Migration Tests ───────────────────────────────────────────────────────

  describe('Migration from learning.json', () => {
    it('auto-migrates legacy learning.json data to brain', async () => {
      // Create legacy learning.json
      const legacyDir = join(dir, '.ratchet');
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(
        join(legacyDir, 'learning.json'),
        JSON.stringify({
          version: 1,
          issueTypes: {
            'missing-tests': {
              issueType: 'missing-tests',
              attempts: 10,
              successes: 7,
              failures: 3,
              bestSpecialization: 'quality',
              avgFixTimeMs: 5000,
              totalFixTimeMs: 35000,
            },
          },
          files: {
            'src/api.ts': {
              filePath: 'src/api.ts',
              attempts: 5,
              successes: 3,
              failures: 2,
              failureReasons: ['timeout'],
              lastAttemptAt: '2026-03-15T10:00:00Z',
            },
          },
          specializations: {},
          issueFiles: {},
          updatedAt: '2026-03-15T10:00:00Z',
        }),
        'utf-8'
      );

      // Loading brain should auto-migrate
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      // Brain directory should now exist
      expect(existsSync(join(dir, '.ratchet', 'brain', 'l0.json'))).toBe(true);
      expect(existsSync(join(dir, '.ratchet', 'brain', 'l1.json'))).toBe(true);

      // Check migrated issue stats
      const patterns = await brain.getIssuePatterns();
      const testPattern = patterns.find((p) => p.issueType === 'missing-tests');
      expect(testPattern).toBeDefined();
      expect(testPattern!.frequency).toBe(10);

      // Check migrated file stats
      const fileHistory = await brain.getFileHistory('src/api.ts');
      expect(fileHistory.touchCount).toBe(5);
    });

    it('does not migrate if brain directory already exists', async () => {
      // Create both legacy and brain directories
      const legacyDir = join(dir, '.ratchet');
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(
        join(legacyDir, 'learning.json'),
        JSON.stringify({
          version: 1,
          issueTypes: {
            'old-data': { issueType: 'old-data', attempts: 99, successes: 99, failures: 0, bestSpecialization: null, avgFixTimeMs: 0, totalFixTimeMs: 0 },
          },
          files: {},
          specializations: {},
          issueFiles: {},
          updatedAt: '2026-03-15T10:00:00Z',
        }),
        'utf-8'
      );

      // Create brain dir (indicating migration already happened)
      mkdirSync(join(dir, '.ratchet', 'brain'), { recursive: true });

      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      // Should NOT have migrated the old data
      const patterns = await brain.getIssuePatterns();
      expect(patterns.find((p) => p.issueType === 'old-data')).toBeUndefined();
    });
  });

  // ── Tiered Retrieval Tests ────────────────────────────────────────────────

  describe('Tiered retrieval — getContext()', () => {
    it('always includes L0 data', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0']);

      brain.setCurrentScan({
        score: 72,
        maxScore: 100,
        totalIssues: 14,
        issueCounts: { 'missing-tests': 5 },
        timestamp: '2026-03-15T10:00:00Z',
      });

      const ctx = await brain.getContext({ phase: 'scan' });
      expect(ctx.l0).toBeDefined();
      expect((ctx.l0 as any).currentScan.score).toBe(72);
      expect(ctx.summary).toContain('72/100');
    });

    it('includes L1 data for plan phase', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      await brain.recordRunResult({
        runId: 'run-001',
        finalScore: 85,
        initialScore: 72,
        issuesFixed: 5,
        clicksLanded: 4,
        clicksRolled: 1,
        duration: 60000,
        strategiesUsed: ['errors:add try-catch'],
        timestamp: '2026-03-15T10:00:00Z',
      });

      const ctx = await brain.getContext({ phase: 'plan' });
      expect(ctx.l1).not.toBeNull();
    });

    it('includes strategy info when issueType is specified', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      await brain.recordRunResult({
        runId: 'run-001',
        finalScore: 85,
        initialScore: 72,
        issuesFixed: 5,
        clicksLanded: 4,
        clicksRolled: 1,
        duration: 60000,
        strategiesUsed: ['errors:add try-catch'],
        timestamp: '2026-03-15T10:00:00Z',
      });

      const ctx = await brain.getContext({ issueType: 'errors', phase: 'fix' });
      expect(ctx.l1).not.toBeNull();
      expect((ctx.l1 as any).effectiveStrategies).toBeDefined();
      expect(ctx.summary).toContain('strategies for "errors"');
    });

    it('includes file history when filePath is specified', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0', 'l1']);

      await brain.recordFileOutcome('src/api.ts', 'errors', true, 80);

      const ctx = await brain.getContext({ filePath: 'src/api.ts', phase: 'fix' });
      expect(ctx.l1).not.toBeNull();
      expect((ctx.l1 as any).fileHistory).toBeDefined();
      expect(ctx.summary).toContain('src/api.ts');
    });

    it('returns "No context available" when empty', async () => {
      const brain = new ContextBrain(dir, globalDir);
      await brain.load(['l0']);

      const ctx = await brain.getContext({ phase: 'scan' });
      expect(ctx.summary).toBe('No context available.');
    });
  });

  // ── snapshotFromScanResult ────────────────────────────────────────────────

  describe('snapshotFromScanResult', () => {
    it('converts ScanResult to ScanSnapshot', () => {
      const scanResult = {
        projectName: 'test-project',
        total: 72,
        maxTotal: 100,
        categories: [],
        totalIssuesFound: 14,
        issuesByType: [
          { category: 'Testing', subcategory: 'missing-tests', count: 5, description: 'missing tests', severity: 'high' as const },
          { category: 'Errors', subcategory: 'empty-catches', count: 3, description: 'empty catches', severity: 'medium' as const },
        ],
      };

      const snapshot = ContextBrain.snapshotFromScanResult(scanResult);
      expect(snapshot.score).toBe(72);
      expect(snapshot.maxScore).toBe(100);
      expect(snapshot.totalIssues).toBe(14);
      expect(snapshot.issueCounts['missing-tests']).toBe(5);
      expect(snapshot.issueCounts['empty-catches']).toBe(3);
    });
  });
});
