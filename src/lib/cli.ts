/**
 * Shared CLI presentation utilities.
 * Centralises repeated patterns from command files:
 * printHeader, exitWithError, validateInt, loadConfigOrExit,
 * writeOutputFile, printBulletList, withSpinner,
 * warnIfStaleBinary, warnIfDirtyWorktree, formatScoreDelta, renderClickTable.
 */
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { writeFile } from 'fs/promises';
import { loadConfig } from '../core/config.js';
import { toErrorMessage } from '../core/utils.js';
import { checkStaleBinary } from '../core/stale-check.js';
import { status as gitStatus, isRepo } from '../core/git.js';
import type { Click } from '../types.js';
import type { ClickPhase } from '../core/engine.js';

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

/** Warn once if the compiled binary is older than source files. */
export function warnIfStaleBinary(): void {
  const warning = checkStaleBinary();
  if (warning) console.warn(chalk.yellow(`  ${warning}\n`));
}

/**
 * Warn if the working tree has uncommitted changes.
 * Shows up to 3 file names and a stash-safety note.
 */
export async function warnIfDirtyWorktree(cwd: string): Promise<void> {
  const ws = await gitStatus(cwd);
  const allDirty = [...ws.staged, ...ws.unstaged, ...ws.untracked];
  const dirtyFiles = allDirty.length;
  if (dirtyFiles > 0) {
    const fileWord = dirtyFiles === 1 ? 'file' : 'files';
    const shown = allDirty.slice(0, 3).join(', ');
    const extra = dirtyFiles > 3 ? ` +${dirtyFiles - 3} more` : '';
    console.warn(
      chalk.yellow(`  ⚠  Dirty worktree: ${dirtyFiles} uncommitted ${fileWord}`) +
        chalk.dim(` (${shown}${extra}).`) +
        chalk.dim(' Ratchet will stash these before each click and restore them on rollback.\n'),
    );
  }
}

/**
 * Format a score delta as a coloured string, e.g. "+3" (green), "-2" (red), "±0" (dim).
 * @param before - score before the run
 * @param after  - score after the run
 */
export function formatScoreDelta(before: number, after: number): string {
  const delta = after - before;
  if (delta > 0) return chalk.green(`+${delta}`);
  if (delta < 0) return chalk.red(String(delta));
  return chalk.dim('±0');
}

/**
 * Human-readable labels for each ClickPhase, shared by torque and improve commands.
 * Avoids duplicating the map in every file that renders spinner progress.
 */
export const CLICK_PHASE_LABELS: Record<ClickPhase, string> = {
  analyzing: 'analyzing…',
  proposing: 'proposing…',
  building: 'building…',
  testing: 'testing…',
  committing: 'committing…',
};

/**
 * Assert the cwd is inside a git repository.
 * Prints a formatted error and exits if not.
 * Used by commands that REQUIRE git (torque, improve).
 */
export async function assertIsRepo(cwd: string): Promise<void> {
  if (!(await isRepo(cwd))) {
    console.error(
      chalk.red('  Not a git repository.') +
        '\n  Ratchet requires git to track changes and roll back on failure.' +
        '\n\n  ' + chalk.dim('To initialize a git repo:') +
        '\n    ' + chalk.cyan('git init && git add -A && git commit -m "init"') + '\n',
    );
    process.exit(1);
  }
}

/**
 * Warn (but do not exit) if the cwd is not inside a git repository.
 * Used by commands that work without git but advise the user (init).
 */
export async function warnIfNotRepo(cwd: string): Promise<void> {
  if (!(await isRepo(cwd))) {
    console.warn(
      chalk.yellow('  ⚠  Not a git repository.') +
        ' Ratchet requires git to track changes and roll back on failure.\n' +
        '\n  ' + chalk.dim('Initialize git before running ratchet torque:') +
        '\n    ' + chalk.cyan('git init && git add -A && git commit -m "init"') + '\n',
    );
  }
}

/**
 * Print a per-click result table to stdout.
 * Each row shows pass/fail icon, click number, status, commit hash, and modified files.
 */
export function renderClickTable(clicks: Click[]): void {
  if (clicks.length === 0) return;
  console.log('');
  for (const click of clicks) {
    const icon = click.testsPassed ? chalk.green('✓') : chalk.yellow('✗');
    const label = click.testsPassed ? chalk.green('passed') : chalk.yellow('rolled back');
    const hash = click.commitHash
      ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`)
      : '';
    const files =
      click.filesModified.length > 0
        ? chalk.dim(
            ` — ${click.filesModified.slice(0, 2).join(', ')}${click.filesModified.length > 2 ? ` +${click.filesModified.length - 2}` : ''}`,
          )
        : '';
    console.log(`  ${icon} Click ${chalk.bold(String(click.number))}  ${label}${hash}${files}`);
  }
}
