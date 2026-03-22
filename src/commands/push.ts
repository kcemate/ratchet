import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { printHeader } from '../lib/cli.js';
import { loadCredentials, detectOwnerRepo } from '../core/credentials.js';
import { pushScanResult } from '../core/push-api.js';
import { runAutoPr } from '../core/auto-pr.js';
import type { ScanResult } from './scan.js';
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
      'Reads .ratchet/scan-cache.json (written by `ratchet scan --push` or a prior scan).',
    )
    .argument('[dir]', 'Project directory (default: current directory)', '.')
    .option('--no-auto-pr', 'Skip the auto-PR step even if this is the first push')
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet push\n' +
      '  $ ratchet push --no-auto-pr\n',
    )
    .action(async (dir: string, options: { autoPr: boolean }) => {
      const { resolve } = await import('path');
      const cwd = resolve(dir);

      printHeader('📡 Ratchet Push');

      // Load credentials
      const creds = loadCredentials();
      if (!creds) {
        logger.error('No API key found. Run `ratchet login --api-key <key>` first.');
        process.exit(1);
      }

      // Load cached scan result
      const result = loadScanCache(cwd);
      if (!result) {
        logger.error({ file: SCAN_CACHE_FILE }, 'No scan cache found. Run `ratchet scan --push` to scan and push in one step.');
        process.exit(1);
      }

      // Detect owner/repo
      const ownerRepo = creds.owner && creds.repo
        ? { owner: creds.owner, repo: creds.repo }
        : await detectOwnerRepo(cwd);

      if (!ownerRepo) {
        logger.error('Could not detect owner/repo from git remote. Is this a GitHub repo?');
        process.exit(1);
      }

      logger.info({ repo: `${ownerRepo.owner}/${ownerRepo.repo}` }, 'Pushing to repo');
      logger.info({ score: `${result.total}/${result.maxTotal}` }, 'Score');

      // Push
      const spinner = ora('Pushing scan results…').start();
      const pushResult = await pushScanResult(creds, {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        scan: result,
        timestamp: new Date().toISOString(),
      });

      if (!pushResult.ok) {
        spinner.fail(chalk.red(`Push failed: ${pushResult.error}`));
        process.exit(1);
      }

      spinner.succeed(chalk.green('Scan results pushed!'));
      logger.info({ badgeUrl: `https://ratchetcli.com/badge/${ownerRepo.owner}/${ownerRepo.repo}` }, 'Badge URL');

      // Auto-PR on first push
      if (options.autoPr && pushResult.isFirstPush) {
        const prSpinner = ora('Checking README for badge (first push)…').start();
        const prResult = await runAutoPr(cwd, ownerRepo.owner, ownerRepo.repo, result);

        if (prResult.skipped) {
          prSpinner.info(chalk.dim(`Auto-PR skipped: ${prResult.reason}`));
        } else if (prResult.prUrl) {
          prSpinner.succeed(chalk.green(`PR created: ${prResult.prUrl}`));
        } else {
          prSpinner.warn(chalk.yellow(`Auto-PR: ${prResult.reason ?? 'unknown error'}`));
        }
      }
    });

  return cmd;
}
