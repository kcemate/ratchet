import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

import {
  DebateEngine,
  formatDebateReport,
  MAX_AGENTS,
  MAX_ROUNDS,
} from '../core/debate.js';
import { printHeader, validateInt, writeOutputFile, printBulletList } from '../lib/cli.js';
import { toErrorMessage } from '../core/utils.js';

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
          spinner.fail(chalk.red(`  ${toErrorMessage(err)}`));
          process.exit(1);
        }

        try {
          const result = await engine.run();
          spinner.succeed(`  Debate complete — ${roundCount} rounds, ${agentCount} agents`);
          console.log('');

          const { synthesis } = result;

          console.log(chalk.bold('  Recommendation'));
          console.log(`  ${synthesis.recommendation.slice(0, 300)}${synthesis.recommendation.length > 300 ? '…' : ''}`);
          console.log('');

          printBulletList('Tradeoffs:', synthesis.tradeoffs, chalk.yellow);
          printBulletList('Action Items:', synthesis.actionItems, chalk.green);
          printBulletList('Dissenting Opinions:', synthesis.dissent, chalk.red, 3);

          console.log(`  Consensus: ${chalk.bold(String(synthesis.consensus))}%`);
          console.log('');

          if (options.output) {
            await writeOutputFile(options.output, formatDebateReport(result));
          }
        } catch (err) {
          spinner.fail(chalk.red('  Debate failed'));
          console.error(chalk.red(`\n  ${toErrorMessage(err)}`) + '\n');
          process.exit(1);
        }
      },
    );

  return cmd;
}
