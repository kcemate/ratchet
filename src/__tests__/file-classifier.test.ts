import { describe, it, expect } from "vitest";
import { classifyFile, classifyFiles, filterByClass } from "../core/file-classifier.js";

describe("classifyFile", () => {
  it("classifies production source files", () => {
    expect(classifyFile("src/index.ts")).toBe("production");
    expect(classifyFile("src/core/scanner.ts")).toBe("production");
    expect(classifyFile("src/commands/scan.ts")).toBe("production");
  });

  it("classifies test files", () => {
    expect(classifyFile("src/__tests__/foo.test.ts")).toBe("test");
    expect(classifyFile("src/core/bar.spec.ts")).toBe("test");
    expect(classifyFile("src/__tests__/baz.test.tsx")).toBe("test");
  });

  it("classifies documentation files", () => {
    expect(classifyFile("docs/guide.md")).toBe("documentation");
    expect(classifyFile("README.md")).toBe("documentation");
    expect(classifyFile("src/core/explanations.ts")).toBe("documentation");
    expect(classifyFile("examples/usage.ts")).toBe("documentation");
    expect(classifyFile("src/example.ts")).toBe("production"); // not *.example.ts
    expect(classifyFile("src/foo.example.ts")).toBe("documentation");
  });

  it("classifies config files", () => {
    expect(classifyFile("tsconfig.json")).toBe("config");
    expect(classifyFile("vitest.config.ts")).toBe("config");
    expect(classifyFile(".eslintrc")).toBe("config");
    expect(classifyFile("docker-compose.yml")).toBe("config");
  });
});

describe("filterByClass", () => {
  it("filters files by classification", () => {
    const files = ["src/index.ts", "src/__tests__/foo.test.ts", "docs/guide.md", "tsconfig.json"];
    const classifications = classifyFiles(files);

    const prod = filterByClass(files, classifications, "production");
    expect(prod).toEqual(["src/index.ts"]);

    const testFiles = filterByClass(files, classifications, "test");
    expect(testFiles).toEqual(["src/__tests__/foo.test.ts"]);

    const prodAndTest = filterByClass(files, classifications, "production", "test");
    expect(prodAndTest).toEqual(["src/index.ts", "src/__tests__/foo.test.ts"]);
  });
});
