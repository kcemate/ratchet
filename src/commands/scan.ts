import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { IssueSubcategory, IssueCategoryName } from "../core/taxonomy.js";
import { printHeader, severityColor, scoreColor } from "../lib/cli.js";
import { logger } from "../lib/logger.js";
import { classifyIssues, summarizeClassifications } from "../core/cross-cutting.js";
import { getExplanation } from "../core/explanations.js";
import type { ClickGuards } from "../types.js";
import type { SupportedLanguage } from "../core/language-rules.js";
import { ClassicEngine } from "../core/engines/classic.js";
import { createEngine } from "../core/engine-router.js";

import {
  CategoryThreshold,
  GateResult,
  parseCategoryThreshold,
  evaluateGates,
  exitWithGateFailure,
  Baseline,
  loadBaseline,
  saveBaseline,
  deltaStr,
  runScan,
  RunScanOptions,
  ScanResult,
} from "../core/scanner";
export { runScan, ScanResult } from "../core/scanner";

// --- Language detection ---

type Language = "ts" | "js" | "python" | "go" | "rust" | "auto";

const NON_TSJS_WARNING = (lang: string) =>
  `Note: Ratchet scoring is optimized for TypeScript/JavaScript projects. ` +
  `Some rules (console.log, any types, tsconfig) may not apply to ${lang} projects. ` +
  `Language-specific scoring is coming soon.`;

function detectLanguage(cwd: string): { language: "ts" | "js" | "python" | "go" | "rust"; detected: boolean } {
  if (existsSync(join(cwd, "tsconfig.json"))) return { language: "ts", detected: true };
  if (existsSync(join(cwd, "package.json"))) return { language: "js", detected: true };
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "setup.py")))
    return { language: "python", detected: true };
  if (existsSync(join(cwd, "go.mod"))) return { language: "go", detected: true };
  if (existsSync(join(cwd, "Cargo.toml"))) return { language: "rust", detected: true };
  return { language: "ts", detected: false };
}

// --- Scan output renderers ---

function renderDeductions(result: ScanResult, cwd: string): void {
  printHeader("📋 Score Deductions");

  let hasAnyDeductions = false;

  for (const cat of result.categories) {
    const catDeduction = cat.max - cat.score;
    if (catDeduction <= 0) continue;

    hasAnyDeductions = true;
    process.stdout.write(
      `\n  ${cat.emoji} ${chalk.bold(cat.name)}` +
        `  ${chalk.dim(`${cat.score}/${cat.max} pts`)}` +
        `  ${chalk.red(`(−${catDeduction} pts)`)}\n`
    );

    for (const sub of cat.subcategories) {
      if (sub.issuesFound === 0) continue;
      const subDeduction = sub.max - sub.score;
      const locations = sub.locations ?? [];
      const desc = sub.issuesDescription ?? "issue";

      if (locations.length > 0) {
        process.stdout.write(
          `    ${chalk.dim(sub.name)}` + (subDeduction > 0 ? `  ${chalk.red(`−${subDeduction} pts`)}` : "") + `:\n`
        );
        const shown = locations.slice(0, 12);
        for (const loc of shown) {
          const rel = loc.replace(cwd + "/", "").replace(cwd + "\\", "");
          process.stdout.write(`      ${chalk.cyan(rel)} — ${chalk.dim(desc)}\n`);
        }
        if (locations.length > 12) {
          process.stdout.write(chalk.dim(`      ... and ${locations.length - 12} more\n`));
        }
      } else {
        process.stdout.write(
          `    ${chalk.dim(sub.name)}` +
            (subDeduction > 0 ? `  ${chalk.red(`−${subDeduction} pts`)}` : "") +
            `:  ${chalk.dim(sub.summary)}\n`
        );
      }
    }
  }

  if (!hasAnyDeductions) {
    process.stdout.write(chalk.green("\n  ✔ No deductions — perfect score!\n"));
  }

  process.stdout.write("\n");
}

