import { describe, it, expect } from "vitest";
import { detectProjectLanguage, LANG_SOURCE_EXTENSIONS, LANG_DISPLAY_NAMES } from "../core/detect-language.js";
import type { SupportedLanguage } from "../core/language-rules.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTmpDir(marker: string, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
  try {
    writeFileSync(join(dir, marker), "");
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withEmptyDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// detectProjectLanguage
// ---------------------------------------------------------------------------

describe("detectProjectLanguage", () => {
  it("returns ts when tsconfig.json exists", () => {
    withTmpDir("tsconfig.json", dir => {
      expect(detectProjectLanguage(dir)).toBe("ts");
    });
  });

  it("returns js when only package.json exists (no tsconfig)", () => {
    withTmpDir("package.json", dir => {
      expect(detectProjectLanguage(dir)).toBe("js");
    });
  });

  it("returns python when pyproject.toml exists", () => {
    withTmpDir("pyproject.toml", dir => {
      expect(detectProjectLanguage(dir)).toBe("python");
    });
  });

  it("returns python when setup.py exists", () => {
    withTmpDir("setup.py", dir => {
      expect(detectProjectLanguage(dir)).toBe("python");
    });
  });

  it("returns go when go.mod exists", () => {
    withTmpDir("go.mod", dir => {
      expect(detectProjectLanguage(dir)).toBe("go");
    });
  });

  it("returns rust when Cargo.toml exists", () => {
    withTmpDir("Cargo.toml", dir => {
      expect(detectProjectLanguage(dir)).toBe("rust");
    });
  });

  it("defaults to ts when no recognised marker file exists", () => {
    withEmptyDir(dir => {
      expect(detectProjectLanguage(dir)).toBe("ts");
    });
  });

  it("prefers ts over js when both tsconfig.json and package.json exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
    try {
      writeFileSync(join(dir, "tsconfig.json"), "{}");
      writeFileSync(join(dir, "package.json"), "{}");
      expect(detectProjectLanguage(dir)).toBe("ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns ts for the ratchet project itself (which has tsconfig.json)", () => {
    // Smoke-test against the real project root
    expect(detectProjectLanguage(process.cwd())).toBe("ts");
  });
});

// ---------------------------------------------------------------------------
// LANG_SOURCE_EXTENSIONS
// ---------------------------------------------------------------------------

describe("LANG_SOURCE_EXTENSIONS", () => {
  const langs: SupportedLanguage[] = ["ts", "js", "python", "go", "rust", "java", "kotlin"];

  it("has an entry for every supported language", () => {
    for (const lang of langs) {
      expect(Array.isArray(LANG_SOURCE_EXTENSIONS[lang])).toBe(true);
      expect(LANG_SOURCE_EXTENSIONS[lang].length).toBeGreaterThan(0);
    }
  });

  it("ts extensions include .ts and .tsx", () => {
    expect(LANG_SOURCE_EXTENSIONS.ts).toContain(".ts");
    expect(LANG_SOURCE_EXTENSIONS.ts).toContain(".tsx");
  });

  it("python extensions only contain .py", () => {
    expect(LANG_SOURCE_EXTENSIONS.python).toEqual([".py"]);
  });

  it("go extensions only contain .go", () => {
    expect(LANG_SOURCE_EXTENSIONS.go).toEqual([".go"]);
  });

  it("rust extensions only contain .rs", () => {
    expect(LANG_SOURCE_EXTENSIONS.rust).toEqual([".rs"]);
  });

  it("all extensions start with a dot", () => {
    for (const lang of langs) {
      for (const ext of LANG_SOURCE_EXTENSIONS[lang]) {
        expect(ext.startsWith(".")).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// LANG_DISPLAY_NAMES
// ---------------------------------------------------------------------------

describe("LANG_DISPLAY_NAMES", () => {
  it("has a human-readable name for every supported language", () => {
    const langs: SupportedLanguage[] = ["ts", "js", "python", "go", "rust", "java", "kotlin"];
    for (const lang of langs) {
      expect(typeof LANG_DISPLAY_NAMES[lang]).toBe("string");
      expect(LANG_DISPLAY_NAMES[lang].length).toBeGreaterThan(0);
    }
  });

  it("labels TypeScript correctly", () => {
    expect(LANG_DISPLAY_NAMES.ts).toBe("TypeScript");
  });

  it("labels Python correctly", () => {
    expect(LANG_DISPLAY_NAMES.python).toBe("Python");
  });

  it("labels Go correctly", () => {
    expect(LANG_DISPLAY_NAMES.go).toBe("Go");
  });

  it("labels Rust correctly", () => {
    expect(LANG_DISPLAY_NAMES.rust).toBe("Rust");
  });

  it("labels Java correctly", () => {
    expect(LANG_DISPLAY_NAMES.java).toBe("Java");
  });

  it("labels Kotlin correctly", () => {
    expect(LANG_DISPLAY_NAMES.kotlin).toBe("Kotlin");
  });
});

// ---------------------------------------------------------------------------
// Java and Kotlin detection
// ---------------------------------------------------------------------------

describe("detectProjectLanguage — Java and Kotlin", () => {
  it("returns java when pom.xml exists (no .kt files)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
    try {
      writeFileSync(join(dir, "pom.xml"), "<project/>");
      expect(detectProjectLanguage(dir)).toBe("java");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns java when build.gradle exists (no .kt files)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
    try {
      writeFileSync(join(dir, "build.gradle"), "");
      expect(detectProjectLanguage(dir)).toBe("java");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns kotlin when build.gradle.kts exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
    try {
      writeFileSync(join(dir, "build.gradle.kts"), "");
      expect(detectProjectLanguage(dir)).toBe("kotlin");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns kotlin when pom.xml exists with a .kt file present", () => {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
    try {
      writeFileSync(join(dir, "pom.xml"), "<project/>");
      writeFileSync(join(dir, "Main.kt"), "");
      expect(detectProjectLanguage(dir)).toBe("kotlin");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("LANG_SOURCE_EXTENSIONS — Java and Kotlin", () => {
  it("java extensions only contain .java", () => {
    expect(LANG_SOURCE_EXTENSIONS.java).toEqual([".java"]);
  });

  it("kotlin extensions contain .kt and .kts", () => {
    expect(LANG_SOURCE_EXTENSIONS.kotlin).toContain(".kt");
    expect(LANG_SOURCE_EXTENSIONS.kotlin).toContain(".kts");
  });
});
