import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { runTests } from './runner.js';
import type { RatchetConfig } from '../types.js';
import { logger } from '../lib/logger.js';

export interface TestGateResult {
  passed: boolean;
  /** Which gate produced this result */
  gate: 'lint' | 'related' | 'full';
  output: string;
  durationMs: number;
  failedTests: string[];
  unrelatedFailures?: string[];
  landedWithWarning?: boolean;
  warningMessage?: string;
}

export interface BaselineResult {
  failedTests: string[];
  totalTests: number;
  passingTests: number;
}

/**
 * Run progressive validation gates: lint → related tests → full suite.
 *
 * If testIsolation is disabled, falls back to a single full-suite run.
 * Fails fast at each gate. If the full suite fails with only unrelated
 * failures and allowUnrelatedFailures=true, returns passed=true with
 * landedWithWarning=true so the commit can still land.
 */
export async function progressiveGates(
  config: RatchetConfig,
  cwd: string,
  baselineFailures: string[] = [],
): Promise<TestGateResult> {
  const { defaults } = config;
  const testIsolation = defaults.testIsolation ?? false;
  const useProgressiveGates = defaults.progressiveGates ?? false;
  const testCmd = defaults.testCommand;

  // Test isolation disabled — plain full-suite run
  if (!testIsolation) {
    const start = Date.now();
    const result = await runTests({ command: testCmd, cwd });
    return {
      passed: result.passed,
      gate: 'full',
      output: result.output ?? '',
      durationMs: Date.now() - start,
      failedTests: result.passed ? [] : extractFailingTestFiles(result.output ?? ''),
    };
  }

  const lintCmd = defaults.lintCmd ?? 'npx tsc --noEmit';
  const testRelatedCmd = defaults.testRelatedCmd ?? 'npx vitest --related';
  const allowUnrelated = defaults.allowUnrelatedFailures ?? false;
  const changedFiles = getChangedFiles(cwd);

  if (useProgressiveGates) {
    // Gate 1: lint / typecheck
    const lintStart = Date.now();
    logger.info('Gate 1/3: lint/typecheck');
    const lintResult = runCommandSync(lintCmd, cwd);
    const lintDuration = Date.now() - lintStart;
    logger.info({ success: lintResult.success, durationMs: lintDuration }, 'Gate 1/3: lint');

    if (!lintResult.success) {
      return {
        passed: false,
        gate: 'lint',
        output: lintResult.output,
        durationMs: lintDuration,
        failedTests: [],
      };
    }

    // Gate 2: related tests only
    if (changedFiles.length > 0) {
      const relatedStart = Date.now();
      const relatedCmd = `${testRelatedCmd} ${changedFiles.join(' ')}`;
      logger.info({ changedFiles: changedFiles.length }, 'Gate 2/3: related tests');
      const relatedResult = await runTests({ command: relatedCmd, cwd });
      const relatedDuration = Date.now() - relatedStart;
      logger.info({ passed: relatedResult.passed, durationMs: relatedDuration }, 'Gate 2/3: related tests');

      if (!relatedResult.passed) {
        return {
          passed: false,
          gate: 'related',
          output: relatedResult.output ?? '',
          durationMs: relatedDuration,
          failedTests: extractFailingTestFiles(relatedResult.output ?? ''),
        };
      }
    }
  }

  // Final gate: full suite with failure classification
  const gateLabel = useProgressiveGates ? 'Gate 3/3' : 'Gate 1/1';
  const fullStart = Date.now();
  logger.info({ gate: gateLabel }, 'Full test suite');
  const fullResult = await runTests({ command: testCmd, cwd });
  const fullDuration = Date.now() - fullStart;
  logger.info({ gate: gateLabel, passed: fullResult.passed, durationMs: fullDuration }, 'Full suite result');

  if (fullResult.passed) {
    return {
      passed: true,
      gate: 'full',
      output: fullResult.output ?? '',
      durationMs: fullDuration,
      failedTests: [],
    };
  }

  // Full suite failed — classify the failures
  const allFailed = extractFailingTestFiles(fullResult.output ?? '');

  // Exempt pre-existing baseline failures
  const newFailures = allFailed.filter(
    t => !baselineFailures.some(b => b === t || b.endsWith(`/${t}`) || t.endsWith(`/${b}`)),
  );

  if (newFailures.length === 0) {
    logger.info({ count: allFailed.length }, 'All failures are pre-existing baseline');
    return {
      passed: true,
      gate: 'full',
      output: fullResult.output ?? '',
      durationMs: fullDuration,
      failedTests: allFailed,
    };
  }

  const { related: relatedFailures, unrelated: unrelatedFailures } = classifyFailures(changedFiles, newFailures, cwd);

  if (relatedFailures.length > 0) {
    return {
      passed: false,
      gate: 'full',
      output: fullResult.output ?? '',
      durationMs: fullDuration,
      failedTests: newFailures,
      unrelatedFailures,
    };
  }

  // All new failures are unrelated to our changes
  if (allowUnrelated && unrelatedFailures.length > 0) {
    const warningMessage = `Landed with unrelated test failures (${unrelatedFailures.join(', ')})`;
    logger.warn(warningMessage);
    return {
      passed: true,
      gate: 'full',
      output: fullResult.output ?? '',
      durationMs: fullDuration,
      failedTests: newFailures,
      unrelatedFailures,
      landedWithWarning: true,
      warningMessage,
    };
  }

  return {
    passed: false,
    gate: 'full',
    output: fullResult.output ?? '',
    durationMs: fullDuration,
    failedTests: newFailures,
    unrelatedFailures,
  };
}

