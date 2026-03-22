/**
 * parallel.ts — Multi-spec parallel execution for Ratchet
 *
 * Runs DIFFERENT tasks simultaneously (vs. swarm which races agents on the SAME task).
 * Each task gets its own git worktree. A semaphore limits concurrency to `maxWorkers`.
 * After all tasks complete, results are merged to main in scoreDelta order (best first).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { mkdirSync, existsSync, symlinkSync, readFileSync, rmSync } from 'fs';
import { readFile } from 'fs/promises';
import { logger } from '../lib/logger.js';
import chalk from 'chalk';

const execFileAsync = promisify(execFile);
const log = logger;

// ─── Types

export interface ParallelTask {
  id: string;
  spec?: string;
  target?: string;
  mode: 'normal' | 'harden' | 'feature';
  clicks: number;
}

export interface ParallelConfig {
  maxWorkers: number;
  tasks: ParallelTask[];
  model?: string;
  guards?: string;
  debate?: boolean;
  strategy?: boolean;
}

export interface ParallelResult {
  tasks: ParallelTaskResult[];
  totalWallTimeMs: number;
  totalClicks: number;
  totalLanded: number;
  totalRolledBack: number;
  scoreBefore: number;
  scoreAfter: number;
}

export interface ParallelTaskResult {
  taskId: string;
  status: 'completed' | 'failed' | 'timeout';
  scoreDelta: number;
  clicksLanded: number;
  clicksTotal: number;
  error?: string;
  wallTimeMs: number;
}

// ─── Semaphore (worker pool)

export interface WorkerPool {
  acquire(): Promise<() => void>;
}

export function createWorkerPool(maxWorkers: number): WorkerPool {
  let running = 0;
  const queue: Array<() => void> = [];

  return {
    async acquire(): Promise<() => void> {
      return new Promise<() => void>((resolve) => {
        const tryAcquire = () => {
          if (running < maxWorkers) {
            running++;
            resolve(() => {
              running--;
              if (queue.length > 0) {
                const next = queue.shift();
                if (next) next();
              }
            });
          } else {
            queue.push(tryAcquire);
          }
        };
        tryAcquire();
      });
    },
  };
}

// ─── Git helpers

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

// ─── Specs-file parser

/**
 * Parse a markdown file where each `## ` heading defines a separate task spec.
 *
 * ```markdown
 * ## Add user authentication
 * JWT-based auth with refresh tokens...
 *
 * ## Add caching layer
 * Redis caching for hot endpoints...
 * ```
 */
export function parseSpecsFile(content: string): string[] {
  const lines = content.split('\n');
  const specs: string[] = [];
  let current: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inSection && current.length > 0) {
        specs.push(current.join('\n').trim());
      }
      // Start a new section — include the heading as the first line of the spec
      current = [line];
      inSection = true;
    } else if (inSection) {
      current.push(line);
    }
  }

  // Push the last section
  if (inSection && current.length > 0) {
    specs.push(current.join('\n').trim());
  }

  return specs.filter((s) => s.length > 0);
}

/**
 * Load and parse a specs file, returning ParallelTask objects.
 */
