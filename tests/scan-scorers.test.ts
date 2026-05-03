import { describe, it, expect } from "vitest";
import {
  scoreCoverageRatio,
  scoreEdgeCases,
  scoreTestQuality,
  scoreSecrets,
  scoreInputValidation,
  scoreAuthChecks,
  scoreAnyTypeDensity,
  scoreEhCoverage,
  scoreEmptyCatches,
  scoreStructuredLogging,
  scoreAwaitInLoop,
  scoreConsoleLog,
  scoreImportHygiene,
  scoreFunctionLength,
  scoreLineLength,
  scoreDeadCode,
} from "../src/core/scan-scorers.js";

// ── scoreCoverageRatio ──────────────────────────────────────────────────────

describe("scoreCoverageRatio", () => {
  it("returns score 0 with no test files and no test script", () => {
    const result = scoreCoverageRatio(0, 10, false);
    expect(result.score).toBe(0);
    expect(result.summary).toBe("no test files");
    expect(result.issues).toBe(10);
  });

  it("returns score 0 with no test files but has test script", () => {
    const result = scoreCoverageRatio(0, 5, true);
    expect(result.score).toBe(0);
    expect(result.summary).toBe("test script configured, no test files");
    expect(result.issues).toBe(5);
  });

  it("returns score 8 at exactly 50% ratio", () => {
    const result = scoreCoverageRatio(5, 10, true);
    expect(result.score).toBe(8);
    expect(result.summary).toContain("5 test files");
    expect(result.summary).toContain("50%");
    expect(result.issues).toBe(0);
  });

  it("returns score 8 above 50% ratio", () => {
    const result = scoreCoverageRatio(10, 10, true);
    expect(result.score).toBe(8);
    expect(result.issues).toBe(0);
    expect(result.summary).toContain("100%");
  });

  it("returns score 7.5 at 35% ratio", () => {
    const result = scoreCoverageRatio(35, 100, false);
    expect(result.score).toBe(7.5);
    expect(result.summary).toContain("35%");
    expect(result.issues).toBeGreaterThan(0);
  });

  it("returns score 6 at 22% ratio", () => {
    const result = scoreCoverageRatio(22, 100, false);
    expect(result.score).toBe(6);
    expect(result.summary).toContain("22%");
    expect(result.issues).toBeGreaterThan(0);
  });

  it("returns score 4 at 12% ratio", () => {
    const result = scoreCoverageRatio(12, 100, false);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("12%");
  });

  it("returns score 2 at 5% ratio", () => {
    const result = scoreCoverageRatio(5, 100, false);
    expect(result.score).toBe(2);
    expect(result.summary).toContain("5%");
  });

  it("returns score 0 below 5% ratio", () => {
    const result = scoreCoverageRatio(1, 100, false);
    expect(result.score).toBe(0);
    expect(result.issues).toBeGreaterThan(0);
  });

  it("handles zero source files gracefully", () => {
    const result = scoreCoverageRatio(5, 0, true);
    expect(result.score).toBe(0);
    expect(result.issues).toBe(0);
  });
});

// ── scoreEdgeCases ──────────────────────────────────────────────────────────

