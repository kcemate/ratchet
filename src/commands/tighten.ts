import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { loadRunState } from './status.js';
import { currentBranch, hasRemote } from '../core/git.js';

const execFileAsync = promisify(execFile);

export function tightenCommand(): Command {
  const cmd = new Command('tighten');

  cmd
    .description(
      'Finalize a Ratchet run and optionally create a pull request.\n\n' +
        'The PR title includes the click count, and the PR description includes\n' +
        'the full ratchet log: every click\'s analysis, proposal, and commit hash.\n\n' +
        'Reads the last run state from .ratchet-state.json.'
    )
    .option('--pr', 'Create a GitHub pull request (requires the gh CLI)', false)
    .option('--draft', 'Create the PR as a draft (use with --pr)', false)
    .action(async (options: { pr: boolean; draft: boolean }) => {
      const cwd = process.cwd();

      console.log(chalk.bold('\n⚙  Ratchet Tighten\n'));

      const run = await loadRunState(cwd);

      if (!run) {
        console.error(
          chalk.red('  No run state found.') +
            '\n  Run ' +
            chalk.cyan('ratchet torque') +
            ' first.\n',
        );
        process.exit(1);
      }

      if (run.status === 'running') {
        console.error(chalk.red('  Run is still in progress. Wait for it to finish.\n'));
        process.exit(1);
      }

      const passedClicks = run.clicks.filter((c) => c.testsPassed).length;
      const totalClicks = run.clicks.length;

      const branch = await currentBranch(cwd).catch(() => '');

      console.log(`  Target  : ${chalk.cyan(run.target.name)}`);
      console.log(`  Run ID  : ${chalk.dim(run.id)}`);
      if (branch) console.log(`  Branch  : ${chalk.cyan(branch)}`);
      console.log(`  Clicks  : ${chalk.green(String(passedClicks))} passed / ${totalClicks} total`);
      console.log(
        `  Status  : ${run.status === 'completed' ? chalk.green('completed') : chalk.red('failed')}`,
      );
      console.log('');

      if (passedClicks === 0) {
        console.log(chalk.yellow('  No successful clicks. Nothing to tighten.\n'));
        process.exit(0);
      }

      // List commits
      const commits = run.clicks
        .filter((c) => c.commitHash)
        .map((c) => `    ${chalk.dim(c.commitHash!.slice(0, 7))} — click ${c.number}`);

      if (commits.length > 0) {
        console.log('  ' + chalk.bold('Commits:'));
        console.log(commits.join('\n'));
        console.log('');
      }

      if (!options.pr) {
        console.log(
          chalk.green('  ✓') +
            ' Run finalized. Use ' +
            chalk.cyan('--pr') +
            ' to open a pull request.\n',
        );
        return;
      }

      // Guard: gh pr create requires a remote to push to
      if (!(await hasRemote(cwd))) {
        console.error(
          chalk.red('  No git remote configured.') +
            '\n  A remote is required to create a pull request.\n' +
            '\n  ' + chalk.dim('Add one with:') +
            '\n    ' + chalk.cyan('git remote add origin <url>') +
            '\n    ' + chalk.cyan('git push -u origin HEAD') + '\n',
        );
        process.exit(1);
      }

      // Create PR
      const spinner = ora('  Creating pull request…').start();
      try {
        // Load ratchet log for PR body
        const logPath = join(cwd, 'docs', `${run.target.name}-ratchet.md`);
        let logContent = '';
        try {
          logContent = await readFile(logPath, 'utf-8');
        } catch {
          logContent = `*No ratchet log found at \`${logPath}\`*`;
        }

        const clickWord = passedClicks === 1 ? 'click' : 'clicks';
        const prTitle = `ratchet(${run.target.name}): ${passedClicks} ${clickWord} of improvements`;
        const prBody = buildPRBody(run.id, run.target.name, passedClicks, totalClicks, logContent);

        const ghArgs = [
          'pr',
          'create',
          '--title',
          prTitle,
          '--body',
          prBody,
        ];

        if (options.draft) ghArgs.push('--draft');

        const { stdout } = await execFileAsync('gh', ghArgs, { cwd });
        const prUrl = stdout.trim();

        spinner.succeed(`Pull request created: ${chalk.cyan(prUrl)}`);
      } catch (err) {
        spinner.fail('Failed to create pull request');
        const msg = String(err);
        if (msg.includes('gh: command not found') || msg.includes('ENOENT')) {
          console.error(
            chalk.red('\n  gh CLI not found.') +
              ' Install it from ' +
              chalk.cyan('https://cli.github.com') +
              '\n',
          );
        } else {
          console.error(chalk.red('\n  ' + msg) + '\n');
        }
        process.exit(1);
      }

      console.log('');
    });

  return cmd;
}

function buildPRBody(
  runId: string,
  targetName: string,
  passedClicks: number,
  totalClicks: number,
  logContent: string,
): string {
  return `## Ratchet Run: \`${targetName}\`

**Run ID:** \`${runId}\`
**Clicks:** ${passedClicks} landed / ${totalClicks} attempted

This PR was generated by [Ratchet](https://github.com/ratchet-run/ratchet) — an autonomous iterative code improvement CLI.

Each _click_ is one complete **analyze → propose → build → test → commit** cycle.
Only changes that pass tests are committed (The Pawl). The codebase can only ever get better.

---

## Ratchet Log

${logContent}
`;
}
