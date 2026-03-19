import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { validateLicenseRemote, saveLicense, loadLicense, clearLicense, getLicensePath } from '../core/license.js';

export function loginCommand(): Command {
  const cmd = new Command('login');

  cmd
    .description('Activate your Ratchet license key.')
    .argument('<key>', 'License key from your subscription email')
    .action(async (key: string) => {
      console.log('');
      const spinner = ora('Validating license key...').start();

      const result = await validateLicenseRemote(key);

      if (!result.valid) {
        spinner.fail(chalk.red('Invalid license key'));
        console.error(`  ${result.error}`);
        console.error('');
        process.exit(1);
      }

      saveLicense(result.license!);
      spinner.succeed(chalk.green('License activated!'));
      console.log('');
      console.log(`  ${chalk.dim('Plan:')}     ${chalk.bold(result.license!.tier)}`);
      if (result.license!.email) {
        console.log(`  ${chalk.dim('Email:')}    ${result.license!.email}`);
      }
      if (result.license!.cyclesTotal) {
        console.log(`  ${chalk.dim('Cycles:')}   ${result.license!.cyclesRemaining ?? result.license!.cyclesTotal}/${result.license!.cyclesTotal} remaining`);
      }
      console.log('');
      console.log(`  License saved to ${chalk.dim(getLicensePath())}`);
      console.log('');
    });

  return cmd;
}

export function logoutCommand(): Command {
  const cmd = new Command('logout');

  cmd
    .description('Deactivate and remove your Ratchet license key.')
    .action(() => {
      const license = loadLicense();
      if (!license || !license.key) {
        console.log('');
        console.log(chalk.dim('  No active license found.'));
        console.log('');
        return;
      }

      clearLicense();
      console.log('');
      console.log(chalk.green('  ✓ License removed.'));
      console.log('');
    });

  return cmd;
}
