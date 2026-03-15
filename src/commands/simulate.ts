import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';

import {
  SimulationEngine,
  formatReport,
  getAvailableScenarios,
  MAX_PERSONAS,
} from '../core/simulate.js';

export function simulateCommand(): Command {
  const cmd = new Command('simulate');

  cmd
    .description(
      'Simulate user personas navigating your product.\n\n' +
        'Spawns N AI persona agents (power-user, casual, new-user, mobile,\n' +
        'accessibility, api-developer) who walk through a scenario and report\n' +
        'friction points, drop-offs, and suggestions.\n\n' +
        'A synthesis agent aggregates findings into an actionable report.',
    )
    .option('-s, --scenario <name>', 'scenario to simulate (onboarding, daily-use, premium-upgrade, or custom)', 'onboarding')
    .option('-p, --personas <number>', `number of persona agents to spawn (1-${MAX_PERSONAS})`, '5')
    .option('-u, --url <url>', 'API base URL to test against (optional)')
    .option('-o, --output <path>', 'save report as markdown file')
    .option('-m, --model <model>', 'override Claude model')
    .option('--timeout <ms>', 'timeout per persona call in milliseconds', '120000')
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ ratchet simulate --scenario onboarding --personas 5 --output report.md\n' +
        '  $ ratchet simulate --scenario daily-use --personas 10\n' +
        '  $ ratchet simulate --scenario premium-upgrade --personas 3 --url http://localhost:3000\n' +
        `\nAvailable built-in scenarios: ${getAvailableScenarios().join(', ')}\n` +
        'You can also pass any custom scenario name.\n',
    )
    .action(
      async (options: {
        scenario: string;
        personas: string;
        url?: string;
        output?: string;
        model?: string;
        timeout: string;
      }) => {
        const cwd = process.cwd();

        console.log(chalk.bold('\n🎭  Ratchet Simulate\n'));

        // Parse and validate persona count
        const personaCount = parseInt(options.personas, 10);
        if (isNaN(personaCount) || personaCount < 1) {
          console.error(
            chalk.red(`  Invalid --personas value: ${chalk.bold(options.personas)}`) +
              '\n  Must be a positive integer (e.g. ' +
              chalk.cyan('--personas 5') + ').\n',
          );
          process.exit(1);
        }
        if (personaCount > MAX_PERSONAS) {
          console.error(
            chalk.red(`  Too many personas: ${personaCount}`) +
              `\n  Maximum is ${MAX_PERSONAS}.\n`,
          );
          process.exit(1);
        }

        // Parse timeout
        const timeout = parseInt(options.timeout, 10);
        if (isNaN(timeout) || timeout < 1000) {
          console.error(
            chalk.red(`  Invalid --timeout value: ${chalk.bold(options.timeout)}`) +
              '\n  Must be at least 1000 (1 second).\n',
          );
          process.exit(1);
        }

        // Print run summary
        const builtinScenarios = getAvailableScenarios();
        const isBuiltin = builtinScenarios.includes(options.scenario);
        console.log(`  Scenario : ${chalk.cyan(options.scenario)}${isBuiltin ? '' : chalk.dim(' (custom)')}`);
        console.log(`  Personas : ${chalk.yellow(String(personaCount))}`);
        if (options.url) {
          console.log(`  URL      : ${chalk.dim(options.url)}`);
        }
        if (options.model) {
          console.log(`  Model    : ${chalk.dim(options.model)}`);
        }
        console.log('');

        const spinner = ora('  Spawning persona agents…').start();

        let engine: SimulationEngine;
        try {
          engine = new SimulationEngine({
            personas: personaCount,
            scenario: options.scenario,
            targetUrl: options.url,
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
          spinner.succeed(`  ${personaCount} persona simulations complete`);
          console.log('');

          // Print summary to console
          const { summary } = result;
          console.log(chalk.bold('  Summary'));
          console.log(`  ${summary.overallSentiment}`);
          console.log('');

          if (summary.topPainPoints.length > 0) {
            console.log(chalk.bold('  Top Pain Points:'));
            for (const p of summary.topPainPoints.slice(0, 5)) {
              console.log(`    ${chalk.red('•')} ${p}`);
            }
            console.log('');
          }

          if (summary.criticalDropoffs.length > 0) {
            console.log(chalk.bold('  Critical Drop-offs:'));
            for (const d of summary.criticalDropoffs) {
              console.log(`    ${chalk.yellow('•')} ${d}`);
            }
            console.log('');
          }

          if (summary.topSuggestions.length > 0) {
            console.log(chalk.bold('  Top Suggestions:'));
            for (const s of summary.topSuggestions.slice(0, 5)) {
              console.log(`    ${chalk.green('•')} ${s}`);
            }
            console.log('');
          }

          // Write report if --output specified
          if (options.output) {
            const report = formatReport(result);
            const outputPath = options.output.endsWith('.md') ? options.output : `${options.output}.md`;
            await writeFile(outputPath, report, 'utf-8');
            console.log(`  Report saved: ${chalk.dim(outputPath)}\n`);
          }
        } catch (err) {
          spinner.fail(chalk.red('  Simulation failed'));
          console.error(chalk.red('\n  ' + (err instanceof Error ? err.message : String(err))) + '\n');
          process.exit(1);
        }
      },
    );

  return cmd;
}
