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
import { scanCommand } from './commands/scan.js';
import { reportCommand } from './commands/report.js';
import { buildCommand } from './commands/build.js';
import { improveCommand } from './commands/improve.js';
import { visionCommand } from './commands/vision.js';
import { badgeCommand } from './commands/badge.js';
import { loginCommand, logoutCommand } from './commands/login.js';

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
    'Autonomous iterative code improvement CLI.\n\n' +
    'Initialize in your project:\n' +
    '  ratchet init\n\n' +
    'Then run improvement clicks on a target:\n' +
    '  ratchet torque --target <name>\n\n' +
    'Each click: analyze → propose → build → test → commit (or revert).\n' +
    'Only improvements that pass tests are kept. Every click ships code.'
  )
  .version(version, '-v, --version', 'print version');

program.addCommand(initCommand());
program.addCommand(torqueCommand());
program.addCommand(statusCommand());
program.addCommand(logCommand());
program.addCommand(tightenCommand());
program.addCommand(scanCommand());
program.addCommand(reportCommand());
program.addCommand(buildCommand());
program.addCommand(improveCommand());
program.addCommand(visionCommand());
program.addCommand(badgeCommand());
program.addCommand(loginCommand());
program.addCommand(logoutCommand());

program.parse(process.argv);
