#!/usr/bin/env node
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenvConfig({ path: resolve(process.cwd(), '.env') });
const __ratchetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenvConfig({ path: resolve(__ratchetRoot, '.env') });

import { Command } from 'commander';
import { join } from 'path';
import { readFileSync } from 'fs';
import chalk from 'chalk';

import { initCommand } from './commands/init.js';
import { scanCommand } from './commands/scan.js';
import { reportCommand } from './commands/report.js';
import { visionCommand } from './commands/vision.js';
import { badgeCommand } from './commands/badge.js';
import { buildCommand } from './commands/build.js';
import { statusCommand } from './commands/status.js';
import { logCommand } from './commands/log.js';
import { stopCommand } from './commands/stop.js';
import { pushCommand } from './commands/push.js';
import { quickFixCommand } from './commands/quick-fix.js';
import { registerGraphCommand } from './commands/graph.js';
import { torqueCommand } from './commands/torque.js';

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
let version = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
    version: string;
  };
  version = pkg.version;
} catch (err) {
  if (process.env.RATCHET_DEBUG) console.debug('Could not read package.json version:', err);
}

const program = new Command();

program
  .name('ratchet')
  .description(
    'Security scanner for AI-generated code. Scan, score, and auto-fix what AI gets wrong.\n\n' +
      'Quick start:\n' +
      '  ratchet init          Set up your project\n' +
      '  ratchet scan          Score your codebase\n\n' +
      'Upgrade to Pro for AI-powered fixes:\n' +
      '  npm install -g ratchet-pro',
  )
  .version(version, '-v, --version', 'print version');

// Register core commands
program.addCommand(initCommand());
program.addCommand(scanCommand());
program.addCommand(reportCommand());
program.addCommand(visionCommand());
program.addCommand(badgeCommand());
program.addCommand(buildCommand());
program.addCommand(statusCommand());
program.addCommand(logCommand());
program.addCommand(stopCommand());
program.addCommand(pushCommand());
program.addCommand(quickFixCommand());
registerGraphCommand(program);

// Hidden internal alias
const torque = torqueCommand();
torque.name('torque');
program.addCommand(torque, { hidden: true });

// Try to load ratchet-pro plugin (paid features)
try {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error ratchet-pro is an optional peer dependency
  const pro = (await import('ratchet-pro')) as { registerCommands?: (p: typeof program) => void };
  if (pro.registerCommands) {
    pro.registerCommands(program);
  }
} catch {
  // ratchet-pro not installed — free tier only
}

// Add global error handler
program.exitOverride((err) => {
  if (err.code !== 'commander.helpDisplayed') {
    console.error(chalk.red('Error:'), err.message);
    process.exit(1);
  }
});

program.parse(process.argv);