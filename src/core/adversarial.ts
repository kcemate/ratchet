import { spawn } from 'child_process';
import { readFile, writeFile, access } from 'fs/promises';
import { basename, dirname, join, extname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runTests } from './runner.js';

const execFileAsync = promisify(execFile);

export interface RedTeamResult {
  challenged: boolean;
  testPassed: boolean;
  testFailed: boolean;
  testCode: string;
  reasoning: string;
  rollbackRecommended: boolean;
}

export interface RedTeamConfig {
  model?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 180_000; // 3 minutes

/**
 * RedTeamAgent: after a click lands, tries to write a failing test that catches
 * regressions introduced by the change.
 *
 * If the test fails → the change has a regression → recommend rollback.
 * If the test passes → the change is solid.
 */
export class RedTeamAgent {
  private model: string | undefined;
  private timeout: number;

  constructor(config: RedTeamConfig = {}) {
    this.model = config.model;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  async challenge(
    originalCode: string,
    newCode: string,
    testFile: string,
    cwd: string,
  ): Promise<RedTeamResult> {
    // If there's no behavioral diff, skip
    const diff = computeSimpleDiff(originalCode, newCode);
    if (!diff.trim()) {
      return {
        challenged: false,
        testPassed: false,
        testFailed: false,
        testCode: '',
        reasoning: 'No behavioral change detected between original and new code.',
        rollbackRecommended: false,
      };
    }

    // Check test file exists
    const testFileExists = await fileExists(join(cwd, testFile));
    if (!testFileExists) {
      return {
        challenged: false,
        testPassed: false,
        testFailed: false,
        testCode: '',
        reasoning: `Test file not found: ${testFile}. Skipping adversarial challenge.`,
        rollbackRecommended: false,
      };
    }

    // Read existing test file content
    let existingTests: string;
    try {
      existingTests = await readFile(join(cwd, testFile), 'utf-8');
    } catch {
      return {
        challenged: false,
        testPassed: false,
        testFailed: false,
        testCode: '',
        reasoning: `Could not read test file: ${testFile}`,
        rollbackRecommended: false,
      };
    }

    // Ask the agent to generate a targeted regression test
    const prompt = buildRedTeamPrompt(originalCode, newCode, diff, existingTests, testFile);
    let agentOutput: string;
    try {
      agentOutput = await this.runAgent(prompt, cwd);
    } catch (err: unknown) {
      const error = err as Error;
      return {
        challenged: false,
        testPassed: false,
        testFailed: false,
        testCode: '',
        reasoning: `Agent failed to generate test: ${error.message}`,
        rollbackRecommended: false,
      };
    }

    // Extract the test code from agent output
    const testCode = extractTestCode(agentOutput);
    if (!testCode) {
      return {
        challenged: false,
        testPassed: false,
        testFailed: false,
        testCode: '',
        reasoning: 'Agent did not produce a valid test code block.',
        rollbackRecommended: false,
      };
    }

    const reasoning = extractReasoning(agentOutput);

    // Append the test to the test file, run tests, then restore
    const originalTestContent = existingTests;
    const augmentedContent = existingTests + '\n\n' + testCode + '\n';

    try {
      await writeFile(join(cwd, testFile), augmentedContent, 'utf-8');

      // Run the test suite
      const testResult = await runTests({
        command: `npx vitest run ${testFile}`,
        cwd,
        timeout: this.timeout,
      });

      const testPassed = testResult.passed;
      const testFailed = !testResult.passed;

      return {
        challenged: true,
        testPassed,
        testFailed,
        testCode,
        reasoning,
        rollbackRecommended: testFailed,
      };
    } finally {
      // Always restore the original test file
      await writeFile(join(cwd, testFile), originalTestContent, 'utf-8').catch(() => {});
    }
  }

  private runAgent(prompt: string, cwd: string): Promise<string> {
    const args = ['--print', '--permission-mode', 'bypassPermissions'];
    if (this.model) {
      args.push('--model', this.model);
    }
    args.push(prompt);

    const maxBuffer = 10 * 1024 * 1024;

    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutBuf = '';
      let stderrBuf = '';
      let totalBytes = 0;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.timeout);

      child.stdout.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= maxBuffer) stdoutBuf += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= maxBuffer) stderrBuf += chunk.toString();
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(new Error(`Red team agent error: ${err.message}`));
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);

        if (timedOut) {
          reject(new Error('Red team agent timed out'));
          return;
        }

        const output = [stdoutBuf, stderrBuf].filter(Boolean).join('\n').trim();

        if (code === 0 || output) {
          resolve(output);
          return;
        }

        reject(new Error(`Red team agent exited with code ${code}`));
      });
    });
  }
}

