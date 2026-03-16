import { Command } from 'commander';
import chalk from 'chalk';

import {
  SimulationEngine,
  formatReport,
  getAvailableScenarios,
  MAX_PERSONAS,
} from '../core/simulate.js';
import { printHeader, validateInt, writeOutputFile, printBulletList, printFields, withSpinner } from '../lib/cli.js';

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

        printHeader('🎭  Ratchet Simulate');

        const personaCount = validateInt(options.personas, 'personas', 1, MAX_PERSONAS);
        const timeout = validateInt(options.timeout, 'timeout', 1000);

        // Print run summary
        const builtinScenarios = getAvailableScenarios();
        const isBuiltin = builtinScenarios.includes(options.scenario);
        const fields: Array<[string, string]> = [
          ['Scenario', chalk.cyan(options.scenario) + (isBuiltin ? '' : chalk.dim(' (custom)'))],
          ['Personas', chalk.yellow(String(personaCount))],
        ];
        if (options.url) fields.push(['URL', chalk.dim(options.url)]);
        if (options.model) fields.push(['Model', chalk.dim(options.model)]);
        printFields(fields);

        await withSpinner('  Spawning persona agents…', async (spinner) => {
          const engine = new SimulationEngine({
            personas: personaCount,
            scenario: options.scenario,
            targetUrl: options.url,
            cwd,
            model: options.model,
            timeout,
          });

          const result = await engine.run();
          spinner.succeed(`  ${personaCount} persona simulations complete`);
          console.log('');

          const { summary } = result;
          console.log(chalk.bold('  Summary'));
          console.log(`  ${summary.overallSentiment}`);
          console.log('');

          printBulletList('Top Pain Points:', summary.topPainPoints, chalk.red);
          printBulletList('Critical Drop-offs:', summary.criticalDropoffs, chalk.yellow);
          printBulletList('Top Suggestions:', summary.topSuggestions, chalk.green);

          if (options.output) {
            await writeOutputFile(options.output, formatReport(result));
          }
        }, 'Simulation failed');
      },
    );

  return cmd;
}
