import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { validateLicenseRemote, saveLicense, loadLicense, clearLicense, getLicensePath } from '../core/license.js';
import { logger } from '../lib/logger.js';

export function loginCommand(): Command {
  const cmd = new Command('login');

  cmd
    .description('Activate your Ratchet license key.')
    .argument('<key>', 'License key from your subscription email')
    .action(async (key: string) => {
      const spinner = ora('Validating license key...').start();

      const result = await validateLicenseRemote(key);

      if (!result.valid) {
        spinner.fail(chalk.red('Invalid license key'));
        logger.error({ error: result.error }, 'License validation failed');
        process.exit(1);
      }

      saveLicense(result.license!);
      spinner.succeed(chalk.green('License activated!'));
      logger.info({ plan: result.license!.tier }, 'License activated');
      if (result.license!.email) {
        logger.info({ email: result.license!.email }, 'License email');
      }
      if (result.license!.cyclesTotal) {
        logger.info({ cyclesRemaining: result.license!.cyclesRemaining ?? result.license!.cyclesTotal, cyclesTotal: result.license!.cyclesTotal }, 'License cycles');
      }
      logger.info({ path: getLicensePath() }, 'License saved');
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
        logger.info('No active license found');
        return;
      }

      clearLicense();
      logger.info('License removed');
    });

  return cmd;
}
