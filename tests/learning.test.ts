import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LearningStore } from '../src/core/learning.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-learning-'));
}

describe('LearningStore', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  describe('load + save', () => {
    it('starts with empty defaults when no file exists', async () => {
      const store = new LearningStore(dir);
      await store.load();
      const data = store.getData();
      expect(data.version).toBe(1);
      expect(Object.keys(data.issueTypes)).toHaveLength(0);
      expect(Object.keys(data.files)).toHaveLength(0);
      expect(Object.keys(data.specializations)).toHaveLength(0);
    });

    it('persists data to .ratchet/learning.json', async () => {
      const store = new LearningStore(dir);
      await store.load();
      await store.recordOutcome({
        issueType: 'missing-tests',
        filePath: 'src/api.ts',
        specialization: 'quality',
        success: true,
        fixTimeMs: 5000,
        scoreDelta: 3,
      });

      expect(existsSync(join(dir, '.ratchet', 'learning.json'))).toBe(true);
      const raw = readFileSync(join(dir, '.ratchet', 'learning.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(1);
      expect(parsed.issueTypes['missing-tests']).toBeDefined();
    });

    it('loads previously saved data', async () => {
      const store1 = new LearningStore(dir);
      await store1.load();
      await store1.recordOutcome({
        issueType: 'xss',
        filePath: 'src/render.ts',
        specialization: 'security',
        success: true,
        fixTimeMs: 3000,
        scoreDelta: 5,
      });

      const store2 = new LearningStore(dir);
      await store2.load();
      const data = store2.getData();
      expect(data.issueTypes['xss']!.successes).toBe(1);
      expect(data.specializations['security']!.wins).toBe(1);
    });

    it('handles corrupt learning.json gracefully', async () => {
      const { mkdirSync, writeFileSync } = await import('fs');
      mkdirSync(join(dir, '.ratchet'), { recursive: true });
      writeFileSync(join(dir, '.ratchet', 'learning.json'), 'NOT JSON!!!', 'utf-8');

      const store = new LearningStore(dir);
      await store.load();
      // Should not throw, starts with empty data
      const data = store.getData();
      expect(data.version).toBe(1);
      expect(Object.keys(data.issueTypes)).toHaveLength(0);
    });
  });

  describe('recordOutcome', () => {
    it('tracks issue type successes and failures', async () => {
      const store = new LearningStore(dir);
      await store.load();

      await store.recordOutcome({
        issueType: 'empty-catch',
        filePath: 'src/a.ts',
        specialization: 'errors',
        success: true,
        fixTimeMs: 2000,
        scoreDelta: 2,
      });
      await store.recordOutcome({
        issueType: 'empty-catch',
        filePath: 'src/b.ts',
        specialization: 'errors',
        success: false,
        fixTimeMs: 3000,
        scoreDelta: 0,
        failureReason: 'tests failed',
      });

      const data = store.getData();
      const rec = data.issueTypes['empty-catch']!;
      expect(rec.attempts).toBe(2);
      expect(rec.successes).toBe(1);
      expect(rec.failures).toBe(1);
      expect(rec.avgFixTimeMs).toBe(2000); // only successful attempts count
    });

    it('tracks file successes and failure reasons', async () => {
      const store = new LearningStore(dir);
      await store.load();

      await store.recordOutcome({
        issueType: 'any-type',
        filePath: 'src/utils.ts',
        specialization: 'types',
        success: false,
        fixTimeMs: 1000,
        scoreDelta: 0,
        failureReason: 'type error after change',
      });
      await store.recordOutcome({
        issueType: 'any-type',
        filePath: 'src/utils.ts',
        specialization: 'types',
        success: true,
        fixTimeMs: 2000,
        scoreDelta: 1,
      });

      const data = store.getData();
      const file = data.files['src/utils.ts']!;
      expect(file.attempts).toBe(2);
      expect(file.successes).toBe(1);
      expect(file.failures).toBe(1);
      expect(file.failureReasons).toEqual(['type error after change']);
      expect(file.lastAttemptAt).toBeTruthy();
    });

    it('tracks specialization win/loss and score delta', async () => {
      const store = new LearningStore(dir);
      await store.load();

      await store.recordOutcome({
        issueType: 'a',
        filePath: 'f.ts',
        specialization: 'security',
        success: true,
        fixTimeMs: 1000,
        scoreDelta: 4,
      });
      await store.recordOutcome({
        issueType: 'b',
        filePath: 'g.ts',
        specialization: 'security',
        success: false,
        fixTimeMs: 500,
        scoreDelta: 0,
      });
      await store.recordOutcome({
        issueType: 'c',
        filePath: 'h.ts',
        specialization: 'security',
        success: true,
        fixTimeMs: 2000,
        scoreDelta: 6,
      });

      const data = store.getData();
      const spec = data.specializations['security']!;
      expect(spec.wins).toBe(2);
      expect(spec.losses).toBe(1);
      expect(spec.totalRuns).toBe(3);
      expect(spec.totalScoreDelta).toBe(10);
    });

    it('tracks issue+file combination failures', async () => {
      const store = new LearningStore(dir);
      await store.load();

      for (let i = 0; i < 3; i++) {
        await store.recordOutcome({
          issueType: 'perf-issue',
          filePath: 'src/heavy.ts',
          specialization: 'performance',
          success: false,
          fixTimeMs: 1000,
          scoreDelta: 0,
        });
      }

      expect(store.getIssueFileFailures('perf-issue', 'src/heavy.ts')).toBe(3);
    });

    it('sets bestSpecialization to the first successful spec', async () => {
      const store = new LearningStore(dir);
      await store.load();

      await store.recordOutcome({
        issueType: 'missing-test',
        filePath: 'src/x.ts',
        specialization: 'quality',
        success: true,
        fixTimeMs: 1000,
        scoreDelta: 2,
      });

      const data = store.getData();
      expect(data.issueTypes['missing-test']!.bestSpecialization).toBe('quality');
    });
  });

  describe('getRecommendation', () => {
    it('returns low confidence with no data', async () => {
      const store = new LearningStore(dir);
      await store.load();

      const rec = store.getRecommendation('unknown-issue');
      expect(rec.preferredSpecialization).toBeNull();
      expect(rec.confidence).toBe('low');
    });

    it('returns low confidence with only 1 attempt', async () => {
      const store = new LearningStore(dir);
      await store.load();

      await store.recordOutcome({
        issueType: 'xss',
        filePath: 'src/a.ts',
        specialization: 'security',
        success: true,
        fixTimeMs: 1000,
        scoreDelta: 3,
      });

      const rec = store.getRecommendation('xss');
      expect(rec.confidence).toBe('low');
    });

    it('recommends the best specialization with medium confidence after 3 attempts', async () => {
      const store = new LearningStore(dir);
      await store.load();

      for (let i = 0; i < 3; i++) {
        await store.recordOutcome({
          issueType: 'error-handling',
          filePath: `src/${i}.ts`,
          specialization: 'errors',
          success: true,
          fixTimeMs: 1000,
          scoreDelta: 2,
        });
      }

      const rec = store.getRecommendation('error-handling');
      expect(rec.preferredSpecialization).toBe('errors');
      expect(rec.confidence).toBe('medium');
    });

    it('returns high confidence after 5+ attempts with 60%+ win rate', async () => {
      const store = new LearningStore(dir);
      await store.load();

      for (let i = 0; i < 5; i++) {
        await store.recordOutcome({
          issueType: 'type-safety',
          filePath: `src/${i}.ts`,
          specialization: 'types',
          success: i < 4, // 4/5 = 80% win rate
          fixTimeMs: 1000,
          scoreDelta: i < 4 ? 2 : 0,
        });
      }

      const rec = store.getRecommendation('type-safety');
      expect(rec.preferredSpecialization).toBe('types');
      expect(rec.confidence).toBe('high');
    });
  });

  describe('getSpecializationRanking', () => {
    it('returns empty array with no data', async () => {
      const store = new LearningStore(dir);
      await store.load();
      expect(store.getSpecializationRanking()).toEqual([]);
    });

    it('ranks specializations by win rate', async () => {
      const store = new LearningStore(dir);
      await store.load();

      // security: 3/4 = 75%
      for (let i = 0; i < 4; i++) {
        await store.recordOutcome({
          issueType: `issue-${i}`,
          filePath: `f${i}.ts`,
          specialization: 'security',
          success: i < 3,
          fixTimeMs: 1000,
          scoreDelta: i < 3 ? 2 : 0,
        });
      }

      // quality: 1/4 = 25%
      for (let i = 0; i < 4; i++) {
        await store.recordOutcome({
          issueType: `issue-q-${i}`,
          filePath: `q${i}.ts`,
          specialization: 'quality',
          success: i === 0,
          fixTimeMs: 1000,
          scoreDelta: i === 0 ? 1 : 0,
        });
      }

      const ranking = store.getSpecializationRanking();
      expect(ranking).toHaveLength(2);
      expect(ranking[0]!.specialization).toBe('security');
      expect(ranking[0]!.winRate).toBe(0.75);
      expect(ranking[1]!.specialization).toBe('quality');
      expect(ranking[1]!.winRate).toBe(0.25);
    });

    it('includes avgScoreDelta in ranking', async () => {
      const store = new LearningStore(dir);
      await store.load();

      await store.recordOutcome({
        issueType: 'a',
        filePath: 'f.ts',
        specialization: 'performance',
        success: true,
        fixTimeMs: 1000,
        scoreDelta: 10,
      });
      await store.recordOutcome({
        issueType: 'b',
        filePath: 'g.ts',
        specialization: 'performance',
        success: true,
        fixTimeMs: 2000,
        scoreDelta: 6,
      });

      const ranking = store.getSpecializationRanking();
      expect(ranking[0]!.avgScoreDelta).toBe(8);
    });
  });

  describe('shouldSkip', () => {
    it('returns false with no data', async () => {
      const store = new LearningStore(dir);
      await store.load();
      expect(store.shouldSkip('any', 'any')).toBe(false);
    });

    it('returns false after 2 failures', async () => {
      const store = new LearningStore(dir);
      await store.load();

      for (let i = 0; i < 2; i++) {
        await store.recordOutcome({
          issueType: 'hard-issue',
          filePath: 'src/tricky.ts',
          specialization: 'quality',
          success: false,
          fixTimeMs: 1000,
          scoreDelta: 0,
        });
      }

      expect(store.shouldSkip('hard-issue', 'src/tricky.ts')).toBe(false);
    });

    it('returns true after 3 failures on the same issue+file', async () => {
      const store = new LearningStore(dir);
      await store.load();

      for (let i = 0; i < 3; i++) {
        await store.recordOutcome({
          issueType: 'hard-issue',
          filePath: 'src/tricky.ts',
          specialization: 'quality',
          success: false,
          fixTimeMs: 1000,
          scoreDelta: 0,
        });
      }

      expect(store.shouldSkip('hard-issue', 'src/tricky.ts')).toBe(true);
    });

    it('does not skip different issue+file combinations', async () => {
      const store = new LearningStore(dir);
      await store.load();

      for (let i = 0; i < 3; i++) {
        await store.recordOutcome({
          issueType: 'hard-issue',
          filePath: 'src/tricky.ts',
          specialization: 'quality',
          success: false,
          fixTimeMs: 1000,
          scoreDelta: 0,
        });
      }

      // Same issue, different file
      expect(store.shouldSkip('hard-issue', 'src/other.ts')).toBe(false);
      // Different issue, same file
      expect(store.shouldSkip('other-issue', 'src/tricky.ts')).toBe(false);
    });
  });

  describe('getSpecializationWeights', () => {
    it('returns empty map with no data', async () => {
      const store = new LearningStore(dir);
      await store.load();
      const weights = store.getSpecializationWeights();
      expect(weights.size).toBe(0);
    });

    it('returns 1.0 for specs with fewer than 2 runs', async () => {
      const store = new LearningStore(dir);
      await store.load();

      await store.recordOutcome({
        issueType: 'a',
        filePath: 'f.ts',
        specialization: 'security',
        success: true,
        fixTimeMs: 1000,
        scoreDelta: 2,
      });

      const weights = store.getSpecializationWeights();
      expect(weights.get('security')).toBe(1.0);
    });

    it('weights specs based on win rate after 2+ runs', async () => {
      const store = new LearningStore(dir);
      await store.load();

      // security: 2/2 = 100% → weight = 0.5 + 1.0 = 1.5
      await store.recordOutcome({ issueType: 'a', filePath: 'f.ts', specialization: 'security', success: true, fixTimeMs: 1000, scoreDelta: 2 });
      await store.recordOutcome({ issueType: 'b', filePath: 'g.ts', specialization: 'security', success: true, fixTimeMs: 1000, scoreDelta: 3 });

      // quality: 0/2 = 0% → weight = 0.5 + 0.0 = 0.5
      await store.recordOutcome({ issueType: 'c', filePath: 'h.ts', specialization: 'quality', success: false, fixTimeMs: 1000, scoreDelta: 0 });
      await store.recordOutcome({ issueType: 'd', filePath: 'i.ts', specialization: 'quality', success: false, fixTimeMs: 1000, scoreDelta: 0 });

      const weights = store.getSpecializationWeights();
      expect(weights.get('security')).toBe(1.5);
      expect(weights.get('quality')).toBe(0.5);
    });
  });

  describe('graceful degradation', () => {
    it('all query functions return sensible defaults without load()', () => {
      const store = new LearningStore(dir);
      // Do NOT call load()

      expect(store.getRecommendation('any').preferredSpecialization).toBeNull();
      expect(store.getRecommendation('any').confidence).toBe('low');
      expect(store.getSpecializationRanking()).toEqual([]);
      expect(store.shouldSkip('any', 'file')).toBe(false);
      expect(store.getSpecializationWeights().size).toBe(0);
    });
  });
});
