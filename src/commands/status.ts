import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { RatchetRun } from '../types.js';
import { lockFilePath } from '../core/lock.js';
import { currentBranch } from '../core/git.js';

export const STATE_FILE = '.ratchet-state.json';

const log = console.log.bind(console);

export async function loadRunState(cwd: string): Promise<RatchetRun | null> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, STATE_FILE), 'utf-8');
  } catch {
    return null; // File doesn't exist — normal for a fresh repo
  }

  try {
    return JSON.parse(raw) as RatchetRun;
  } catch {
    throw new Error(
      `.ratchet-state.json exists but could not be parsed — the file may be corrupted.\n` +
        `  Delete it to reset: rm .ratchet-state.json`,
    );
  }
}

function formatDuration(startIso: string, endIso?: string): string {
  const ms = (endIso ? new Date(endIso) : new Date()).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function colorStatus(status: RatchetRun['status'], stale = false): string {
  switch (status) {
    case 'running':
      return stale
        ? chalk.red('interrupted ✗') + chalk.dim(' (process died — lock released)')
        : chalk.yellow('running ⏳');
    case 'completed':
      return chalk.green('completed ✓');
    case 'failed':
      return chalk.red('failed ✗');
  }
}

export function statusCommand(): Command {
  const cmd = new Command('status');

  cmd
    .description('Show the status of the current or most recent Ratchet run')
    .action(async () => {
      const cwd = process.cwd();

      log(chalk.bold('\n⚙  Ratchet Status\n'));

      const run = await loadRunState(cwd);

      if (!run) {
        const hasConfig = existsSync(join(cwd, '.ratchet.yml'));
        if (!hasConfig) {
          log(
            chalk.dim('  No runs found and no .ratchet.yml detected.\n') +
              '  Get started:\n' +
              `    ${chalk.cyan('ratchet init')}               — create .ratchet.yml\n` +
              `    ${chalk.cyan('ratchet torque --target <name>')} — start the click loop\n`,
          );
        } else {
          log(
            chalk.dim('  No runs found. Run ') +
              chalk.cyan('ratchet torque --target <name>') +
              chalk.dim(' to start.\n'),
          );
        }
        return;
      }

      const passedClicks = run.clicks.filter((c) => c.testsPassed).length;
      const totalClicks = run.clicks.length;
      const duration = formatDuration(
        run.startedAt as unknown as string,
        run.finishedAt as unknown as string | undefined,
      );

      // A run marked "running" with no active lock means the process was killed.
      const staleRunning = run.status === 'running' && !existsSync(lockFilePath(cwd));

      const branch = await currentBranch(cwd).catch(() => '');

      log(`  Run ID  : ${chalk.dim(run.id)}`);
      if (branch) log(`  Branch  : ${chalk.cyan(branch)}`);
      log(
        `  Target  : ${chalk.cyan(run.target.name)} ${chalk.dim(`(${run.target.path})`)}`,
      );
      if (run.target.description) {
        log(`  Desc    : ${chalk.dim(run.target.description)}`);
      }
      log(`  Status  : ${colorStatus(run.status, staleRunning)}`);
      log(
        `  Clicks  : ${chalk.green(String(passedClicks))} passed / ${totalClicks} total`,
      );
      log(`  Time    : ${chalk.yellow(duration)}`);

      if (run.clicks.length > 0) {
        log('\n  ' + chalk.bold('Click history:'));
        for (const click of run.clicks) {
          const icon = click.testsPassed ? chalk.green('✓') : chalk.red('✗');
          const commit = click.commitHash
            ? chalk.dim(` [${click.commitHash.slice(0, 7)}]`)
            : chalk.dim(' [rolled back]');
          const files =
            click.filesModified.length > 0
              ? chalk.dim(` — ${click.filesModified.slice(0, 3).join(', ')}${click.filesModified.length > 3 ? ` +${click.filesModified.length - 3} more` : ''}`)
              : '';
          log(`    ${icon} Click ${click.number}${commit}${files}`);
        }
      }

      if (run.status === 'completed' && passedClicks > 0) {
        log(
          '\n  ' +
            chalk.dim('Run ') +
            chalk.cyan('ratchet tighten --pr') +
            chalk.dim(' to create a pull request.'),
        );
      }

      log('');
    });

  return cmd;
}
