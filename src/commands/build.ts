import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export function buildCommand(): Command {
  const cmd = new Command('build');

  cmd
    .description('Rebuild the CLI binary and re-link it.\n\nRuns `npm run build && npm link` in the ratchet package directory.')
    .action(() => {
      // Resolve the ratchet package root (one level up from dist/)
      const thisFile = fileURLToPath(import.meta.url);
      const distDir = dirname(thisFile);
      const packageRoot = dirname(distDir);

      console.log(chalk.bold('\n🔨 Rebuilding ratchet…\n'));

      try {
        console.log(chalk.dim('  npm run build'));
        execSync('npm run build', { cwd: packageRoot, stdio: 'inherit' });

        console.log(chalk.dim('\n  npm link'));
        execSync('npm link', { cwd: packageRoot, stdio: 'inherit' });

        console.log(chalk.green('\n  ✓ Binary rebuilt and linked successfully.\n'));
      } catch (err) {
        console.error(chalk.red('\n  ✗ Build failed.') + '\n');
        process.exit(1);
      }
    });

  return cmd;
}
