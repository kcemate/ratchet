import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  familiarize,
  buildFamiliarizationContext,
  detectIndentation,
  detectQuoteStyle,
  detectSemicolons,
  detectImportStyle,
  detectErrorHandling,
  detectTestPattern,
  detectEntryPoint,
  detectTestDir,
  getHotFiles,
} from "../core/familiarize.js";
import type { RepoContext } from "../core/familiarize.js";
import type { RepoProfile } from "../core/repo-probe.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ratchet-familiarize-"));
  dirs.push(dir);
  return dir;
}

function write(dir: string, rel: string, content: string = ""): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function mkdir(dir: string, rel: string): void {
  mkdirSync(join(dir, rel), { recursive: true });
}

function makeProfile(overrides: Partial<RepoProfile> = {}): RepoProfile {
  return {
    language: "ts",
    sourceRoots: ["src/"],
    testRunner: { name: "vitest", command: "npx vitest run" },
    buildTool: { name: "tsc", command: "npx tsc --noEmit" },
    lintTool: null,
    packageManager: "npm",
    monorepo: null,
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// detectIndentation
// ---------------------------------------------------------------------------

describe("detectIndentation", () => {
  it("detects 2-space indent", () => {
    const content = "function foo() {\n  const x = 1;\n  return x;\n}\n";
    expect(detectIndentation(content)).toBe("2-space");
  });

  it("detects 4-space indent", () => {
    const content = "function foo() {\n    const x = 1;\n    return x;\n}\n";
    expect(detectIndentation(content)).toBe("4-space");
  });

  it("detects tabs", () => {
    const content = "function foo() {\n\tconst x = 1;\n\treturn x;\n}\n";
    expect(detectIndentation(content)).toBe("tabs");
  });

  it("returns unknown for no indented lines", () => {
    expect(detectIndentation("const x = 1;\nconst y = 2;\n")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// detectQuoteStyle
// ---------------------------------------------------------------------------

describe("detectQuoteStyle", () => {
  it("detects single quotes", () => {
    const content = "import foo from 'foo';\nconst x = 'hello';\nconst y = 'world';\n";
    expect(detectQuoteStyle(content)).toBe("single");
  });

  it("detects double quotes", () => {
    const content = 'import foo from "foo";\nconst x = "hello";\nconst y = "world";\n';
    expect(detectQuoteStyle(content)).toBe("double");
  });

  it("returns unknown for no string literals", () => {
    expect(detectQuoteStyle("const x = 1;\nconst y = 2;\n")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// detectSemicolons
// ---------------------------------------------------------------------------

describe("detectSemicolons", () => {
  it("detects semicolons present", () => {
    const content = "const x = 1;\nconst y = 2;\nconst z = x + y;\n";
    expect(detectSemicolons(content)).toBe(true);
  });

  it("detects no semicolons", () => {
    const content = "const x = 1\nconst y = 2\nconst z = x + y\n";
    expect(detectSemicolons(content)).toBe(false);
  });

  it("returns null for empty content", () => {
    expect(detectSemicolons("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectImportStyle
// ---------------------------------------------------------------------------

describe("detectImportStyle", () => {
  it("detects ESM", () => {
    const content = "import { foo } from './foo.js'\nexport const bar = 1\n";
    expect(detectImportStyle(content)).toBe("esm");
  });

  it("detects CJS", () => {
    const content = "const foo = require('./foo')\nmodule.exports = { foo }\n";
    expect(detectImportStyle(content)).toBe("cjs");
  });

  it("detects mixed", () => {
    const content = "import { foo } from './foo.js'\nconst bar = require('./bar')\n";
    expect(detectImportStyle(content)).toBe("mixed");
  });

  it("returns unknown for no imports", () => {
    expect(detectImportStyle("const x = 1\n")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// detectErrorHandling
// ---------------------------------------------------------------------------

describe("detectErrorHandling", () => {
  it("detects try-catch pattern", () => {
    const content =
      "async function foo() {\n  try {\n    return await bar()\n  } catch (err) {\n    throw err\n  }\n}\n";
    expect(detectErrorHandling(content)).toBe("try-catch");
  });

  it("detects custom error class", () => {
    const content = "class AppError extends Error {\n  constructor(msg: string) { super(msg) }\n}\n";
    expect(detectErrorHandling(content)).toBe("error-class");
  });

  it("detects result type", () => {
    const content = "function parse(): Result<number, Error> {\n  return ok(42)\n}\n";
    expect(detectErrorHandling(content)).toBe("result-class");
  });

  it("returns unknown for no error handling", () => {
    expect(detectErrorHandling("const x = 1\n")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// detectTestPattern
// ---------------------------------------------------------------------------

describe("detectTestPattern", () => {
  it("detects describe/it pattern", () => {
    const content = "describe('foo', () => {\n  it('works', () => {})\n})\n";
    expect(detectTestPattern(content)).toBe("describe-it");
  });

  it("detects test() pattern", () => {
    const content = "test('foo works', () => {})\ntest('bar works', () => {})\n";
    expect(detectTestPattern(content)).toBe("test-fn");
  });

  it("detects mixed pattern", () => {
    const content = "describe('foo', () => {\n  it('works', () => {})\n})\ntest('bar', () => {})\n";
    expect(detectTestPattern(content)).toBe("mixed");
  });

  it("returns unknown for no test patterns", () => {
    expect(detectTestPattern("const x = 1\n")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// detectEntryPoint
// ---------------------------------------------------------------------------

describe("detectEntryPoint", () => {
  it("returns main from package.json", () => {
    const dir = tmpDir();
    write(dir, "package.json", JSON.stringify({ main: "dist/index.js" }));
    expect(detectEntryPoint(dir)).toBe("dist/index.js");
  });

  it("returns exports[.].import when present", () => {
    const dir = tmpDir();
    write(dir, "package.json", JSON.stringify({ exports: { ".": { import: "./dist/index.mjs" } } }));
    expect(detectEntryPoint(dir)).toBe("./dist/index.mjs");
  });

  it("falls back to src/index.ts when no package.json", () => {
    const dir = tmpDir();
    write(dir, "src/index.ts", "");
    expect(detectEntryPoint(dir)).toBe("src/index.ts");
  });

  it("returns null when nothing found", () => {
    const dir = tmpDir();
    expect(detectEntryPoint(dir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectTestDir
// ---------------------------------------------------------------------------

describe("detectTestDir", () => {
  it("detects __tests__ dir", () => {
    const dir = tmpDir();
    mkdir(dir, "__tests__");
    expect(detectTestDir(dir)).toBe("__tests__/");
  });

  it("detects test dir", () => {
    const dir = tmpDir();
    mkdir(dir, "test");
    expect(detectTestDir(dir)).toBe("test/");
  });

  it("detects src/__tests__ dir", () => {
    const dir = tmpDir();
    mkdir(dir, "src/__tests__");
    expect(detectTestDir(dir)).toBe("src/__tests__/");
  });

  it("returns null when no test dir found", () => {
    const dir = tmpDir();
    expect(detectTestDir(dir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// familiarize — integration with temp repo
// ---------------------------------------------------------------------------

describe("familiarize", () => {
  it("detects ESM style from source files", async () => {
    const dir = tmpDir();
    write(
      dir,
      "src/index.ts",
      ["import { foo } from './foo.js'", "export const bar = 'hello'", "export const baz = 'world'"].join("\n")
    );
    write(dir, "package.json", JSON.stringify({ main: "src/index.ts" }));
    const profile = makeProfile({ sourceRoots: ["src/"] });
    const ctx = await familiarize(dir, profile, undefined, { force: true });
    expect(ctx.importStyle).toBe("esm");
    expect(ctx.quoteStyle).toBe("single");
    expect(ctx.semicolons).toBe(false);
  });

  it("detects test patterns from test files", async () => {
    const dir = tmpDir();
    write(dir, "src/index.ts", "export const x = 1\n");
    write(
      dir,
      "__tests__/index.test.ts",
      [
        "import { describe, it, expect } from 'vitest'",
        "describe('x', () => {",
        "  it('is 1', () => { expect(1).toBe(1) })",
        "})",
      ].join("\n")
    );
    const profile = makeProfile();
    const ctx = await familiarize(dir, profile, undefined, { force: true });
    expect(ctx.testPattern).toBe("describe-it");
    expect(ctx.testDir).toBe("__tests__/");
  });

  it("stores testRunnerName from profile", async () => {
    const dir = tmpDir();
    write(dir, "src/index.ts", "export const x = 1\n");
    const profile = makeProfile({ testRunner: { name: "jest", command: "npx jest" } });
    const ctx = await familiarize(dir, profile, undefined, { force: true });
    expect(ctx.testRunnerName).toBe("jest");
  });

  it("caches result and returns cached on second call", async () => {
    const dir = tmpDir();
    write(dir, "src/index.ts", "import { a } from './a.js'\nexport const x = 1\n");
    const profile = makeProfile();
    const first = await familiarize(dir, profile, undefined, { force: true });
    // Modify the source file — cached result should be returned
    write(dir, "src/index.ts", "const x = require('./a')\nmodule.exports = { x }\n");
    const second = await familiarize(dir, profile, undefined);
    expect(second.importStyle).toBe(first.importStyle);
    expect(second.detectedAt).toBe(first.detectedAt);
  });

  it("cache hit: saves .ratchet/repo-context.json", async () => {
    const dir = tmpDir();
    write(dir, "src/index.ts", "export const x = 1\n");
    const profile = makeProfile();
    await familiarize(dir, profile, undefined, { force: true });
    const cacheFile = join(dir, ".ratchet/repo-context.json");
    const raw = JSON.parse(readFileSync(cacheFile, "utf-8")) as RepoContext;
    expect(raw.detectedAt).toBeTruthy();
    expect(raw.sourceDirs).toEqual(["src/"]);
  });

  it("force: true bypasses cache", async () => {
    const dir = tmpDir();
    write(dir, "src/index.ts", "import { a } from './a.js'\nexport const x = 1\n");
    const profile = makeProfile();
    await familiarize(dir, profile, undefined, { force: true });
    // Now swap to CJS
    write(dir, "src/index.ts", "const a = require('./a')\nmodule.exports = { a }\n");
    const forced = await familiarize(dir, profile, undefined, { force: true });
    expect(forced.importStyle).toBe("cjs");
  });

  it("gracefully handles missing files", async () => {
    const dir = tmpDir();
    // Completely empty repo — no src files, no tests
    const profile = makeProfile({ sourceRoots: [] });
    const ctx = await familiarize(dir, profile, undefined, { force: true });
    expect(ctx.importStyle).toBe("unknown");
    expect(ctx.hotFiles).toEqual([]);
    expect(ctx.entryPoint).toBeNull();
    expect(ctx.testDir).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildFamiliarizationContext
// ---------------------------------------------------------------------------

describe("buildFamiliarizationContext", () => {
  function makeContext(overrides: Partial<RepoContext> = {}): RepoContext {
    return {
      importStyle: "esm",
      indentation: "2-space",
      quoteStyle: "single",
      semicolons: false,
      errorHandling: "try-catch",
      testPattern: "describe-it",
      testDir: "__tests__/",
      testRunnerName: "vitest",
      sourceDirs: ["src/"],
      entryPoint: "src/index.ts",
      hotFiles: ["src/router.ts", "src/context.ts"],
      detectedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("starts with REPO CONTEXT header", () => {
    const out = buildFamiliarizationContext(makeContext());
    expect(out).toMatch(/^REPO CONTEXT \(auto-detected\):/);
  });

  it("includes style information", () => {
    const out = buildFamiliarizationContext(makeContext());
    expect(out).toContain("esm imports");
    expect(out).toContain("single quotes");
    expect(out).toContain("no semicolons");
    expect(out).toContain("2-space indent");
  });

  it("includes test runner and pattern", () => {
    const out = buildFamiliarizationContext(makeContext());
    expect(out).toContain("vitest");
    expect(out).toContain("describe/it pattern");
    expect(out).toContain("__tests__/");
  });

  it("includes error handling", () => {
    const out = buildFamiliarizationContext(makeContext());
    expect(out).toContain("try/catch pattern");
  });

  it("includes structure, entry point, hot files", () => {
    const out = buildFamiliarizationContext(makeContext());
    expect(out).toContain("src/");
    expect(out).toContain("src/index.ts");
    expect(out).toContain("src/router.ts");
  });

  it("omits unknown fields gracefully", () => {
    const out = buildFamiliarizationContext(
      makeContext({
        importStyle: "unknown",
        quoteStyle: "unknown",
        semicolons: null,
        indentation: "unknown",
        errorHandling: "unknown",
        testPattern: "unknown",
        testDir: null,
        testRunnerName: null,
        sourceDirs: [],
        entryPoint: null,
        hotFiles: [],
      })
    );
    // Should still have the header but no noise
    expect(out).toMatch(/^REPO CONTEXT \(auto-detected\):/);
    expect(out).not.toContain("unknown");
    expect(out).not.toContain("Style:");
    expect(out).not.toContain("Tests:");
    expect(out).not.toContain("Errors:");
  });

  it("stays under 600 chars for typical context", () => {
    const out = buildFamiliarizationContext(makeContext());
    expect(out.length).toBeLessThan(600);
  });
});
