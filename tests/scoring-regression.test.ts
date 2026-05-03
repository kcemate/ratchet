/**
 * Scoring Regression Suite
 *
 * These tests snapshot the exact scores produced by `runScan()` on known fixture
 * projects. If these break, you changed scoring. Update intentionally.
 *
 * Fixture projects live in tests/fixtures/scoring-corpus/ and are copied to tmpdir
 * before scanning (the scanner classifies files under /tests/ as test files).
 */
import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { mkdtempSync, cpSync, rmSync } from "fs";
import { tmpdir } from "os";
import { runScan, type ScanResult } from "../src/commands/scan.js";

const CORPUS = join(__dirname, "fixtures", "scoring-corpus");
const tempDirs: string[] = [];

function copyFixtureToTmp(name: string): string {
  const tmp = mkdtempSync(join(tmpdir(), `ratchet-regr-${name}-`));
  cpSync(join(CORPUS, name), tmp, { recursive: true });
  tempDirs.push(tmp);
  return tmp;
}

function getCat(result: ScanResult, name: string) {
  return result.categories.find(c => c.name === name)!;
}

function getSub(result: ScanResult, catName: string, subName: string) {
  return getCat(result, catName).subcategories.find(s => s.name === subName)!;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

// ─── minimal-ts: clean TypeScript project, should score well ───
describe("scoring regression: minimal-ts", () => {
  let result: ScanResult;

  it("scans successfully", async () => {
    result = await runScan(copyFixtureToTmp("minimal-ts"));
  });

  it("total score", () => {
    expect(result.total).toBe(60);
    expect(result.maxTotal).toBe(100);
  });

  it("Testing category", () => {
    const cat = getCat(result, "Testing");
    expect(cat.score).toBe(13);
    expect(getSub(result, "Testing", "Coverage ratio").score).toBe(8);
    expect(getSub(result, "Testing", "Edge case depth").score).toBe(1);
    expect(getSub(result, "Testing", "Test quality").score).toBe(4);
  });

  it("Security category", () => {
    const cat = getCat(result, "Security");
    expect(cat.score).toBe(2);
    expect(getSub(result, "Security", "Secrets & env vars").score).toBe(2);
    expect(getSub(result, "Security", "Input validation").score).toBe(0);
    expect(getSub(result, "Security", "Auth & rate limiting").score).toBe(0);
  });

  it("Type Safety category — full marks with strict TS", () => {
    const cat = getCat(result, "Type Safety");
    expect(cat.score).toBe(15);
    expect(getSub(result, "Type Safety", "Strict config").score).toBe(7);
    expect(getSub(result, "Type Safety", "Any type count").score).toBe(8);
  });

  it("Error Handling category", () => {
    const cat = getCat(result, "Error Handling");
    expect(cat.score).toBe(5);
    expect(getSub(result, "Error Handling", "Empty catches").score).toBe(5);
  });

  it("Performance category — full marks", () => {
    expect(getCat(result, "Performance").score).toBe(10);
  });

  it("Code Quality category — full marks", () => {
    expect(getCat(result, "Code Quality").score).toBe(15);
  });

  it("issue counts", () => {
    expect(result.totalIssuesFound).toBe(4);
    // No hardcoded secrets
    expect(getSub(result, "Security", "Secrets & env vars").issuesFound).toBe(0);
    // No any types
    expect(getSub(result, "Type Safety", "Any type count").issuesFound).toBe(0);
    // No empty catches
    expect(getSub(result, "Error Handling", "Empty catches").issuesFound).toBe(0);
  });
});

// ─── messy-js: intentionally bad JS project, should score low ───
describe("scoring regression: messy-js", () => {
  let result: ScanResult;

  it("scans successfully", async () => {
    result = await runScan(copyFixtureToTmp("messy-js"));
  });

  it("total score", () => {
    expect(result.total).toBe(39);
    expect(result.maxTotal).toBe(100);
  });

  it("Testing category — zero", () => {
    const cat = getCat(result, "Testing");
    expect(cat.score).toBe(0);
  });

  it("Security category — secrets detected", () => {
    const cat = getCat(result, "Security");
    expect(cat.score).toBe(0);
    expect(getSub(result, "Security", "Secrets & env vars").score).toBe(0);
    expect(getSub(result, "Security", "Secrets & env vars").issuesFound).toBe(2);
  });

  it("Type Safety category — zero (JS only)", () => {
    const cat = getCat(result, "Type Safety");
    expect(cat.score).toBe(0);
  });

  it("Error Handling category", () => {
    const cat = getCat(result, "Error Handling");
    expect(cat.score).toBe(14);
    expect(getSub(result, "Error Handling", "Empty catches").issuesFound).toBe(1);
  });

  it("Performance — console.log penalty", () => {
    const consoleSub = getSub(result, "Performance", "Console cleanup");
    expect(consoleSub.issuesFound).toBe(42);
  });

  it("Code Quality — dead code detected", () => {
    const deadSub = getSub(result, "Code Quality", "Dead code");
    expect(deadSub.issuesFound).toBe(19);
  });

  it("issue counts", () => {
    expect(result.totalIssuesFound).toBe(74);
  });
});

// ─── mixed-quality: some good, some bad ───
describe("scoring regression: mixed-quality", () => {
  let result: ScanResult;

  it("scans successfully", async () => {
    result = await runScan(copyFixtureToTmp("mixed-quality"));
  });

  it("total score", () => {
    expect(result.total).toBe(56);
    expect(result.maxTotal).toBe(100);
  });

  it("Testing category — partial coverage", () => {
    const cat = getCat(result, "Testing");
    expect(cat.score).toBe(10);
    expect(getSub(result, "Testing", "Coverage ratio").score).toBe(8);
    expect(getSub(result, "Testing", "Test quality").score).toBe(2);
  });

  it("Type Safety — strict but any types present", () => {
    const cat = getCat(result, "Type Safety");
    expect(cat.score).toBe(7);
    expect(getSub(result, "Type Safety", "Strict config").score).toBe(7);
    expect(getSub(result, "Type Safety", "Any type count").score).toBe(0);
    expect(getSub(result, "Type Safety", "Any type count").issuesFound).toBe(8);
  });

  it("Error Handling — empty catches present", () => {
    const cat = getCat(result, "Error Handling");
    expect(cat.score).toBe(12);
    expect(getSub(result, "Error Handling", "Empty catches").issuesFound).toBe(3);
  });

  it("Performance — some console.logs", () => {
    const consoleSub = getSub(result, "Performance", "Console cleanup");
    expect(consoleSub.issuesFound).toBe(5);
  });

  it("Code Quality — TODOs and commented code", () => {
    const deadSub = getSub(result, "Code Quality", "Dead code");
    expect(deadSub.issuesFound).toBe(3);
  });

  it("issue counts", () => {
    expect(result.totalIssuesFound).toBe(24);
  });
});