describe("scoreEdgeCases", () => {
  it("returns 9 for 50+ edge cases", () => {
    const result = scoreEdgeCases(50);
    expect(result.score).toBe(9);
    expect(result.summary).toContain("50");
  });

  it("returns 9 for 100 edge cases", () => {
    const result = scoreEdgeCases(100);
    expect(result.score).toBe(9);
    expect(result.summary).toContain("edge/error test cases");
  });

  it("returns 7 for 20-49 edge cases", () => {
    const result = scoreEdgeCases(20);
    expect(result.score).toBe(7);
    expect(result.summary).toContain("20");
  });

  it("returns 5 for 10-19 edge cases", () => {
    const result = scoreEdgeCases(10);
    expect(result.score).toBe(5);
    expect(result.summary).toContain("10");
  });

  it("returns 3 for 3-9 edge cases", () => {
    const result = scoreEdgeCases(5);
    expect(result.score).toBe(3);
    expect(result.summary).toContain("5");
  });

  it("returns 1 for 1 edge case with singular label", () => {
    const result = scoreEdgeCases(1);
    expect(result.score).toBe(1);
    expect(result.summary).toContain("1 edge/error test case");
    expect(result.summary).not.toContain("cases");
  });

  it("returns 1 for 2 edge cases with plural label", () => {
    const result = scoreEdgeCases(2);
    expect(result.score).toBe(1);
    expect(result.summary).toContain("cases");
  });

  it("returns 0 for zero edge cases", () => {
    const result = scoreEdgeCases(0);
    expect(result.score).toBe(0);
    expect(result.summary).toBe("no edge case tests detected");
  });
});

// ── scoreTestQuality ────────────────────────────────────────────────────────

describe("scoreTestQuality", () => {
  it("returns 8 for large test suite with high assertion density and describe blocks", () => {
    const result = scoreTestQuality(100, 250, true);
    expect(result.score).toBe(8);
    expect(result.summary).toContain("assertions per test");
    expect(result.summary).toContain("2.5");
  });

  it("returns 8 at exact thresholds: 50 tests, 2.0 ratio, hasDescribe", () => {
    const result = scoreTestQuality(50, 100, true);
    expect(result.score).toBe(8);
    expect(result.summary).toContain("2.0");
  });

  it("returns 6 for medium suite with >=1.5 ratio and describe", () => {
    const result = scoreTestQuality(20, 35, true);
    expect(result.score).toBe(6);
    expect(result.summary).toContain("assertions per test");
  });

  it("returns 6 at exact lower threshold: 10 tests, 1.5 ratio, hasDescribe", () => {
    const result = scoreTestQuality(10, 15, true);
    expect(result.score).toBe(6);
    expect(result.summary).toContain("1.5");
  });

  it("returns 4 for small suite with >=1 assertion per test", () => {
    const result = scoreTestQuality(5, 7, false);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("assertions per test");
  });

  it("returns 2 for suite with very low assertion density", () => {
    const result = scoreTestQuality(5, 2, false);
    expect(result.score).toBe(2);
    expect(result.summary).toContain("low assertion density");
  });

  it("returns 2 for single test case (below 5-test threshold)", () => {
    const result = scoreTestQuality(1, 1, false);
    expect(result.score).toBe(2);
    expect(result.summary).toContain("low assertion density");
  });

  it("returns 0 for no test cases", () => {
    const result = scoreTestQuality(0, 0, false);
    expect(result.score).toBe(0);
    expect(result.summary).toBe("no test cases found");
  });

  it("misses score 8 without describe blocks even with high density", () => {
    const result = scoreTestQuality(100, 300, false);
    expect(result.score).toBeLessThan(8);
  });

  it("gives score 8 to large suites with strong assertion density", () => {
    const result = scoreTestQuality(100, 190, true);
    expect(result.score).toBe(8);
  });
});

// ── scoreSecrets ────────────────────────────────────────────────────────────

describe("scoreSecrets", () => {
  it("returns 3 for zero secrets with env vars", () => {
    const result = scoreSecrets(0, true);
    expect(result.score).toBe(3);
    expect(result.summary).toContain("no hardcoded secrets");
    expect(result.summary).toContain("env vars");
  });

  it("returns 2 for zero secrets without env vars", () => {
    const result = scoreSecrets(0, false);
    expect(result.score).toBe(2);
    expect(result.summary).toBe("no hardcoded secrets");
  });

  it("returns 0 for one secret", () => {
    const result = scoreSecrets(1, false);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("1 potential secret");
    expect(result.summary).not.toContain("secrets");
  });

  it("returns 0 for multiple secrets with plural label", () => {
    const result = scoreSecrets(3, true);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("3 potential secrets");
  });
});

