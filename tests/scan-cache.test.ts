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
import { IncrementalScanner, analyzeFile, rebuildScanFromMetrics } from '../src/core/scan-cache.js';
import type { PerFileMetrics } from '../src/core/scan-cache.js';

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

function makeEmptyPerFileMetrics(overrides: Partial<PerFileMetrics> = {}): PerFileMetrics {
  return {
    isTestFile: false,
    lineCount: 10,
    consoleLogCount: 0,
    anyTypeCount: 0,
    longLineCount: 0,
    emptyCatchCount: 0,
    longFunctionCount: 0,
    functionCount: 0,
    totalFunctionLength: 0,
    tryCatchCount: 0,
    asyncFunctionCount: 0,
    awaitInLoopCount: 0,
    commentedCodeCount: 0,
    todoCount: 0,
    secretCount: 0,
    edgeCaseTestCount: 0,
    testCaseCount: 0,
    assertCount: 0,
    describeCount: 0,
    hasValidation: false,
    isRouteFile: false,
    hasAuthMiddleware: false,
    hasRateLimit: false,
    hasCors: false,
    importIssueCount: 0,
    significantLines: [],
    ...overrides,
  };
}

function makeCache(overrides: Partial<ScanCache> = {}): ScanCache {
  return {
    fileHashes: { '/project/src/index.ts': 'abc123' },
    lastFullScan: makeScan(),
    fileMetrics: {
      '/project/src/index.ts': makeEmptyPerFileMetrics(),
    },
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
        JSON.stringify({ lastScanAt: oldTimestamp, fileHashes: {}, lastFullScan: makeScan(), fileMetrics: {} }),
      );
      expect(scanner.needsFullScan()).toBe(true);
    });

    it('returns false when cache is fresh (< 1 hour old)', () => {
      const freshTimestamp = Date.now() - 5 * 60 * 1000; // 5 minutes ago
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ lastScanAt: freshTimestamp, fileHashes: {}, lastFullScan: makeScan(), fileMetrics: {} }),
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

    it('migrates old cache without fileMetrics', async () => {
      const oldCache = {
        fileHashes: { '/project/src/index.ts': 'abc123' },
        lastFullScan: makeScan(),
        lastScanAt: Date.now(),
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(oldCache));
      const result = await scanner.loadCache();
      expect(result).not.toBeNull();
      expect(result?.fileMetrics).toEqual({});
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
      const fileMetrics: Record<string, PerFileMetrics> = {};
      for (let i = 0; i < 10; i++) {
        fileHashes[`${cwd}/src/file${i}.ts`] = `hash${i}`;
        fileMetrics[`${cwd}/src/file${i}.ts`] = makeEmptyPerFileMetrics();
      }
      const cachedScan = makeScan({ total: 30 });
      const cache = makeCache({ fileHashes, fileMetrics, lastFullScan: cachedScan, lastScanAt: Date.now() });
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

    it('runs true incremental rescan for small change sets (no runScan call)', async () => {
      // 10 tracked files, 1 changed = 10% < 30% threshold
      const fileHashes: Record<string, string> = {};
      const fileMetrics: Record<string, PerFileMetrics> = {};
      for (let i = 0; i < 10; i++) {
        const fp = `${cwd}/src/file${i}.ts`;
        fileHashes[fp] = `hash${i}`;
        fileMetrics[fp] = makeEmptyPerFileMetrics({ lineCount: 20 });
      }
      const cachedScan = makeScan({ total: 50 });
      const cache = makeCache({ fileHashes, fileMetrics, lastFullScan: cachedScan, lastScanAt: Date.now() });

      mockExistsSync.mockReturnValue(true);

      // Track which files readFileSync is called with
      const filesRead: string[] = [];
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith('scan-cache.json')) return JSON.stringify(cache);
        if (path.endsWith('package.json')) return JSON.stringify({ name: 'test-project' });
        if (path.endsWith('tsconfig.json')) return JSON.stringify({ compilerOptions: { strict: true } });
        filesRead.push(path);
        // Return simple TS content for the changed file
        return 'const x: number = 1;\n';
      });

      let gitCallCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        gitCallCount++;
        if (gitCallCount <= 2) {
          // git diff: 1 changed file (10% of 10)
          return `src/file0.ts\n`;
        }
        // git hash-object: return different hash for changed file
        return 'newhash999\n';
      });

      const result = await scanner.incrementalScan(cachedScan);

      // runScan should NOT have been called — this is the key assertion
      expect(mockRunScan).not.toHaveBeenCalled();

      // Only the changed file should have been read for content analysis
      expect(filesRead).toEqual([`${cwd}/src/file0.ts`]);

      // Result should still be a valid ScanResult
      expect(result.projectName).toBe('test-project');
      expect(typeof result.total).toBe('number');
      expect(typeof result.maxTotal).toBe('number');
    });

    it('updates cached issue counts correctly after incremental rescan', async () => {
      // Setup: 5 files, 1 has 3 console.logs. After change, it has 1.
      const fileHashes: Record<string, string> = {};
      const fileMetrics: Record<string, PerFileMetrics> = {};
      for (let i = 0; i < 5; i++) {
        const fp = `${cwd}/src/file${i}.ts`;
        fileHashes[fp] = `hash${i}`;
        fileMetrics[fp] = makeEmptyPerFileMetrics({
          lineCount: 20,
          consoleLogCount: i === 0 ? 3 : 0, // file0 has 3 console.logs
        });
      }
      const cachedScan = makeScan({ total: 50 });
      const cache = makeCache({ fileHashes, fileMetrics, lastFullScan: cachedScan, lastScanAt: Date.now() });

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith('scan-cache.json')) return JSON.stringify(cache);
        if (path.endsWith('package.json')) return JSON.stringify({ name: 'test-project' });
        if (path.endsWith('tsconfig.json')) return JSON.stringify({ compilerOptions: { strict: true } });
        // The changed file now has only 1 console.log
        return 'const x = 1;\nconsole.log("hello");\n';
      });

      let gitCallCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        gitCallCount++;
        if (gitCallCount <= 2) return `src/file0.ts\n`;
        return 'newhash\n';
      });

      const result = await scanner.incrementalScan(cachedScan);
      expect(mockRunScan).not.toHaveBeenCalled();

      // Verify the console.log count in the result reflects the update
      // Old: 3 console.logs (from file0) + 0 from others = 3
      // New: 1 console.log (from file0) + 0 from others = 1
      const perfCategory = result.categories.find(c => c.name === 'Performance');
      const consoleSub = perfCategory?.subcategories.find(s => s.name === 'Console cleanup');
      expect(consoleSub?.issuesFound).toBe(1);
    });

    it('handles delta merge correctly when file is deleted', async () => {
      const fileHashes: Record<string, string> = {};
      const fileMetrics: Record<string, PerFileMetrics> = {};
      for (let i = 0; i < 5; i++) {
        const fp = `${cwd}/src/file${i}.ts`;
        fileHashes[fp] = `hash${i}`;
        fileMetrics[fp] = makeEmptyPerFileMetrics({
          lineCount: 20,
          consoleLogCount: i === 2 ? 5 : 0, // file2 has 5 console.logs
        });
      }
      const cachedScan = makeScan({ total: 50 });
      const cache = makeCache({ fileHashes, fileMetrics, lastFullScan: cachedScan, lastScanAt: Date.now() });

      // file2 was changed but no longer exists (deleted)
      mockExistsSync.mockImplementation((path: string) => {
        if (path === `${cwd}/src/file2.ts`) return false;
        return true;
      });
      mockReadFileSync.mockImplementation((path: string) => {
        if (path.endsWith('scan-cache.json')) return JSON.stringify(cache);
        if (path.endsWith('package.json')) return JSON.stringify({ name: 'test-project' });
        if (path.endsWith('tsconfig.json')) return JSON.stringify({ compilerOptions: { strict: true } });
        return 'const x = 1;\n';
      });

      let gitCallCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        gitCallCount++;
        if (gitCallCount <= 2) return `src/file2.ts\n`;
        return 'newhash\n';
      });

      const result = await scanner.incrementalScan(cachedScan);
      expect(mockRunScan).not.toHaveBeenCalled();

      // file2 was deleted, so its 5 console.logs should be gone
      const perfCategory = result.categories.find(c => c.name === 'Performance');
      const consoleSub = perfCategory?.subcategories.find(s => s.name === 'Console cleanup');
      expect(consoleSub?.issuesFound).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// analyzeFile unit tests
