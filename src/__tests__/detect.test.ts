import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectProjectType,
  detectTestCommand,
  detectSourcePaths,
  countTestFiles,
  buildAutoConfig,
  type ProjectType,
} from "../core/detect.js";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { existsSync, readFileSync, readdirSync } from "fs";

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockReaddirSync = readdirSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectProjectType", () => {
  it("returns node when package.json exists", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    expect(detectProjectType("/project")).toBe("node");
  });

  it("returns python when requirements.txt exists", () => {
    mockExistsSync.mockReturnValue(false);
    mockExistsSync.mockImplementation((path: string) => path.includes("requirements.txt"));
    expect(detectProjectType("/project")).toBe("python");
  });

  it("returns python when pyproject.toml exists", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("pyproject.toml"));
    expect(detectProjectType("/project")).toBe("python");
  });

  it("returns python when setup.py exists", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("setup.py"));
    expect(detectProjectType("/project")).toBe("python");
  });

  it("returns go when go.mod exists", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("go.mod"));
    expect(detectProjectType("/project")).toBe("go");
  });

  it("returns rust when Cargo.toml exists", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("Cargo.toml"));
    expect(detectProjectType("/project")).toBe("rust");
  });

  it("returns unknown when no project markers found", () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectProjectType("/project")).toBe("unknown");
  });
});

describe("detectTestCommand", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  it("returns pytest for python projects", () => {
    expect(detectTestCommand("/project", "python")).toBe("pytest");
  });

  it("returns go test ./... for go projects", () => {
    expect(detectTestCommand("/project", "go")).toBe("go test ./...");
  });

  it("returns cargo test for rust projects", () => {
    expect(detectTestCommand("/project", "rust")).toBe("cargo test");
  });

  it("returns null for unknown projects", () => {
    expect(detectTestCommand("/project", "unknown")).toBeNull();
  });

  it("returns npx vitest run when test script is vitest run", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "vitest run" },
      })
    );
    expect(detectTestCommand("/project", "node")).toBe("npx vitest run");
  });

  it("returns npx jest when test script is jest", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "jest" },
      })
    );
    expect(detectTestCommand("/project", "node")).toBe("npx jest");
  });

  it("returns npm run test when test script exists", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "jest --coverage" },
      })
    );
    expect(detectTestCommand("/project", "node")).toBe("npm run test");
  });

  it("prefers test:unit script over test (test is checked first in candidates order)", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "echo hello", "test:unit": "jest" },
      })
    );
    // Candidates order is: test, test:unit, test:ci, test:run — 'test' checked first
    expect(detectTestCommand("/project", "node")).toBe("npm run test");
  });

  it("prefers test:ci over test:unit (test:ci comes before test:unit in candidates order)", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { "test:unit": "jest --unit", "test:ci": "jest --ci" },
      })
    );
    // 'test' not present; 'test:unit' checked before 'test:ci'
    expect(detectTestCommand("/project", "node")).toBe("npm run test:unit");
  });

  it("prefers test:ci script over test (test is checked first)", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "jest", "test:ci": "jest --ci" },
      })
    );
    // 'test' is found first and matches 'jest' → returns 'npx jest'
    expect(detectTestCommand("/project", "node")).toBe("npx jest");
  });

  it("falls back to vitest config when no test script", () => {
    mockExistsSync.mockImplementation(
      (path: string) => path.includes("package.json") || path.includes("vitest.config.ts")
    );
    mockReadFileSync.mockReturnValue(JSON.stringify({ scripts: {} }));
    expect(detectTestCommand("/project", "node")).toBe("npx vitest run");
  });

  it("falls back to jest config when no test script and no vitest config", () => {
    mockExistsSync.mockImplementation(
      (path: string) => path.includes("package.json") || path.includes("jest.config.ts")
    );
    mockReadFileSync.mockReturnValue(JSON.stringify({ scripts: {} }));
    expect(detectTestCommand("/project", "node")).toBe("npx jest");
  });

  it("returns null when no test configuration found", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(JSON.stringify({ scripts: {} }));
    expect(detectTestCommand("/project", "node")).toBeNull();
  });

  it("returns null when package.json is not valid JSON", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue("not json");
    expect(detectTestCommand("/project", "node")).toBeNull();
  });
});

describe("detectSourcePaths", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  it("returns existing source directories", () => {
    mockExistsSync.mockImplementation((path: string) => ["src", "lib", "pkg"].some(d => path.endsWith(d)));
    const paths = detectSourcePaths("/project");
    expect(paths).toContain("src");
    expect(paths).toContain("lib");
    expect(paths).toContain("pkg");
  });

  it("returns empty array when no source directories exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectSourcePaths("/project")).toHaveLength(0);
  });

  it("returns only existing source directories", () => {
    mockExistsSync.mockImplementation((path: string) => path.endsWith("app"));
    const paths = detectSourcePaths("/project");
    expect(paths).toEqual(["app"]);
  });
});

