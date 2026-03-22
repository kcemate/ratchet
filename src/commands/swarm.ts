import { Command } from 'commander';
import chalk from 'chalk';
import { getPersonalityStats, loadSwarmMemory, saveSwarmMemory } from '../core/swarm-memory.js';
import { getAllPersonalities } from '../core/agents/personalities.js';
import { printHeader, exitWithError, validateInt } from '../lib/cli.js';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';

/**
 * `ratchet swarm` — dedicated swarm command with stats and reset subcommands.
 *
 * Usage:
 *   ratchet swarm --spec "Add caching layer" --agents 4
 *   ratchet swarm --target src/core/ --agents 3 --no-debate
 *   ratchet swarm stats
 *   ratchet swarm reset
 */
export function swarmCommand(): Command {
  const cmd = new Command('swarm');

  cmd
    .description(
      'Run the Ratchet swarm — multiple competing agents with personalities and debate.\n\n' +
        'Each agent has a personality (The Surgeon, The Detective, etc.) that shapes\n' +
        'how it approaches the problem. After all agents finish, they debate and a\n' +
        'judge picks the winner. Social learning records outcomes for future runs.',
    )
    .addCommand(swarmStatsCommand())
    .addCommand(swarmResetCommand());

  cmd
    .option('--spec <text>', 'Feature spec or improvement goal (quoted string or path to .md file)')
    .option('--target <name>', 'Target name from .ratchet.yml config')
    .option('--agents <number>', 'Number of competing agents (default: 3)', '3')
    .option('--no-debate', 'Disable the debate round (pick winner by score only)')
    .option(
      '--personalities <names>',
      'Comma-separated personality names to use (e.g. the-surgeon,the-hawk)',
    )
    .option('--focus <specs>', 'Comma-separated specializations: security,performance,quality,errors,types')
    .option('--model <model>', 'Model to use for agents and judge')
    .option('--dry-run', 'Preview mode — show what would run without executing', false)
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ ratchet swarm --spec "Add input validation to user endpoints" --agents 4\n' +
        '  $ ratchet swarm --target api --agents 3 --no-debate\n' +
        '  $ ratchet swarm stats\n' +
        '  $ ratchet swarm reset\n',
    )
    .action(
      async (options: {
        spec?: string;
        target?: string;
        agents: string;
        debate: boolean;
        personalities?: string;
        focus?: string;
        model?: string;
        dryRun: boolean;
      }) => {
        printHeader('🐝 Ratchet Swarm');

        const cwd = process.cwd();
        const agentCount = validateInt(options.agents, 'agents', 1, 10) ?? 3;

        if (!options.spec && !options.target) {
          exitWithError(
            'Specify --spec "goal" or --target <name>.\n' +
              'Run `ratchet swarm --help` for usage.',
          );
          return;
        }

        const personalities = options.personalities
          ? options.personalities.split(',').map((p) => p.trim())
          : undefined;

        const focus = options.focus
          ? options.focus.split(',').map((f) => f.trim())
          : undefined;

        // Show configuration
        const allPersonalities = getAllPersonalities();
        process.stdout.write(chalk.bold('\n  Configuration\n'));
        process.stdout.write(`  Agents:       ${chalk.yellow(agentCount)}\n`);
        process.stdout.write(`  Debate:       ${options.debate ? chalk.green('enabled') : chalk.dim('disabled')}\n`);
        if (personalities) {
          process.stdout.write(`  Personalities: ${chalk.cyan(personalities.join(', '))}\n`);
        } else {
          process.stdout.write(`  Personalities: ${chalk.dim('auto-assigned')}\n`);
        }
        if (focus) {
          process.stdout.write(`  Focus:        ${chalk.dim(focus.join(', '))}\n`);
        }
        if (options.model) {
          process.stdout.write(`  Model:        ${chalk.dim(options.model)}\n`);
        }
        if (options.spec) {
          process.stdout.write(`  Spec:         ${chalk.dim(options.spec.slice(0, 80))}\n`);
        }
        if (options.target) {
          process.stdout.write(`  Target:       ${chalk.dim(options.target)}\n`);
        }
        process.stdout.write('\n');

        if (options.dryRun) {
          process.stdout.write(chalk.dim('  [dry-run] Would run swarm with the above configuration.\n\n'));
          return;
        }

        // Load memory and show if available
        const memory = await loadSwarmMemory(cwd);
        const stats = getPersonalityStats(memory);
        if (stats.length > 0) {
          process.stdout.write(chalk.bold('  📈 Memory (historical personality win rates)\n'));
          const sorted = stats.sort((a, b) => b.winRate - a.winRate).slice(0, 5);
          for (const s of sorted) {
            const bar = '█'.repeat(Math.round(s.winRate * 10));
            process.stdout.write(
              `  ${chalk.cyan(s.name.padEnd(20))} ${bar.padEnd(10)} ${(s.winRate * 100).toFixed(0)}% (${s.wins}W/${s.losses}L)\n`,
            );
          }
          process.stdout.write('\n');
        }

        // Delegate to torque with swarm flags
        const { torqueCommand } = await import('./torque.js');
        const torqueArgs = ['torque', '--swarm', `--agents`, String(agentCount)];

        if (options.spec) {
          torqueArgs.push('--mode', 'feature', '--spec', options.spec);
        }
        if (options.target) {
          torqueArgs.push('--target', options.target);
        }
        if (!options.debate) {
          // Passed as env var — torque will pick it up
          process.env['RATCHET_NO_DEBATE'] = '1';
        }
        if (personalities) {
          process.env['RATCHET_PERSONALITIES'] = personalities.join(',');
        }
        if (focus) {
          torqueArgs.push('--focus', focus.join(','));
        }
        if (options.model) {
          torqueArgs.push('--model', options.model);
        }

        // Re-invoke via torque command
        process.argv = ['node', 'ratchet', ...torqueArgs.slice(1)];
        const torque = torqueCommand();
        await torque.parseAsync(torqueArgs, { from: 'user' });
      },
    );

  return cmd;
}

