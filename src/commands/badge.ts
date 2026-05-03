import { Command } from "commander";
import chalk from "chalk";
import { mkdir, writeFile } from "fs/promises";
import { logger } from "../lib/logger.js";
import { join } from "path";
import { printHeader, printFields } from "../lib/cli.js";
import { runScan } from "./scan.js";
import {
  generateBadgeSvg,
  generateBadgeUrl,
  generateReadmeSnippet,
  scoreToColor,
  type BadgeStyle,
  type BadgeFormat,
} from "../core/badge.js";

export function badgeCommand(): Command {
  const cmd = new Command("badge");

  cmd
    .description(
      "Generate a score badge for your README.\n" +
        "Runs a scan (or uses the latest result) and outputs a shields.io-compatible badge snippet."
    )
    .argument("[dir]", "Directory to scan (default: current directory)", ".")
    .option("--save", "Save badge.svg to .ratchet/badge.svg")
    .option("--format <format>", "Output format: markdown (default) | html", "markdown")
    .option("--style <style>", "Badge style: flat (default) | flat-square | for-the-badge", "flat")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  $ ratchet badge\n" +
        "  $ ratchet badge --save\n" +
        "  $ ratchet badge --style flat-square --format html\n" +
        "  $ ratchet badge --style for-the-badge --save\n"
    )
    .action(async (dir: string, options: { save: boolean; format: string; style: string }) => {
      const { resolve } = await import("path");
      const cwd = resolve(dir);

      // Validate options
      const validStyles = new Set(["flat", "flat-square", "for-the-badge"]);
      if (!validStyles.has(options.style)) {
        logger.error({ style: options.style }, "Invalid --style");
        logger.info("Valid styles: flat, flat-square, for-the-badge");
        process.exit(1);
      }
      const validFormats = new Set(["markdown", "html"]);
      if (!validFormats.has(options.format)) {
        logger.error({ format: options.format }, "Invalid --format");
        logger.info("Valid formats: markdown, html");
        process.exit(1);
      }

      const style = options.style as BadgeStyle;
      const format = options.format as BadgeFormat;

      printHeader("🔩 Ratchet Score Badge");

      // Run the scan
      process.stdout.write(chalk.dim("  Scanning project...\n"));
      const result = await runScan(cwd);
      const { total, maxTotal, projectName } = result;

      // Color-code the score for terminal output
      const { name: colorName, hex } = scoreToColor(total);
      const scoreLabel = (() => {
        if (total >= 90) return chalk.greenBright.bold(`${total}/${maxTotal}`);
        if (total >= 75) return chalk.green.bold(`${total}/${maxTotal}`);
        if (total >= 60) return chalk.yellow.bold(`${total}/${maxTotal}`);
        if (total >= 40) return chalk.hex("#fe7d37").bold(`${total}/${maxTotal}`);
        return chalk.red.bold(`${total}/${maxTotal}`);
      })();

      process.stdout.write("\n");
      printFields([
        ["Project", chalk.cyan(projectName)],
        ["Score", scoreLabel],
        ["Status", chalk.dim(colorName)],
        ["Style", chalk.dim(style)],
      ]);

      // Optionally save SVG
      let localBadgePath: string | undefined;
      if (options.save) {
        const ratchetDir = join(cwd, ".ratchet");
        await mkdir(ratchetDir, { recursive: true });
        const svgPath = join(ratchetDir, "badge.svg");
        const svg = generateBadgeSvg(total, maxTotal, style);
        await writeFile(svgPath, svg, "utf-8");
        localBadgePath = ".ratchet/badge.svg";
        process.stdout.write(`  ${chalk.green("✔")} Badge saved: ${chalk.dim(svgPath)}\n\n`);
      }

      // Generate snippet
      const snippet = generateReadmeSnippet(total, maxTotal, style, format, localBadgePath);
      const shieldsUrl = generateBadgeUrl(total, maxTotal, style);

      const formatLabel = format === "html" ? "HTML" : "Markdown";
      process.stdout.write(chalk.bold(`  Add this to your README.md (${formatLabel}):\n\n`));
      process.stdout.write(`    ${chalk.cyan(snippet)}\n\n`);
      process.stdout.write(chalk.dim("  shields.io URL:\n"));
      process.stdout.write(`    ${chalk.dim(shieldsUrl)}\n\n`);

      if (!options.save) {
        process.stdout.write(
          chalk.dim("  Tip: run ") +
            chalk.white("ratchet badge --save") +
            chalk.dim(" to also save a local badge.svg\n\n")
        );
      }
    });

  return cmd;
}