function buildRedTeamPrompt(
  originalCode: string,
  newCode: string,
  diff: string,
  existingTests: string,
  testFile: string,
): string {
  return (
    `You are a RED TEAM test engineer. Your job is to find regressions in code changes.\n\n` +
    `## ORIGINAL CODE (before change):\n\`\`\`\n${originalCode}\n\`\`\`\n\n` +
    `## NEW CODE (after change):\n\`\`\`\n${newCode}\n\`\`\`\n\n` +
    `## DIFF:\n\`\`\`\n${diff}\n\`\`\`\n\n` +
    `## EXISTING TESTS (${testFile}):\n\`\`\`\n${existingTests}\n\`\`\`\n\n` +
    `## INSTRUCTIONS:\n` +
    `1. Analyze the behavioral changes (ignore style-only changes like formatting, renaming, comments)\n` +
    `2. Write ONE targeted test that would FAIL if the change introduced a regression\n` +
    `3. The test should verify the NEW behavior is correct, not just that the old behavior was preserved\n` +
    `4. Use the same test framework and patterns as the existing tests\n` +
    `5. The test must be self-contained and appendable to the existing test file\n\n` +
    `## OUTPUT FORMAT:\n` +
    `First, explain your reasoning in a REASONING: block.\n` +
    `Then output the test code in a single fenced code block:\n\n` +
    `REASONING: <why you're targeting this specific behavior>\n\n` +
    `\`\`\`typescript\n` +
    `// your test code here\n` +
    `\`\`\`\n`
  );
}

/**
 * Compute a simple line-by-line diff between two strings.
 * Strips whitespace-only and comment-only changes to focus on behavioral diffs.
 */
export function computeSimpleDiff(original: string, updated: string): string {
  const origLines = original.split('\n');
  const newLines = updated.split('\n');

  const diffs: string[] = [];
  const maxLen = Math.max(origLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i] ?? '';
    const newLine = newLines[i] ?? '';

    if (normalizeLine(origLine) !== normalizeLine(newLine)) {
      if (i < origLines.length) diffs.push(`- ${origLine}`);
      if (i < newLines.length) diffs.push(`+ ${newLine}`);
    }
  }

  return diffs.join('\n');
}

function normalizeLine(line: string): string {
  // Strip comments and normalize whitespace for comparison
  return line
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '')
    .trim();
}

/**
 * Extract test code from a fenced code block in agent output.
 */
export function extractTestCode(output: string): string {
  const match = output.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : '';
}

/**
 * Extract reasoning from agent output.
 */
export function extractReasoning(output: string): string {
  const match = output.match(/REASONING:\s*([\s\S]*?)(?=```|$)/);
  return match ? match[1].trim() : 'No reasoning provided.';
}

/**
 * Auto-detect the test file for a given source file.
 * Looks for common patterns: foo.test.ts, foo.spec.ts, __tests__/foo.test.ts
 */
export async function detectTestFile(sourceFile: string, cwd: string): Promise<string | undefined> {
  const ext = extname(sourceFile);
  const base = basename(sourceFile, ext);
  const dir = dirname(sourceFile);

  const candidates = [
    // Same directory patterns
    join(dir, `${base}.test${ext}`),
    join(dir, `${base}.spec${ext}`),
    // __tests__ directory
    join(dir, '__tests__', `${base}.test${ext}`),
    join(dir, '__tests__', `${base}.spec${ext}`),
    // tests/ at repo root
    join('tests', `${base}.test${ext}`),
    join('tests', `${base}.spec${ext}`),
    // test/ at repo root
    join('test', `${base}.test${ext}`),
    join('test', `${base}.spec${ext}`),
  ];

  for (const candidate of candidates) {
    if (await fileExists(join(cwd, candidate))) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Get the original code of a file from the previous commit.
 */
export async function getOriginalCode(filepath: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `HEAD~1:${filepath}`], { cwd });
    return stdout;
  } catch {
    return '';
  }
}

async function fileExists(filepath: string): Promise<boolean> {
  try {
    await access(filepath);
    return true;
  } catch {
    return false;
  }
}
