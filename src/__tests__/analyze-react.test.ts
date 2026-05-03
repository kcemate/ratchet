import { describe, it, expect, vi } from "vitest";
import { runDeepAnalyze, runReadTurn, safeReadFile, computeConfidence, deriveRiskLevel } from "../core/analyze-react";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { logger } from "../lib/logger.js";
import { getImpact, getContext, queryFlows, isIndexed } from "../core/gitnexus";
import type { ScanResult } from "../core/scanner";

// Mock dependencies
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("path", () => ({
  join: vi.fn().mockReturnValue("mocked-path"),
  relative: vi.fn().mockReturnValue("relative-path"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../core/gitnexus", () => ({
  isIndexed: vi.fn(),
  getImpact: vi.fn(),
  getContext: vi.fn(),
  queryFlows: vi.fn(),
}));

// Mock scan data
const mockScan: ScanResult = {
  projectName: "test-project",
  total: 85,
  maxTotal: 100,
  totalIssuesFound: 18,
  categories: [],
  issuesByType: [
    {
      category: "Code Quality",
      subcategory: "Missing semicolons",
      count: 10,
      description: "Missing semicolons",
      severity: "low",
      locations: ["src/file1.ts", "src/file2.ts"],
    },
    {
      category: "Code Quality",
      subcategory: "Unused variables",
      count: 5,
      description: "Unused variables",
      severity: "medium",
      locations: ["src/file3.ts"],
    },
    {
      category: "Code Quality",
      subcategory: "Type errors",
      count: 3,
      description: "Type errors",
      severity: "high",
      locations: ["src/file4.ts", "src/file5.ts"],
    },
  ],
};

const mockTarget = {
  path: "src/main.ts",
  name: "Main Component",
  description: "React component analysis",
};

describe("analyze-react.ts", () => {
  describe("safeReadFile", () => {
    it("should read file and return content when successful", async () => {
      const mockContent = 'console.log("test");';
      vi.mocked(readFile).mockResolvedValue(Buffer.from(mockContent) as unknown as string);
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await safeReadFile("test.ts");
      expect(result).toBe(mockContent);
      expect(readFile).toHaveBeenCalledWith("test.ts");
    });

    it("should truncate content when exceeding MAX_FILE_BYTES", async () => {
      const longContent = "a".repeat(10_000);
      vi.mocked(readFile).mockResolvedValue(Buffer.from(longContent) as unknown as string);
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await safeReadFile("test.ts");
      expect(result.length).toBeLessThanOrEqual(8_000 + 3); // +3 for "... [truncated]"
      expect(result).toContain("...[truncated]");
    });

    it("should return empty string when file read fails", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await safeReadFile("test.ts");
      expect(result).toBe("");
    });
  });

  describe("computeConfidence", () => {
    it("should calculate base confidence correctly", () => {
      const result = computeConfidence([], "low", [], 0);
      expect(result).toBe(0.7);
    });

    it("should increase confidence with high-priority changes", () => {
      const changes = [
        { filePath: "file1.ts", description: "Fix", priority: "high" as const },
        { filePath: "file2.ts", description: "Fix", priority: "high" as const },
      ];
      const result = computeConfidence([], "low", changes, 0);
      expect(result).toBe(0.8);
    });

    it("should decrease confidence with blast radius concerns", () => {
      const concerns = ["file1.ts", "file2.ts", "file3.ts"];
      const result = computeConfidence(concerns, "low", [], 0);
      expect(result).toBe(0.55);
    });

    it("should decrease confidence for high/critical risk levels", () => {
      const resultHigh = computeConfidence([], "high", [], 0);
      expect(resultHigh).toBe(0.6);

      const resultCritical = computeConfidence([], "critical", [], 0);
      expect(resultCritical).toBe(0.5);
    });

    it("should increase confidence with tool calls used", () => {
      const result = computeConfidence([], "low", [], 10);
      expect(result).toBe(0.75); // 0.7 + 10*0.01 (capped at 0.05)
    });

    it("should clamp confidence between 0.1 and 1.0", () => {
      const resultLow = computeConfidence(Array(10).fill("f.ts"), "critical", [], 0);
      expect(resultLow).toBe(0.3);

      const resultHigh = computeConfidence(
        [],
        "low",
        Array(20).fill({ filePath: "f.ts", description: "x", priority: "high" as const }),
        10
      );
      expect(resultHigh).toBe(0.9);
    });
  });

  describe("deriveRiskLevel", () => {
    it("should return low risk when no concerns and few callers", () => {
      const result = deriveRiskLevel([], 0);
      expect(result).toBe("low");
    });

    it("should return medium risk when some concerns or moderate callers", () => {
      const result1 = deriveRiskLevel(["file1"], 1);
      expect(result1).toBe("medium");

      const result2 = deriveRiskLevel([], 2);
      expect(result2).toBe("medium");
    });

    it("should return high risk when more concerns or many callers", () => {
      const result1 = deriveRiskLevel(["file1", "file2"], 4);
      expect(result1).toBe("high");

      const result2 = deriveRiskLevel([], 5);
      expect(result2).toBe("high");
    });

    it("should return critical risk when many concerns or very many callers", () => {
      const result1 = deriveRiskLevel(["file1", "file2", "file3", "file4", "file5"], 9);
      expect(result1).toBe("critical");

      const result2 = deriveRiskLevel([], 10);
      expect(result2).toBe("critical");
    });
  });

  describe("runReadTurn", () => {
    it("should read top issue files and return observations", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(Buffer.from("test content") as unknown as string);

      const result = await runReadTurn(mockScan, mockTarget, "/tmp");
      expect(result.turn.index).toBe(1);
      expect(result.turn.phase).toBe("read");
      expect(result.turn.actions).toContain("read:relative-path");
      expect(result.turn.observations).toContain("relative-path: 1 lines read");
      expect(result.toolCalls).toBe(3);
    });

    it("should handle missing files gracefully", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await runReadTurn(mockScan, mockTarget, "/tmp");
      expect(result.turn.actions).toEqual([]);
      expect(result.turn.observations).toEqual([]);
      expect(result.toolCalls).toBe(0);
    });

    it("should fall back to target path when no issue locations", async () => {
      const scanWithNoLocations: ScanResult = {
        ...mockScan,
        issuesByType: [
          {
            category: "Code Quality",
            subcategory: "None",
            count: 0,
            description: "None",
            severity: "low",
            locations: [],
          },
        ],
      };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(Buffer.from("test") as unknown as string);

      const result = await runReadTurn(scanWithNoLocations, mockTarget, "/tmp");
      expect(result.turn.actions).toContain("read:relative-path");
    });
  });

  describe("runDeepAnalyze", () => {
    it("should perform full analysis with 3 turns", async () => {
      // Mock all dependencies
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(Buffer.from("test content") as unknown as string);
      vi.mocked(isIndexed).mockReturnValue(true);
      vi.mocked(getImpact).mockReturnValue({
        target: "src/main.ts",
        directCallers: ["dep1", "dep2"],
        affectedFiles: [],
        riskLevel: "low",
        confidence: 0.7,
        raw: "",
      });
      vi.mocked(getContext).mockReturnValue({
        symbol: "",
        incoming: { ref1: [{ name: "file1", filePath: "file1.ts" }] },
        outgoing: {},
        raw: "",
      });
      vi.mocked(queryFlows).mockReturnValue(["flow1", "flow2"]);

      const result = await runDeepAnalyze(mockScan, mockTarget, "/tmp");

      expect(result.turns.length).toBeGreaterThanOrEqual(2);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.riskLevel).toBeOneOf(["low", "medium", "high", "critical"]);
      expect(result.proposedChanges.length).toBeGreaterThan(0);
      expect(result.executionOrder.length).toBeGreaterThan(0);
      expect(result.blastRadiusConcerns.length).toBeGreaterThanOrEqual(0);
      expect(result.toolCallsUsed).toBeGreaterThanOrEqual(0);
    });

    it("should handle errors gracefully and still return partial results", async () => {
      // Simulate read turn failure
      vi.mocked(readFile).mockRejectedValue(new Error("Read failed"));

      const result = await runDeepAnalyze(mockScan, mockTarget, "/tmp");

      expect(result.turns.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0.1);
      expect(result.riskLevel).toBeDefined();
    });

    it("should skip investigation when GitNexus not indexed", async () => {
      vi.mocked(isIndexed).mockReturnValue(false);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(Buffer.from("test") as unknown as string);

      const result = await runDeepAnalyze(mockScan, mockTarget, "/tmp");

      const investigationTurn = result.turns.find(t => t.phase === "investigate");
      expect(investigationTurn?.reasoning).toContain("GitNexus index not found");
      expect(result.blastRadiusConcerns).toEqual([]);
    });
  });
});
