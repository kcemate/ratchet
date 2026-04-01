import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { access, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { printHeader, warnIfNotRepo } from '../lib/cli.js';
import { logger } from '../lib/logger.js';

// ── Repo classification

export interface RepoClassification {
  /** Human-readable framework label, e.g. "Next.js app", "Express API" */
  framework: string;
  /** Directories that should be excluded from scanning, with trailing slash */
  excludeDirs: string[];
}

export type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'make' | 'unknown';

export interface DetectedProject {
  type: ProjectType;
  testCommand: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  testFramework?: 'vitest' | 'jest' | 'mocha';
  isMonorepo?: boolean;
  excludeDirs?: string[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Read package.json and return parsed object, or null on failure. */
async function readPackageJson(
  cwd: string,
): Promise<{
  name?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
} | null> {
  const pkgPath = join(cwd, 'package.json');
  if (!(await exists(pkgPath))) return null;
  try {
    return JSON.parse(await readFile(pkgPath, 'utf-8')) as {
      name?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
      workspaces?: string[] | { packages?: string[] };
    };
  } catch {
    return null;
  }
}

/** Detect which test framework a Node project uses and return the best test command. */
function detectTestFramework(
  pkg: NonNullable<Awaited<ReturnType<typeof readPackageJson>>>,
  pm: 'npm' | 'yarn' | 'pnpm',
): { testCommand: string; testFramework?: 'vitest' | 'jest' | 'mocha' } {
  const allDeps = { ...pkg.devDependencies, ...pkg.dependencies };
  const testScript = pkg.scripts?.['test'] ?? '';
  const runPrefix = pm === 'npm' ? 'npx' : pm;

  if (allDeps['vitest'] || testScript.includes('vitest')) {
    return { testCommand: `${runPrefix} vitest run`, testFramework: 'vitest' };
  }
  if (allDeps['jest'] || testScript.includes('jest')) {
    return { testCommand: `${runPrefix} jest`, testFramework: 'jest' };
  }
  if (allDeps['mocha'] || testScript.includes('mocha')) {
    return { testCommand: `${runPrefix} mocha`, testFramework: 'mocha' };
  }
  // Fall back to the test script as-is, or pm test
  const fallback = testScript && !testScript.startsWith('echo') ? testScript : `${pm} test`;
  return { testCommand: fallback };
}

/** Check if a Node project is a monorepo (workspaces, lerna, pnpm-workspace). */
async function detectMonorepo(
  cwd: string,
  pkg: NonNullable<Awaited<ReturnType<typeof readPackageJson>>>,
): Promise<boolean> {
  if (pkg.workspaces) return true;
  if (await exists(join(cwd, 'lerna.json'))) return true;
  if (await exists(join(cwd, 'pnpm-workspace.yaml'))) return true;
  if (await exists(join(cwd, 'packages'))) return true;
  return false;
}

/** Detect common non-production directories that should be excluded from scanning. */
async function detectExcludeDirs(cwd: string): Promise<string[]> {
  const candidates = [
    'e2e', 'integration-tests', 'integration_tests',
    'docs', 'scripts', 'fixtures', 'benchmarks',
    'storybook', '.storybook', 'coverage', 'examples',
    '__mocks__', '__fixtures__',
  ];
  const found: string[] = [];
  for (const dir of candidates) {
    if (await exists(join(cwd, dir))) found.push(dir + '/');
  }
  return found;
}

/**
 * Classify the repo to determine its framework and which directories to exclude.
 * Returns a RepoClassification with a human-readable label and a list of
 * non-production directories that should not be scored.
 */
export async function classifyRepo(cwd: string): Promise<RepoClassification> {
  const pkg = await readPackageJson(cwd);
  const allDeps = { ...pkg?.devDependencies, ...pkg?.dependencies };

  // Framework detection (order matters — most specific first)
  let framework = 'Node.js project';
  if (!pkg) {
    if (await exists(join(cwd, 'go.mod'))) framework = 'Go project';
    else if (await exists(join(cwd, 'Cargo.toml'))) framework = 'Rust project';
    else if (await exists(join(cwd, 'pyproject.toml')) || await exists(join(cwd, 'setup.py'))) {
      framework = 'Python project';
    } else {
      framework = 'Unknown project';
    }
  } else if (
    allDeps['next'] ||
    await exists(join(cwd, 'next.config.js')) ||
    await exists(join(cwd, 'next.config.ts')) ||
    await exists(join(cwd, 'next.config.mjs'))
  ) {
    framework = 'Next.js app';
  } else if (allDeps['@nestjs/core']) {
    framework = 'NestJS app';
  } else if (allDeps['react']) {
    framework = 'React app';
  } else if (allDeps['fastify']) {
    framework = 'Fastify API';
  } else if (allDeps['express']) {
    framework = 'Express API';
  } else if (allDeps['hono']) {
    framework = 'Hono API';
  } else {
    framework = 'Node.js library';
  }

  // Detect directories to exclude — always check for these
  const excludeCandidates = [
    'migrations', 'migration',           // DB migrations
    'fixtures', '__fixtures__',          // test fixtures
    'e2e', 'integration-tests', 'integration_tests', // e2e / integration
    'scripts',                           // build/deploy scripts
    'docs', 'documentation',             // docs
    'benchmarks', 'bench',               // benchmarks
    'examples', 'example',               // examples
    'storybook', '.storybook',           // Storybook
    '__mocks__',                         // Jest mocks
  ];

  const excludeDirs: string[] = [];
  for (const dir of excludeCandidates) {
    if (await exists(join(cwd, dir))) excludeDirs.push(dir + '/');
  }

  // Framework-specific extra exclusions
  if (framework === 'Next.js app') {
    if (await exists(join(cwd, 'public'))) excludeDirs.push('public/');
  }

  return { framework, excludeDirs };
}

export async function detectProject(cwd: string): Promise<DetectedProject> {
  const pkg = await readPackageJson(cwd);

  if (pkg !== null) {
    const pm: 'npm' | 'yarn' | 'pnpm' = (await exists(join(cwd, 'pnpm-lock.yaml')))
      ? 'pnpm'
      : (await exists(join(cwd, 'yarn.lock')))
        ? 'yarn'
        : 'npm';

    const { testCommand, testFramework } = detectTestFramework(pkg, pm);
    const isMonorepo = await detectMonorepo(cwd, pkg);
    const excludeDirs = await detectExcludeDirs(cwd);

    return { type: 'node', testCommand, packageManager: pm, testFramework, isMonorepo, excludeDirs };
  }

  if (
    (await exists(join(cwd, 'pytest.ini'))) ||
    (await exists(join(cwd, 'pyproject.toml'))) ||
    (await exists(join(cwd, 'setup.py'))) ||
    (await exists(join(cwd, 'setup.cfg')))
  ) {
    const excludeDirs = await detectExcludeDirs(cwd);
    return { type: 'python', testCommand: 'pytest', excludeDirs };
  }

  if (await exists(join(cwd, 'go.mod'))) {
    const excludeDirs = await detectExcludeDirs(cwd);
    return { type: 'go', testCommand: 'go test ./...', excludeDirs };
  }

  if (await exists(join(cwd, 'Cargo.toml'))) {
    const excludeDirs = await detectExcludeDirs(cwd);
    return { type: 'rust', testCommand: 'cargo test', excludeDirs };
  }

  if (await exists(join(cwd, 'Makefile'))) {
    return { type: 'make', testCommand: 'make test' };
  }

  return { type: 'unknown', testCommand: 'npm test' };
}

export function buildConfig(project: DetectedProject, targetDir: string): string {
  const safePath = targetDir.endsWith('/') ? targetDir : `${targetDir}/`;
  const targetName = safePath.replace(/\/$/, '').replace(/.*\//, '') || 'main';

  const monorepoComment = project.isMonorepo
    ? '# monorepo: true  # Detected workspaces — consider separate targets per package\n\n'
    : '';

  const excludeBlock =
    project.excludeDirs && project.excludeDirs.length > 0
      ? '\n# Non-production directories detected — uncomment to exclude from scanning:\n' +
        project.excludeDirs.map(d => `# exclude: ${d}`).join('\n') + '\n'
      : '';

  const frameworkNote = project.testFramework
    ? `  # Detected test framework: ${project.testFramework}\n`
    : '';

  return `# .ratchet.yml — Ratchet configuration
# Run 'ratchet torque --target ${targetName}' to start the click loop.
# Docs: https://github.com/ratchet-run/ratchet
${monorepoComment}
agent: claude-code
model: claude-sonnet-4-6

defaults:
  clicks: 7
${frameworkNote}  test_command: ${project.testCommand}
  auto_commit: true

targets:
  - name: ${targetName}
    path: ${safePath}
    description: "Iteratively improve code quality in ${safePath}"
${excludeBlock}
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
      'Auto-detects project type, test framework, package manager,\n' +
      'monorepo layout, and non-production dirs, then writes .ratchet.yml.\n\n' +
      'Supports: npm, yarn, pnpm (vitest/jest/mocha), pytest, go test, cargo test, make test'
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

      // Detect project + classify repo (framework, monorepo, excludes)
      const detectSpinner = ora('Detecting project type and scanning repo…').start();
      let project: DetectedProject;
      let classification: RepoClassification;
      try {
        [project, classification] = await Promise.all([
          detectProject(cwd),
          classifyRepo(cwd),
        ]);

        const extras: string[] = [];
        if (project.testFramework) extras.push(`test: ${chalk.cyan(project.testFramework)}`);
        if (project.packageManager) extras.push(`pm: ${chalk.cyan(project.packageManager)}`);
        if (project.isMonorepo) extras.push(chalk.yellow('monorepo'));

        detectSpinner.succeed(
          `${chalk.cyan(classification.framework)} detected — ` +
          `${chalk.green(project.testCommand)}` +
          (extras.length > 0 ? `  (${extras.join(', ')})` : ''),
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

      // Write .ratchetignore with auto-detected exclusions
      if (classification.excludeDirs.length > 0) {
        const ratchetIgnorePath = join(cwd, '.ratchetignore');
        const ignoreContent =
          '# Auto-generated by ratchet init — directories excluded from scan scoring\n' +
          classification.excludeDirs.join('\n') + '\n';
        try {
          await writeFile(ratchetIgnorePath, ignoreContent, 'utf-8');
        } catch (err) {
          logger.warn({ err }, 'Failed to write .ratchetignore');
        }
      }

      // Emit calibration summary
      if (classification.excludeDirs.length > 0) {
        process.stdout.write(
          chalk.green(`\n  Detected: ${classification.framework}.`) +
          chalk.dim(
            ` Pre-configured exclusions: ${classification.excludeDirs.join(', ')}\n` +
            '  (written to .ratchetignore — edit to adjust)\n',
          ),
        );
      }

      if (project.isMonorepo) {
        process.stdout.write(
          chalk.yellow('\n  ⚠ Monorepo detected.') +
          chalk.dim(
            ' Consider adding separate targets per package\n' +
            '  (e.g. packages/api/, packages/web/) in .ratchet.yml.\n',
          ),
        );
      }

      process.stdout.write(
        `\n${chalk.bold('Next steps:')}\n` +
        `  ${chalk.dim('1.')} Edit ${chalk.cyan('.ratchet.yml')} — review targets and boundaries\n` +
        `  ${chalk.dim('2.')} Run ` +
        `${chalk.green(`ratchet torque --target ${detectedTargetName}`)} to start the loop\n\n`,
      );

    });

  return cmd;
}
