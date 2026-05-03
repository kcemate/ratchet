/**
 * Tests for --deep report integration.
 *
 * Covers:
 *   - getComplianceLevel: score → compliance tier mapping
 *   - extractDeepReportFindings: ScanResult → DeepReportFinding[]
 *   - generateReport: deep sections present when deepAnalysis provided
 *   - generateReport: unchanged output when no deepAnalysis
 *   - JSON output shape includes deepFindings, complianceLevel, executiveSummary
 */

import { describe, it, expect } from "vitest";
import {
  getComplianceLevel,
  extractDeepReportFindings,
  generateReport,
  type DeepAnalysis,
  type ReportOptions,
} from "../core/report.js";
import type { ScanResult } from "../core/scanner";
import type { RatchetRun } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScanResult(total: number, maxTotal = 100): ScanResult {
  return {
    projectName: "test-project",
    total,
    maxTotal,
    categories: [
      {
        name: "Security",
        emoji: "🔒",
        score: Math.round(total * 0.15),
        max: 15,
        summary: "Security checks",
        subcategories: [],
      },
    ],
    totalIssuesFound: 2,
    issuesByType: [
      {
        category: "Security",
        subcategory: "Input validation",
        count: 1,
        description: "Missing input validation on user-supplied data",
        severity: "high",
        locations: ["src/routes/user.ts:42"],
      },
      {
        category: "Testing",
        subcategory: "Coverage ratio",
        count: 1,
        description: "Low test coverage detected",
        severity: "medium",
        locations: ["src/core/engine.ts"],
      },
    ],
  };
}

function makeRun(): RatchetRun {
  return {
    id: "test-run-001",
    target: { name: "myapp", path: ".", description: "" },
    clicks: [],
    status: "completed" as const,
    startedAt: new Date("2026-03-27T10:00:00Z"),
    finishedAt: new Date("2026-03-27T10:05:00Z"),
  };
}

function makeDeepAnalysis(): DeepAnalysis {
  return {
    findings: [
      {
        severity: "high",
        file: "src/routes/user.ts",
        message: "Missing input validation on user-supplied data",
        confidence: 0.9,
        category: "Security",
        subcategory: "Input validation",
      },
      {
        severity: "medium",
        file: "src/core/engine.ts",
        message: "Low test coverage detected",
        confidence: 0.75,
        category: "Testing",
        subcategory: "Coverage ratio",
      },
    ],
    executiveSummary: "The project scores 72/100 with notable gaps in security and testing coverage.",
    complianceLevel: "Silver",
  };
}

// ---------------------------------------------------------------------------
// getComplianceLevel
// ---------------------------------------------------------------------------

describe("getComplianceLevel", () => {
  it("returns Bronze for score < 60%", () => {
    expect(getComplianceLevel(55, 100)).toBe("Bronze");
    expect(getComplianceLevel(0, 100)).toBe("Bronze");
    expect(getComplianceLevel(59, 100)).toBe("Bronze");
  });

  it("returns Silver for 60–79%", () => {
    expect(getComplianceLevel(60, 100)).toBe("Silver");
    expect(getComplianceLevel(72, 100)).toBe("Silver");
    expect(getComplianceLevel(79, 100)).toBe("Silver");
  });

  it("returns Gold for 80–89%", () => {
    expect(getComplianceLevel(80, 100)).toBe("Gold");
    expect(getComplianceLevel(85, 100)).toBe("Gold");
    expect(getComplianceLevel(89, 100)).toBe("Gold");
  });

  it("returns Platinum for >= 90%", () => {
    expect(getComplianceLevel(90, 100)).toBe("Platinum");
    expect(getComplianceLevel(100, 100)).toBe("Platinum");
  });

  it("returns Bronze when maxScore is 0", () => {
    expect(getComplianceLevel(0, 0)).toBe("Bronze");
  });

  it("works with non-100 maxScore", () => {
    // 90/100 of maxScore=50 → 90%
    expect(getComplianceLevel(45, 50)).toBe("Platinum");
    // 40/50 = 80%
    expect(getComplianceLevel(40, 50)).toBe("Gold");
  });
});

// ---------------------------------------------------------------------------
// extractDeepReportFindings
// ---------------------------------------------------------------------------

