import {
  CategoryThreshold,
  GateResult,
  Baseline,
  ScanResult,
  RunScanOptions,
  SubCategory,
  CategoryResult,
  IssueType,
} from "./types.js";
import { ClassicEngine } from "../engines/classic.js";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import chalk from "chalk";

export function parseCategoryThreshold(raw: string): CategoryThreshold {
  const eqIndex = raw.indexOf("=");
  if (eqIndex === -1) {
    throw new Error(`Invalid --fail-on-category format: "${raw}". Expected "CategoryName=Score" (e.g., Security=12).`);
  }
  const name = raw.slice(0, eqIndex).trim();
  const scoreStr = raw.slice(eqIndex + 1).trim();
  const score = parseInt(scoreStr, 10);
  if (isNaN(score) || score < 0) {
    throw new Error(`Invalid threshold score in --fail-on-category "${raw}". Score must be a non-negative integer.`);
  }
  return { categoryName: name, threshold: score, max: 0 };
}

export function evaluateGates(
  result: ScanResult,
  totalThreshold: number | null,
  categoryThresholds: CategoryThreshold[]
): GateResult {
  const failedCategories: GateResult["failedCategories"] = [];

  const resolvedThresholds = categoryThresholds.map(ct => {
    const cat = result.categories.find(c => c.name.toLowerCase() === ct.categoryName.toLowerCase());
    if (!cat) {
      throw new Error(
        `Category "${ct.categoryName}" not found. Available: ${result.categories.map(c => c.name).join(", ")}.`
      );
    }
    return { ...ct, score: cat.score, max: cat.max };
  });

  for (const ct of resolvedThresholds) {
    if (ct.score < ct.threshold) {
      failedCategories.push({ name: ct.categoryName, score: ct.score, threshold: ct.threshold });
    }
  }

  const totalPassed = totalThreshold === null || result.total >= totalThreshold;

  return {
    passed: totalPassed && failedCategories.length === 0,
    failedCategories,
    totalScore: result.total,
    totalThreshold,
  };
}

export function exitWithGateFailure(gate: GateResult): never {
  process.stdout.write("\n");
  process.stdout.write(chalk.red.bold("❌ Quality Gate Failed\n\n"));

  if (gate.totalThreshold !== null && gate.totalScore < gate.totalThreshold) {
    process.stdout.write(
      `  ${chalk.red("✗")} Overall score ${chalk.red(`${gate.totalScore}`)} ` +
        `below required threshold of ${gate.totalThreshold}\n`
    );
  }

  if (gate.failedCategories.length > 0) {
    process.stdout.write("\n  Failed category thresholds:\n");
    for (const fc of gate.failedCategories) {
      process.stdout.write(
        `    ${chalk.red("✗")} ${fc.name}: ${chalk.red(String(fc.score))} — required ≥${fc.threshold}\n`
      );
    }
  }

  process.stdout.write("\n");
  process.exit(1);
}

export function loadBaseline(cwd: string): Baseline | null {
  const baselinePath = join(cwd, ".ratchet", "baseline.json");
  if (!existsSync(baselinePath)) return null;
  try {
    return JSON.parse(readFileSync(baselinePath, "utf-8")) as Baseline;
  } catch {
    return null;
  }
}

export function saveBaseline(cwd: string, result: ScanResult): void {
  const ratchetDir = join(cwd, ".ratchet");
  mkdirSync(ratchetDir, { recursive: true });
  const baseline: Baseline = {
    score: result.total,
    categories: Object.fromEntries(result.categories.map(c => [c.name, c.score])),
    issues: result.totalIssuesFound,
    savedAt: new Date().toISOString(),
    version: "1.0.8",
  };
  writeFileSync(join(ratchetDir, "baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
}

export function deltaStr(diff: number): string {
  if (diff > 0) return chalk.green(`+${diff}`);
  if (diff < 0) return chalk.red(String(diff));
  return chalk.dim("—");
}

export async function runScan(cwd: string, options: RunScanOptions = {}): Promise<ScanResult> {
  const engine = new ClassicEngine();
  return engine.analyze(cwd, options);
}
