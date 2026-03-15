import { Command } from 'commander';
import chalk from 'chalk';
import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { loadRun, loadLatestRun, listRuns } from '../core/history.js';
import { generateReport } from '../core/report.js';
import { generatePDF } from '../core/pdf-report.js';
import { runScan } from './scan.js';
import type { RatchetRun } from '../types.js';
import type { ScanResult } from './scan.js';

const execFileAsync = promisify(execFile);

function formatDate(date: Date | string): string {
  const d = new Date(date as string);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function scoreArrow(before?: ScanResult, after?: ScanResult): string {
  if (before && after) {
    return `${before.total} → ${after.total}`;
  }
  if (after) return String(after.total);
  if (before) return String(before.total);
  return '—';
}

function renderList(entries: Awaited<ReturnType<typeof listRuns>>): void {
  if (entries.length === 0) {
    process.stdout.write(chalk.dim('  No runs found.') + '\n');
    return;
  }

  const colId = 26;
  const colTarget = 10;
  const colClicks = 8;
  const colScore = 12;

  const header = [
    'ID'.padEnd(colId),
    'Target'.padEnd(colTarget),
    'Clicks'.padEnd(colClicks),
    'Score'.padEnd(colScore),
    'Date',
  ].join('  ');

  process.stdout.write('\n' + chalk.bold('⚙  Ratchet Run History') + '\n\n  ' + chalk.dim(header) + '\n  ' + chalk.dim('─'.repeat(header.length)) + '\n');

  for (const entry of entries) {
    const { run, scoreBefore, scoreAfter } = entry;
    const passed = run.clicks.filter((c) => c.testsPassed).length;
    const total = run.clicks.length;
    const score = scoreArrow(scoreBefore, scoreAfter);
    const date = formatDate(entry.savedAt);

    const row = [
      run.id.slice(0, colId - 1).padEnd(colId),
      run.target.name.slice(0, colTarget - 1).padEnd(colTarget),
      `${passed}/${total}`.padEnd(colClicks),
      score.padEnd(colScore),
      date,
    ].join('  ');

    console.log('  ' + row);
  }

  console.log('');
}

async function openFile(filePath: string): Promise<void> {
  const platform = process.platform;
  const opener = platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    await execFileAsync(opener, [filePath]);
  } catch {
    // Non-fatal — file may still have been generated successfully
  }
}

export function reportCommand(): Command {
  const cmd = new Command('report');

  cmd
    .description(
      'Generate a Ratchet run report (markdown and/or PDF).\n' +
      'Loads the latest run from history, or a specific run with --run <id>.',
    )
    .option('--run <id>', 'Specific run ID to report on (default: latest)')
    .option('--format <type>', 'Output format: "pdf", "markdown", or "both"', 'both')
    .option('--output <path>', 'Output directory (default: docs/)')
    .option('--open', 'Open the PDF after generation')
    .option('--list', 'List all saved runs')
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet report\n' +
      '  $ ratchet report --format markdown\n' +
      '  $ ratchet report --run my-run-id --open\n' +
      '  $ ratchet report --list\n',
    )
    .action(async (opts: {
      run?: string;
      format: string;
      output?: string;
      open?: boolean;
      list?: boolean;
    }) => {
      const cwd = process.cwd();

      // --list flag: show all runs and exit
      if (opts.list) {
        const entries = await listRuns(cwd);
        renderList(entries);
        return;
      }

      // Load the run
      let entry: Awaited<ReturnType<typeof loadLatestRun>>;
      if (opts.run) {
        entry = await loadRun(cwd, opts.run);
        if (!entry) {
          console.error(chalk.red(`✗ Run not found: ${opts.run}`));
          console.error(chalk.dim(`  Use 'ratchet report --list' to see available runs.`));
          process.exit(1);
        }
      } else {
        entry = await loadLatestRun(cwd);
        if (!entry) {
          console.error(chalk.red('✗ No runs found.'));
          console.error(chalk.dim(`  Run 'ratchet torque' first, then generate a report.`));
          process.exit(1);
        }
      }

      const run: RatchetRun = entry.run;
      let scoreBefore: ScanResult | undefined = entry.scoreBefore;
      let scoreAfter: ScanResult | undefined = entry.scoreAfter;

      // If no scoreAfter in history, run a fresh scan
      if (!scoreAfter) {
        try {
          scoreAfter = await runScan(cwd);
        } catch {
          // Non-fatal
        }
      }

      const outputDir = opts.output ? opts.output : join(cwd, 'docs');
      const reportOptions = { run, cwd, scoreBefore, scoreAfter };
      const format = opts.format;

      let markdownPath: string | null = null;
      let pdfPath: string | null = null;

      process.stdout.write('\n' + chalk.bold('⚙  Ratchet Report') + '\n\n');

      // Generate markdown
      if (format === 'markdown' || format === 'both') {
        try {
          const content = generateReport(reportOptions);
          const mdFile = join(outputDir, `${run.target.name}-ratchet-report.md`);
          await mkdir(dirname(mdFile), { recursive: true });
          await writeFile(mdFile, content, 'utf-8');
          markdownPath = mdFile;
          console.log(`  ${chalk.green('✓')} Markdown  ${chalk.cyan(mdFile.replace(cwd + '/', ''))}`);
        } catch (err) {
          console.error(`  ${chalk.red('✗')} Markdown generation failed: ${(err as Error).message}`);
        }
      }

      // Generate PDF
      if (format === 'pdf' || format === 'both') {
        try {
          const buffer = await generatePDF(reportOptions);
          const pdfFile = join(outputDir, `${run.target.name}-ratchet-report.pdf`);
          await mkdir(dirname(pdfFile), { recursive: true });
          await writeFile(pdfFile, buffer);
          pdfPath = pdfFile;
          console.log(`  ${chalk.green('✓')} PDF       ${chalk.cyan(pdfFile.replace(cwd + '/', ''))}`);
        } catch (err) {
          console.error(`  ${chalk.red('✗')} PDF generation failed: ${(err as Error).message}`);
        }
      }

      // Summary
      const passedClicks = run.clicks.filter((c) => c.testsPassed).length;
      const totalClicks = run.clicks.length;
      const score = scoreArrow(scoreBefore, scoreAfter);

      console.log('');
      console.log(`  Run     : ${chalk.dim(run.id)}`);
      console.log(`  Target  : ${chalk.cyan(run.target.name)}`);
      console.log(`  Clicks  : ${chalk.green(String(passedClicks))} / ${totalClicks} passed`);
      console.log(`  Score   : ${chalk.yellow(score)}`);
      console.log('');

      // Open PDF if requested
      if (opts.open && pdfPath) {
        await openFile(pdfPath);
      }
    });

  return cmd;
}