// ── scoreInputValidation ────────────────────────────────────────────────────

describe("scoreInputValidation", () => {
  it("returns 6 for 3+ validation files with good ratio", () => {
    const result = scoreInputValidation(5, 6);
    expect(result.score).toBe(6);
    expect(result.summary).toContain("validation on 5 files");
    expect(result.issues).toBe(0);
  });

  it("returns 4 for 2 validation files", () => {
    const result = scoreInputValidation(2, 4);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("2 files");
    expect(result.issues).toBeGreaterThanOrEqual(0);
  });

  it("returns 2 for 1 validation file", () => {
    const result = scoreInputValidation(1, 3);
    expect(result.score).toBe(2);
    expect(result.summary).toContain("minimal input validation");
    expect(result.issues).toBe(2);
  });

  it("returns 0 for no validation files", () => {
    const result = scoreInputValidation(0, 5);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("no input validation");
    expect(result.issues).toBe(5);
  });

  it("returns 0 with no routes and no validation", () => {
    const result = scoreInputValidation(0, 0);
    expect(result.score).toBe(0);
    expect(result.issues).toBe(0);
  });
});

// ── scoreAuthChecks ─────────────────────────────────────────────────────────

describe("scoreAuthChecks", () => {
  it("returns 6 when all 3 checks are present", () => {
    const result = scoreAuthChecks(true, true, true);
    expect(result.score).toBe(6);
    expect(result.summary).toContain("auth middleware");
    expect(result.summary).toContain("rate limiting");
    expect(result.summary).toContain("CORS");
    expect(result.issues).toBe(0);
  });

  it("returns 4 for auth + rate limiting", () => {
    const result = scoreAuthChecks(true, true, false);
    expect(result.score).toBe(4);
    expect(result.issues).toBe(1);
  });

  it("returns 4 for auth + CORS", () => {
    const result = scoreAuthChecks(true, false, true);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("auth middleware");
    expect(result.summary).toContain("CORS");
  });

  it("returns 2 for auth only", () => {
    const result = scoreAuthChecks(true, false, false);
    expect(result.score).toBe(2);
    expect(result.summary).toBe("auth middleware only");
    expect(result.issues).toBe(2);
  });

  it("returns 2 for rate limiting only", () => {
    const result = scoreAuthChecks(false, true, false);
    expect(result.score).toBe(2);
    expect(result.summary).toBe("rate limiting only");
  });

  it("returns 2 for CORS only", () => {
    const result = scoreAuthChecks(false, false, true);
    expect(result.score).toBe(2);
    expect(result.summary).toBe("CORS only");
  });

  it("returns 0 with no checks", () => {
    const result = scoreAuthChecks(false, false, false);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("no auth");
    expect(result.issues).toBe(3);
  });

  it("reduces score for overly broad rate limiters", () => {
    const result = scoreAuthChecks(true, true, true, 2);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("overly broad rate limiter");
    expect(result.issues).toBe(2);
  });

  it("includes plural form for multiple broad limiters", () => {
    const result = scoreAuthChecks(true, true, true, 3);
    expect(result.score).toBe(3);
    expect(result.summary).toContain("limiters");
  });
});

// ── scoreAnyTypeDensity ─────────────────────────────────────────────────────

describe("scoreAnyTypeDensity", () => {
  it("returns 8 for zero any types", () => {
    const result = scoreAnyTypeDensity(0, 1000);
    expect(result.score).toBe(8);
    expect(result.summary).toBe("zero any types");
  });

  it("returns 8 for very low density (< 1 per 1000 lines)", () => {
    const result = scoreAnyTypeDensity(1, 2000);
    expect(result.score).toBe(8);
    expect(result.summary).toContain("very low density");
  });

  it("returns 7 for density 1-2 per 1000 lines", () => {
    const result = scoreAnyTypeDensity(15, 10000);
    expect(result.score).toBe(7);
    expect(result.summary).toContain("low density");
  });

  it("returns 5 for moderate density", () => {
    const result = scoreAnyTypeDensity(50, 10000);
    expect(result.score).toBe(5);
    expect(result.summary).toContain("moderate");
  });

  it("returns 0 for very high density", () => {
    const result = scoreAnyTypeDensity(200, 1000);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("very high density");
  });
});