/**
 * Classify failing test files as related or unrelated to the changed source files.
 */
export function classifyFailures(
  changedFiles: string[],
  failedTests: string[],
  cwd: string = '.',
): { related: string[]; unrelated: string[] } {
  const related: string[] = [];
  const unrelated: string[] = [];
  for (const test of failedTests) {
    if (isUnrelatedFailure(test, changedFiles, cwd)) {
      unrelated.push(test);
    } else {
      related.push(test);
    }
  }
  return { related, unrelated };
}

/**
 * Capture baseline test suite state before any changes.
 * Records pre-existing failures so they can be exempted from rollback decisions.
 */
export async function captureBaseline(testCmd: string, cwd: string): Promise<BaselineResult> {
  logger.info('Capturing baseline test suite state');
  const result = await runTests({ command: testCmd, cwd });
  const failedTests = extractFailingTestFiles(result.output ?? '');

  // Try to extract total test count from runner output
  const totalMatch = result.output?.match(/(\d+)\s+(?:tests?|specs?)\b/i);
  const totalTests = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  const passingTests = Math.max(0, totalTests - failedTests.length);

  if (failedTests.length > 0) {
    logger.info({ failureCount: failedTests.length, passingTests, totalTests }, 'Baseline pre-existing failures');
    for (const f of failedTests) {
      logger.info({ file: f }, 'Pre-existing failure');
    }
  } else {
    logger.info('Baseline: all tests passing');
  }

  return { failedTests, totalTests, passingTests };
}

/**
 * Check if a failed test file is unrelated to the changed source files.
 * Returns true if the test does NOT import any of the changed files.
 * Errs on the side of caution (returns false) when the test file cannot be read.
 */
export function isUnrelatedFailure(
  failedTest: string,
  changedFiles: string[],
  cwd: string = '.',
): boolean {
  if (changedFiles.length === 0) return false;

  try {
    const testFilePath = resolveTestFile(failedTest, cwd);
    if (!testFilePath) return true; // can't locate file — assume unrelated

    const content = readFileSync(testFilePath, 'utf-8');

    // Collect import/require lines
    const importLines = content
      .split('\n')
      .filter(line => /^\s*(?:import|(?:const|let|var)\s+.+=\s*require)\b/.test(line) || /\bfrom\s+['"]/.test(line));

    for (const changedFile of changedFiles) {
      // Normalize: strip leading ./ and extension
      const normalized = changedFile.replace(/^\.\//, '').replace(/\.[^/.]+$/, '');
      const baseName = normalized.split('/').pop() ?? normalized;

      for (const line of importLines) {
        if (line.includes(baseName)) {
          return false; // test imports this changed file → related
        }
      }
    }

    return true; // no matching imports found → unrelated
  } catch {
    return false; // can't read — assume related (conservative)
  }
}

/**
 * Get list of changed files (staged + unstaged) from git diff.
 */
export function getChangedFiles(cwd: string): string[] {
  try {
    const staged = execSync('git diff --name-only --cached', { cwd, encoding: 'utf8' }).trim();
    const unstaged = execSync('git diff --name-only', { cwd, encoding: 'utf8' }).trim();
    const combined = [staged, unstaged].filter(Boolean).join('\n');
    return combined ? [...new Set(combined.split('\n').filter(Boolean))] : [];
  } catch {
    return [];
  }
}

/**
 * Extract failing test file basenames from test runner output.
 * Handles Vitest/Jest "FAIL path/to/file.test.ts" patterns.
 */
export function extractFailingTestFiles(output: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const line of output.split('\n')) {
    const m = line.match(/(?:^|\s)(?:FAIL|×)\s+([\w./\\-]+\.(?:test|spec)\.[a-z]+)/i);
    if (m) {
      const name = m[1].split(/[/\\]/).pop() ?? m[1];
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  return names;
}

/**
 * Resolve a test file name to its full path on disk.
 */
function resolveTestFile(testName: string, cwd: string): string | null {
  if (testName.includes('/') || testName.includes('\\')) {
    const full = resolve(cwd, testName);
    try {
      readFileSync(full);
      return full;
    } catch {
      return null;
    }
  }

  for (const dir of ['src/__tests__', '__tests__', 'test', 'tests', 'src']) {
    const full = join(cwd, dir, testName);
    try {
      readFileSync(full);
      return full;
    } catch {
      // try next
    }
  }

  return null;
}

/**
 * Run a shell command synchronously and return success + combined output.
 */
function runCommandSync(cmd: string, cwd: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf8', timeout: 120_000, stdio: 'pipe' });
    return { success: true, output: typeof output === 'string' ? output : '' };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
    return { success: false, output };
  }
}