function renderScan(result: ScanResult, opts?: { explain?: boolean; baseline?: Baseline | null }): void {
  const showExplain = opts?.explain ?? false;
  const baseline = opts?.baseline ?? null;
  printHeader("🔧 Ratchet Scan — Production Readiness");
  process.stdout.write(`Your app: ${chalk.cyan(result.projectName)}\n`);

  const totalColor = scoreColor(result.total, result.maxTotal);
  const issuesStr = result.totalIssuesFound > 0 ? chalk.dim(`  |  Issues: ${result.totalIssuesFound} found`) : "";
  process.stdout.write(`Score:    ${totalColor.bold(`${result.total}/${result.maxTotal}`)}${issuesStr}\n`);

  if (baseline !== null) {
    const scoreDiff = result.total - baseline.score;
    const issuesDiff = result.totalIssuesFound - baseline.issues;
    const issuesDiffStr =
      issuesDiff === 0
        ? chalk.dim("—")
        : issuesDiff > 0
          ? chalk.red(`+${issuesDiff} issues`)
          : chalk.green(`-${Math.abs(issuesDiff)} issues`);
    process.stdout.write(
      `Baseline: ${chalk.dim(`${baseline.score}/${result.maxTotal}`)}` +
        `  |  Δ ${deltaStr(scoreDiff)} pts  |  ${issuesDiffStr}\n`
    );
  }

  process.stdout.write("\n");

  for (const cat of result.categories) {
    const color = scoreColor(cat.score, cat.max);
    const label = `${cat.emoji} ${cat.name}`.padEnd(22);
    const catDelta =
      baseline !== null && baseline.categories[cat.name] !== undefined
        ? `  (${deltaStr(cat.score - baseline.categories[cat.name]!)})`
        : "";
    process.stdout.write(`  ${label} ${color.bold(`${cat.score}/${cat.max}`)}${catDelta}\n`);

    for (const sub of cat.subcategories) {
      const subColor = scoreColor(sub.score, sub.max);
      const subLabel = sub.name.padEnd(24);
      const subScore = `${sub.score}/${sub.max}`.padEnd(6);
      process.stdout.write(`     ${chalk.dim(subLabel)} ${subColor(`${subScore}`)}  ${chalk.dim(sub.summary)}\n`);

      if (showExplain) {
        const explanation = getExplanation(sub.name);
        if (explanation) {
          process.stdout.write(`       ${chalk.cyan("Why?")} ${explanation.why}\n`);
          process.stdout.write(`       ${chalk.green("Fix:")} ${explanation.fix}\n`);
          if (explanation.example) {
            for (const line of explanation.example.split("\n")) {
              process.stdout.write(`       ${chalk.dim(line)}\n`);
            }
          }
        }
      }
    }
  }

  if (result.issuesByType.length > 0) {
    process.stdout.write("\n");
    process.stdout.write(`  ${chalk.bold(`📋 Issues Found: ${result.totalIssuesFound}`)}\n`);
    const topIssues = result.issuesByType.slice(0, 8);
    for (const issue of topIssues) {
      const sevColor = severityColor(issue.severity);
      process.stdout.write(`     ${issue.count} ${issue.description} ${sevColor(`(${issue.severity})`)}\n`);
    }
    if (result.issuesByType.length > 8) {
      const remaining = result.issuesByType.length - 8;
      process.stdout.write(chalk.dim(`     ... and ${remaining} more issue type${remaining !== 1 ? "s" : ""}`) + "\n");
    }
  }

  const defaultGuards: ClickGuards = { maxFilesChanged: 3, maxLinesChanged: 40 };
  const classifications = classifyIssues(result, defaultGuards);
  if (classifications.length > 0) {
    const summary = summarizeClassifications(classifications);
    const crossAndArch = [...summary.crossCutting, ...summary.architectural];
    if (crossAndArch.length > 0) {
      process.stdout.write("\n");
      process.stdout.write(chalk.yellow("  ⚠ Cross-cutting issues detected:") + "\n");
      for (const c of crossAndArch) {
        const hits = `${c.hitCount} hits across ${c.fileCount} file${c.fileCount !== 1 ? "s" : ""}`;
        const rec = c.recommendation ? ` — ${c.recommendation}` : "";
        process.stdout.write(`     ${c.subcategory} (${hits})${rec}\n`);
      }
    }
    if (summary.singleFile.length > 0) {
      process.stdout.write("\n");
      process.stdout.write(chalk.green("  ✅ Single-file issues (fixable with normal torque):") + "\n");
      for (const c of summary.singleFile) {
        process.stdout.write(`     ${c.subcategory} (${c.hitCount} in individual files)\n`);
      }
    }
    if (summary.hasAnyCrossCutting) {
      process.stdout.write("\n");
      process.stdout.write(chalk.cyan(`  💡 Recommended: ${summary.recommendedCommand}`) + "\n");
    }
  }

  process.stdout.write("\n");
  process.stdout.write(chalk.dim("Run 'npx ratchet fix' to improve your score.") + "\n");
  process.stdout.write("\n");
}

