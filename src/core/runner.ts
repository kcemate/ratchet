import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TestResult, RunnerOptions } from '../types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 120_000; // 2 minutes

export async function runTests(options: RunnerOptions): Promise<TestResult> {
  const { command, cwd, timeout = DEFAULT_TIMEOUT } = options;
  const start = Date.now();

  const [bin, ...args] = parseCommand(command);

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env },
    });
    const duration = Date.now() - start;
    return {
      passed: true,
      output: [stdout, stderr].filter(Boolean).join('\n'),
      duration,
    };
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };

    // Binary not found — give a clear, actionable message instead of the raw ENOENT
    if (error.code === 'ENOENT') {
      const friendlyMessage =
        `Test command not found: \`${bin}\`\n` +
        `  Make sure \`${bin}\` is installed and available in your PATH.\n` +
        `  Check the test_command setting in .ratchet.yml`;
      return {
        passed: false,
        output: friendlyMessage,
        duration,
        error: friendlyMessage,
      };
    }

    const output = [error.stdout, error.stderr].filter(Boolean).join('\n');
    return {
      passed: false,
      output,
      duration,
      error: error.message,
    };
  }
}

export function parseCommand(command: string): string[] {
  // Simple shell-style split: handles quoted strings
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === ' ' && !inSingle && !inDouble) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export async function detectTestCommand(cwd: string): Promise<string> {
  const { existsSync } = await import('fs');
  const { join } = await import('path');

  if (existsSync(join(cwd, 'package.json'))) {
    return 'npm test';
  }
  if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml'))) {
    return 'pytest';
  }
  if (existsSync(join(cwd, 'Makefile'))) {
    return 'make test';
  }
  if (existsSync(join(cwd, 'go.mod'))) {
    return 'go test ./...';
  }
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    return 'cargo test';
  }
  return 'npm test';
}
