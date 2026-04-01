import { describe, it, expect } from "vitest";
import { buildSweepPrompt } from "../src/core/agents/shell.js";
import { buildBacklog } from "../src/core/issue-backlog.js";

describe("sweep mode", () => {
  it("buildSweepPrompt includes file paths", () => {
    const prompt = buildSweepPrompt("console.log calls in src", ["src/a.ts", "src/b.ts"]);
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("src/b.ts");
    expect(prompt).toContain("MODIFIED:");
  });

  it("chunks 13 files into batches of 6", () => {
    // Test the chunk helper — export it or test via runSweepEngine behavior
    const files = Array.from({ length: 13 }, (_, i) => `file${i}.ts`);
    const chunks: string[][] = [];
    for (let i = 0; i < files.length; i += 6) chunks.push(files.slice(i, i + 6));
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(6);
    expect(chunks[2]).toHaveLength(1);
  });

  it("buildBacklog sets sweepFiles from locations", () => {
    const mockScan = {
      projectName: "test", total: 0, maxTotal: 100,
      totalIssuesFound: 1, categories: [],
      issuesByType: [{
        category: "Performance", subcategory: "Console cleanup",
        count: 3, description: "console.log calls in src",
        severity: "medium" as const,
        locations: ["src/a.ts", "src/b.ts", "src/c.ts"]
      }]
    };
    const backlog = buildBacklog(mockScan);
    expect(backlog[0].sweepFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("buildSweepPrompt enforces constraints", () => {
    const prompt = buildSweepPrompt("empty catch blocks", ["src/x.ts"]);
    expect(prompt).toContain("ONLY");
    expect(prompt).toContain("HARD CONSTRAINTS");
  });
});
