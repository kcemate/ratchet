/**
 * Shared language detection helper used by scan, torque, improve, quick-fix,
 * report, and graph commands. Inspects project root files to determine the
 * dominant programming language.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { SupportedLanguage } from "./language-rules.js";

/**
 * Returns true if any file with the given extension exists directly under dir.
 */
function hasFileWithExt(dir: string, ext: string): boolean {
  try {
    return readdirSync(dir).some(f => f.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Detects the primary programming language of the project at `cwd` by
 * checking for well-known config / manifest files.
 *
 * Returns 'ts' as the default when no recognisable marker is found.
 */
export function detectProjectLanguage(cwd: string): SupportedLanguage {
  if (existsSync(join(cwd, "tsconfig.json"))) return "ts";
  if (existsSync(join(cwd, "package.json"))) return "js";
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "setup.py"))) return "python";
  if (existsSync(join(cwd, "go.mod"))) return "go";
  if (existsSync(join(cwd, "Cargo.toml"))) return "rust";
  // Kotlin: build.gradle.kts is definitive; build.gradle with .kt files is also Kotlin
  if (existsSync(join(cwd, "build.gradle.kts"))) return "kotlin";
  if ((existsSync(join(cwd, "pom.xml")) || existsSync(join(cwd, "build.gradle"))) && hasFileWithExt(cwd, ".kt"))
    return "kotlin";
  if (existsSync(join(cwd, "pom.xml")) || existsSync(join(cwd, "build.gradle"))) return "java";
  if (hasFileWithExt(cwd, ".csproj") || hasFileWithExt(cwd, ".sln")) return "csharp";
  if (existsSync(join(cwd, "composer.json"))) return "php";
  return "ts";
}

/** Source file extensions per language, used for file discovery. */
export const LANG_SOURCE_EXTENSIONS: Record<SupportedLanguage, string[]> = {
  ts: [".ts", ".tsx"],
  js: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py"],
  go: [".go"],
  rust: [".rs"],
  java: [".java"],
  kotlin: [".kt", ".kts"],
  csharp: [".cs"],
  php: [".php"],
};

/** Human-readable label for each supported language. */
export const LANG_DISPLAY_NAMES: Record<SupportedLanguage, string> = {
  ts: "TypeScript",
  js: "JavaScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
  php: "PHP",
};
