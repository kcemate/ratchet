import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { bgRunDir, isProcessAlive } from '../core/background.js';

export function stopCommand(): Command {
  const cmd = new Command('stop');

  cmd
    .description('Stop a background ratchet run by sending SIGTERM')
    .argument('<id>', 'Run ID to stop (from ratchet status or ratchet torque --background output)')
    .action(async (id: string) => {
      const cwd = process.cwd();
      const runDir = bgRunDir(cwd, id);
      const pidPath = join(runDir, 'pid');

      let pidRaw: string;
      try {
        pidRaw = await readFile(pidPath, 'utf-8');
      } catch {
        console.error(chalk.red(`  No background run found with ID: ${id}`));
        process.exit(1);
      }

      const pid = parseInt(pidRaw.trim(), 10);
      if (isNaN(pid)) {
        console.error(chalk.red(`  Invalid PID in run directory for: ${id}`));
        process.exit(1);
      }

      if (!isProcessAlive(pid)) {
        console.log(chalk.yellow(`  Process (PID ${pid}) is no longer running.`));
        process.exit(0);
      }

      try {
        process.kill(pid, 'SIGTERM');
        console.log(
          `  Sent SIGTERM to PID ${chalk.bold(String(pid))} (run ${chalk.dim(id)})\n` +
          `  The run will save its state and exit gracefully.\n` +
          `  Resume later with: ${chalk.cyan(`ratchet torque --resume ${id}`)}`,
        );
      } catch (err) {
        console.error(chalk.red(`  Failed to send SIGTERM: ${String(err)}`));
        process.exit(1);
      }
    });

  return cmd;
}
