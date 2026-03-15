import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';

import {
  DebateEngine,
  formatDebateReport,
  MAX_AGENTS,
  MAX_ROUNDS,
} from '../core/debate.js';
import { printHeader, validateInt } from '../lib/cli.js';

export function debateCommand(): Command {
  const cmd = new Command('debate');

  cmd
    .description(
      'Spawn AI architects with different philosophies to debate a design topic.\n\n' +
        'Each agent argues from their perspective (pragmatist, purist, security-first,\n' +
        'performance-first, user-first, minimalist) across multiple rounds.\n' +
        'A synthesis agent produces a final recommendation with tradeoffs.',
    )
    .requiredOption('-t, --topic <topic>', 'the design question to debate')
    .option('-a, --agents <number>', `number of debater agents (1-${MAX_AGENTS})`, '4')
    .option('-r, --rounds <number>', `debate rounds (1-${MAX_ROUNDS})`, '3')
    .option('-o, --output <path>', 'save debate transcript + synthesis as markdown')
    .option('-m, --model <model>', 'override Claude model')
    .option('--timeout <ms>', 'timeout per agent call in milliseconds', '120000')
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ ratchet debate --topic "should we use Clerk or roll our own auth"\n' +
        '  $ ratchet debate --topic "monorepo vs polyrepo" --agents 6 --rounds 4\n' +
        '  $ ratchet debate --topic "REST vs GraphQL for the API layer" --output debate-api.md\n',
    )
    .action(
      async (options: {
        topic: string;
        agents: string;
        rounds: string;
        output?: string;
        model?: string;
        timeout: string;
      }) => {
        const cwd = process.cwd();

        printHeader('⚔  Ratchet Debate');

        const agentCount = validateInt(options.agents, 'agents', 1, MAX_AGENTS);
        const roundCount = validateInt(options.rounds, 'rounds', 1, MAX_ROUNDS);
        const timeout = validateInt(options.timeout, 'timeout', 1000);

        // Print run summary
        process.stdout.write(`  Topic  : ${chalk.cyan(options.topic)}\n`);
        process.stdout.write(`  Agents : ${chalk.yellow(String(agentCount))}\n`);
        process.stdout.write(`  Rounds : ${chalk.yellow(String(roundCount))}\n`);
        if (options.model) {
          process.stdout.write(`  Model  : ${chalk.dim(options.model)}\n`);
        }
        process.stdout.write('\n');

        const spinner = ora('  Round 1 — agents stating positions…').start();

        let engine: DebateEngine;
        try {
          engine = new DebateEngine({
            topic: options.topic,
            agents: agentCount,
            rounds: roundCount,
            cwd,
            model: options.model,
            timeout,
          });
        } catch (err) {
          spinner.fail(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        }

        try {
          const result = await engine.run();
          spinner.succeed(`  Debate complete — ${roundCount} rounds, ${agentCount} agents`);
          process.stdout.write('\n');

          // Print synthesis to console
          const { synthesis } = result;

          process.stdout.write(chalk.bold('  Recommendation') + '\n');
          process.stdout.write(`  ${synthesis.recommendation.slice(0, 300)}${synthesis.recommendation.length > 300 ? '…' : ''}\n`);
          process.stdout.write('\n');

          if (synthesis.tradeoffs.length > 0) {
            process.stdout.write(chalk.bold('  Tradeoffs:') + '\n');
            for (const t of synthesis.tradeoffs.slice(0, 5)) {
              console.log(`    ${chalk.yellow('•')} ${t}`);
            }
            process.stdout.write('\n');
          }

          if (synthesis.actionItems.length > 0) {
            console.log(chalk.bold('  Action Items:'));
            for (const a of synthesis.actionItems.slice(0, 5)) {
              console.log(`    ${chalk.green('•')} ${a}`);
            }
            process.stdout.write('\n');
          }

          if (synthesis.dissent.length > 0) {
            console.log(chalk.bold('  Dissenting Opinions:'));
            for (const d of synthesis.dissent.slice(0, 3)) {
              console.log(`    ${chalk.red('•')} ${d}`);
            }
            process.stdout.write('\n');
          }

          console.log(`  Consensus: ${chalk.bold(String(synthesis.consensus))}%`);
          process.stdout.write('\n');

          // Write report if --output specified
          if (options.output) {
            const report = formatDebateReport(result);
            const outputPath = options.output.endsWith('.md') ? options.output : `${options.output}.md`;
            await writeFile(outputPath, report, 'utf-8');
            console.log(`  Report saved: ${chalk.dim(outputPath)}\n`);
          }
        } catch (err) {
          spinner.fail(chalk.red('  Debate failed'));
          console.error(chalk.red('\n  ' + (err instanceof Error ? err.message : String(err))) + '\n');
          process.exit(1);
        }
      },
    );

  return cmd;
}