// ── scoreEhCoverage ─────────────────────────────────────────────────────────

describe("scoreEhCoverage", () => {
  it("returns 0 for no try/catch blocks", () => {
    const result = scoreEhCoverage(0, 10);
    expect(result.score).toBe(0);
    expect(result.summary).toBe("no try/catch found");
  });

  it("returns 8 when try/catch count >= 60% of async functions", () => {
    const result = scoreEhCoverage(6, 10);
    expect(result.score).toBe(8);
    expect(result.summary).toContain("6 try/catch block");
  });

  it("returns 8 when there are no async functions", () => {
    const result = scoreEhCoverage(5, 0);
    expect(result.score).toBe(8);
    expect(result.summary).toContain("5 try/catch blocks");
  });

  it("uses singular block label for count of 1", () => {
    const result = scoreEhCoverage(1, 0);
    expect(result.score).toBe(8);
    expect(result.summary).toBe("1 try/catch block");
  });

  it("returns proportional score for partial coverage", () => {
    const result = scoreEhCoverage(3, 10);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(8);
    expect(result.summary).toContain("30% async coverage");
  });
});

// ── scoreEmptyCatches ───────────────────────────────────────────────────────

describe("scoreEmptyCatches", () => {
  it("returns 5 for zero empty catches", () => {
    const result = scoreEmptyCatches(0);
    expect(result.score).toBe(5);
    expect(result.summary).toBe("no empty catch blocks");
  });

  it("returns 4.5 for exactly 1 empty catch", () => {
    const result = scoreEmptyCatches(1);
    expect(result.score).toBe(4.5);
    expect(result.summary).toBe("1 empty catch");
  });

  it("returns 4 for 2 empty catches", () => {
    const result = scoreEmptyCatches(2);
    expect(result.score).toBe(4);
    expect(result.summary).toBe("2 empty catches");
  });

  it("returns 3 for 3-4 empty catches", () => {
    const result = scoreEmptyCatches(4);
    expect(result.score).toBe(3);
    expect(result.summary).toContain("4 empty catches");
  });

  it("returns 2 for 5-7 empty catches", () => {
    const result = scoreEmptyCatches(7);
    expect(result.score).toBe(2);
  });

  it("returns 1 for 8-12 empty catches", () => {
    const result = scoreEmptyCatches(10);
    expect(result.score).toBe(1);
  });

  it("returns 0 for 13+ empty catches", () => {
    const result = scoreEmptyCatches(15);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("15 empty catches");
  });
});

// ── scoreStructuredLogging ──────────────────────────────────────────────────

describe("scoreStructuredLogging", () => {
  it("returns 7 for structured logger only with no console calls", () => {
    const result = scoreStructuredLogging(10, 0);
    expect(result.score).toBe(7);
    expect(result.summary).toContain("structured logger only");
    expect(result.summary).toContain("10 calls");
  });

  it("returns 5 for structured logger with few console calls", () => {
    const result = scoreStructuredLogging(10, 3);
    expect(result.score).toBe(5);
    expect(result.summary).toContain("structured logger");
    expect(result.summary).toContain("3 console calls");
  });

  it("returns 3 for structured logger with many console calls", () => {
    const result = scoreStructuredLogging(5, 10);
    expect(result.score).toBe(3);
    expect(result.summary).toContain("console");
  });

  it("returns 1 for console only (no structured logger)", () => {
    const result = scoreStructuredLogging(0, 5);
    expect(result.score).toBe(1);
    expect(result.summary).toContain("console.error/warn calls");
    expect(result.summary).toContain("no structured logger");
  });

  it("returns 0 for no logging at all", () => {
    const result = scoreStructuredLogging(0, 0);
    expect(result.score).toBe(0);
    expect(result.summary).toBe("no error logging detected");
  });
});

