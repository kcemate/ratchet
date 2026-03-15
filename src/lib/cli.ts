/**
 * Shared CLI presentation utilities.
 * Centralises repeated patterns from command files:
 * printHeader, exitWithError, validateInt, loadConfigOrExit,
 * writeOutputFile, printBulletList, withSpinner.
 */
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { writeFile } from 'fs/promises';
import { loadConfig } from '../core/config.js';
import { toErrorMessage } from '../core/utils.js';

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

/**
 * Write content to a file, appending `.md` if the path lacks that extension.
 * Logs the saved path to stdout. Shared by simulate and debate commands.
 */
export async function writeOutputFile(outputPath: string, content: string): Promise<void> {
  const resolved = outputPath.endsWith('.md') ? outputPath : `${outputPath}.md`;
  await writeFile(resolved, content, 'utf-8');
  console.log(`  Report saved: ${chalk.dim(resolved)}\n`);
}

/**
 * Print a block of aligned label : value pairs, e.g.
 *   Topic  : <cyan value>
 *   Agents : <yellow value>
 *
 * Values may already contain chalk colour sequences.
 * Labels are right-padded so colons align automatically.
 *
 * @param fields          - Array of [label, preformatted-value] tuples
 * @param trailingNewline - Emit a blank line after the block (default: true)
 */
export function printFields(
  fields: Array<[string, string]>,
  trailingNewline = true,
): void {
  const width = Math.max(...fields.map(([label]) => label.length));
  for (const [label, value] of fields) {
    process.stdout.write(`  ${label.padEnd(width)} : ${value}\n`);
  }
  if (trailingNewline) process.stdout.write('\n');
}

/**
 * Print a titled bullet list to stdout with a given chalk color function.
 * Shared by simulate, debate, and improve commands.
 *
 * @param title  - bold heading
 * @param items  - array of strings to render as bullets
 * @param color  - chalk color fn applied to the bullet character
 * @param limit  - max items to show (default: 5)
 */
export function printBulletList(
  title: string,
  items: string[],
  color: (s: string) => string,
  limit = 5,
): void {
  if (items.length === 0) return;
  console.log(chalk.bold(`  ${title}`));
  for (const item of items.slice(0, limit)) {
    console.log(`    ${color('•')} ${item}`);
  }
  console.log('');
}

/**
 * Run an async operation inside an ora spinner with unified error handling.
 * The callback receives the spinner so it can call spinner.succeed() on success.
 * On any thrown error, fails the spinner and exits the process.
 *
 * @param text      - initial spinner text
 * @param fn        - async work; receives the Ora spinner instance
 * @param failLabel - short label for spinner.fail() (e.g. 'Debate failed')
 *                    If omitted, the error message is used directly.
 */
export async function withSpinner<T>(
  text: string,
  fn: (spinner: Ora) => Promise<T>,
  failLabel?: string,
): Promise<T> {
  const spinner = ora(text).start();
  try {
    return await fn(spinner);
  } catch (err) {
    const label = failLabel ? `  ${failLabel}` : `  ${toErrorMessage(err)}`;
    spinner.fail(chalk.red(label));
    if (failLabel) {
      console.error(chalk.red(`\n  ${toErrorMessage(err)}`) + '\n');
    }
    process.exit(1);
  }
}
