import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { IssueSubcategory, IssueCategoryName } from '../core/taxonomy.js';
import { printHeader, severityColor, scoreColor } from '../lib/cli.js';
import { logger } from '../lib/logger.js';
import { classifyIssues, summarizeClassifications } from '../core/cross-cutting.js';
import { getExplanation } from '../core/explanations.js';
import type { ClickGuards } from '../types.js';
import type { SupportedLanguage } from '../core/language-rules.js';
import { ClassicEngine } from '../core/engines/classic.js';
import { createEngine } from '../core/engine-router.js';

import { CategoryThreshold, GateResult, parseCategoryThreshold, evaluateGates, exitWithGateFailure, Baseline, loadBaseline, saveBaseline, deltaStr, runScan, RunScanOptions, ScanResult } from '../core/scanner';

export function scanCommand(): Command {
  const cmd = new Command('scan');

  cmd
    .description(
      'Scan the project and generate a Production Readiness Score (0-100).\n' +
      'Analyzes testing, security, types, error handling, performance, and code quality.',
    )
    .argument('[dir]', 'Directory to scan (default: current directory)', '.')
    .option(
      '--fail-on <score>',
      'Exit with code 1 if the overall score is below this threshold (0-100).',
      (value) => {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 0 || n > 100) throw new Error('--fail-on must be an integer between 0 and 100');
        return n;
      },
    )
    .option(
      '--fail-on-category <name=score>',
      'Exit with code 1 if a category score is below its threshold. Repeatable.',
      (value, prev: string[]) => [...(prev ?? []), value],
      [] as string[],
    )
    .option('--output-json', 'Output the full scan result as JSON for CI/CD integration.')
    .option('--explain', "Show human-readable explanations for each subcategory's issues.")
    .option(
      '-e, --explain-deductions',
      'Show exactly which files and line numbers caused score deductions.',
    )
    .option('--include-tests', 'Include test files in the scan (by default, test files are excluded).')
    .option(
      '--language <lang>',
      'Language to scan: ts, js, python, go, rust, auto (default: auto — detected from project files).',
      'auto',
    )
    .option('--baseline', 'Save current scan result as baseline to .ratchet/baseline.json.')
    .option('--no-baseline', 'Skip baseline comparison for this run.')
    .option(
      '--diff [base]',
      'Scan only files changed since <base> (branch, commit, or HEAD~N). Defaults to HEAD~1.',
    )
    .option(
      '--top <n>',
      'Show top N highest-impact improvements (quick-fix mode). Default: 3.',
    )
    .option(
      '--no-registry',
      'Skip submitting results to the Ratchet Score Registry (RATCHET_REGISTRY_KEY must be set to enable).',
    )
    .option('--deep', 'Use deep (LLM-powered) scanning engine (requires Ratchet Pro subscription).')
    .option(
      '--engine <mode>',
      'Scoring engine to use: classic (default), deep, or auto (reads RATCHET_ENGINE env var).',
      'classic',
    )
    .option(
      '--categories <list>',
      'Comma-separated list of categories to analyse (e.g. Testing,Security).',
    )
    .option(
      '--budget <amount>',
      'Maximum spend in USD for deep scanning (deep engine only).',
      parseFloat,
    )
    .option(
      '--scan-model <model>',
      'Model to use for deep scanning, independent of the fix/improve model (e.g. kimi-k2:1t, gpt-4o-mini).',
    )
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet scan\n' +
      '  $ ratchet scan ./my-project\n' +
      '  $ ratchet scan --fail-on 80\n' +
      '  $ ratchet scan --fail-on 80 --fail-on-category Security=12\n' +
      '  $ ratchet scan --output-json > scan-result.json\n' +
      '  $ ratchet scan --explain\n' +
      '  $ ratchet scan --explain-deductions\n' +
      '  $ ratchet scan -e\n' +
      '  $ ratchet scan --include-tests\n' +
      '  $ ratchet scan --language python\n' +
      '  $ ratchet scan --baseline\n' +
      '  $ ratchet scan --no-baseline\n' +
      '  $ ratchet scan --diff main\n' +
      '  $ ratchet scan --diff HEAD~3\n' +
      '  $ ratchet scan --engine classic\n' +
      '  $ ratchet scan --deep\n' +
      '  $ ratchet scan --categories Testing,Security\n' +
      '  $ ratchet scan --deep --scan-model kimi-k2:1t\n',
    )
    .action(async (dir: string, options: Record<string, unknown>) => {
      const { resolve } = await import('path');
      const { findSourceFiles } = await import('../core/scan-constants.js');
      const cwd = resolve(dir);

      // --top: quick-fix mode — show top N highest-impact improvements
      if (options['top'] !== undefined) {
        const { quickFixCommand } = await import('./quick-fix.js');
        await quickFixCommand().parseAsync(['node', 'quick-fix', dir]);
        return;
      }

      // telemetry: no-op in open-source build

      // Language detection / warning
      const langOpt = (options['language'] as Language | undefined) ?? 'auto';
      const validLanguages: Language[] = ['ts', 'js', 'python', 'go', 'rust', 'auto'];
      if (!validLanguages.includes(langOpt)) {
        process.stderr.write(
          chalk.red(`Invalid --language value: "${langOpt}". Valid values: ts, js, python, go, rust, auto.\n`),
        );
        process.exit(1);
      }

      let resolvedLang: 'ts' | 'js' | 'python' | 'go' | 'rust';
      if (langOpt === 'auto') {
        const { language, detected } = detectLanguage(cwd);
        resolvedLang = language;
        if (!detected) {
          process.stdout.write(chalk.yellow(NON_TSJS_WARNING('this')) + '\n\n');
        }
      } else {
        resolvedLang = langOpt as 'ts' | 'js' | 'python' | 'go' | 'rust';
      }

      // --- --diff: filter to changed files only ---
      let diffFiles: string[] | undefined;
      const diffOpt = options['diff'] as string | boolean | undefined;
      if (diffOpt !== undefined) {
        const base = typeof diffOpt === 'string' ? diffOpt : 'HEAD~1';
        const { execSync } = await import('child_process');
        let changedRaw = '';
        try {
          changedRaw = execSync(`git diff --name-only ${base}`, {
            cwd,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          logger.warn({ base }, 'git diff failed — scanning all files');
        }
        if (changedRaw) {
          const changedAbs = new Set(
            changedRaw.split('\n').filter(Boolean).map(f => resolve(cwd, f)),
          );
          const allSrcFiles = findSourceFiles(cwd);
          diffFiles = allSrcFiles.filter(f => changedAbs.has(f));
          process.stdout.write(
            `Scanning ${diffFiles.length} changed file${diffFiles.length !== 1 ? 's' : ''} (vs ${base})\n`,
          );
        }
      }

      // Load scan config from .ratchet.yml if present
      let includeNonProduction = false;
      let cfgEngineMode: 'classic' | 'deep' | 'auto' = 'classic';
      try {
        const { loadConfig } = await import('../core/config.js');
        const cfg = loadConfig(cwd);
        includeNonProduction = cfg.scan?.includeNonProduction ?? false;
        cfgEngineMode = (cfg.scan?.engine as 'classic' | 'deep' | 'auto' | undefined) ?? 'classic';
      } catch { /* use default */ }

      // Resolve engine mode: --deep flag overrides --engine, which overrides config
      const deepFlag = options['deep'] as boolean | undefined;
      const engineOpt = options['engine'] as string | undefined;
      const engineMode: 'classic' | 'deep' | 'auto' = deepFlag
        ? 'deep'
        : (engineOpt as 'classic' | 'deep' | 'auto' | undefined) ?? cfgEngineMode;

      // Resolve category filter
      const categoriesOpt = options['categories'] as string | undefined;
      const categories = categoriesOpt ? categoriesOpt.split(',').map(s => s.trim()) : undefined;

      const budget = options['budget'] as number | undefined;
      const scanModel = options['scanModel'] as string | undefined;

      // Load config for engine router
      let ratchetConfig;
      try {
        const { loadConfig } = await import('../core/config.js');
        ratchetConfig = loadConfig(cwd);
      } catch { /* use default */ }

      const engine = createEngine(engineMode, ratchetConfig, { scanModel });

      const result = await engine.analyze(cwd, {
        includeTests: options['includeTests'] as boolean | undefined,
        files: diffFiles,
        includeNonProduction,
        lang: resolvedLang,
        categories,
        budget,
      });

      if (options['outputJson']) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }

      const saveAsBaseline = options['baseline'] === true;
      const skipBaseline = options['baseline'] === false;

      let baseline: Baseline | null = null;
      if (!saveAsBaseline && !skipBaseline) {
        baseline = loadBaseline(cwd);
      }

      renderScan(result, { explain: options['explain'] as boolean | undefined, baseline });

      if (options['explainDeductions']) {
        renderDeductions(result, cwd);
      }

      if (saveAsBaseline) {
        saveBaseline(cwd, result);
        const baselineMsg = `  ✔ Baseline saved: ${result.total}/${result.maxTotal}` +
          ` (${result.totalIssuesFound} issues)\n\n`;
        process.stdout.write(chalk.green(baselineMsg));
      }

      const failOn = options['failOn'] as number | undefined;
      const failOnCategory = (options['failOnCategory'] as string[] | undefined) ?? [];

      if (failOn !== undefined || failOnCategory.length > 0) {
        const categoryThresholds = failOnCategory.map(parseCategoryThreshold);
        const gate = evaluateGates(result, failOn ?? null, categoryThresholds);
        if (!gate.passed) exitWithGateFailure(gate);
        process.stdout.write(chalk.green('  ✔ Quality gates passed\n\n'));
      }

      // Auto-submit to registry when RATCHET_REGISTRY_KEY is configured
      // and --no-registry was not passed.
      if (options['registry'] !== false && process.env['RATCHET_REGISTRY_KEY']) {
        let ratchetVersion = 'unknown';
        try {
          import { readFileSync } from 'fs';
          const pkgPath = new URL('../../package.json', import.meta.url).pathname;
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
          ratchetVersion = pkg.version ?? 'unknown';
        } catch { /* use default */ }

        import { submitToRegistry } from '../registry/client.js';
        const submitResult = await submitToRegistry(result, cwd, resolvedLang, ratchetVersion);
        if (submitResult.ok) {
          process.stdout.write(chalk.dim(`  ↑ Score submitted to registry (#${submitResult.submission_id})\n\n`));
        }
      }
    });

  return cmd;
}