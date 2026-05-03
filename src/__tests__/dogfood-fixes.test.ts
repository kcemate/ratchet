/**
 * Tests for 7 scanner improvements from Mission Control dogfood findings.
 */

import { describe, it, expect } from "vitest";
import { countMatchesWithLocations } from "../core/scan-constants.js";
import { scoreInputValidation, scoreStructuredLogging, scoreCoverageRatio } from "../core/scan-scorers.js";

// ─── Fix 2: Custom validators — scoreInputValidation tests ───────────────────
// scoreInputValidation() is unchanged (pure function on counts), but the
// detection in classic.ts now finds custom validators. We test the scorer's
// partial-credit behaviour that gets exercised when custom validators are found.

describe("scoreInputValidation partial credit (fix 2)", () => {
  it("gives partial score when 1 custom validator file detected (like lib/validate.ts)", () => {
    // 1 validation file found via custom validator detection
    const r = scoreInputValidation(1, 5);
    expect(r.score).toBe(2); // partial credit — not 0
    expect(r.score).toBeGreaterThan(0);
  });

  it("gives partial score when 2 custom validators found", () => {
    const r = scoreInputValidation(2, 5);
    expect(r.score).toBe(4); // better partial credit
  });

  it("score 0 when no validators at all", () => {
    const r = scoreInputValidation(0, 5);
    expect(r.score).toBe(0);
  });
});

// ─── Fix 3: Custom loggers — scoreStructuredLogging tests ────────────────────
// When a custom logger is detected (e.g. lib/logger.ts exporting .error/.warn),
// structuredLogCount > 0, so the scorer awards partial/full credit.

describe("scoreStructuredLogging with custom logger (fix 3)", () => {
  it("awards score 7 when custom logger detected with 0 console calls", () => {
    const r = scoreStructuredLogging(1, 0); // 1 call from custom logger
    expect(r.score).toBe(7);
    expect(r.summary).toContain("structured logger");
  });

  it("awards score 5 when custom logger + some console calls", () => {
    const r = scoreStructuredLogging(3, 4);
    expect(r.score).toBe(5);
  });

  it("still scores 0 when no logger and no console", () => {
    const r = scoreStructuredLogging(0, 0);
    expect(r.score).toBe(0);
  });
});

// ─── Fix 7: Coverage ratio — UI component weighting ─────────────────────────
// scoreCoverageRatio is called with an adjusted sourceCount that weights
// UI component files at 0.5x. We test the scorer handles fractional counts.

describe("scoreCoverageRatio with UI component weighting (fix 7)", () => {
  it("improves ratio when UI files are weighted at 0.5x", () => {
    // Without weighting: 2 tests / 8 source = 25% → score 6
    const unweighted = scoreCoverageRatio(2, 8, true);
    expect(unweighted.score).toBe(6);

    // With weighting: 4 of those 8 are UI components → weighted denominator = 4 + 4*0.5 = 6
    // 2 tests / 6 weighted = 33% → still score 6, but with fewer issues
    const weighted = scoreCoverageRatio(2, 6, true); // 6 = 4 non-ui + 4*0.5 ui
    expect(weighted.score).toBeGreaterThanOrEqual(unweighted.score);
  });

  it("half-weighted denominator can cross a threshold boundary", () => {
    // 5 tests, 40 sources without weighting → 12.5% → score 4
    const unweighted = scoreCoverageRatio(5, 40, true);
    expect(unweighted.score).toBe(4);

    // If 20 of those 40 are UI components: weighted denominator = 20 + 20*0.5 = 30
    // 5 tests / 30 = 16.7% → score 4, or if more UI: 5/25 = 20% → score 4 still
    // But 5/22 = 22.7% → score 6
    const weighted = scoreCoverageRatio(5, 22, true);
    expect(weighted.score).toBe(6); // crossed the 22% threshold
  });
});

// ─── Fix 5: Empty catch file:line locations ───────────────────────────────────
// countMatchesWithLocations returns "file:line" format strings so the scan
// report can show exactly which line each empty catch is on.

describe("countMatchesWithLocations for empty catches (fix 5)", () => {
  it("returns file:line format for each matching line", () => {
    const contents = new Map([["src/server.ts", "try {\n  doSomething();\n} catch (e) {}\n"]]);
    const { count, locations } = countMatchesWithLocations(
      ["src/server.ts"],
      contents,
      /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g
    );
    expect(count).toBeGreaterThan(0);
    expect(locations.length).toBeGreaterThan(0);
    // Location must be "file:lineNumber" format
    expect(locations[0]).toMatch(/src\/server\.ts:\d+/);
  });

  it("returns multiple locations for multiple empty catches in one file", () => {
    const contents = new Map([["src/api.ts", "try { a() } catch (e) {}\ntry { b() } catch (e) {}\n"]]);
    const { locations } = countMatchesWithLocations(["src/api.ts"], contents, /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g);
    expect(locations.length).toBe(2);
    expect(locations[0]).toContain("src/api.ts:");
    expect(locations[1]).toContain("src/api.ts:");
  });

  it("locations across multiple files include the file name", () => {
    const contents = new Map([
      ["src/a.ts", "try { a() } catch (e) {}\n"],
      ["src/b.ts", "try { b() } catch (e) {}\n"],
    ]);
    const { locations } = countMatchesWithLocations(
      ["src/a.ts", "src/b.ts"],
      contents,
      /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g
    );
    expect(locations.some(l => l.startsWith("src/a.ts:"))).toBe(true);
    expect(locations.some(l => l.startsWith("src/b.ts:"))).toBe(true);
  });
});
