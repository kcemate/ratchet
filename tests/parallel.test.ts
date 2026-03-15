import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScanResult } from '../src/commands/scan.js';
import type { TestResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// ESM-compatible top-level mocks
// ---------------------------------------------------------------------------

vi.mock('../src/core/runner.js', () => ({
  runTests: vi.fn(),
}));

import { runTests } from '../src/core/runner.js';
import { parallelTestAndScan } from '../src/core/parallel.js';

const mockRunTests = runTests as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test-project',
    total: 50,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 3,
    issuesByType: [],
    ...overrides,
  };
}

function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    passed: true,
    output: 'All tests passed',
    duration: 1234,
    ...overrides,
  };
}

function makeMockScanner(scanResult: ScanResult) {
  return {
    incrementalScan: vi.fn().mockResolvedValue(scanResult),
    loadCache: vi.fn().mockResolvedValue(null),
    saveCache: vi.fn().mockResolvedValue(undefined),
    needsFullScan: vi.fn().mockReturnValue(false),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parallelTestAndScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs tests and scan concurrently and returns both results', async () => {
    const testResult = makeTestResult();
    const scanResult = makeScan({ total: 60 });
    const lastScan = makeScan({ total: 50 });
    const mockScanner = makeMockScanner(scanResult);

    mockRunTests.mockResolvedValue(testResult);

    const result = await parallelTestAndScan(
      'npm test',
      '/tmp/test-cwd',
      mockScanner as any,
      lastScan,
    );

    expect(result.testResult).toBeDefined();
    expect(result.scanResult).toBeDefined();
    expect(result.testResult.passed).toBe(true);
    expect(result.scanResult.total).toBe(60);
    expect(mockScanner.incrementalScan).toHaveBeenCalledWith(lastScan);
    expect(mockRunTests).toHaveBeenCalledWith({ command: 'npm test', cwd: '/tmp/test-cwd' });
  });

  it('returns failed test result without aborting the scan', async () => {
    const failedTestResult = makeTestResult({ passed: false, output: 'FAIL: 3 tests failed' });
    const scanResult = makeScan({ total: 45 });
    const lastScan = makeScan();
    const mockScanner = makeMockScanner(scanResult);

    mockRunTests.mockResolvedValue(failedTestResult);

    const result = await parallelTestAndScan(
      'npm test',
      '/tmp/test-cwd',
      mockScanner as any,
      lastScan,
    );

    expect(result.testResult.passed).toBe(false);
    expect(result.testResult.output).toBe('FAIL: 3 tests failed');
    expect(result.scanResult.total).toBe(45);
  });

  it('propagates scan errors', async () => {
    const lastScan = makeScan();
    const mockScanner = {
      incrementalScan: vi.fn().mockRejectedValue(new Error('scan failed')),
      loadCache: vi.fn().mockResolvedValue(null),
      saveCache: vi.fn().mockResolvedValue(undefined),
      needsFullScan: vi.fn().mockReturnValue(false),
    };

    mockRunTests.mockResolvedValue(makeTestResult());

    await expect(
      parallelTestAndScan('npm test', '/tmp/test-cwd', mockScanner as any, lastScan),
    ).rejects.toThrow('scan failed');
  });

  it('propagates test runner errors', async () => {
    const lastScan = makeScan();
    const mockScanner = makeMockScanner(makeScan());

    mockRunTests.mockRejectedValue(new Error('test runner crashed'));

    await expect(
      parallelTestAndScan('npm test', '/tmp/test-cwd', mockScanner as any, lastScan),
    ).rejects.toThrow('test runner crashed');
  });

  it('runs tests and scan simultaneously (Promise.all behavior)', async () => {
    const lastScan = makeScan();
    const scanResult = makeScan({ total: 75 });

    let testStarted = false;
    let scanStarted = false;
    let testFinished = false;
    let scanFinished = false;

    const mockScanner = {
      incrementalScan: vi.fn().mockImplementation(async () => {
        scanStarted = true;
        // Simulate scan taking 10ms
        await new Promise(r => setTimeout(r, 10));
        scanFinished = true;
        return scanResult;
      }),
      loadCache: vi.fn().mockResolvedValue(null),
      saveCache: vi.fn().mockResolvedValue(undefined),
      needsFullScan: vi.fn().mockReturnValue(false),
    };

    mockRunTests.mockImplementation(async () => {
      testStarted = true;
      // Simulate tests taking 10ms
      await new Promise(r => setTimeout(r, 10));
      testFinished = true;
      return makeTestResult();
    });

    const result = await parallelTestAndScan(
      'npm test',
      '/tmp/test-cwd',
      mockScanner as any,
      lastScan,
    );

    // Both should have started and finished
    expect(testStarted).toBe(true);
    expect(scanStarted).toBe(true);
    expect(testFinished).toBe(true);
    expect(scanFinished).toBe(true);

    expect(result.testResult.passed).toBe(true);
    expect(result.scanResult.total).toBe(75);
  });
});
