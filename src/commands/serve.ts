import { Command } from 'commander';
import chalk from 'chalk';
import { printHeader } from '../lib/cli.js';

export function serveCommand(): Command {
  const cmd = new Command('serve');

  cmd
    .description('Start the Ratchet API server for self-hosted deployments')
    .option('-p, --port <port>', 'Port to listen on (overrides RATCHET_API_PORT)', '3100')
    .option('--db <path>', 'SQLite database path (overrides RATCHET_DB_PATH)')
    .action(async (options: { port: string; db?: string }) => {
      printHeader('ratchet serve');

      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(chalk.red('Invalid port number'));
        process.exit(1);
      }

      process.env.RATCHET_API_PORT = String(port);
      if (options.db) {
        process.env.RATCHET_DB_PATH = options.db;
      }

      console.log(chalk.dim('Configuration:'));
      console.log(chalk.dim(`  Port    : ${port}`));
      console.log(chalk.dim(`  DB path : ${process.env.RATCHET_DB_PATH ?? '.ratchet/api.db'}`));
      console.log();

      const { startServer } = await import('../api/index.js');
      await startServer();

      console.log();
      console.log(chalk.green('✓') + ' API server running');
      console.log(chalk.dim(`  Health : http://localhost:${port}/health`));
      console.log(chalk.dim(`  Auth   : http://localhost:${port}/api/auth`));
      console.log(chalk.dim(`  Usage  : http://localhost:${port}/api/usage`));
      console.log();
      console.log(chalk.dim('Press Ctrl+C to stop.'));
    });

  return cmd;
}
