#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

import { initCommand } from './commands/init.js';
import { torqueCommand } from './commands/torque.js';
import { statusCommand } from './commands/status.js';
import { logCommand } from './commands/log.js';
import { tightenCommand } from './commands/tighten.js';

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
let version = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as { version: string };
  version = pkg.version;
} catch {
  // fallback
}

const program = new Command();

program
  .name('ratchet')
  .description(
    'Autonomous iterative code improvement CLI.\n' +
    'Point it at a target — it analyzes → proposes → builds → tests → commits → repeats.\n' +
    'Every click ships code.'
  )
  .version(version, '-v, --version', 'print version');

program.addCommand(initCommand());
program.addCommand(torqueCommand());
program.addCommand(statusCommand());
program.addCommand(logCommand());
program.addCommand(tightenCommand());

program.parse(process.argv);
