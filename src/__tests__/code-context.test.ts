import { describe, it, expect } from "vitest";
import { stripCommentsAndStrings } from "../core/code-context.js";

describe("stripCommentsAndStrings", () => {
  it("strips single-line comments", () => {
    const src = "// console.log(x)\nconst x = 1;";
    expect(stripCommentsAndStrings(src)).not.toMatch(/console\.log/);
    expect(stripCommentsAndStrings(src)).toMatch(/const x = 1/);
  });

  it("strips block comments", () => {
    const src = "/* console.log(x) */\nconst y = 2;";
    expect(stripCommentsAndStrings(src)).not.toMatch(/console\.log/);
    expect(stripCommentsAndStrings(src)).toMatch(/const y = 2/);
  });

  it("strips double-quoted string literals", () => {
    const src = 'const msg = "console.log(x)";';
    expect(stripCommentsAndStrings(src)).not.toMatch(/console\.log/);
  });

  it("strips single-quoted string literals", () => {
    const src = "const msg = 'console.log(x)';";
    expect(stripCommentsAndStrings(src)).not.toMatch(/console\.log/);
  });

  it("strips template literals", () => {
    const src = "const msg = `console.log(x)`;";
    expect(stripCommentsAndStrings(src)).not.toMatch(/console\.log/);
  });

  it("preserves real code", () => {
    const src = "console.log(x);";
    expect(stripCommentsAndStrings(src)).toMatch(/console\.log/);
  });

  it("handles escape sequences in double-quoted strings", () => {
    const src = 'const s = "she said \\"hello\\"";';
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).not.toMatch(/hello/);
    // The outer structure is preserved
    expect(stripped).toMatch(/const s =/);
  });

  it("handles escape sequences in single-quoted strings", () => {
    const src = "const s = 'it\\'s here';";
    expect(stripCommentsAndStrings(src)).not.toMatch(/it.*here/);
  });

  it("handles escape sequences in template literals", () => {
    const src = "const s = `escaped \\` backtick`;";
    expect(stripCommentsAndStrings(src)).not.toMatch(/escaped/);
  });

  it("handles mixed content — only real code matches", () => {
    const src = [
      '// console.log("debug")',
      'const x = "console.log(fake)";',
      "console.log(real);",
      "/* console.log(block) */",
    ].join("\n");
    const stripped = stripCommentsAndStrings(src);
    const matches = stripped.match(/console\.log/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("preserves newlines in multi-line block comments", () => {
    const src = "/*\nline1\nline2\n*/\ncode;";
    const stripped = stripCommentsAndStrings(src);
    const lines = stripped.split("\n");
    expect(lines.length).toBe(src.split("\n").length);
  });

  it("handles empty input", () => {
    expect(stripCommentsAndStrings("")).toBe("");
  });

  it("handles file with only comments", () => {
    const src = "// nothing\n/* also nothing */";
    const stripped = stripCommentsAndStrings(src);
    expect(stripped.trim()).toBe("");
  });
});
