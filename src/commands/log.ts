import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { loadConfig, configFilePath } from '../core/config.js';
import { existsSync } from 'fs';
import { printHeader, exitWithError } from '../lib/cli.js';

export function logCommand(): Command {
  const cmd = new Command('log');

  cmd
    .description(
      'Display the Ratchet log for a target.\n\n' +
      'The log lives at docs/<target>-ratchet.md and records every click:\n' +
      'analysis, proposal, files changed, and commit hash (or rolled back).\n\n' +
      'Auto-detects target if only one exists in the project.'
    )
    .option('-t, --target <name>', 'Target name to show log for (auto-detected if omitted)')
    .option('--raw', 'Print raw markdown without color formatting', false)
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ ratchet log\n' +
        '  $ ratchet log --target src\n' +
        '  $ ratchet log --raw\n',
    )
    .action(async (options: { target?: string; raw: boolean }) => {
      const cwd = process.cwd();

      printHeader('⚙  Ratchet Log');

      let targetName = options.target;

      // Auto-detect target from config or docs directory
      if (!targetName) {
        targetName = await inferTarget(cwd) ?? undefined;
        if (!targetName) {
          exitWithError(
            '  No target specified and none could be inferred.\n  Use ' +
              chalk.cyan('ratchet log --target <name>'),
          );
        }
      }

      const logPath = join(cwd, 'docs', `${targetName}-ratchet.md`);

      let content: string;
      try {
        content = await readFile(logPath, 'utf-8');
      } catch {
        exitWithError(
          `  No log found for target "${targetName}".\n  Expected: ${chalk.dim(logPath)}`,
        );
      }

      if (options.raw) {
        process.stdout.write(content);
        return;
      }

      // Parse click stats from markdown content
      const passedCount = (content.match(/## Click \d+ — ✅/g) ?? []).length;
      const failedCount = (content.match(/## Click \d+ — ❌/g) ?? []).length;
      const totalCount = passedCount + failedCount;
      if (totalCount > 0) {
        process.stdout.write(
          chalk.dim(`  ${totalCount} click${totalCount !== 1 ? 's' : ''} · `) +
            chalk.green(`${passedCount} passed`) +
            chalk.dim(' · ') +
            (failedCount > 0 ? chalk.red(`${failedCount} rolled back`) : chalk.dim('0 rolled back')) +
            '\n\n',
        );
      }

      renderMarkdown(content);
    });

  return cmd;
}

async function inferTarget(cwd: string): Promise<string | null> {
  // Try config first
  if (existsSync(configFilePath(cwd))) {
    try {
      const config = loadConfig(cwd);
      if (config.targets.length === 1) {
        return config.targets[0].name;
      }
      if (config.targets.length > 1) {
        const names = config.targets.map((t) => chalk.cyan(t.name)).join(', ');
        exitWithError(
          `  Multiple targets in .ratchet.yml. Specify one with --target.\n  Available: ${names}`,
        );
      }
    } catch {
      // ignore
    }
  }

  // Fall back to docs directory
  const docsDir = join(cwd, 'docs');
  try {
    const files = await readdir(docsDir);
    const logFiles = files.filter((f) => f.endsWith('-ratchet.md'));
    if (logFiles.length === 1) {
      return logFiles[0].replace(/-ratchet\.md$/, '');
    }
    if (logFiles.length > 1) {
      const names = logFiles
        .map((f) => chalk.cyan(f.replace(/-ratchet\.md$/, '')))
        .join(', ');
      exitWithError(
        `  Multiple log files found. Specify one with --target.\n  Available: ${names}`,
      );
    }
  } catch {
    // docs dir doesn't exist
  }

  return null;
}

function renderInline(line: string): string {
  // Bold **text** — must run before italic to avoid double-processing
  let out = line.replace(/\*\*([^*]+)\*\*/g, (_m, text) => chalk.bold(text));
  // Italic *text* (single asterisk, not touching bold regions)
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m, text) => chalk.italic(text));
  // Inline code `text`
  out = out.replace(/`([^`]+)`/g, (_m, code) => chalk.cyan(code));
  return out;
}

function print(line: string): void {
  process.stdout.write(line + '\n');
}

function renderMarkdown(content: string): void {
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.startsWith('# ')) {
      print(chalk.bold.white(renderInline(line)));
    } else if (line.startsWith('## ')) {
      // Colorize click status indicators
      if (line.includes('✅')) {
        print('\n' + chalk.bold.green(renderInline(line)));
      } else if (line.includes('❌')) {
        print('\n' + chalk.bold.red(renderInline(line)));
      } else {
        print('\n' + chalk.bold.cyan(renderInline(line)));
      }
    } else if (line.startsWith('### ')) {
      print(chalk.bold(renderInline(line)));
    } else if (line.startsWith('> ')) {
      print(chalk.italic.dim(renderInline(line)));
    } else if (line.startsWith('| ')) {
      print(chalk.dim(line));
    } else if (line === '---') {
      print(chalk.dim('─'.repeat(60)));
    } else if (line.startsWith('*Generated by')) {
      print(chalk.dim(line));
    } else {
      print(renderInline(line));
    }
  }
}
