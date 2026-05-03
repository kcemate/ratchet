import { describe, it, expect } from "vitest";
import { getLanguagePromptHints, getFixOverride, getTypeSafetyLabel } from "../core/language-hints.js";
import type { SupportedLanguage } from "../core/language-rules.js";

// ---------------------------------------------------------------------------
// getLanguagePromptHints
// ---------------------------------------------------------------------------

describe("getLanguagePromptHints", () => {
  const langs: SupportedLanguage[] = ["ts", "js", "python", "go", "rust", "java", "kotlin"];

  it("returns a non-empty string for every supported language", () => {
    for (const lang of langs) {
      const hints = getLanguagePromptHints(lang);
      expect(typeof hints).toBe("string");
      expect(hints.length).toBeGreaterThan(0);
    }
  });

  it("TS hints reference tsconfig and strict mode", () => {
    expect(getLanguagePromptHints("ts")).toMatch(/tsconfig/i);
    expect(getLanguagePromptHints("ts")).toMatch(/strict/i);
  });

  it("TS hints reference Jest or Vitest", () => {
    expect(getLanguagePromptHints("ts")).toMatch(/Jest|Vitest/);
  });

  it("Python hints reference mypy or pyright", () => {
    expect(getLanguagePromptHints("python")).toMatch(/mypy|pyright/i);
  });

  it("Python hints reference pytest", () => {
    expect(getLanguagePromptHints("python")).toMatch(/pytest/i);
  });

  it("Python hints do NOT reference tsconfig", () => {
    expect(getLanguagePromptHints("python")).not.toMatch(/tsconfig/i);
  });

  it("Go hints reference go vet", () => {
    expect(getLanguagePromptHints("go")).toMatch(/go vet/i);
  });

  it("Go hints reference error handling pattern", () => {
    expect(getLanguagePromptHints("go")).toMatch(/err != nil/);
  });

  it("Rust hints reference clippy", () => {
    expect(getLanguagePromptHints("rust")).toMatch(/clippy/i);
  });

  it("Rust hints reference Result<T, E>", () => {
    expect(getLanguagePromptHints("rust")).toMatch(/Result/);
  });

  it("Rust hints reference #[test]", () => {
    expect(getLanguagePromptHints("rust")).toMatch(/#\[test\]/);
  });

  it("Java hints reference SLF4J", () => {
    expect(getLanguagePromptHints("java")).toMatch(/SLF4J/i);
  });

  it("Java hints reference JUnit 5", () => {
    expect(getLanguagePromptHints("java")).toMatch(/JUnit/i);
  });

  it("Java hints reference Bean Validation", () => {
    expect(getLanguagePromptHints("java")).toMatch(/Bean Validation/i);
  });

  it("Kotlin hints reference coroutines", () => {
    expect(getLanguagePromptHints("kotlin")).toMatch(/coroutine/i);
  });

  it("Kotlin hints reference Kotest or JUnit 5", () => {
    expect(getLanguagePromptHints("kotlin")).toMatch(/Kotest|JUnit/i);
  });

  it("Kotlin hints reference sealed classes", () => {
    expect(getLanguagePromptHints("kotlin")).toMatch(/sealed class/i);
  });
});

// ---------------------------------------------------------------------------
// getFixOverride
// ---------------------------------------------------------------------------

describe("getFixOverride", () => {
  it("returns null for TS (use default explanations)", () => {
    expect(getFixOverride("Strict config", "ts")).toBeNull();
    expect(getFixOverride("Any type count", "ts")).toBeNull();
    expect(getFixOverride("Coverage", "ts")).toBeNull();
  });

  it("returns null for JS (use default explanations)", () => {
    expect(getFixOverride("Strict config", "js")).toBeNull();
  });

  it("returns Python-appropriate text for Strict config", () => {
    const fix = getFixOverride("Strict config", "python");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/mypy|pyright/i);
  });

  it("returns Python-appropriate text for Any type count", () => {
    const fix = getFixOverride("Any type count", "python");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/Any/);
  });

  it("returns Python-appropriate text for Empty catches", () => {
    const fix = getFixOverride("Empty catches", "python");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/except/i);
  });

  it("returns Go-appropriate text for Strict config", () => {
    const fix = getFixOverride("Strict config", "go");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/go vet/i);
  });

  it("returns Go-appropriate text for Coverage (error handling)", () => {
    const fix = getFixOverride("Coverage", "go");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/err != nil/);
  });

  it("returns Rust-appropriate text for Strict config", () => {
    const fix = getFixOverride("Strict config", "rust");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/clippy/i);
  });

  it("returns Rust-appropriate text for Coverage (error handling)", () => {
    const fix = getFixOverride("Coverage", "rust");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/Result/);
  });

  it("returns null for unknown subcategory names", () => {
    expect(getFixOverride("Unknown subcategory", "python")).toBeNull();
    expect(getFixOverride("Unknown subcategory", "go")).toBeNull();
    expect(getFixOverride("Unknown subcategory", "rust")).toBeNull();
  });

  it("returns Java-appropriate text for Strict config", () => {
    const fix = getFixOverride("Strict config", "java");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/maven-compiler-plugin|SpotBugs|Checkstyle/i);
  });

  it("returns Java-appropriate text for Empty catches", () => {
    const fix = getFixOverride("Empty catches", "java");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/catch/i);
  });

  it("returns Java-appropriate text for Structured logging", () => {
    const fix = getFixOverride("Structured logging", "java");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/SLF4J/i);
  });

  it("returns Kotlin-appropriate text for Strict config", () => {
    const fix = getFixOverride("Strict config", "kotlin");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/-Werror|allWarningsAsErrors/i);
  });

  it("returns Kotlin-appropriate text for Coverage (error handling)", () => {
    const fix = getFixOverride("Coverage", "kotlin");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/runCatching|try\/catch/i);
  });

  it("returns Kotlin-appropriate text for Structured logging", () => {
    const fix = getFixOverride("Structured logging", "kotlin");
    expect(fix).not.toBeNull();
    expect(fix).toMatch(/kotlin-logging|SLF4J/i);
  });
});

// ---------------------------------------------------------------------------
// getTypeSafetyLabel
// ---------------------------------------------------------------------------

describe("getTypeSafetyLabel", () => {
  it('returns "Type Safety" for TypeScript', () => {
    expect(getTypeSafetyLabel("ts")).toBe("Type Safety");
  });

  it('returns "Type Safety" for JavaScript', () => {
    expect(getTypeSafetyLabel("js")).toBe("Type Safety");
  });

  it('returns "Type Checking" for Python', () => {
    expect(getTypeSafetyLabel("python")).toBe("Type Checking");
  });

  it('returns "Type Checking" for Go', () => {
    expect(getTypeSafetyLabel("go")).toBe("Type Checking");
  });

  it('returns "Type Checking" for Rust', () => {
    expect(getTypeSafetyLabel("rust")).toBe("Type Checking");
  });

  it('returns "Type Checking" for Java', () => {
    expect(getTypeSafetyLabel("java")).toBe("Type Checking");
  });

  it('returns "Type Checking" for Kotlin', () => {
    expect(getTypeSafetyLabel("kotlin")).toBe("Type Checking");
  });
});
