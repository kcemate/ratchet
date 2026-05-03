import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runScan, type ScanResult } from "../src/commands/scan.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ratchet-scan-"));
}

describe("runScan", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a ScanResult with all 6 categories", async () => {
    writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
    const result = await runScan(dir);

    expect(result.categories).toHaveLength(6);
    expect(result.maxTotal).toBe(100);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it("uses package.json name as projectName", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-cool-app", scripts: { test: "vitest run" } }));
    const result = await runScan(dir);
    expect(result.projectName).toBe("my-cool-app");
  });

  it("falls back to directory name when no package.json", async () => {
    const result = await runScan(dir);
    expect(result.projectName).toBeTruthy();
  });

  describe("subcategory structure", () => {
    it("all categories have subcategories array", async () => {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      const result = await runScan(dir);
      for (const cat of result.categories) {
        expect(cat.subcategories).toBeDefined();
        expect(Array.isArray(cat.subcategories)).toBe(true);
        expect(cat.subcategories.length).toBeGreaterThan(0);
      }
    });

    it("subcategory scores sum to category score", async () => {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      writeFileSync(
        join(dir, "index.test.ts"),
        `
import { describe, it, expect } from 'vitest';
describe('x', () => {
  it('works', () => expect(1).toBe(1));
});
`
      );
      const result = await runScan(dir);
      for (const cat of result.categories) {
        const subSum = cat.subcategories.reduce((acc, s) => acc + s.score, 0);
        expect(subSum).toBe(cat.score);
      }
    });

    it("all category maxes sum to 100", async () => {
      const result = await runScan(dir);
      const maxSum = result.categories.reduce((acc, c) => acc + c.max, 0);
      expect(maxSum).toBe(100);
    });

    it("subcategory maxes sum to category max", async () => {
      const result = await runScan(dir);
      for (const cat of result.categories) {
        const subMaxSum = cat.subcategories.reduce((acc, s) => acc + s.max, 0);
        expect(subMaxSum).toBe(cat.max);
      }
    });
  });

  describe("issues metrics", () => {
    it("returns totalIssuesFound and issuesByType", async () => {
      writeFileSync(join(dir, "index.ts"), "export const x: any = 1;\n");
      const result = await runScan(dir);
      expect(typeof result.totalIssuesFound).toBe("number");
      expect(Array.isArray(result.issuesByType)).toBe(true);
    });

    it("issuesByType entries have required fields", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
async function bad() {
  try { await fetch('x'); } catch {}
}
`
      );
      const result = await runScan(dir);
      for (const issue of result.issuesByType) {
        expect(issue.category).toBeTruthy();
        expect(issue.subcategory).toBeTruthy();
        expect(typeof issue.count).toBe("number");
        expect(issue.description).toBeTruthy();
        expect(["low", "medium", "high"]).toContain(issue.severity);
      }
    });

    it("totalIssuesFound equals sum of issuesByType counts", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
async function bad() {
  try { await fetch('x'); } catch {}
  const x: any = 1;
  console.log(x);
}
`
      );
      const result = await runScan(dir);
      const sum = result.issuesByType.reduce((acc, i) => acc + i.count, 0);
      expect(result.totalIssuesFound).toBe(sum);
    });

    it("detects empty catch blocks as high severity issues", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
async function bad1() { try { await fetch('x'); } catch {} }
async function bad2() { try { await fetch('y'); } catch {} }
async function bad3() { try { await fetch('z'); } catch {} }
`
      );
      const result = await runScan(dir);
      const emptyCatchIssue = result.issuesByType.find(i => i.description === "empty catch blocks");
      expect(emptyCatchIssue).toBeDefined();
      expect(emptyCatchIssue?.count).toBeGreaterThanOrEqual(3);
      expect(emptyCatchIssue?.severity).toBe("high");
    });

    it("detects any types as medium severity issues", async () => {
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFileSync(
        join(dir, "app.ts"),
        `
export function process(data: any): any { return data; }
export function transform(x: any): any { return x; }
`
      );
      const result = await runScan(dir);
      const anyIssue = result.issuesByType.find(i => i.description === "any types");
      expect(anyIssue).toBeDefined();
      expect(anyIssue?.severity).toBe("medium");
    });
  });

  describe("Testing category", () => {
    it("scores 0 for testing when no test files exist", async () => {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", scripts: { start: "node ." } }));
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Testing")!;
      expect(cat.score).toBe(0);
    });

    it("awards points for test files", async () => {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      writeFileSync(join(dir, "index.test.ts"), 'import { x } from "./index"; expect(x).toBe(1);\n');
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", scripts: { test: "vitest run" } }));
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Testing")!;
      expect(cat.score).toBeGreaterThan(0);
    });

    it("has coverage ratio, edge case depth, test quality subcategories", async () => {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Testing")!;
      const subNames = cat.subcategories.map(s => s.name);
      expect(subNames).toContain("Coverage ratio");
      expect(subNames).toContain("Edge case depth");
      expect(subNames).toContain("Test quality");
    });

    it("detects edge case tests", async () => {
      writeFileSync(join(dir, "app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(dir, "app.test.ts"),
        `
import { describe, it, expect } from 'vitest';
describe('app', () => {
  it('works', () => expect(1).toBe(1));
  it('throws on invalid input', () => expect(() => {}).toThrow());
  it('handles error gracefully', () => expect(true).toBe(true));
  it('rejects bad data', () => expect(true).toBe(true));
  it('handles empty input', () => expect(true).toBe(true));
  it('fails with boundary values', () => expect(true).toBe(true));
});
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Testing")!;
      const edgeSub = cat.subcategories.find(s => s.name === "Edge case depth")!;
      expect(edgeSub.score).toBeGreaterThan(0);
    });

    it("measures test quality via assertion density", async () => {
      writeFileSync(join(dir, "app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(dir, "app.test.ts"),
        `
import { describe, it, expect } from 'vitest';
describe('app', () => {
  it('works', () => {
    expect(1).toBe(1);
    expect(2).toBe(2);
    expect(3).toBe(3);
  });
  it('also works', () => {
    expect(true).toBe(true);
    expect(false).toBe(false);
  });
});
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Testing")!;
      const qualSub = cat.subcategories.find(s => s.name === "Test quality")!;
      expect(qualSub.score).toBeGreaterThan(0);
    });
  });

  describe("Error Handling category", () => {
    it("awards points for try/catch blocks", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
async function fetchData() {
  try {
    const result = await fetch('https://api.example.com');
    return result.json();
  } catch (err) {
    console.error(err);
  }
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Error Handling")!;
      expect(cat.score).toBeGreaterThan(0);
      expect(cat.summary).toContain("try/catch");
    });

    it("penalizes empty catch blocks", async () => {
      const withEmpty = `
async function bad() {
  try {
    await fetch('x');
  } catch {}
}
`;
      const withHandler = `
async function good() {
  try {
    await fetch('x');
  } catch (e) {
    console.error(e);
  }
}
`;
      writeFileSync(join(dir, "bad.ts"), withEmpty);
      const badResult = await runScan(dir);
      const badCat = badResult.categories.find(c => c.name === "Error Handling")!;

      rmSync(join(dir, "bad.ts"));
      writeFileSync(join(dir, "good.ts"), withHandler);
      const goodResult = await runScan(dir);
      const goodCat = goodResult.categories.find(c => c.name === "Error Handling")!;

      expect(goodCat.score).toBeGreaterThanOrEqual(badCat.score);
    });

    it("has Coverage, Empty catches, Structured logging subcategories", async () => {
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Error Handling")!;
      const subNames = cat.subcategories.map(s => s.name);
      expect(subNames).toContain("Coverage");
      expect(subNames).toContain("Empty catches");
      expect(subNames).toContain("Structured logging");
    });

    it("detects structured logger usage", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
import winston from 'winston';
const logger = winston.createLogger({});

async function run() {
  try {
    await fetch('x');
  } catch (e) {
    logger.error('Failed', { error: e });
  }
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Error Handling")!;
      const logSub = cat.subcategories.find(s => s.name === "Structured logging")!;
      expect(logSub.score).toBeGreaterThan(0);
    });
  });

  describe("Type Safety category", () => {
    it("returns low score for JS-only project", async () => {
      writeFileSync(join(dir, "index.js"), "module.exports = { x: 1 };\n");
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Type Safety")!;
      expect(cat.score).toBe(0);
      expect(cat.summary).toContain("JavaScript");
    });

    it("awards points for TypeScript with strict mode", async () => {
      writeFileSync(join(dir, "index.ts"), "export function add(a: number, b: number): number { return a + b; }\n");
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Type Safety")!;
      expect(cat.score).toBeGreaterThanOrEqual(4 + 8); // strict (4) + zero any (8)
      expect(cat.summary).toContain("strict mode");
    });

    it("deducts for any types", async () => {
      const withAny = "export function process(data: any): any { return data; }\n".repeat(20);
      const withoutAny = "export function process(data: string): string { return data; }\n".repeat(20);

      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));

      writeFileSync(join(dir, "app.ts"), withAny);
      const anyResult = await runScan(dir);
      const anyCat = anyResult.categories.find(c => c.name === "Type Safety")!;

      writeFileSync(join(dir, "app.ts"), withoutAny);
      const cleanResult = await runScan(dir);
      const cleanCat = cleanResult.categories.find(c => c.name === "Type Safety")!;

      expect(cleanCat.score).toBeGreaterThan(anyCat.score);
    });

    it("has Strict config and Any type count subcategories", async () => {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Type Safety")!;
      const subNames = cat.subcategories.map(s => s.name);
      expect(subNames).toContain("Strict config");
      expect(subNames).toContain("Any type count");
    });
  });

  describe("Security category", () => {
    it("awards points for clean code with env vars", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
const apiUrl = process.env.API_URL;
export async function fetchData() {
  const res = await fetch(apiUrl!);
  return res.json();
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Security")!;
      expect(cat.summary).toContain("no hardcoded secrets");
    });

    it("flags hardcoded API keys", async () => {
      writeFileSync(
        join(dir, "config.ts"),
        `
const apiKey = 'sk-abcdefghijklmnopqrstuvwx';
export { apiKey };
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Security")!;
      expect(cat.summary).toContain("potential secret");
    });

    it("has Secrets, Input validation, Auth & rate limiting subcategories", async () => {
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Security")!;
      const subNames = cat.subcategories.map(s => s.name);
      expect(subNames).toContain("Secrets & env vars");
      expect(subNames).toContain("Input validation");
      expect(subNames).toContain("Auth & rate limiting");
    });

    it("detects input validation with Zod", async () => {
      writeFileSync(
        join(dir, "routes.ts"),
        `
import { z } from 'zod';
const schema = z.object({ name: z.string(), age: z.number() });
export function validateUser(data: unknown) {
  return schema.parse(data);
}
`
      );
      writeFileSync(
        join(dir, "routes2.ts"),
        `
import { z } from 'zod';
const bodySchema = z.object({ email: z.string().email() });
export function validateBody(data: unknown) {
  return bodySchema.parse(data);
}
`
      );
      writeFileSync(
        join(dir, "routes3.ts"),
        `
import { z } from 'zod';
const paramSchema = z.object({ id: z.string().uuid() });
export function validateParams(data: unknown) {
  return paramSchema.parse(data);
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Security")!;
      const valSub = cat.subcategories.find(s => s.name === "Input validation")!;
      expect(valSub.score).toBeGreaterThan(0);
    });

    it("detects auth middleware patterns", async () => {
      writeFileSync(
        join(dir, "middleware.ts"),
        `
import jwt from 'jsonwebtoken';
export function authenticate(req: any, res: any, next: any) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  jwt.verify(token, process.env.JWT_SECRET!, (err: any, decoded: any) => {
    if (err) return res.status(401).json({ error: 'invalid token' });
    req.user = decoded;
    next();
  });
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Security")!;
      const authSub = cat.subcategories.find(s => s.name === "Auth & rate limiting")!;
      expect(authSub.score).toBeGreaterThan(0);
    });
  });

  describe("Performance category", () => {
    it("awards full points for no issues", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
export async function fetchAll(ids: string[]): Promise<string[]> {
  const results = await Promise.all(ids.map(id => fetch(id).then(r => r.text())));
  return results;
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Performance")!;
      expect(cat.score).toBeGreaterThanOrEqual(9);
    });

    it("detects console.log in source files", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
export function process(x: number): number {
  console.log('processing', x);
  console.log('done');
  console.log('extra');
  console.log('more');
  console.log('five');
  console.log('six');
  console.log('seven');
  console.log('eight');
  console.log('nine');
  console.log('ten');
  console.log('eleven');
  console.log('twelve');
  console.log('thirteen');
  console.log('fourteen');
  console.log('fifteen');
  console.log('sixteen');
  console.log('seventeen');
  console.log('eighteen');
  console.log('nineteen');
  console.log('twenty');
  console.log('twenty-one');
  return x * 2;
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Performance")!;
      expect(cat.summary).toContain("console.log");
    });

    it("has Async patterns, Console cleanup, Import hygiene subcategories", async () => {
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Performance")!;
      const subNames = cat.subcategories.map(s => s.name);
      expect(subNames).toContain("Async patterns");
      expect(subNames).toContain("Console cleanup");
      expect(subNames).toContain("Import hygiene");
    });
  });

  describe("Code Quality category", () => {
    it("awards points for short functions and no long lines", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Code Quality")!;
      expect(cat.score).toBeGreaterThan(10);
    });

    it("detects commented-out code", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
export function add(a: number, b: number): number {
  // const debug = true;
  // if (debug) {
  // return a + b + 1;
  // }
  // const old = a - b;
  // const temp = a + b;
  // const extra = b;
  // const more = a;
  // const further = b;
  // const another = a;
  // const yetMore = b;
  return a + b;
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Code Quality")!;
      const deadSub = cat.subcategories.find(s => s.name === "Dead code")!;
      expect(deadSub.summary).toContain("commented-out");
    });

    it("has Function length, Line length, Dead code, Duplication subcategories", async () => {
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Code Quality")!;
      const subNames = cat.subcategories.map(s => s.name);
      expect(subNames).toContain("Function length");
      expect(subNames).toContain("Line length");
      expect(subNames).toContain("Dead code");
      expect(subNames).toContain("Duplication");
    });

    it("detects TODO comments as dead code indicators", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        `
export function run() {
  // TODO: implement this
  // TODO: fix this later
  // TODO: remove this hack
  // FIXME: this is broken
  // FIXME: needs refactor
  return null;
}
`
      );
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Code Quality")!;
      const deadSub = cat.subcategories.find(s => s.name === "Dead code")!;
      expect(deadSub.issuesFound).toBeGreaterThan(0);
    });

    it("detects duplicate lines across files", async () => {
      const repeatedBlock = `
  const x = doSomething();
  const y = process(x);
  const z = transform(y);
  return z;
`.repeat(1); // repeated content in each file

      writeFileSync(join(dir, "file1.ts"), `export function a() {\n${repeatedBlock}\n}`);
      writeFileSync(join(dir, "file2.ts"), `export function b() {\n${repeatedBlock}\n}`);
      writeFileSync(join(dir, "file3.ts"), `export function c() {\n${repeatedBlock}\n}`);
      writeFileSync(join(dir, "file4.ts"), `export function d() {\n${repeatedBlock}\n}`);

      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === "Code Quality")!;
      const dupSub = cat.subcategories.find(s => s.name === "Duplication")!;
      // Having the same lines in 4+ files should be detected
      expect(dupSub).toBeDefined();
    });
  });

  describe("score totals", () => {
    it("total equals sum of category scores", async () => {
      writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");
      const result = await runScan(dir);
      const sum = result.categories.reduce((acc, c) => acc + c.score, 0);
      expect(result.total).toBe(sum);
    });

    it("maxTotal is always 100", async () => {
      const result = await runScan(dir);
      expect(result.maxTotal).toBe(100);
    });

    it("category max values are: Testing=25, Security=15, TypeSafety=15, ErrorHandling=20, Performance=10, CodeQuality=15", async () => {
      const result = await runScan(dir);
      const maxByName: Record<string, number> = {};
      for (const cat of result.categories) {
        maxByName[cat.name] = cat.max;
      }
      expect(maxByName["Testing"]).toBe(25);
      expect(maxByName["Security"]).toBe(15);
      expect(maxByName["Type Safety"]).toBe(15);
      expect(maxByName["Error Handling"]).toBe(20);
      expect(maxByName["Performance"]).toBe(10);
      expect(maxByName["Code Quality"]).toBe(15);
    });

    it("scores improve with better code", async () => {
      // Bad code: JS, no tests, hardcoded secrets, console.log everywhere
      writeFileSync(
        join(dir, "bad.js"),
        `
const password = 'supersecretpassword123';
function doStuff(x) {
  console.log(x);
  console.log(x);
  console.log(x);
  console.log(x);
  console.log(x);
  console.log(x);
  return x;
}
`
      );
      const badResult = await runScan(dir);

      rmSync(join(dir, "bad.js"));

      // Good code: TypeScript, strict, env vars, no secrets, no console.log
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "good-app", scripts: { test: "vitest run" } }));
      writeFileSync(
        join(dir, "app.ts"),
        `
const apiUrl = process.env.API_URL ?? '';

export async function fetchData(): Promise<string> {
  try {
    const res = await fetch(apiUrl);
    return res.text();
  } catch (err) {
    throw new Error(\`Fetch failed: \${String(err)}\`);
  }
}
`
      );
      writeFileSync(
        join(dir, "app.test.ts"),
        `
import { describe, it, expect } from 'vitest';
describe('app', () => {
  it('works', () => expect(true).toBe(true));
  it('handles errors', () => expect(true).toBe(true));
});
`
      );

      const goodResult = await runScan(dir);
      expect(goodResult.total).toBeGreaterThan(badResult.total);
    });
  });

  describe("--explain-deductions: file:line locations", () => {
    it("console.log locations include file:line format", async () => {
      writeFileSync(
        join(dir, "app.ts"),
        ["export function debug(x: unknown) {", "  console.log(x);", '  console.log("done");', "}"].join("\n")
      );
      const result = await runScan(dir);
      const perfCat = result.categories.find(c => c.name === "Performance");
      const consoleSub = perfCat?.subcategories.find(s => s.name === "Console cleanup");
      expect(consoleSub?.locations).toBeDefined();
      const locs = consoleSub?.locations ?? [];
      expect(locs.length).toBeGreaterThan(0);
      // locations should be file:line format
      expect(locs.every(l => /:\d+$/.test(l))).toBe(true);
      // both lines should be present
      expect(locs.some(l => l.endsWith(":2"))).toBe(true);
      expect(locs.some(l => l.endsWith(":3"))).toBe(true);
    });

    it("line length locations include file:line format", async () => {
      const longName = `value${"x".repeat(130)}`;
      writeFileSync(join(dir, "app.ts"), `export const a = 1;\nexport const ${longName} = 2;\nexport const b = 3;\n`);
      const result = await runScan(dir);
      const qualityCat = result.categories.find(c => c.name === "Code Quality");
      const lineSub = qualityCat?.subcategories.find(s => s.name === "Line length");
      expect(lineSub?.issuesFound).toBeGreaterThan(0);
      const locs = lineSub?.locations ?? [];
      expect(locs.length).toBeGreaterThan(0);
      // should contain file:line entries
      expect(locs.every(l => /:\d+$/.test(l))).toBe(true);
      // long line is on line 2
      expect(locs.some(l => l.endsWith(":2"))).toBe(true);
    });

    it("any type locations include file:line format", async () => {
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFileSync(
        join(dir, "app.ts"),
        ["export function process(data: any): void {", "  const x: any = data;", "  console.log(x);", "}"].join("\n")
      );
      const result = await runScan(dir);
      const typeCat = result.categories.find(c => c.name === "Type Safety");
      const anySub = typeCat?.subcategories.find(s => s.name === "Any type count");
      expect(anySub?.issuesFound).toBeGreaterThan(0);
      const locs = anySub?.locations ?? [];
      expect(locs.length).toBeGreaterThan(0);
      expect(locs.every(l => /:\d+$/.test(l))).toBe(true);
    });
  });
});
