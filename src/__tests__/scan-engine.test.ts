/**
 * Tests for the scan engine abstraction layer.
 *
 * Covers:
 *   - ClassicEngine produces same results as runScan()
 *   - DeepEngine stub throws the correct error
 *   - createEngine() selects the right engine
 *   - FindingNormalizer / mergeScores logic
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClassicEngine } from "../core/engines/classic.js";
import { DeepEngine } from "../core/engines/deep.js";
import { createEngine } from "../core/engine-router.js";
import { normalizeFindings, mergeScores, type Finding } from "../core/normalize.js";
import { runScan } from "../core/scanner/index.js";

// ---------------------------------------------------------------------------
// ClassicEngine
// ---------------------------------------------------------------------------

describe("ClassicEngine", () => {
  it("implements ScanEngine interface", () => {
    const engine = new ClassicEngine();
    expect(engine.name).toBe("ClassicEngine");
    expect(engine.mode).toBe("classic");
    expect(typeof engine.analyze).toBe("function");
  });

  it("analyze() returns a valid ScanResult shape", async () => {
    const engine = new ClassicEngine();
    const result = await engine.analyze(process.cwd());

    expect(result).toMatchObject({
      projectName: expect.any(String),
      total: expect.any(Number),
      maxTotal: expect.any(Number),
      categories: expect.any(Array),
      totalIssuesFound: expect.any(Number),
      issuesByType: expect.any(Array),
    });
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(result.maxTotal);
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it("produces same result as runScan()", async () => {
    const cwd = process.cwd();
    const [engineResult, runResult] = await Promise.all([new ClassicEngine().analyze(cwd), runScan(cwd)]);

    // Scores should be identical (both use ClassicEngine internally)
    expect(engineResult.total).toBe(runResult.total);
    expect(engineResult.maxTotal).toBe(runResult.maxTotal);
    expect(engineResult.categories.length).toBe(runResult.categories.length);
    for (let i = 0; i < engineResult.categories.length; i++) {
      expect(engineResult.categories[i]!.score).toBe(runResult.categories[i]!.score);
      expect(engineResult.categories[i]!.name).toBe(runResult.categories[i]!.name);
    }
  });

  it("respects includeTests option", async () => {
    const engine = new ClassicEngine();
    const without = await engine.analyze(process.cwd(), { includeTests: false });
    const with_ = await engine.analyze(process.cwd(), { includeTests: true });
    // Scores may differ — just check both complete without error
    expect(without.total).toBeGreaterThanOrEqual(0);
    expect(with_.total).toBeGreaterThanOrEqual(0);
  });

  it("respects lang option", async () => {
    const engine = new ClassicEngine();
    const result = await engine.analyze(process.cwd(), { lang: "ts" });
    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// DeepEngine stub
// ---------------------------------------------------------------------------

describe("DeepEngine", () => {
  it("implements ScanEngine interface", () => {
    const engine = new DeepEngine();
    expect(engine.name).toBe("DeepEngine");
    expect(engine.mode).toBe("deep");
    expect(typeof engine.analyze).toBe("function");
  });

  it("analyze() throws when no provider is configured", async () => {
    const engine = new DeepEngine();
    await expect(engine.analyze(process.cwd())).rejects.toThrow("Deep scanning requires an API key");
  });

  it("error message mentions how to set a provider", async () => {
    const engine = new DeepEngine();
    await expect(engine.analyze(process.cwd())).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  it("error message mentions .ratchet.yml config", async () => {
    const engine = new DeepEngine();
    await expect(engine.analyze(process.cwd())).rejects.toThrow(".ratchet.yml");
  });
});

// ---------------------------------------------------------------------------
// Engine Router
// ---------------------------------------------------------------------------

describe("createEngine", () => {
  beforeEach(() => {
    delete process.env["RATCHET_ENGINE"];
  });

  it("returns ClassicEngine for mode=classic", () => {
    const engine = createEngine("classic");
    expect(engine).toBeInstanceOf(ClassicEngine);
    expect(engine.mode).toBe("classic");
  });

  it("returns DeepEngine for mode=deep", () => {
    const engine = createEngine("deep");
    expect(engine).toBeInstanceOf(DeepEngine);
    expect(engine.mode).toBe("deep");
  });

  it("returns ClassicEngine for mode=auto with no env var", () => {
    const engine = createEngine("auto");
    expect(engine).toBeInstanceOf(ClassicEngine);
  });

  it("returns DeepEngine for mode=auto with RATCHET_ENGINE=deep", () => {
    process.env["RATCHET_ENGINE"] = "deep";
    const engine = createEngine("auto");
    expect(engine).toBeInstanceOf(DeepEngine);
  });

  it("explicit mode overrides env var", () => {
    process.env["RATCHET_ENGINE"] = "deep";
    const engine = createEngine("classic");
    expect(engine).toBeInstanceOf(ClassicEngine);
  });

  it("reads engine from config.scan.engine when mode=auto", () => {
    const config = { scan: { engine: "classic" as const } } as Parameters<typeof createEngine>[1];
    const engine = createEngine("auto", config);
    expect(engine).toBeInstanceOf(ClassicEngine);
  });
});

// ---------------------------------------------------------------------------
// FindingNormalizer
// ---------------------------------------------------------------------------

describe("normalizeFindings", () => {
  const sampleFindings: Finding[] = [
    {
      category: "Security",
      subcategory: "Secrets & env vars",
      severity: "high",
      message: "Hardcoded API key detected",
      confidence: 0.95,
      source: "classic",
      file: "src/config.ts",
      line: 12,
    },
    {
      category: "Testing",
      subcategory: "Coverage ratio",
      severity: "medium",
      message: "Low test coverage",
      confidence: 0.8,
      source: "deep",
    },
  ];

  it("returns NormalizedResult with findings array", () => {
    const result = normalizeFindings(sampleFindings);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.category).toBe("Security");
    expect(result.findings[1]!.category).toBe("Testing");
  });

  it("wraps findings in a ScanResult", () => {
    const result = normalizeFindings(sampleFindings);
    expect(result.scanResult).toMatchObject({
      totalIssuesFound: 2,
      issuesByType: expect.any(Array),
    });
  });

  it("maps critical/high findings to high severity in issuesByType", () => {
    const result = normalizeFindings(sampleFindings);
    const secIssue = result.scanResult.issuesByType.find(i => i.category === "Security");
    expect(secIssue?.severity).toBe("high");
  });

  it("maps medium findings to medium severity in issuesByType", () => {
    const result = normalizeFindings(sampleFindings);
    const testIssue = result.scanResult.issuesByType.find(i => i.category === "Testing");
    expect(testIssue?.severity).toBe("medium");
  });

  it("handles empty findings array", () => {
    const result = normalizeFindings([]);
    expect(result.findings).toHaveLength(0);
    expect(result.scanResult.totalIssuesFound).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mergeScores
// ---------------------------------------------------------------------------

describe("mergeScores", () => {
  it("returns deep score when difference > 1", () => {
    expect(mergeScores(80, 75)).toBe(75); // deep is 5 below classic
    expect(mergeScores(75, 80)).toBe(80); // deep is 5 above classic
  });

  it("averages scores when difference is exactly 1", () => {
    expect(mergeScores(80, 81)).toBe(81); // diff=1, rounds to (80+81)/2 = 80.5 → 81
    expect(mergeScores(81, 80)).toBe(81); // diff=1, (81+80)/2 = 80.5 → 81
  });

  it("averages scores when difference is 0", () => {
    expect(mergeScores(80, 80)).toBe(80);
  });

  it("returns deep score when classic and deep differ by more than 1", () => {
    expect(mergeScores(90, 70)).toBe(70);
    expect(mergeScores(70, 90)).toBe(90);
  });
});
