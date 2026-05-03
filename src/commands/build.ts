import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { logger } from "../lib/logger.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export function buildCommand(): Command {
  const cmd = new Command("build");

  cmd
    .description(
      "Rebuild the CLI binary and re-link it.\n\nRuns `npm run build && npm link` in the ratchet package directory."
    )
    .action(() => {
      // Resolve the ratchet package root (one level up from dist/)
      const thisFile = fileURLToPath(import.meta.url);
      const distDir = dirname(thisFile);
      const packageRoot = dirname(distDir);

      process.stdout.write(chalk.bold("\n🔨 Rebuilding ratchet…\n"));

      try {
        process.stdout.write(chalk.dim("  npm run build") + "\n");
        execSync("npm run build", { cwd: packageRoot, stdio: "inherit" });

        process.stdout.write(chalk.dim("\n  npm link") + "\n");
        execSync("npm link", { cwd: packageRoot, stdio: "inherit" });

        process.stdout.write(chalk.green("\n  ✓ Binary rebuilt and linked successfully.\n"));
      } catch (err) {
        logger.error("Build failed");
        process.exit(1);
      }
    });

  return cmd;
}
