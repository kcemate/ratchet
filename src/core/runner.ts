import { spawn } from 'child_process';
import type { TestResult, RunnerOptions } from '../types.js';

const DEFAULT_TIMEOUT = 120_000; // 2 minutes

export async function runTests(options: RunnerOptions): Promise<TestResult> {
  const { command, cwd, timeout = DEFAULT_TIMEOUT } = options;
  const start = Date.now();

  const parts = parseCommand(command);
  if (parts.length === 0) {
    const friendlyMessage =
      `Test command is empty or invalid: ${JSON.stringify(command)}\n` +
      `  Set a valid test_command in .ratchet.yml (e.g. test_command: npm test)`;
    return {
      passed: false,
      output: friendlyMessage,
      duration: 0,
      error: friendlyMessage,
    };
  }
  const [bin, ...args] = parts;

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let totalBytes = 0;
    const maxBuffer = 10 * 1024 * 1024; // 10MB
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);

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
      const duration = Date.now() - start;
      if (err.code === 'ENOENT') {
        const friendlyMessage =
          `Test command not found: \`${bin}\`\n` +
          `  Make sure \`${bin}\` is installed and available in your PATH.\n` +
          `  Check the test_command setting in .ratchet.yml`;
        resolve({ passed: false, output: friendlyMessage, duration, error: friendlyMessage });
      } else {
        resolve({ passed: false, output: err.message, duration, error: err.message });
      }
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      const duration = Date.now() - start;
      const output = [stdoutBuf, stderrBuf].filter(Boolean).join('\n');

      if (timedOut) {
        resolve({ passed: false, output, duration, error: `Test command timed out after ${timeout}ms` });
        return;
      }

      resolve({ passed: code === 0, output, duration, error: code !== 0 ? `Exited with code ${code}` : undefined });
    });
  });
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
