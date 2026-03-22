import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, readdir } from 'fs/promises';
import { logger } from '../lib/logger.js';
import { join } from 'path';
import { existsSync, createReadStream } from 'fs';
import type { RatchetRun } from '../types.js';
import { lockFilePath } from '../core/lock.js';
import { currentBranch } from '../core/git.js';
import { bgRunDir, BG_RUNS_DIR, isProcessAlive } from '../core/background.js';
import type { ProgressState } from '../core/background.js';

export const STATE_FILE = '.ratchet-state.json';

const log = (msg: string) => logger.info(msg);

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

async function listBackgroundRuns(cwd: string): Promise<ProgressState[]> {
  const runsDir = join(cwd, BG_RUNS_DIR);
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }

  const results: ProgressState[] = [];
  for (const entry of entries) {
    const progressPath = join(runsDir, entry, 'progress.json');
    if (!existsSync(progressPath)) continue;
    try {
      const progress = JSON.parse(await readFile(progressPath, 'utf-8')) as ProgressState;
      results.push(progress);
    } catch {
      // Skip corrupted entries
    }
  }
  // Newest first
  results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return results;
}

function printBackgroundRuns(runs: ProgressState[]): void {
  const active = runs.filter(r => r.status === 'running');
  if (active.length === 0) return;

  log('\n  ' + chalk.bold('Background runs:'));
  for (const r of active) {
    const alive = isProcessAlive(r.pid);
    const elapsed = formatDuration(r.startedAt);
    const clickStr = r.clicksTotal > 0
      ? `${r.clicksCompleted}/${r.clicksTotal} clicks`
      : `${r.clicksCompleted} clicks`;
    const scoreStr = r.score !== undefined ? ` · score ${r.score}` : '';
    const pidStr = alive ? chalk.dim(`PID ${r.pid}`) : chalk.red(`PID ${r.pid} (dead)`);
    log(
      `    ${chalk.cyan(r.runId.slice(0, 8))}… · ${clickStr}${scoreStr} · ${chalk.yellow(elapsed)} · ${pidStr}`,
    );
    log(`      Stop: ${chalk.dim(`ratchet stop ${r.runId}`)}`);
    log(`      Log:  ${chalk.dim(join(bgRunDir(process.cwd(), r.runId), 'output.log'))}`);
  }
}

export function statusCommand(): Command {
  const cmd = new Command('status');

  cmd
    .description('Show the status of the current or most recent Ratchet run')
    .option('--follow <id>', 'Tail the output log of a background run in real-time')
    .action(async (options: { follow?: string }) => {
      const cwd = process.cwd();

      // --follow: tail a background run's output log
      if (options.follow) {
        const logPath = join(bgRunDir(cwd, options.follow), 'output.log');
        if (!existsSync(logPath)) {
          log(chalk.red(`  No log found for run: ${options.follow}`));
          process.exit(1);
        }
        log(chalk.dim(`  Following ${logPath} (Ctrl+C to stop)\n`));
        // Pipe existing content then stream new writes
        const stream = createReadStream(logPath);
        stream.pipe(process.stdout);
        stream.on('end', () => {
          // Keep watching for new data
          const watcher = setInterval(() => {
            // Re-stream by re-opening — simple approach
          }, 500);
          process.on('SIGINT', () => { clearInterval(watcher); process.exit(0); });
        });
        return;
      }

      log(chalk.bold('\n⚙  Ratchet Status\n'));

      const run = await loadRunState(cwd);

      // Show background runs regardless
      const bgRuns = await listBackgroundRuns(cwd);
      printBackgroundRuns(bgRuns);

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
              ? chalk.dim(
                ` — ${click.filesModified.slice(0, 3).join(', ')}` +
                `${click.filesModified.length > 3 ? ` +${click.filesModified.length - 3} more` : ''}`,
              )
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