export function scanCommand(): Command {
  const cmd = new Command("scan");

  cmd
    .description(
      "Scan the project and generate a Production Readiness Score (0-100).\n" +
        "Analyzes testing, security, types, error handling, performance, and code quality."
    )
    .argument("[dir]", "Directory to scan (default: current directory)", ".")
    .option("--fail-on <score>", "Exit with code 1 if the overall score is below this threshold (0-100).", value => {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 0 || n > 100) throw new Error("--fail-on must be an integer between 0 and 100");
      return n;
    })
    .option(
      "--fail-on-category <name=score>",
      "Exit with code 1 if a category score is below its threshold. Repeatable.",
      (value, prev: string[]) => [...(prev ?? []), value],
      [] as string[]
    )
    .option("--output-json", "Output the full scan result as JSON for CI/CD integration.")
    .option("--explain", "Show human-readable explanations for each subcategory's issues.")
    .option("-e, --explain-deductions", "Show exactly which files and line numbers caused score deductions.")
    .option("--include-tests", "Include test files in the scan (by default, test files are excluded).")
    .option(
      "--language <lang>",
      "Language to scan: ts, js, python, go, rust, auto (default: auto — detected from project files).",
      "auto"
    )
    .option("--baseline", "Save current scan result as baseline to .ratchet/baseline.json.")
    .option("--no-baseline", "Skip baseline comparison for this run.")
    .option("--diff [base]", "Scan only files changed since <base> (branch, commit, or HEAD~N). Defaults to HEAD~1.")
    .option("--top <n>", "Show top N highest-impact improvements (quick-fix mode). Default: 3.")
    .option(
      "--no-registry",
      "Skip submitting results to the Ratchet Score Registry (RATCHET_REGISTRY_KEY must be set to enable)."
    )
    .option("--deep", "Use deep (LLM-powered) scanning engine (requires Ratchet Pro subscription).")
    .option(
      "--engine <mode>",
      "Scoring engine to use: classic (default), deep, or auto (reads RATCHET_ENGINE env var).",
      "classic"
    )
    .option("--categories <list>", "Comma-separated list of categories to analyse (e.g. Testing,Security).")
    .option("--budget <amount>", "Maximum spend in USD for deep scanning (deep engine only).", parseFloat)
    .option(
      "--scan-model <model>",
      "Model to use for deep scanning, independent of the fix/improve model (e.g. kimi-k2:1t, gpt-4o-mini)."
    )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  $ ratchet scan\n" +
        "  $ ratchet scan ./my-project\n" +
        "  $ ratchet scan --fail-on 80\n" +
        "  $ ratchet scan --fail-on 80 --fail-on-category Security=12\n" +
        "  $ ratchet scan --output-json > scan-result.json\n" +
        "  $ ratchet scan --explain\n" +
        "  $ ratchet scan --explain-deductions\n" +
        "  $ ratchet scan -e\n" +
        "  $ ratchet scan --include-tests\n" +
        "  $ ratchet scan --language python\n" +
        "  $ ratchet scan --baseline\n" +
        "  $ ratchet scan --no-baseline\n" +
        "  $ ratchet scan --diff main\n" +
        "  $ ratchet scan --diff HEAD~3\n" +
        "  $ ratchet scan --engine classic\n" +
        "  $ ratchet scan --deep\n" +
        "  $ ratchet scan --categories Testing,Security\n" +
        "  $ ratchet scan --deep --scan-model kimi-k2:1t\n"
    )
    .action(async (dir: string, options: Record<string, unknown>) => {
      const { resolve } = await import("path");
      const { findSourceFiles } = await import("../core/scan-constants.js");
      const cwd = resolve(dir);

      // --top: quick-fix mode — show top N highest-impact improvements
      if (options["top"] !== undefined) {
        const { quickFixCommand } = await import("./quick-fix.js");
        await quickFixCommand().parseAsync(["node", "quick-fix", dir]);
        return;
      }

      // telemetry: no-op in open-source build

      // Language detection / warning
      const langOpt = (options["language"] as Language | undefined) ?? "auto";
      const validLanguages: Language[] = ["ts", "js", "python", "go", "rust", "auto"];
      if (!validLanguages.includes(langOpt)) {
        process.stderr.write(
          chalk.red(`Invalid --language value: "${langOpt}". Valid values: ts, js, python, go, rust, auto.\n`)
        );
        process.exit(1);
      }

      let resolvedLang: "ts" | "js" | "python" | "go" | "rust";
      if (langOpt === "auto") {
        const { language, detected } = detectLanguage(cwd);
        resolvedLang = language;
        if (!detected) {
          process.stdout.write(chalk.yellow(NON_TSJS_WARNING("this")) + "\n\n");
        }
      } else {
        resolvedLang = langOpt as "ts" | "js" | "python" | "go" | "rust";
      }

      // --- --diff: filter to changed files only ---
      let diffFiles: string[] | undefined;
      const diffOpt = options["diff"] as string | boolean | undefined;
      if (diffOpt !== undefined) {
        const base = typeof diffOpt === "string" ? diffOpt : "HEAD~1";
        const { execSync } = await import("child_process");
        let changedRaw = "";
        try {
          changedRaw = execSync(`git diff --name-only ${base}`, {
            cwd,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch {
          logger.warn({ base }, "git diff failed — scanning all files");
        }
        if (changedRaw) {
          const changedAbs = new Set(
            changedRaw
              .split("\n")
              .filter(Boolean)
              .map(f => resolve(cwd, f))
          );
          const allSrcFiles = findSourceFiles(cwd);
          diffFiles = allSrcFiles.filter(f => changedAbs.has(f));
          process.stdout.write(
            `Scanning ${diffFiles.length} changed file${diffFiles.length !== 1 ? "s" : ""} (vs ${base})\n`
          );
        }
      }

      // Load scan config from .ratchet.yml if present
      let includeNonProduction = false;
      let cfgEngineMode: "classic" | "deep" | "auto" = "classic";
      let ratchetConfig;
      try {
        const { loadConfig } = await import("../core/config.js");
        ratchetConfig = loadConfig(cwd);
        includeNonProduction = ratchetConfig.scan?.includeNonProduction ?? false;
        cfgEngineMode = (ratchetConfig.scan?.engine as "classic" | "deep" | "auto" | undefined) ?? "classic";
      } catch (err) {
        logger.warn({ err }, "Failed to load .ratchet.yml config — using defaults");
      }

      // Resolve category filter
      const categoriesOpt = options["categories"] as string | undefined;
      const categories = categoriesOpt ? categoriesOpt.split(",").map(s => s.trim()) : undefined;

      const budget = options["budget"] as number | undefined;
      const scanModel = options["scanModel"] as string | undefined;

      // Resolve engine mode: --deep flag overrides --engine, which overrides config
      const deepFlag = options["deep"] as boolean | undefined;
      const engineOpt = options["engine"] as string | undefined;
      const engineMode: "classic" | "deep" | "auto" = deepFlag
        ? "deep"
        : ((engineOpt as "classic" | "deep" | "auto" | undefined) ?? cfgEngineMode);

      const engine = createEngine(engineMode, ratchetConfig, { scanModel });

      const result = await engine.analyze(cwd, {
        includeTests: options["includeTests"] as boolean | undefined,
        files: diffFiles,
        includeNonProduction,
        lang: resolvedLang,
        categories,
        budget,
      });

      if (options["outputJson"]) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }

      const saveAsBaseline = options["baseline"] === true;
      const skipBaseline = options["baseline"] === false;

      let baseline: Baseline | null = null;
      if (!saveAsBaseline && !skipBaseline) {
        baseline = loadBaseline(cwd);
      }

      renderScan(result, { explain: options["explain"] as boolean | undefined, baseline });

      if (options["explainDeductions"]) {
        renderDeductions(result, cwd);
      }

      if (saveAsBaseline) {
        saveBaseline(cwd, result);
        const baselineMsg =
          `  ✔ Baseline saved: ${result.total}/${result.maxTotal}` + ` (${result.totalIssuesFound} issues)\n\n`;
        process.stdout.write(chalk.green(baselineMsg));
      }

      const failOn = options["failOn"] as number | undefined;
      const failOnCategory = (options["failOnCategory"] as string[] | undefined) ?? [];

      if (failOn !== undefined || failOnCategory.length > 0) {
        const categoryThresholds = failOnCategory.map(parseCategoryThreshold);
        const gate = evaluateGates(result, failOn ?? null, categoryThresholds);
        if (!gate.passed) exitWithGateFailure(gate);
        process.stdout.write(chalk.green("  ✔ Quality gates passed\n\n"));
      }

      // Auto-submit to registry when RATCHET_REGISTRY_KEY is configured
      // and --no-registry was not passed.
      if (options["registry"] !== false && process.env["RATCHET_REGISTRY_KEY"]) {
        let ratchetVersion = "unknown";
        try {
          const pkgPath = new URL("../../package.json", import.meta.url).pathname;
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
          ratchetVersion = pkg.version ?? "unknown";
        } catch {
          /* use default */
        }

        const { submitToRegistry } = await import("../registry/client.js");
        const submitResult = await submitToRegistry(result, cwd, resolvedLang, ratchetVersion);
        if (submitResult.ok) {
          process.stdout.write(chalk.dim(`  ↑ Score submitted to registry (#${submitResult.submission_id})\n\n`));
        }
      }
    });

  return cmd;
}
