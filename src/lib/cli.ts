/**
 * Shared CLI presentation utilities.
 * Centralises repeated patterns from command files:
 * printHeader, exitWithError, validateInt, loadConfigOrExit.
 */
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';

/** Print a bold command header line, e.g. printHeader('⚙  Ratchet Improve') */
export function printHeader(text: string): void {
  process.stdout.write(chalk.bold(`\n${text}\n`) + '\n');
}

/** Write a red error message to stderr and exit. Never returns. */
export function exitWithError(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

/**
 * Parse and validate an integer CLI option.
 * Exits with a descriptive error on invalid input.
 *
 * @param raw   - raw string value from Commander option
 * @param name  - option name for error messages (e.g. 'agents')
 * @param min   - inclusive minimum (default: 1)
 * @param max   - inclusive maximum (optional)
 */
export function validateInt(raw: string, name: string, min = 1, max?: number): number {
  const value = parseInt(raw, 10);
  if (isNaN(value) || value < 1) {
    exitWithError(`  Invalid --${name} value: ${chalk.bold(raw)}\n  Must be a positive integer.`);
  }
  if (value < min) {
    exitWithError(`  Invalid --${name} value: ${value}\n  Minimum is ${min}.`);
  }
  if (max !== undefined && value > max) {
    exitWithError(`  Too many ${name}: ${value}\n  Maximum is ${max}.`);
  }
  return value;
}

/** Load .ratchet.yml or print a formatted error and exit. */
export function loadConfigOrExit(cwd: string): ReturnType<typeof loadConfig> {
  try {
    return loadConfig(cwd);
  } catch (err) {
    exitWithError('Error loading .ratchet.yml: ' + String(err));
  }
}

/** Return the chalk color function for a severity level. */
export function severityColor(severity: string): typeof chalk.red {
  if (severity === 'high') return chalk.red;
  if (severity === 'medium') return chalk.yellow;
  return chalk.dim;
}
