import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadMeta, saveMeta, acquireLock, releaseLock, extractFrequentFiles,
  extractAntiPatterns, extractKnownPatterns, extractProjectStructure,
  buildRepoKnowledgeDoc, consolidateRunLearnings, loadRepoKnowledge,
} from '../core/consolidate.js';
import type { RatchetRun, RatchetClick } from '../types.js';

vi.mock('node:fs');
vi.mock('../core/feedback.js', () => ({
  loadFeedback: vi.fn(() => ({
    entries: [],
  })),
}));

const mockFs = fs as unknown as {
  existsSync: vi.Mock;
  readFileSync: vi.Mock;
  writeFileSync: vi.Mock;
  mkdirSync: vi.Mock;
  unlinkSync: vi.Mock;
};

describe('consolidate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('{}');
    mockFs.writeFileSync.mockImplementation(() => {});
    mockFs.mkdirSync.mockImplementation(() => {});
    mockFs.unlinkSync.mockImplementation(() => {});
  });

  describe('loadMeta', () => {
    it('should return default meta when file does not exist', () => {
      const meta = loadMeta('/test');
      expect(meta).toEqual({
        version: 1,
        lastConsolidatedAt: null,
        landedClicksSinceConsolidation: 0,
      });
    });

    it('should load meta from file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify({
        version: 1,
        lastConsolidatedAt: '2026-01-01T00:00:00.000Z',
        landedClicksSinceConsolidation: 5,
      }));
      const meta = loadMeta('/test');
      expect(meta).toEqual({
        version: 1,
        lastConsolidatedAt: '2026-01-01T00:00:00.000Z',
        landedClicksSinceConsolidation: 5,
      });
    });
  });

  describe('acquireLock', () => {
    it('should acquire lock when no lock exists', () => {
      mockFs.existsSync.mockReturnValue(false);
      const acquired = acquireLock('/test');
      expect(acquired).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false when valid lock exists', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        return p.includes('lock');
      });
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify({
        pid: 123,
        acquiredAt: new Date().toISOString(),
      }));
      const acquired = acquireLock('/test');
      expect(acquired).toBe(false);
    });
  });

  describe('extractFrequentFiles', () => {
    it('should extract most-touched files from run', () => {
      const run: RatchetRun = {
        clicks: [
          {
            filesModified: ['src/a.ts', 'src/b.ts'],
            testsPassed: true,
          },
          {
            filesModified: ['src/a.ts', 'src/c.ts'],
            testsPassed: true,
          },
        ],
      } as unknown as RatchetRun;
      const files = extractFrequentFiles(run);
      expect(files.length).toBeLessThanOrEqual(10);
      expect(files.some(f => f.file === 'src/a.ts')).toBe(true);
    });
  });

  describe('buildRepoKnowledgeDoc', () => {
    it('should build markdown document with all sections', () => {
      const run = { clicks: [] } as unknown as RatchetRun;
      const doc = buildRepoKnowledgeDoc(
        '/test',
        run,
        ['Entry point: src/index.ts'],
        ['Fixes to "linting" category landed reliably'],
        ['Changes that break tests (caused 2 rollbacks)'],
        [{ file: 'src/a.ts', count: 2, totalClicks: 3 }],
      );
      expect(doc).toContain('# Repo Knowledge');
      expect(doc).toContain('## Project Structure');
      expect(doc).toContain('## Known Patterns');
      expect(doc).toContain('## Anti-Patterns Discovered');
      expect(doc).toContain('## Files Frequently Modified');
    });
  });

  describe('consolidateRunLearnings', () => {
    it('should skip when time gate not met', async () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        return p.includes('consolidation-meta.json');
      });
      const recentDate = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify({
        version: 1,
        lastConsolidatedAt: recentDate,
        landedClicksSinceConsolidation: 0,
      }));

      const run = { clicks: [] } as unknown as RatchetRun;
      const result = await consolidateRunLearnings('/test', run);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('time_gate');
    });

    it('should skip when session gate not met', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const run = { clicks: [] } as unknown as RatchetRun;
      const result = await consolidateRunLearnings('/test', run);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('session_gate');
    });

    it('should skip when lock contention', async () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.includes('consolidation-meta.json')) return false;
        if (p.includes('consolidation.lock')) return true; // lock exists
        return false;
      });
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify({
        pid: 123,
        acquiredAt: new Date().toISOString(),
      }));

      const run: RatchetRun = {
        clicks: [
          { testsPassed: true },
          { testsPassed: true },
          { testsPassed: true },
        ],
      } as unknown as RatchetRun;
      const result = await consolidateRunLearnings('/test', run);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('lock_contention');
    });

    it('should write repo knowledge when gates pass', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const run = { clicks: [] } as unknown as RatchetRun;
      const result = await consolidateRunLearnings('/test', run);
      expect(result.skipped).toBe(true); // no data, but gates passed
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('loadRepoKnowledge', () => {
    it('should return null when file does not exist', () => {
      const knowledge = loadRepoKnowledge('/test');
      expect(knowledge).toBeNull();
    });

    it('should return formatted knowledge when file exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('# Repo Knowledge\ntest-project\n\n## Structure\n- Entry: src/index.ts');
      const knowledge = loadRepoKnowledge('/test');
      expect(knowledge).toContain('REPO KNOWLEDGE (from prior runs)');
      expect(knowledge).toContain('test-project');
    });
  });
});
