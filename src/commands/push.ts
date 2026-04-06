import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { printHeader } from '../lib/cli.js';
import type { ScanResult } from '../core/scanner';
import { logger } from '../lib/logger.js';

export const SCAN_CACHE_FILE = '.ratchet/scan-cache.json';

/** Save a scan result to .ratchet/scan-cache.json for later push. */
export function saveScanCache(cwd: string, result: ScanResult): void {
  const dir = join(cwd, '.ratchet');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, SCAN_CACHE_FILE), JSON.stringify(result, null, 2), 'utf-8');
}

/** Load the cached scan result from .ratchet/scan-cache.json. */
export function loadScanCache(cwd: string): ScanResult | null {
  const p = join(cwd, SCAN_CACHE_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ScanResult;
  } catch {
    return null;
  }
}

export function pushCommand(): Command {
  const cmd = new Command('push');

  cmd
    .description(
      'Push the latest scan result to ratchetcli.com.\n' +
      'Requires Ratchet Pro — run `npm install -g ratchet-pro` then `ratchet auth login`.',
    )
    .argument('[dir]', 'Project directory (default: current directory)', '.')
    .option('--no-auto-pr', 'Skip the auto-PR step even if this is the first push')
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet push\n' +
      '  $ ratchet push --no-auto-pr\n',
    )
    .action(async (_dir: string, _options: { autoPr: boolean }) => {
      printHeader('Ratchet Push');

      logger.error(
        'The `push` command requires Ratchet Pro.\n' +
        chalk.dim('  npm install -g ratchet-pro\n') +
        chalk.dim('  ratchet auth login --api-key <key>'),
      );
      process.exit(1);
    });

  return cmd;
}
