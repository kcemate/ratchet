import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { logger } from '../lib/logger.js';
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
        logger.error({ id }, 'No background run found');
        process.exit(1);
      }

      const pid = parseInt(pidRaw.trim(), 10);
      if (isNaN(pid)) {
        logger.error({ id }, 'Invalid PID in run directory');
        process.exit(1);
      }

      if (!isProcessAlive(pid)) {
        logger.warn({ pid }, 'Process is no longer running');
        process.exit(0);
      }

      try {
        process.kill(pid, 'SIGTERM');
        logger.info({ pid, id }, 'Sent SIGTERM');
      } catch (err) {
        logger.error({ err: String(err) }, 'Failed to send SIGTERM');
        process.exit(1);
      }
    });

  return cmd;
}