// ── scoreAwaitInLoop ────────────────────────────────────────────────────────

describe("scoreAwaitInLoop", () => {
  it("returns 5 for zero await-in-loop patterns", () => {
    const result = scoreAwaitInLoop(0);
    expect(result.score).toBe(5);
    expect(result.summary).toBe("no await-in-loop");
  });

  it("returns 4 for exactly 1 pattern", () => {
    const result = scoreAwaitInLoop(1);
    expect(result.score).toBe(4);
    expect(result.summary).toBe("1 await-in-loop pattern");
  });

  it("returns 3 for 2-3 patterns", () => {
    const r2 = scoreAwaitInLoop(2);
    const r3 = scoreAwaitInLoop(3);
    expect(r2.score).toBe(3);
    expect(r3.score).toBe(3);
    expect(r2.summary).toContain("2 await-in-loop patterns");
  });

  it("returns 2 for 4-6 patterns", () => {
    const result = scoreAwaitInLoop(6);
    expect(result.score).toBe(2);
    expect(result.summary).toContain("6 await-in-loop patterns");
  });

  it("returns 1 for 7+ patterns", () => {
    const result = scoreAwaitInLoop(10);
    expect(result.score).toBe(1);
    expect(result.summary).toContain("10 await-in-loop patterns");
  });
});

// ── scoreConsoleLog ─────────────────────────────────────────────────────────

describe("scoreConsoleLog", () => {
  it("returns 5 for zero console.log calls", () => {
    const result = scoreConsoleLog(0);
    expect(result.score).toBe(5);
    expect(result.summary).toBe("no console.log in src");
  });

  it("returns 4 for 1-3 console.log calls", () => {
    const result = scoreConsoleLog(2);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("2 console.log");
  });

  it("returns 3 for 4-10 calls", () => {
    const result = scoreConsoleLog(8);
    expect(result.score).toBe(3);
    expect(result.summary).toContain("8 console.log calls");
  });

  it("returns 2 for 11-25 calls", () => {
    const result = scoreConsoleLog(20);
    expect(result.score).toBe(2);
    expect(result.summary).toContain("20 console.log calls");
  });

  it("returns 1 for 26-75 calls", () => {
    const result = scoreConsoleLog(50);
    expect(result.score).toBe(1);
  });

  it("returns 0 for 76+ calls", () => {
    const result = scoreConsoleLog(100);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("excessive");
  });
});

// ── scoreImportHygiene ──────────────────────────────────────────────────────

describe("scoreImportHygiene", () => {
  it("returns 4 for zero import issues", () => {
    const result = scoreImportHygiene(0);
    expect(result.score).toBe(4);
    expect(result.summary).toBe("clean imports");
  });

  it("returns 2 for 1-2 import issues with singular label", () => {
    const r1 = scoreImportHygiene(1);
    expect(r1.score).toBe(2);
    expect(r1.summary).toContain("1 import issue detected");
  });

  it("returns 2 for 2 import issues", () => {
    const r2 = scoreImportHygiene(2);
    expect(r2.score).toBe(2);
    expect(r2.summary).toContain("2 import issues detected");
  });

  it("returns 0 for 3+ import issues", () => {
    const result = scoreImportHygiene(5);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("5 import issues detected");
  });
});

// ── scoreFunctionLength ─────────────────────────────────────────────────────

