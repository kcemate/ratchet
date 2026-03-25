import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { access, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { printHeader, warnIfNotRepo } from '../lib/cli.js';
import { logger } from '../lib/logger.js';

export type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'make' | 'unknown';

export interface DetectedProject {
  type: ProjectType;
  testCommand: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function detectProject(cwd: string): Promise<DetectedProject> {
  if (await exists(join(cwd, 'package.json'))) {
    if (await exists(join(cwd, 'pnpm-lock.yaml'))) {
      return { type: 'node', testCommand: 'pnpm test', packageManager: 'pnpm' };
    }
    if (await exists(join(cwd, 'yarn.lock'))) {
      return { type: 'node', testCommand: 'yarn test', packageManager: 'yarn' };
    }
    return { type: 'node', testCommand: 'npm test', packageManager: 'npm' };
  }

  if (
    (await exists(join(cwd, 'pytest.ini'))) ||
    (await exists(join(cwd, 'pyproject.toml'))) ||
    (await exists(join(cwd, 'setup.py'))) ||
    (await exists(join(cwd, 'setup.cfg')))
  ) {
    return { type: 'python', testCommand: 'pytest' };
  }

  if (await exists(join(cwd, 'go.mod'))) {
    return { type: 'go', testCommand: 'go test ./...' };
  }

  if (await exists(join(cwd, 'Cargo.toml'))) {
    return { type: 'rust', testCommand: 'cargo test' };
  }

  if (await exists(join(cwd, 'Makefile'))) {
    return { type: 'make', testCommand: 'make test' };
  }

  return { type: 'unknown', testCommand: 'npm test' };
}

export function buildConfig(project: DetectedProject, targetDir: string): string {
  const safePath = targetDir.endsWith('/') ? targetDir : `${targetDir}/`;
  const targetName = safePath.replace(/\/$/, '').replace(/.*\//, '') || 'main';

  return `# .ratchet.yml — Ratchet configuration
# Run 'ratchet torque --target ${targetName}' to start the click loop.
# Docs: https://github.com/ratchet-run/ratchet

agent: claude-code
model: claude-sonnet-4-6

defaults:
  clicks: 7
  test_command: ${project.testCommand}
  auto_commit: true

targets:
  - name: ${targetName}
    path: ${safePath}
    description: "Iteratively improve code quality in ${safePath}"

# Boundaries protect critical paths from agent modification.
# boundaries:
#   - path: src/auth/
#     rule: no-modify
#     reason: "Auth logic is security-sensitive — do not touch"
#   - path: "**/*.test.ts"
#     rule: preserve-pattern
#     reason: "Test structure follows team convention"
#   - path: migrations/
#     rule: no-delete
#     reason: "Migration files are append-only"

# Scan settings. Non-production directories (scripts/, migrations/, seed/,
# fixtures/, examples/, docs/, __fixtures__/, __mocks__/) are excluded by
# default so your score reflects production code quality only.
# scan:
#   include_non_production: false  # set to true to score all directories
`;
}

export function initCommand(): Command {
  const cmd = new Command('init');

  cmd
    .description(
      'Initialize Ratchet in the current project.\n' +
      'Auto-detects project type and test command, then writes .ratchet.yml.\n\n' +
      'Supports: npm, yarn, pnpm, pytest, go test, cargo test, make test'
    )
    .argument('[dir]', 'Directory to initialize (default: current directory)', '.')
    .option('--force', 'Overwrite existing .ratchet.yml', false)
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ ratchet init\n' +
        '  $ ratchet init --force\n' +
        '  $ ratchet init ./my-project\n',
    )
    .action(async (dir: string, options: { force: boolean }) => {
      const cwd = resolve(dir);
      const configPath = join(cwd, '.ratchet.yml');

      printHeader('⚙  Ratchet Init');

      // Warn if not inside a git repo — ratchet torque requires git to function.
      await warnIfNotRepo(cwd);

      // Guard: already initialized
      if (await exists(configPath)) {
        if (!options.force) {
          process.stdout.write(
            chalk.yellow('  .ratchet.yml already exists.') +
            chalk.dim(' Use --force to overwrite.') + '\n',
          );
          process.exit(1);
        }
        process.stdout.write(chalk.dim('  Overwriting existing .ratchet.yml…') + '\n');
      }

      // Detect project
      const detectSpinner = ora('Detecting project type…').start();
      let project: DetectedProject;
      try {
        project = await detectProject(cwd);
        detectSpinner.succeed(
          `${chalk.cyan(project.type)} project detected → ` +
            `test command: ${chalk.green(project.testCommand)}`,
        );
      } catch (err) {
        detectSpinner.fail('Failed to detect project type');
        logger.error({ err }, 'Failed to detect project type');
        process.exit(1);
      }

      // Pick default target directory
      const hasSource = await exists(join(cwd, 'src'));
      const targetDir = hasSource ? 'src' : '.';

      // Derive the target name the same way buildConfig does
      const safePath = targetDir.endsWith('/') ? targetDir : `${targetDir}/`;
      const detectedTargetName = safePath.replace(/\/$/, '').replace(/.*\//, '') || 'main';

      // Write config
      const writeSpinner = ora('Writing .ratchet.yml…').start();
      try {
        const config = buildConfig(project, targetDir);
        await writeFile(configPath, config, 'utf-8');
        writeSpinner.succeed(`Created ${chalk.green('.ratchet.yml')}`);
      } catch (err) {
        writeSpinner.fail('Failed to write .ratchet.yml');
        logger.error({ err }, 'Failed to write .ratchet.yml');
        process.exit(1);
      }

      process.stdout.write(
        `\n${chalk.bold('Next steps:')}\n` +
        `  ${chalk.dim('1.')} Edit ${chalk.cyan('.ratchet.yml')} — set your targets and boundaries\n` +
        `  ${chalk.dim('2.')} Run ` +
        `${chalk.green(`ratchet torque --target ${detectedTargetName}`)} to start the loop\n\n`,
      );
    });

  return cmd;
}