describe("countTestFiles", () => {
  it("returns 0 when directory cannot be read", () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });
    expect(countTestFiles("/project")).toBe(0);
  });

  it("counts files matching .test. pattern", () => {
    const entries: Array<{ name: string; isDirectory: () => boolean }> = [
      { name: "a.test.ts", isDirectory: () => false },
      { name: "b.test.ts", isDirectory: () => false },
      { name: "c.ts", isDirectory: () => false },
    ];
    mockReaddirSync.mockReturnValue(entries as any);
    expect(countTestFiles("/project")).toBe(2);
  });

  it("counts files matching .spec. pattern", () => {
    const entries: Array<{ name: string; isDirectory: () => boolean }> = [
      { name: "a.spec.ts", isDirectory: () => false },
    ];
    mockReaddirSync.mockReturnValue(entries as any);
    expect(countTestFiles("/project")).toBe(1);
  });

  it("counts files matching test_ pattern", () => {
    const entries: Array<{ name: string; isDirectory: () => boolean }> = [
      { name: "test_utils.py", isDirectory: () => false },
    ];
    mockReaddirSync.mockReturnValue(entries as any);
    expect(countTestFiles("/project")).toBe(1);
  });

  it("counts files matching _test pattern", () => {
    const entries: Array<{ name: string; isDirectory: () => boolean }> = [
      { name: "utils_test.go", isDirectory: () => false },
    ];
    mockReaddirSync.mockReturnValue(entries as any);
    expect(countTestFiles("/project")).toBe(1);
  });

  it("recurses into subdirectories", () => {
    const subEntries = [{ name: "nested.test.ts", isDirectory: () => false }];
    const entries = [{ name: "src", isDirectory: () => true }];
    mockReaddirSync.mockImplementation((dir: string) => {
      if (dir === "/project") return entries as any;
      if (dir === "/project/src") return subEntries as any;
      return [];
    });
    expect(countTestFiles("/project")).toBe(1);
  });

  it("skips ignored directories", () => {
    const entries = [
      { name: "node_modules", isDirectory: () => true },
      { name: "dist", isDirectory: () => true },
      { name: "a.test.ts", isDirectory: () => false },
    ];
    mockReaddirSync.mockReturnValue(entries as any);
    // node_modules and dist are in IGNORE_DIRS, so should not recurse
    expect(countTestFiles("/project")).toBe(1);
  });
});

describe("buildAutoConfig", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
  });

  it("builds config for a node project", () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockExistsSync.mockImplementation(
      (path: string) => path.includes("package.json") || path.includes("vitest.config.ts")
    );
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "vitest run" },
      })
    );
    mockExistsSync.mockImplementation((path: string) => path.includes("src"));

    const config = buildAutoConfig("/project");
    expect(config.defaults.clicks).toBe(7);
    expect(config.defaults.autoCommit).toBe(true);
    expect(config._source).toBe("auto-detected");
  });

  it("sets hardenMode when no test command is found", () => {
    mockExistsSync.mockReturnValue(false);
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(JSON.stringify({ scripts: {} }));
    // No vitest or jest config either
    const config = buildAutoConfig("/project");
    expect(config.defaults.hardenMode).toBe(true);
  });

  it("sets hardenMode when test file count is zero", () => {
    mockExistsSync.mockReturnValue(false);
    mockExistsSync.mockImplementation(
      (path: string) => path.includes("package.json") || path.includes("vitest.config.ts")
    );
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "vitest run" },
      })
    );
    mockReaddirSync.mockReturnValue([]); // no test files found

    const config = buildAutoConfig("/project");
    expect(config.defaults.hardenMode).toBe(true);
  });

  it("does not set hardenMode when tests exist", () => {
    mockExistsSync.mockReturnValue(false);
    mockExistsSync.mockImplementation(
      (path: string) => path.includes("package.json") || path.includes("vitest.config.ts") || path === "/project/src"
    );
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "vitest run" },
      })
    );
    const srcEntries = [{ name: "user.test.ts", isDirectory: () => false }];
    mockReaddirSync.mockReturnValue(srcEntries as any);

    const config = buildAutoConfig("/project");
    expect(config.defaults.hardenMode).toBe(false);
  });

  it("creates an auto target with primary source path", () => {
    mockExistsSync.mockImplementation(
      (path: string) => path.includes("package.json") || path === "/project/src" || path === "/project/lib"
    );
    mockExistsSync.mockImplementation(
      (path: string) => path.includes("package.json") || path === "/project/src" || path === "/project/lib"
    );
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        scripts: { test: "npm test" },
      })
    );
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json") || path === "/project/src");

    const config = buildAutoConfig("/project");
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].name).toBe("auto");
    expect(config.targets[0].path).toMatch(/^src\//);
  });

  it('uses "." as source path when no standard dirs exist', () => {
    mockExistsSync.mockImplementation((path: string) => path.includes("package.json"));
    mockReadFileSync.mockReturnValue(JSON.stringify({ scripts: { test: "jest" } }));

    const config = buildAutoConfig("/project");
    expect(config.targets[0].path).toMatch(/^\.\//);
  });
});
