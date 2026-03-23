import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';
import { runScan } from './scan.js';
import { getExplanation } from '../core/explanations.js';
import { printHeader, scoreColor } from '../lib/cli.js';

interface QuickFixItem {
  rank: number;
  subcategoryName: string;
  categoryName: string;
  headroom: number;
  currentScore: number;
  maxScore: number;
  issuesFound: number;
  issuesDescription: string;
  fix: string;
  projectedTotal: number;
}

export function quickFixCommand(): Command {
  const cmd = new Command('quick-fix');

  cmd
    .description(
      'Show the top 3 highest-impact issues and predicted score gains.\n' +
      'Runs a full scan and identifies where you can improve the most.',
    )
    .argument('[dir]', 'Directory to scan (default: current directory)', '.')
    .option('--apply', 'Apply fixes automatically (coming soon).')
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet quick-fix\n' +
      '  $ ratchet quick-fix ./my-project\n',
    )
    .action(async (dir: string, options: Record<string, unknown>) => {
      const cwd = resolve(dir);

      if (options['apply']) {
        process.stdout.write(
          chalk.cyan('Coming soon — use ratchet torque --focus <category> to fix automatically\n'),
        );
        return;
      }

      const { trackEvent } = await import('../core/telemetry.js');
      trackEvent('quick-fix');

      printHeader('Quick Fix');
      process.stdout.write(chalk.dim('Scanning project...\n\n'));

      const result = await runScan(cwd);

      // Gather all subcategories with headroom (max - score > 0)
      const candidates: QuickFixItem[] = [];

      for (const cat of result.categories) {
        for (const sub of cat.subcategories) {
          const headroom = sub.max - sub.score;
          if (headroom <= 0) continue;

          const explanation = getExplanation(sub.name);
          const fix = explanation?.fix ?? 'Review and address the issues found.';

          candidates.push({
            rank: 0,
            subcategoryName: sub.name,
            categoryName: cat.name,
            headroom,
            currentScore: sub.score,
            maxScore: sub.max,
            issuesFound: sub.issuesFound,
            issuesDescription: sub.issuesDescription ?? 'issues',
            fix,
            projectedTotal: 0,
          });
        }
      }

      // Sort by headroom descending, take top 3
      candidates.sort((a, b) => b.headroom - a.headroom);
      const top3 = candidates.slice(0, 3);

      if (top3.length === 0) {
        process.stdout.write(chalk.green.bold('  🎉 Perfect score! No improvements needed.\n\n'));
        return;
      }

      // Calculate cumulative projected scores
      let runningTotal = result.total;
      for (let i = 0; i < top3.length; i++) {
        runningTotal += top3[i].headroom;
        top3[i].rank = i + 1;
        top3[i].projectedTotal = Math.min(runningTotal, result.maxTotal);
      }

      // Header
      process.stdout.write(
        `  Current score: ${scoreColor(result.total)(`${result.total}/${result.maxTotal}`)}\n\n`,
      );
      process.stdout.write(chalk.bold('  Top 3 improvements:\n\n'));

      // Render each item
      for (const item of top3) {
        const headroomStr = chalk.green(`+${item.headroom} pt${item.headroom !== 1 ? 's' : ''}`);
        const projectedStr = scoreColor(item.projectedTotal)(
          `~${item.projectedTotal}/${result.maxTotal}`,
        );

        process.stdout.write(
          `  ${chalk.bold(`${item.rank}.`)} ${chalk.white(item.subcategoryName)} ` +
          `${chalk.dim(`(${item.categoryName})`)} — ${headroomStr} available\n`,
        );

        if (item.issuesFound > 0) {
          process.stdout.write(
            `     ${item.issuesFound} ${item.issuesDescription}\n`,
          );
        }

        process.stdout.write(`     ${chalk.dim('Fix:')} ${item.fix}\n`);
        process.stdout.write(
          `     ${chalk.dim('→')} Fixing this would bring your score to ${projectedStr}\n`,
        );
        process.stdout.write('\n');
      }

      const totalGain = top3[top3.length - 1].projectedTotal - result.total;
      process.stdout.write(
        chalk.cyan(
          `  Fix all 3 and gain up to ${chalk.bold(`+${totalGain} pts`)} ` +
          `(${result.total} → ${top3[top3.length - 1].projectedTotal})\n`,
        ),
      );
      process.stdout.write('\n');
      process.stdout.write(
        chalk.dim("Run 'npx ratchet torque --focus <category>' to fix automatically.\n"),
      );
      process.stdout.write('\n');
    });

  return cmd;
}
