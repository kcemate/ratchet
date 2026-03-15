import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';
import type { ScanCache } from '../src/core/scan-cache.js';
import type { ScanResult } from '../src/commands/scan.js';

// ---------------------------------------------------------------------------
// ESM-compatible mocking: mock fs and child_process at module level
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../src/commands/scan.js', () => ({
  runScan: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { runScan } from '../src/commands/scan.js';
import { IncrementalScanner } from '../src/core/scan-cache.js';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;
const mockExecSync = execSync as ReturnType<typeof vi.fn>;
const mockRunScan = runScan as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test-project',
    total: 42,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 5,
    issuesByType: [],
    ...overrides,
  };
}

function makeCache(overrides: Partial<ScanCache> = {}): ScanCache {
  return {
    fileHashes: { '/project/src/index.ts': 'abc123' },
    lastFullScan: makeScan(),
    lastScanAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('IncrementalScanner', () => {
  const cwd = '/tmp/test-ratchet-project';
  let scanner: IncrementalScanner;

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new IncrementalScanner(cwd);
  });

  describe('needsFullScan', () => {
    it('returns true when cache file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(scanner.needsFullScan()).toBe(true);
    });

    it('returns true when cache is older than 1 hour', () => {
      const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ lastScanAt: oldTimestamp, fileHashes: {}, lastFullScan: makeScan() }),
      );
      expect(scanner.needsFullScan()).toBe(true);
    });

    it('returns false when cache is fresh (< 1 hour old)', () => {
      const freshTimestamp = Date.now() - 5 * 60 * 1000; // 5 minutes ago
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ lastScanAt: freshTimestamp, fileHashes: {}, lastFullScan: makeScan() }),
      );
      expect(scanner.needsFullScan()).toBe(false);
    });
  });

  describe('loadCache', () => {
    it('returns null when cache file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await scanner.loadCache();
      expect(result).toBeNull();
    });

    it('returns null on malformed JSON', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not-json{{{');
      const result = await scanner.loadCache();
      expect(result).toBeNull();
    });

    it('returns null on schema mismatch', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ foo: 'bar' }));
      const result = await scanner.loadCache();
      expect(result).toBeNull();
    });

    it('parses a valid cache correctly', async () => {
      const cache = makeCache();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(cache));
      const result = await scanner.loadCache();
      expect(result).not.toBeNull();
      expect(result?.lastFullScan.total).toBe(42);
      expect(result?.fileHashes['/project/src/index.ts']).toBe('abc123');
    });
  });

  describe('saveCache', () => {
    it('creates .ratchet dir if it does not exist and writes cache', async () => {
      mockExistsSync.mockReturnValue(false);
      const cache = makeCache();
      await scanner.saveCache(cache);

      expect(mockMkdirSync).toHaveBeenCalledWith(join(cwd, '.ratchet'), { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        join(cwd, '.ratchet', 'scan-cache.json'),
        expect.stringContaining('"lastScanAt"'),
        'utf-8',
      );
    });

    it('does not call mkdirSync if .ratchet dir already exists', async () => {
      mockExistsSync.mockReturnValue(true);
      await scanner.saveCache(makeCache());
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('incrementalScan', () => {
    it('falls back to full scan when no cache exists', async () => {
      const freshScan = makeScan({ total: 55 });
      mockExistsSync.mockReturnValue(false);
      mockRunScan.mockResolvedValue(freshScan);
      // git hash-object
      mockExecSync.mockReturnValue('deadbeef\n');

      const result = await scanner.incrementalScan(makeScan());
      expect(result.total).toBe(55);
      expect(mockRunScan).toHaveBeenCalledWith(cwd);
    });

    it('returns cached result when no files changed', async () => {
      const cachedScan = makeScan({ total: 70 });
      const cache = makeCache({ lastFullScan: cachedScan, lastScanAt: Date.now() });

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(cache));
      // git diff returns empty (no changed files)
      mockExecSync.mockReturnValue('\n');

      const result = await scanner.incrementalScan(makeScan());
      expect(result.total).toBe(70);
      // runScan should NOT have been called
      expect(mockRunScan).not.toHaveBeenCalled();
    });

    it('forces full scan when >30% files have changed', async () => {
      // 10 tracked files, 4 changed = 40% > 30% threshold
      const fileHashes: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        fileHashes[`${cwd}/src/file${i}.ts`] = `hash${i}`;
      }
      const cachedScan = makeScan({ total: 30 });
      const cache = makeCache({ fileHashes, lastFullScan: cachedScan, lastScanAt: Date.now() });
      const freshScan = makeScan({ total: 45 });

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(cache));

      let gitCallCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        gitCallCount++;
        if (gitCallCount <= 2) {
          // git diff --name-only calls — return 4 changed files (relative paths)
          return `src/file0.ts\nsrc/file1.ts\nsrc/file2.ts\nsrc/file3.ts\n`;
        }
        // git hash-object calls
        return 'newhash\n';
      });
      mockRunScan.mockResolvedValue(freshScan);

      const result = await scanner.incrementalScan(cachedScan);
      expect(result.total).toBe(45);
      expect(mockRunScan).toHaveBeenCalledWith(cwd);
    });

    it('runs incremental rescan for small change sets', async () => {
      // 10 tracked files, 1 changed = 10% < 30% threshold
      const fileHashes: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        fileHashes[`${cwd}/src/file${i}.ts`] = `hash${i}`;
      }
      const cachedScan = makeScan({ total: 50 });
      const cache = makeCache({ fileHashes, lastFullScan: cachedScan, lastScanAt: Date.now() });
      const freshScan = makeScan({ total: 52 });

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(cache));

      let gitCallCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        gitCallCount++;
        if (gitCallCount <= 2) {
          // git diff: 1 changed file (10% of 10)
          return `src/file0.ts\n`;
        }
        // git hash-object: return different hash to mark as stale
        return 'newhash999\n';
      });
      mockRunScan.mockResolvedValue(freshScan);

      const result = await scanner.incrementalScan(cachedScan);
      expect(result.total).toBe(52);
      expect(mockRunScan).toHaveBeenCalledWith(cwd);
    });
  });
});