export async function loadSpecsFile(
  filePath: string,
  mode: 'normal' | 'harden' | 'feature',
  clicks: number,
): Promise<ParallelTask[]> {
  const content = await readFile(filePath, 'utf-8');
  const specs = parseSpecsFile(content);

  return specs.map((spec, i) => {
    // Extract title from the ## heading
    const firstLine = spec.split('\n')[0] ?? '';
    const title = firstLine.startsWith('## ') ? firstLine.slice(3).trim() : `task-${i + 1}`;

    return {
      id: `specs-${i + 1}-${title.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
      spec,
      mode,
      clicks,
    };
  });
}

// ─── Task executor

/**
 * Run a single ParallelTask in its own git worktree.
 * Returns the result including scoreDelta, clicks landed, and wall time.
 */
export async function executeParallelTask(
  task: ParallelTask,
  worktreePath: string,
  mainCwd: string,
  config: ParallelConfig,
): Promise<ParallelTaskResult> {
  const start = Date.now();

  try {
    // Lazy-import engines to avoid circular deps at module load time
    const { runEngine } = await import('./engine.js');
    const { runFeatureEngine } = await import('./engine-feature.js');
    const { ShellAgent } = await import('./agents/shell.js');
    const { loadConfig } = await import('./config.js');
    const { runScan } = await import('../commands/scan.js');

    // Load ratchet config from main cwd (synchronous)
    const ratchetConfig = loadConfig(mainCwd);

    // Override model if specified
    if (config.model) {
      ratchetConfig.model = config.model;
    }

    const agent = new ShellAgent({ model: ratchetConfig.model, cwd: worktreePath });

    // Find or build target
    let target = ratchetConfig.targets[0] ?? {
      name: task.id,
      path: '.',
      description: task.spec ?? task.target ?? 'Parallel task',
    };

    if (task.target) {
      const found = ratchetConfig.targets.find((t) => t.name === task.target);
      if (found) target = found;
    }

    // Scan before (in worktree)
    let scoreBefore = 0;
    try {
      const scan = await runScan(worktreePath);
      scoreBefore = scan.total;
    } catch {
      // Non-fatal
    }

    let clicksLanded = 0;
    let clicksTotal = 0;

    if (task.mode === 'feature' && task.spec) {
      const featureRun = await runFeatureEngine({
        target,
        clicks: task.clicks,
        config: ratchetConfig,
        cwd: worktreePath,
        agent,
        spec: task.spec,
        createBranch: false,
        noStrategy: config.strategy === false,
      });
      clicksLanded = featureRun.clicks.filter((c) => c.testsPassed).length;
      clicksTotal = featureRun.clicks.length;
    } else {
      const hardenMode = task.mode === 'harden';
      const run = await runEngine({
        target,
        clicks: task.clicks,
        config: ratchetConfig,
        cwd: worktreePath,
        agent,
        createBranch: false,
        hardenMode,
        noStrategy: config.strategy === false,
      });
      clicksLanded = run.clicks.filter((c) => c.testsPassed).length;
      clicksTotal = run.clicks.length;
    }

    // Scan after
    let scoreAfter = scoreBefore;
    try {
      const scan = await runScan(worktreePath);
      scoreAfter = scan.total;
    } catch {
      // Non-fatal
    }

    return {
      taskId: task.id,
      status: 'completed',
      scoreDelta: scoreAfter - scoreBefore,
      clicksLanded,
      clicksTotal,
      wallTimeMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ taskId: task.id, err }, 'parallel: task failed');
    return {
      taskId: task.id,
      status: 'failed',
      scoreDelta: 0,
      clicksLanded: 0,
      clicksTotal: task.clicks,
      error,
      wallTimeMs: Date.now() - start,
    };
  }
}

// ─── Merge logic

/**
 * Get list of files changed in a worktree relative to HEAD.
 */
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  try {
    const committed = await git(['diff', '--name-only', 'HEAD~1', 'HEAD'], worktreePath).catch(() => '');
    const unstaged = await git(['diff', '--name-only'], worktreePath).catch(() => '');
    const staged = await git(['diff', '--name-only', '--cached'], worktreePath).catch(() => '');

    return [...new Set([
      ...committed.split('\n'),
      ...unstaged.split('\n'),
      ...staged.split('\n'),
    ])].filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Attempt auto-resolution of merge conflicts using git's merge strategies.
 * Falls back to ours/theirs for binary files.
 */
export async function resolveConflicts(
  files: string[],
  worktreePath: string,
  mainCwd: string,
): Promise<{ resolved: string[]; skipped: string[] }> {
  const resolved: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    try {
      // Try to get the worktree version of the file
      const src = join(worktreePath, file);
      const dst = join(mainCwd, file);

      if (!existsSync(src)) {
        skipped.push(file);
        continue;
      }

      // Check if there's a conflict in the destination
      const content = readFileSync(dst, 'utf-8');
      if (content.includes('<<<<<<<') && content.includes('>>>>>>>')) {
        // Conflict: prefer the worktree version (theirs)
        const { copyFile } = await import('fs/promises');
        const { mkdirSync: mkdir } = await import('fs');
        const { dirname } = await import('path');
        mkdir(dirname(dst), { recursive: true });
        await copyFile(src, dst);
        resolved.push(file);
        log.info({ file }, 'parallel: auto-resolved conflict (took worktree version)');
      } else {
        resolved.push(file);
      }
    } catch (err) {
      log.warn({ file, err }, 'parallel: could not resolve conflict');
      skipped.push(file);
    }
  }

  return { resolved, skipped };
}

/**
 * Merge a task's worktree result into the main cwd.
 * Copies changed files from the worktree to main.
 * Returns true if merge succeeded, false if skipped.
 */
export async function mergeTaskResult(
  worktreePath: string,
  mainCwd: string,
  taskId: string,
): Promise<{ success: boolean; conflicts: string[]; merged: string[] }> {
  const changedFiles = await getChangedFiles(worktreePath);

  if (changedFiles.length === 0) {
    log.info({ taskId }, 'parallel: no changes to merge');
    return { success: true, conflicts: [], merged: [] };
  }

  const { copyFile } = await import('fs/promises');
  const { mkdirSync: mkdir } = await import('fs');
  const { dirname } = await import('path');

  const merged: string[] = [];
  const conflicts: string[] = [];

  for (const file of changedFiles) {
    const src = join(worktreePath, file);
    const dst = join(mainCwd, file);

    try {
      mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
      merged.push(file);
    } catch (err) {
      log.warn({ file, taskId, err }, 'parallel: merge conflict on file');
      conflicts.push(file);
    }
  }

  if (conflicts.length > 0) {
    const { resolved, skipped } = await resolveConflicts(conflicts, worktreePath, mainCwd);
    log.info({ taskId, resolved: resolved.length, skipped: skipped.length }, 'parallel: conflict resolution');
    return { success: skipped.length === 0, conflicts: skipped, merged: [...merged, ...resolved] };
  }

  return { success: true, conflicts: [], merged };
}

// ─── Worktree management

async function createWorktree(mainCwd: string, worktreeDir: string, taskId: string): Promise<string> {
  const safeName = taskId.replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
  const worktreePath = join(worktreeDir, `parallel-${Date.now()}-${safeName}`);
  const branchName = `ratchet-parallel-${Date.now()}-${safeName}`;

  await git(['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], mainCwd);

  // Symlink node_modules
  const srcModules = join(mainCwd, 'node_modules');
  const dstModules = join(worktreePath, 'node_modules');
  if (existsSync(srcModules) && !existsSync(dstModules)) {
    symlinkSync(srcModules, dstModules, 'junction');
  }

  return worktreePath;
}

async function removeWorktree(worktreePath: string, mainCwd: string): Promise<void> {
  try {
    let branchName: string | undefined;
    try {
      branchName = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
    } catch {
      // Worktree may already be gone
    }

    await git(['worktree', 'remove', '--force', worktreePath], mainCwd);

    if (branchName && branchName.startsWith('ratchet-parallel-')) {
      await git(['branch', '-D', branchName], mainCwd).catch(() => {});
    }
  } catch {
    try {
      rmSync(worktreePath, { recursive: true, force: true });
      await git(['worktree', 'prune'], mainCwd).catch(() => {});
    } catch {
      // Truly best-effort
    }
  }
}

// ─── Progress display

interface TaskDisplayState {
  task: ParallelTask;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  result?: ParallelTaskResult;
  startedAt?: number;
}

function renderParallelTable(
  states: TaskDisplayState[],
  maxWorkers: number,
  totalTasks: number,
): void {
  // Clear previous output (N+3 lines)
  const lineCount = states.length + 3;
  process.stdout.write(`\x1B[${lineCount}A\x1B[J`);

  process.stdout.write(chalk.bold(`⚡ Parallel execution (${maxWorkers} workers, ${totalTasks} tasks)\n\n`));

  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const idx = `[${i + 1}/${totalTasks}]`;
    const label = (s.task.spec
      ? (s.task.spec.split('\n')[0] ?? '').replace(/^##\s*/, '')
      : (s.task.target ?? s.task.id)
    ).slice(0, 30).padEnd(30);

    if (s.status === 'waiting') {
      process.stdout.write(`  ${chalk.dim(idx)} ${chalk.dim(label)} ${chalk.dim('░'.repeat(10))} waiting...\n`);
    } else if (s.status === 'running') {
      const elapsed = s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0;
      process.stdout.write(
        `  ${chalk.yellow(idx)} ${chalk.white(label)} ` +
        `${chalk.yellow('█'.repeat(5) + '░'.repeat(5))} running ${elapsed}s...\n`,
      );
    } else if (s.status === 'completed' && s.result) {
      const delta = s.result.scoreDelta;
      const deltaStr = delta > 0
        ? chalk.green(`+${delta}pts`)
        : delta < 0
        ? chalk.red(`${delta}pts`)
        : chalk.dim('±0pts');
      const bar = chalk.green('█'.repeat(10));
      process.stdout.write(
        `  ${chalk.green(idx)} ${chalk.white(label)} ${bar} ` +
        `${s.result.clicksLanded}/${s.result.clicksTotal} clicks  ${deltaStr}  ✓\n`,
      );
    } else if (s.status === 'failed' && s.result) {
      const errPreview = (s.result.error ?? 'error').slice(0, 40);
      process.stdout.write(
        `  ${chalk.red(idx)} ${chalk.white(label)} ${chalk.red('░'.repeat(10))} ✗ ${chalk.dim(errPreview)}\n`,
      );
    }
  }

  process.stdout.write('\n');
}

function initParallelDisplay(states: TaskDisplayState[], maxWorkers: number, totalTasks: number): void {
  process.stdout.write(chalk.bold(`⚡ Parallel execution (${maxWorkers} workers, ${totalTasks} tasks)\n\n`));
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const idx = `[${i + 1}/${totalTasks}]`;
    const label = (s.task.spec
      ? (s.task.spec.split('\n')[0] ?? '').replace(/^##\s*/, '')
      : (s.task.target ?? s.task.id)
    ).slice(0, 30).padEnd(30);
    process.stdout.write(`  ${chalk.dim(idx)} ${chalk.dim(label)} ${chalk.dim('░'.repeat(10))} waiting...\n`);
  }
  process.stdout.write('\n');
}

// ─── Main entry point

/**
 * Run multiple tasks in parallel, up to `maxWorkers` concurrently.
 * Each task runs in its own git worktree. Results are merged in order of
 * best scoreDelta first to minimize conflicts.
 */
export async function runParallel(config: ParallelConfig, cwd: string): Promise<ParallelResult> {
  const wallStart = Date.now();
  const worktreeDir = '/tmp/ratchet-parallel';
  const { runScan } = await import('../commands/scan.js');

  if (!existsSync(worktreeDir)) {
    mkdirSync(worktreeDir, { recursive: true });
  }

  // Scan before
  let scoreBefore = 0;
  try {
    const scan = await runScan(cwd);
    scoreBefore = scan.total;
  } catch {
    // Non-fatal
  }

  const pool = createWorkerPool(config.maxWorkers);
  const worktrees: Map<string, string> = new Map(); // taskId → worktreePath

  // Set up display state
  const displayStates: TaskDisplayState[] = config.tasks.map((task) => ({
    task,
    status: 'waiting',
  }));
  const isInteractive = process.stdout.isTTY;

  if (isInteractive) {
    initParallelDisplay(displayStates, config.maxWorkers, config.tasks.length);
  } else {
    process.stdout.write(
      chalk.bold(`⚡ Parallel execution (${config.maxWorkers} workers, ${config.tasks.length} tasks)\n`),
    );
  }

  // Kick off all tasks (pool throttles concurrency)
  const taskPromises = config.tasks.map(async (task, idx) => {
    const release = await pool.acquire();

    // Create worktree
    let worktreePath: string;
    try {
      worktreePath = await createWorktree(cwd, worktreeDir, task.id);
      worktrees.set(task.id, worktreePath);
    } catch (err) {
      release();
      const error = err instanceof Error ? err.message : String(err);
      log.error({ taskId: task.id, err }, 'parallel: failed to create worktree');

      displayStates[idx] = { ...displayStates[idx], status: 'failed', result: {
        taskId: task.id, status: 'failed', scoreDelta: 0,
        clicksLanded: 0, clicksTotal: task.clicks, error, wallTimeMs: 0,
      }};
      if (isInteractive) renderParallelTable(displayStates, config.maxWorkers, config.tasks.length);
      else process.stdout.write(`  ✗ ${task.id}: worktree creation failed — ${error}\n`);

      return {
        taskId: task.id, status: 'failed' as const, scoreDelta: 0,
        clicksLanded: 0, clicksTotal: task.clicks, error, wallTimeMs: 0,
      } satisfies ParallelTaskResult;
    }

    displayStates[idx] = { ...displayStates[idx], status: 'running', startedAt: Date.now() };
    if (isInteractive) renderParallelTable(displayStates, config.maxWorkers, config.tasks.length);
    else process.stdout.write(`  ▶ Starting task: ${task.id}\n`);

    try {
      const result = await executeParallelTask(task, worktreePath, cwd, config);

      displayStates[idx] = {
        ...displayStates[idx], status: result.status === 'completed' ? 'completed' : 'failed', result,
      };
      if (isInteractive) renderParallelTable(displayStates, config.maxWorkers, config.tasks.length);
      else {
        const statusIcon = result.status === 'completed' ? '✓' : '✗';
        const deltaStr = result.scoreDelta >= 0 ? `+${result.scoreDelta}` : String(result.scoreDelta);
        process.stdout.write(
          `  ${statusIcon} ${task.id}: ${result.clicksLanded}/${result.clicksTotal} clicks ${deltaStr}pts\n`,
        );
      }

      return result;
    } finally {
      release();
    }
  });

  const settled = await Promise.allSettled(taskPromises);
  const taskResults: ParallelTaskResult[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      taskId: config.tasks[i]!.id,
      status: 'failed',
      scoreDelta: 0,
      clicksLanded: 0,
      clicksTotal: config.tasks[i]!.clicks,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      wallTimeMs: 0,
    } satisfies ParallelTaskResult;
  });

  // Merge results: sort by highest scoreDelta first to minimize conflicts
  process.stdout.write('\n' + chalk.bold('  📥 Merging results...\n'));

  const successful = taskResults
    .filter((r) => r.status === 'completed' && r.scoreDelta >= 0)
    .sort((a, b) => b.scoreDelta - a.scoreDelta);

  for (const result of successful) {
    const worktreePath = worktrees.get(result.taskId);
    if (!worktreePath) continue;

    try {
      const { success, conflicts, merged } = await mergeTaskResult(worktreePath, cwd, result.taskId);
      if (merged.length > 0) {
        process.stdout.write(`  ✓ Merged ${result.taskId} (${merged.length} files)\n`);
      }
      if (!success && conflicts.length > 0) {
        process.stdout.write(`  ⚠ ${result.taskId}: ${conflicts.length} unresolvable conflict(s) — skipped\n`);
      }
    } catch (err) {
      process.stdout.write(
        `  ✗ Failed to merge ${result.taskId}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  // Cleanup all worktrees
  for (const [taskId, worktreePath] of worktrees) {
    await removeWorktree(worktreePath, cwd).catch(() => {
      log.warn({ taskId }, 'parallel: worktree cleanup failed');
    });
  }

  // Scan after
  let scoreAfter = scoreBefore;
  try {
    const scan = await runScan(cwd);
    scoreAfter = scan.total;
  } catch {
    // Non-fatal
  }

  const totalClicks = taskResults.reduce((s, r) => s + r.clicksTotal, 0);
  const totalLanded = taskResults.reduce((s, r) => s + r.clicksLanded, 0);
  const totalRolledBack = totalClicks - totalLanded;

  return {
    tasks: taskResults,
    totalWallTimeMs: Date.now() - wallStart,
    totalClicks,
    totalLanded,
    totalRolledBack,
    scoreBefore,
    scoreAfter,
  };
}

// ─── Report builder

export function buildParallelReport(result: ParallelResult): string {
  const lines: string[] = [];
  const delta = result.scoreAfter - result.scoreBefore;
  const deltaStr = delta > 0 ? chalk.green(`+${delta}`) : delta < 0 ? chalk.red(String(delta)) : chalk.dim('±0');

  lines.push(chalk.bold('\n  ⚡ Parallel Execution Summary'));
  lines.push(`\n  Score:         ${result.scoreBefore} → ${result.scoreAfter} (${deltaStr})`);
  lines.push(`  Wall time:     ${(result.totalWallTimeMs / 1000).toFixed(1)}s`);
  lines.push(`  Clicks:        ${result.totalLanded}/${result.totalClicks} landed`);
  if (result.totalRolledBack > 0) {
    lines.push(`  Rolled back:   ${result.totalRolledBack}`);
  }

  const completed = result.tasks.filter((t) => t.status === 'completed');
  const failed = result.tasks.filter((t) => t.status === 'failed');

  lines.push(`\n  Tasks:         ${completed.length} completed, ${failed.length} failed\n`);

  if (result.tasks.length > 0) {
    lines.push(chalk.bold('  Per-task breakdown:\n'));
    lines.push(`  ${'Task'.padEnd(40)} ${'Status'.padEnd(12)} ${'Clicks'.padEnd(12)} Delta`);
    lines.push(`  ${'─'.repeat(70)}`);

    for (const task of result.tasks) {
      const deltaStr2 = task.scoreDelta > 0
        ? chalk.green(`+${task.scoreDelta}pts`)
        : task.scoreDelta < 0
        ? chalk.red(`${task.scoreDelta}pts`)
        : chalk.dim('±0pts');
      const status = task.status === 'completed'
        ? chalk.green('✓ done')
        : chalk.red('✗ failed');
      lines.push(
        `  ${task.taskId.slice(0, 40).padEnd(40)} ${status.padEnd(12)} ` +
        `${`${task.clicksLanded}/${task.clicksTotal}`.padEnd(12)} ${deltaStr2}`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