describe("scoreFunctionLength", () => {
  it("returns 6 when no functions are detected", () => {
    const result = scoreFunctionLength(0, 0);
    expect(result.score).toBe(6);
    expect(result.summary).toBe("no functions detected");
  });

  it("returns 6 for short average function length (<= 20)", () => {
    const result = scoreFunctionLength(15, 20);
    expect(result.score).toBe(6);
    expect(result.summary).toBe("short functions");
  });

  it("returns 6 for avg <= 30 lines", () => {
    const result = scoreFunctionLength(28, 50);
    expect(result.score).toBe(6);
    expect(result.summary).toContain("28-line functions");
  });

  it("returns 5 for avg 31-40 lines", () => {
    const result = scoreFunctionLength(35, 50);
    expect(result.score).toBe(5);
    expect(result.summary).toContain("35-line functions");
  });

  it("returns 4 for avg 41-50 lines", () => {
    const result = scoreFunctionLength(45, 50);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("45-line functions");
  });

  it("returns 3 for avg 51-65 lines", () => {
    const result = scoreFunctionLength(60, 50);
    expect(result.score).toBe(3);
    expect(result.summary).toContain("60-line functions");
  });

  it("returns 2 for avg 66-80 lines", () => {
    const result = scoreFunctionLength(75, 50);
    expect(result.score).toBe(2);
    expect(result.summary).toContain("75-line functions");
  });

  it("returns 1 for avg > 80 lines", () => {
    const result = scoreFunctionLength(100, 50);
    expect(result.score).toBe(1);
    expect(result.summary).toContain("long avg");
  });
});

// ── scoreLineLength ─────────────────────────────────────────────────────────

describe("scoreLineLength", () => {
  it("returns 6 for zero long lines", () => {
    const result = scoreLineLength(0);
    expect(result.score).toBe(6);
    expect(result.summary).toBe("no long lines");
  });

  it("returns 5 for 1-5 long lines", () => {
    const r1 = scoreLineLength(1);
    const r5 = scoreLineLength(5);
    expect(r1.score).toBe(5);
    expect(r5.score).toBe(5);
    expect(r1.summary).toContain("1 long line");
  });

  it("returns 5 for 5 with plural label", () => {
    const result = scoreLineLength(5);
    expect(result.summary).toContain("5 long lines");
  });

  it("returns 4 for 6-15 long lines", () => {
    const result = scoreLineLength(10);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("10 long lines");
  });

  it("returns 3 for 16-50 long lines", () => {
    const result = scoreLineLength(30);
    expect(result.score).toBe(3);
  });

  it("returns 2 for 51-150 long lines", () => {
    const result = scoreLineLength(100);
    expect(result.score).toBe(2);
  });

  it("returns 1 for 151-500 long lines", () => {
    const result = scoreLineLength(300);
    expect(result.score).toBe(1);
  });

  it("returns 0 for 500+ long lines", () => {
    const result = scoreLineLength(600);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("600 long lines");
  });
});

// ── scoreDeadCode ───────────────────────────────────────────────────────────

describe("scoreDeadCode", () => {
  it("returns 6 for no dead code at all", () => {
    const result = scoreDeadCode(0, 0);
    expect(result.score).toBe(6);
    expect(result.summary).toBe("no dead code detected");
  });

  it("returns 5 for only 1-3 TODOs with no commented-out code", () => {
    const result = scoreDeadCode(0, 2);
    expect(result.score).toBe(5);
    expect(result.summary).toContain("2 TODOs");
  });

  it("uses singular TODO label", () => {
    const result = scoreDeadCode(0, 1);
    expect(result.score).toBe(5);
    expect(result.summary).toContain("1 TODO");
    expect(result.summary).not.toContain("TODOs");
  });

  it("returns 4 for a few commented lines and some TODOs", () => {
    const result = scoreDeadCode(2, 4);
    expect(result.score).toBe(4);
    expect(result.summary).toContain("2 commented-out");
    expect(result.summary).toContain("4 TODOs");
  });

  it("returns 2 for 4-10 commented lines", () => {
    const result = scoreDeadCode(8, 6);
    expect(result.score).toBe(2);
    expect(result.summary).toContain("8 commented-out");
  });

  it("returns 0 for 11+ commented lines", () => {
    const result = scoreDeadCode(15, 3);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("15 commented-out");
  });
});
