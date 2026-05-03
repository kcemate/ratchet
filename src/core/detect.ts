import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { RatchetConfig, Target } from "../types.js";
import { IGNORE_DIRS } from "./scan-constants.js";
import { logger } from "../lib/logger.js";

export type ProjectType = "node" | "python" | "go" | "rust" | "unknown";

export interface DetectedProject {
  type: ProjectType;
  testCommand: string | null;
  sourcePaths: string[];
  noTestCommand: boolean;
  testFileCount: number;
}

const SOURCE_DIRS = ["src", "lib", "app", "pkg", "internal", "cmd"];

const TEST_FILE_PATTERNS = [/\.test\.[a-z]+$/i, /\.spec\.[a-z]+$/i, /^test_.*\.[a-z]+$/i, /.*_test\.[a-z]+$/i];

export function countTestFiles(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          count += countTestFiles(join(dir, entry.name));
        }
      } else if (TEST_FILE_PATTERNS.some(p => p.test(entry.name))) {
        count++;
      }
    }
  } catch (err) {
    logger.debug({ err }, "read directory");
  }
  return count;
}

export function detectProject(cwd: string): DetectedProject {
  const type = detectProjectType(cwd);
  const testCommand = detectTestCommand(cwd, type);
  const sourcePaths = detectSourcePaths(cwd);
  const testFileCount = countTestFiles(cwd);

  return {
    type,
    testCommand,
    sourcePaths,
    noTestCommand: testCommand === null,
    testFileCount,
  };
}

export function detectProjectType(cwd: string): ProjectType {
  if (existsSync(join(cwd, "package.json"))) return "node";
  if (
    existsSync(join(cwd, "requirements.txt")) ||
    existsSync(join(cwd, "pyproject.toml")) ||
    existsSync(join(cwd, "setup.py"))
  )
    return "python";
  if (existsSync(join(cwd, "go.mod"))) return "go";
  if (existsSync(join(cwd, "Cargo.toml"))) return "rust";
  return "unknown";
}

export function detectTestCommand(cwd: string, type: ProjectType): string | null {
  switch (type) {
    case "node":
      return detectNodeTestCommand(cwd);
    case "python":
      return "pytest";
    case "go":
      return "go test ./...";
    case "rust":
      return "cargo test";
    default:
      return null;
  }
}

function detectNodeTestCommand(cwd: string): string | null {
  try {
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};

    // Priority order: prefer common script names
    const candidates = ["test", "test:unit", "test:ci", "test:run"];
    for (const name of candidates) {
      if (scripts[name]) {
        // If the script is literally "vitest run" or "jest", run it directly
        const cmd = scripts[name].trim();
        if (cmd === "vitest run" || cmd === "vitest") return "npx vitest run";
        if (cmd === "jest") return "npx jest";
        return `npm run ${name}`;
      }
    }

    // No scripts matched — fall back to config file detection
    const frameworkConfigs: [string[], string][] = [
      [["vitest.config.ts", "vitest.config.js", "vitest.config.mts"], "npx vitest run"],
      [["jest.config.ts", "jest.config.js", "jest.config.json"], "npx jest"],
    ];
    for (const [configs, cmd] of frameworkConfigs) {
      if (configs.some(f => existsSync(join(cwd, f)))) return cmd;
    }

    return null;
  } catch (err) {
    logger.debug({ err }, "read package.json");
    return null;
  }
}

export function detectSourcePaths(cwd: string): string[] {
  return SOURCE_DIRS.filter(dir => existsSync(join(cwd, dir)));
}

export function buildAutoConfig(cwd: string): RatchetConfig {
  const detected = detectProject(cwd);

  const sourcePaths = detected.sourcePaths.length > 0 ? detected.sourcePaths : ["."];
  const primarySource = sourcePaths[0];

  const targets: Target[] = [
    {
      name: "auto",
      path: `${primarySource}/`,
      description: `Auto-detected ${detected.type} project — ${primarySource}/`,
    },
  ];

  const shouldHarden = detected.noTestCommand || detected.testFileCount === 0;

  return {
    agent: "shell",
    defaults: {
      clicks: 7,
      testCommand: detected.testCommand ?? "npm test",
      autoCommit: true,
      hardenMode: shouldHarden,
    },
    targets,
    _source: "auto-detected",
    _noTestCommand: detected.noTestCommand,
  };
}
