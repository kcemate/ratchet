import type { TestResult } from '../types.js';
import type { ScanResult } from '../commands/scan.js';
import type { IncrementalScanner } from './scan-cache.js';
import { runTests } from './runner.js';

/**
 * Run tests and incremental scan simultaneously after a successful build.
 * This saves the full scan time (~5-10s) on every successful click by
 * overlapping the scan with test execution.
 */
export async function parallelTestAndScan(
  testCommand: string,
  cwd: string,
  scanner: IncrementalScanner,
  lastScan: ScanResult,
): Promise<{ testResult: TestResult; scanResult: ScanResult }> {
  const [testResult, scanResult] = await Promise.all([
    runTests({ command: testCommand, cwd }),
    scanner.incrementalScan(lastScan),
  ]);

  return { testResult, scanResult };
}
