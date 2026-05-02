import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { saveRun, loadRun, listRuns, loadLatestRun } from '../core/history.js';
import type { RatchetRun } from '../types.js';
import type { ScanResult } from '../core/scanner/types.js';

// Mock data
describe('history module', () => {
  let testDir: string;
  let testCwd: string;

  beforeEach(async () => {
    testDir = '/tmp/ratchet-history-test';
    testCwd = join(testDir, 'test-repo');
    await mkdir(testCwd, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const mockRun: RatchetRun = {
    id: 'test-run-123',
    target: {
      name: 'test-target',
      description: 'test description',
      path: '/tmp/ratchet-history-test/test-repo',
    },
    clicks: [],
    startedAt: new Date('2023-01-01T00:00:00Z'),
    status: 'completed',
  };

  const mockScanResult: ScanResult = {
    projectName: 'test-repo',
    total: 85,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 5,
    issuesByType: [],
  };

  describe('saveRun', () => {
    it('saves a run to the filesystem', async () => {
      await saveRun(testCwd, mockRun, mockScanResult, mockScanResult);
      
      const savedRun = await loadRun(testCwd, 'test-run-123');
      expect(savedRun).not.toBeNull();
      expect(savedRun?.run.id).toBe('test-run-123');
      expect(savedRun?.run.status).toBe('completed');
    });

    it('creates .ratchet/runs directory if it does not exist', async () => {
      const runsDir = join(testCwd, '.ratchet/runs');
      expect(require('fs').existsSync(runsDir)).toBe(false); // Directory doesn't exist initially
      
      await saveRun(testCwd, mockRun);
      
      // Directory should exist now
      expect(require('fs').existsSync(runsDir)).toBe(true);
    });
  });

  describe('loadRun', () => {
    it('returns null for non-existent run', async () => {
      const result = await loadRun(testCwd, 'non-existent-run');
      expect(result).toBeNull();
    });

    it('loads a previously saved run', async () => {
      await saveRun(testCwd, mockRun, mockScanResult);
      
      const loaded = await loadRun(testCwd, 'test-run-123');
      expect(loaded).not.toBeNull();
      expect(loaded?.run.id).toBe('test-run-123');
      expect(loaded?.run.target.name).toBe('test-target');
    });

    it('hydrates date fields from JSON strings', async () => {
      await saveRun(testCwd, mockRun, mockScanResult);
      
      const loaded = await loadRun(testCwd, 'test-run-123');
      expect(loaded?.run.startedAt).toBeInstanceOf(Date);
    });

    it('throws for corrupted JSON files', async () => {
      const runsDir = join(testCwd, '.ratchet/runs');
      await mkdir(runsDir, { recursive: true });
      const filePath = join(runsDir, 'corrupted.json');
      await writeFile(filePath, 'invalid json {{}', 'utf-8');

      await expect(loadRun(testCwd, 'corrupted')).rejects.toThrow();
    });
  });

  describe('listRuns', () => {
    it('returns empty array when no runs exist', async () => {
      const runs = await listRuns(testCwd);
      expect(runs).toHaveLength(0);
    });

    it('lists multiple saved runs', async () => {
      const run1 = { ...mockRun, id: 'run-001' };
      const run2 = { ...mockRun, id: 'run-002' };
      
      await saveRun(testCwd, run1);
      await saveRun(testCwd, run2);
      
      const runs = await listRuns(testCwd);
      expect(runs).toHaveLength(2);
      expect(runs.map((r) => r.run.id)).toContain('run-001');
      expect(runs.map((r) => r.run.id)).toContain('run-002');
    });

    it('sorts runs by savedAt (newest first)', async () => {
      const run1 = { ...mockRun, id: 'run-001', startedAt: new Date('2023-01-01') };
      const run2 = { ...mockRun, id: 'run-002', startedAt: new Date('2023-01-03') };
      const run3 = { ...mockRun, id: 'run-003', startedAt: new Date('2023-01-02') };
      
      await saveRun(testCwd, run1);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure different savedAt times
      await saveRun(testCwd, run3);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure different savedAt times
      await saveRun(testCwd, run2);
      
      const runs = await listRuns(testCwd);
      expect(runs[0].run.id).toBe('run-002'); // newest (saved last)
      expect(runs[1].run.id).toBe('run-003');
      expect(runs[2].run.id).toBe('run-001'); // oldest (saved first)
    });

    it('skips corrupted files without failing', async () => {
      const runsDir = join(testCwd, '.ratchet/runs');
      await mkdir(runsDir, { recursive: true });
      
      // Save a valid run
      await saveRun(testCwd, mockRun);
      
      // Add a corrupted file
      const filePath = join(runsDir, 'corrupted.json');
      await writeFile(filePath, 'invalid json {{}', 'utf-8');
      
      // Should only return the valid run
      const runs = await listRuns(testCwd);
      expect(runs).toHaveLength(1);
      expect(runs[0].run.id).toBe('test-run-123');
    });
  });

  describe('loadLatestRun', () => {
    it('returns null when no runs exist', async () => {
      const result = await loadLatestRun(testCwd);
      expect(result).toBeNull();
    });

    it('returns the newest run', async () => {
      const run1 = { ...mockRun, id: 'run-001', startedAt: new Date('2023-01-01') };
      const run2 = { ...mockRun, id: 'run-002', startedAt: new Date('2023-01-03') };
      
      await saveRun(testCwd, run1);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure different savedAt times
      await saveRun(testCwd, run2);
      
      const latest = await loadLatestRun(testCwd);
      expect(latest?.run.id).toBe('run-002');
    });

    it('falls back to legacy .ratchet-state.json when no history entries exist', async () => {
      const legacyState = {
        id: 'legacy-run',
        target: mockRun.target,
        clicks: [],
        startedAt: '2023-01-01T00:00:00.000Z',
        status: 'completed' as const,
      };

      const legacyPath = join(testCwd, '.ratchet-state.json');
      await writeFile(legacyPath, JSON.stringify(legacyState), 'utf-8');

      const latest = await loadLatestRun(testCwd);
      expect(latest?.run.id).toBe('legacy-run');
    });

    it('prefers history entries over legacy file when both exist', async () => {
      const legacyState = {
        id: 'legacy-run',
        target: mockRun.target,
        clicks: [],
        startedAt: '2023-01-01T00:00:00.000Z',
        status: 'completed' as const,
      };

      const legacyPath = join(testCwd, '.ratchet-state.json');
      await writeFile(legacyPath, JSON.stringify(legacyState), 'utf-8');

      // Save a history entry (newer than legacy)
      const historyRun = { ...mockRun, id: 'history-run', startedAt: new Date('2023-01-02') };
      await saveRun(testCwd, historyRun);

      const latest = await loadLatestRun(testCwd);
      expect(latest?.run.id).toBe('history-run');
    });
  });
});