// ---------------------------------------------------------------------------

describe('analyzeFile', () => {
  it('counts console.log in source files', () => {
    const content = 'console.log("a");\nconsole.log("b");\nconst x = 1;';
    const metrics = analyzeFile('/project/src/index.ts', content);
    expect(metrics.consoleLogCount).toBe(2);
    expect(metrics.isTestFile).toBe(false);
  });

  it('does not count console.log in test files', () => {
    const content = 'console.log("debug");\nexpect(true).toBe(true);';
    const metrics = analyzeFile('/project/src/index.test.ts', content);
    expect(metrics.consoleLogCount).toBe(0);
    expect(metrics.isTestFile).toBe(true);
  });

  it('counts any types in .ts source files', () => {
    const content = 'const x: any = 1;\nconst y = z as any;\nfunction foo(a: any): void {}';
    const metrics = analyzeFile('/project/src/index.ts', content);
    expect(metrics.anyTypeCount).toBe(3);
  });

  it('counts empty catches', () => {
    const content = 'try { foo(); } catch (e) {}\ntry { bar(); } catch {}';
    const metrics = analyzeFile('/project/src/index.ts', content);
    expect(metrics.emptyCatchCount).toBe(2);
  });

  it('counts long lines', () => {
    const shortLine = 'const x = 1;';
    const longLine = 'const x = ' + 'a'.repeat(120) + ';';
    const content = `${shortLine}\n${longLine}\n${shortLine}`;
    const metrics = analyzeFile('/project/src/index.ts', content);
    expect(metrics.longLineCount).toBe(1);
  });

  it('tracks test-specific metrics', () => {
    const content = `
describe('MyModule', () => {
  it('handles error case', () => {
    expect(fn()).toThrow();
  });
  it('handles invalid input', () => {
    expect(fn(null)).toBe(false);
  });
  it('works normally', () => {
    expect(fn(1)).toBe(true);
  });
});`;
    const metrics = analyzeFile('/project/tests/my.test.ts', content);
    expect(metrics.isTestFile).toBe(true);
    expect(metrics.testCaseCount).toBe(3);
    expect(metrics.edgeCaseTestCount).toBe(2); // 'error case' and 'invalid input'
    expect(metrics.assertCount).toBe(3);
    expect(metrics.describeCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// rebuildScanFromMetrics unit tests
// ---------------------------------------------------------------------------

describe('rebuildScanFromMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces a valid ScanResult from per-file metrics', () => {
    // Mock fs calls used by rebuildScanFromMetrics
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith('package.json')) return JSON.stringify({ name: 'test-project' });
      if (path.endsWith('tsconfig.json')) return JSON.stringify({ compilerOptions: { strict: true } });
      return '';
    });

    const metrics: Record<string, PerFileMetrics> = {
      '/project/src/a.ts': makeEmptyPerFileMetrics({ lineCount: 50, consoleLogCount: 2 }),
      '/project/src/b.ts': makeEmptyPerFileMetrics({ lineCount: 30, consoleLogCount: 1 }),
      '/project/tests/a.test.ts': makeEmptyPerFileMetrics({
        isTestFile: true, lineCount: 40,
        testCaseCount: 5, assertCount: 10, describeCount: 1, edgeCaseTestCount: 2,
      }),
    };

    const result = rebuildScanFromMetrics(metrics, '/project');

    expect(result.projectName).toBe('test-project');
    expect(result.categories).toHaveLength(6);
    expect(result.maxTotal).toBe(100);
    expect(typeof result.total).toBe('number');
    expect(result.total).toBeGreaterThan(0);

    // Check console.log count aggregated correctly
    const perf = result.categories.find(c => c.name === 'Performance');
    const consoleCleanup = perf?.subcategories.find(s => s.name === 'Console cleanup');
    expect(consoleCleanup?.issuesFound).toBe(3); // 2 + 1
  });

  it('correctly reflects removal of a file', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith('package.json')) return JSON.stringify({ name: 'test' });
      if (path.endsWith('tsconfig.json')) return JSON.stringify({ compilerOptions: { strict: true } });
      return '';
    });

    // Before: 2 source files, one with 5 console.logs
    const metricsBefore: Record<string, PerFileMetrics> = {
      '/project/src/a.ts': makeEmptyPerFileMetrics({ lineCount: 50, consoleLogCount: 5 }),
      '/project/src/b.ts': makeEmptyPerFileMetrics({ lineCount: 30 }),
    };
    const resultBefore = rebuildScanFromMetrics(metricsBefore, '/project');
    const perfBefore = resultBefore.categories.find(c => c.name === 'Performance');
    expect(perfBefore?.subcategories.find(s => s.name === 'Console cleanup')?.issuesFound).toBe(5);

    // After: remove file a.ts (simulating deletion)
    const metricsAfter: Record<string, PerFileMetrics> = {
      '/project/src/b.ts': makeEmptyPerFileMetrics({ lineCount: 30 }),
    };
    const resultAfter = rebuildScanFromMetrics(metricsAfter, '/project');
    const perfAfter = resultAfter.categories.find(c => c.name === 'Performance');
    expect(perfAfter?.subcategories.find(s => s.name === 'Console cleanup')?.issuesFound).toBe(0);
  });
});