function swarmStatsCommand(): Command {
  return new Command('stats')
    .description('Show personality win rates from swarm memory')
    .action(async () => {
      const cwd = process.cwd();
      const memory = await loadSwarmMemory(cwd);
      const stats = getPersonalityStats(memory);

      printHeader('📊 Swarm Memory Stats');

      if (stats.length === 0) {
        process.stdout.write(chalk.dim('  No swarm history yet. Run a swarm to start collecting data.\n\n'));
        return;
      }

      process.stdout.write(chalk.bold('\n  Personality Win Rates\n\n'));
      process.stdout.write(
        `  ${'Personality'.padEnd(22)} ${'Win Rate'.padEnd(12)} ${'W'.padEnd(6)} ${'L'.padEnd(6)} Avg Delta\n`,
      );
      process.stdout.write(`  ${'─'.repeat(60)}\n`);

      const sorted = stats.sort((a, b) => b.winRate - a.winRate);
      for (const s of sorted) {
        const winRatePct = (s.winRate * 100).toFixed(1) + '%';
        const avgDelta = s.avgDelta > 0 ? chalk.green(`+${s.avgDelta.toFixed(1)}`) : chalk.red(s.avgDelta.toFixed(1));
        process.stdout.write(
          `  ${chalk.cyan(s.name.padEnd(22))} ${winRatePct.padEnd(12)} ${String(s.wins).padEnd(6)} ${String(s.losses).padEnd(6)} ${avgDelta}\n`,
        );
      }

      if (memory.bestCombos.length > 0) {
        process.stdout.write(chalk.bold('\n  Best Personality Combos\n\n'));
        for (const combo of memory.bestCombos.slice(0, 5)) {
          process.stdout.write(
            `  ${chalk.yellow(combo.personalities.join(' + '))}: ` +
              `avg ${combo.avgScoreDelta > 0 ? '+' : ''}${combo.avgScoreDelta.toFixed(1)} over ${combo.runs} run(s)\n`,
          );
        }
      }

      if (memory.debatePatterns.length > 0) {
        process.stdout.write(chalk.bold(`\n  ${memory.debatePatterns.length} debate pattern(s) recorded\n`));
      }

      process.stdout.write('\n');
    });
}

function swarmResetCommand(): Command {
  return new Command('reset')
    .description('Clear swarm memory (personality win rates, debate patterns, combos)')
    .action(async () => {
      const cwd = process.cwd();
      const dir = join(cwd, '.ratchet');

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const emptyMemory = {
        version: 1 as const,
        personalityWins: {},
        debatePatterns: [],
        bestCombos: [],
      };

      await saveSwarmMemory(cwd, emptyMemory);
      process.stdout.write(chalk.green('\n  ✓ Swarm memory cleared.\n\n'));
    });
}
