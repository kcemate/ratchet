import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import { loadStrategy, resetStrategy, buildStrategyContext } from '../core/strategy.js';
import { exitWithError } from '../lib/cli.js';

export function strategyCommand(): Command {
  const cmd = new Command('strategy');

  cmd
    .description(
      'Manage the self-evolving strategy for this project.\n\n' +
      'Ratchet builds a `.ratchet/strategy.md` file that tracks what works\n' +
      'and what doesn\'t for THIS codebase — getting smarter each run.\n\n' +
      'Usage:\n' +
      '  ratchet strategy        — show strategy summary\n' +
      '  ratchet strategy show   — print full strategy file\n' +
      '  ratchet strategy reset  — delete strategy and start fresh',
    );

  // Default action: show summary
  cmd.action(async () => {
    const cwd = process.cwd();
    const strategy = await loadStrategy(cwd);

    if (!strategy) {
      process.stdout.write(
        chalk.dim('  No strategy found yet.\n\n') +
        '  Run ' + chalk.bold('ratchet torque') + ' to generate a strategy on the first run.\n' +
        '  Strategy is stored in ' + chalk.cyan('.ratchet/strategy.md') + '\n\n',
      );
      return;
    }

    process.stdout.write('\n');
    process.stdout.write(chalk.bold('  🧠 Ratchet Strategy') + chalk.dim(` v${strategy.version}`) + '\n');
    process.stdout.write(chalk.dim(`  ${strategy.profile.name} · Updated ${strategy.updatedAt.split('T')[0]}`) + '\n\n');

    // Profile
    process.stdout.write(chalk.bold('  📦 Codebase') + '\n');
    process.stdout.write(`     Tech stack:  ${strategy.profile.techStack.join(', ') || chalk.dim('unknown')}\n`);
    process.stdout.write(`     Test runner: ${strategy.profile.testFramework}\n`);
    process.stdout.write(`     Patterns:    ${strategy.profile.patterns.join(', ') || chalk.dim('none detected')}\n`);
    process.stdout.write('\n');

    // Insights
    const works = strategy.insights.filter(i => i.type === 'what-works' && i.confidence >= 0.4);
    const fails = strategy.insights.filter(i => i.type === 'what-fails' && i.confidence >= 0.4);

    if (works.length > 0) {
      process.stdout.write(chalk.bold('  ✅ What works\n'));
      for (const ins of works.slice(0, 5)) {
        const conf = Math.round(ins.confidence * 100);
        process.stdout.write(`     ${chalk.green('→')} ${ins.description} ${chalk.dim(`(${conf}%)`)}\n`);
      }
      process.stdout.write('\n');
    }

    if (fails.length > 0) {
      process.stdout.write(chalk.bold('  ❌ What fails\n'));
      for (const ins of fails.slice(0, 5)) {
        const conf = Math.round(ins.confidence * 100);
        process.stdout.write(`     ${chalk.red('→')} ${ins.description} ${chalk.dim(`(${conf}%)`)}\n`);
      }
      process.stdout.write('\n');
    }

    // Hot spots
    const hotFiles = strategy.hotSpots
      .filter(hs => hs.rollbackRate >= 0.5)
      .sort((a, b) => b.rollbackRate - a.rollbackRate)
      .slice(0, 5);

    if (hotFiles.length > 0) {
      process.stdout.write(chalk.bold('  🔥 Hot spots\n'));
      for (const hs of hotFiles) {
        const pct = Math.round(hs.rollbackRate * 100);
        process.stdout.write(`     ${chalk.yellow('→')} ${chalk.cyan(hs.filePath)} ${chalk.dim(`${pct}% rollback · ${hs.attempts} attempts`)}\n`);
      }
      process.stdout.write('\n');
    }

    // Anti-patterns
    if (strategy.antiPatterns.length > 0) {
      process.stdout.write(chalk.bold('  🚫 Anti-patterns\n'));
      for (const ap of strategy.antiPatterns.slice(0, 3)) {
        process.stdout.write(`     ${chalk.red('→')} ${ap.pattern} ${chalk.dim(`(seen ${ap.occurrences}x)`)}\n`);
      }
      process.stdout.write('\n');
    }

    // Run history
    if (strategy.runSummaries.length > 0) {
      process.stdout.write(chalk.bold(`  📈 Run history (${strategy.runSummaries.length} runs)\n`));
      const recent = [...strategy.runSummaries].reverse().slice(0, 5);
      for (const rs of recent) {
        const delta = rs.scoreAfter - rs.scoreBefore;
        const sign = delta >= 0 ? '+' : '';
        const deltaColor = delta > 0 ? chalk.green : delta < 0 ? chalk.red : chalk.dim;
        const total = rs.landed + rs.rolledBack;
        process.stdout.write(
          `     ${chalk.dim(rs.date.split('T')[0])}  ` +
          deltaColor(`${sign}${delta} score`) +
          chalk.dim(`  ${rs.landed}/${total} landed`) +
          `  ${chalk.dim(rs.keyInsight)}\n`,
        );
      }
      process.stdout.write('\n');
    }

    // Agent context preview
    const context = buildStrategyContext(strategy);
    if (context) {
      process.stdout.write(chalk.bold('  💬 Agent context preview\n'));
      process.stdout.write(chalk.dim('  ─────────────────────────────────\n'));
      for (const line of context.split('\n').slice(0, 10)) {
        process.stdout.write(`  ${chalk.dim(line)}\n`);
      }
      if (context.split('\n').length > 10) {
        process.stdout.write(chalk.dim(`  ... (${context.split('\n').length - 10} more lines)\n`));
      }
      process.stdout.write('\n');
    }

    process.stdout.write(
      chalk.dim(`  File: .ratchet/strategy.md · `) +
      chalk.dim(`Run "ratchet strategy show" for full file\n\n`),
    );
  });

  // Subcommand: show
  cmd
    .command('show')
    .description('Print the full strategy file')
    .action(async () => {
      const cwd = process.cwd();
      const filePath = join(cwd, '.ratchet', 'strategy.md');

      if (!existsSync(filePath)) {
        exitWithError('No strategy file found. Run ratchet torque first to generate one.');
        return;
      }

      const content = await readFile(filePath, 'utf-8');
      process.stdout.write(content + '\n');
    });

  // Subcommand: reset
  cmd
    .command('reset')
    .description('Delete strategy and start fresh on the next run')
    .action(async () => {
      const cwd = process.cwd();
      const deleted = await resetStrategy(cwd);

      if (deleted) {
        process.stdout.write(
          chalk.green('  ✓ Strategy reset.\n') +
          chalk.dim('  Next run will generate a fresh strategy.\n\n'),
        );
      } else {
        process.stdout.write(chalk.dim('  No strategy file found — nothing to reset.\n\n'));
      }
    });

  return cmd;
}