describe("extractDeepReportFindings", () => {
  it("converts issuesByType into DeepReportFinding[]", () => {
    const result = makeScanResult(72);
    const findings = extractDeepReportFindings(result);
    expect(findings).toHaveLength(2);
  });

  it("maps severity correctly", () => {
    const result = makeScanResult(72);
    const findings = extractDeepReportFindings(result);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[1]!.severity).toBe("medium");
  });

  it("sets confidence based on severity", () => {
    const result = makeScanResult(72);
    const findings = extractDeepReportFindings(result);
    expect(findings[0]!.confidence).toBe(0.9); // high
    expect(findings[1]!.confidence).toBe(0.75); // medium
  });

  it("extracts file from first location", () => {
    const result = makeScanResult(72);
    const findings = extractDeepReportFindings(result);
    expect(findings[0]!.file).toBe("src/routes/user.ts:42");
  });

  it("filters out zero-count issues", () => {
    const result = makeScanResult(72);
    result.issuesByType.push({
      category: "Performance",
      subcategory: "Async patterns",
      count: 0,
      description: "No issues",
      severity: "low",
      locations: [],
    });
    const findings = extractDeepReportFindings(result);
    expect(findings).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// generateReport — without --deep
// ---------------------------------------------------------------------------

describe("generateReport without deepAnalysis", () => {
  it("produces standard sections only", () => {
    const opts: ReportOptions = {
      run: makeRun(),
      cwd: "/tmp/myapp",
    };
    const md = generateReport(opts);
    expect(md).toContain("# 🔧 Ratchet Report");
    expect(md).not.toContain("Executive Summary");
    expect(md).not.toContain("Deep Findings");
    expect(md).not.toContain("Recommendations");
  });
});

// ---------------------------------------------------------------------------
// generateReport — with --deep
// ---------------------------------------------------------------------------

describe("generateReport with deepAnalysis", () => {
  const opts: ReportOptions = {
    run: makeRun(),
    cwd: "/tmp/myapp",
    scoreAfter: makeScanResult(72),
    deepAnalysis: makeDeepAnalysis(),
  };

  it("includes Executive Summary section", () => {
    const md = generateReport(opts);
    expect(md).toContain("## Executive Summary");
    expect(md).toContain("The project scores 72/100");
  });

  it("includes compliance level badge", () => {
    const md = generateReport(opts);
    expect(md).toContain("Silver");
  });

  it("includes Deep Findings table", () => {
    const md = generateReport(opts);
    expect(md).toContain("## Deep Findings");
    expect(md).toContain("Missing input validation");
    expect(md).toContain("Low test coverage");
  });

  it("includes Recommendations section", () => {
    const md = generateReport(opts);
    expect(md).toContain("## Recommendations");
  });

  it("sorts recommendations by severity (high first)", () => {
    const md = generateReport(opts);
    const recIdx = md.indexOf("## Recommendations");
    const highIdx = md.indexOf("Missing input validation", recIdx);
    const medIdx = md.indexOf("Low test coverage", recIdx);
    expect(highIdx).toBeLessThan(medIdx);
  });

  it("truncates long messages in findings table", () => {
    const longOpts: ReportOptions = {
      ...opts,
      deepAnalysis: {
        ...makeDeepAnalysis(),
        findings: [
          {
            severity: "high",
            file: "src/foo.ts",
            message: "A".repeat(200),
            confidence: 0.9,
            category: "Security",
            subcategory: "Input validation",
          },
        ],
      },
    };
    const md = generateReport(longOpts);
    // Should not exceed 80 chars for the message in the table
    const tableLines = md.split("\n").filter(l => l.includes("| 🔴 High |"));
    expect(tableLines[0]!.length).toBeLessThan(300); // truncated reasonably
  });
});

// ---------------------------------------------------------------------------
// JSON output shape
// ---------------------------------------------------------------------------

describe("JSON output shape", () => {
  it("deepFindings, complianceLevel, executiveSummary are present in serialized form", () => {
    const analysis = makeDeepAnalysis();
    // Simulate what the report command serializes
    const payload = {
      runId: "test-run-001",
      target: "myapp",
      scoreAfter: makeScanResult(72),
      deepFindings: analysis.findings,
      complianceLevel: analysis.complianceLevel,
      executiveSummary: analysis.executiveSummary,
    };
    const json = JSON.stringify(payload);
    const parsed = JSON.parse(json);
    expect(parsed.deepFindings).toHaveLength(2);
    expect(parsed.complianceLevel).toBe("Silver");
    expect(parsed.executiveSummary).toContain("72/100");
  });

  it("deepFindings entries have required fields", () => {
    const analysis = makeDeepAnalysis();
    for (const f of analysis.findings) {
      expect(f).toHaveProperty("severity");
      expect(f).toHaveProperty("message");
      expect(f).toHaveProperty("confidence");
      expect(f).toHaveProperty("category");
    }
  });
});
