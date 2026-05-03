/**
 * Language-aware improvement hints used by torque, improve, quick-fix, and
 * report commands. Provides language-appropriate fix suggestions so AI agent
 * prompts and CLI output reference the right tools and patterns for each
 * supported language.
 */

import type { SupportedLanguage } from "./language-rules.js";

// ---------------------------------------------------------------------------
// Prompt hints — injected into AI agent prompts
// ---------------------------------------------------------------------------

const PROMPT_HINTS: Record<SupportedLanguage, string> = {
  ts: [
    "Enable strict mode in tsconfig.json (compilerOptions.strict: true).",
    "Replace `any` types with specific types or `unknown` with type guards.",
    "Wrap async route handlers in try/catch blocks.",
    "Use Jest or Vitest test patterns (describe/it/expect).",
    "Use a structured logger (pino, winston) instead of console.log.",
  ].join(" "),

  js: [
    "Add JSDoc type annotations to exported functions.",
    "Wrap async route handlers in try/catch blocks.",
    "Use Jest or Vitest test patterns (describe/it/expect).",
    "Use a structured logger (pino, winston) instead of console.log.",
    "Consider migrating to TypeScript for type safety.",
  ].join(" "),

  python: [
    "Configure mypy or pyright for static type checking (pyproject.toml or mypy.ini).",
    "Add type hints to all function signatures (PEP 484).",
    "Replace bare `except:` with specific exception types (e.g. `except ValueError:`).",
    "Write pytest test functions named test_* with assert statements.",
    "Use the logging module or loguru instead of print() for structured output.",
  ].join(" "),

  go: [
    "Run `go vet` and staticcheck as part of CI for static analysis.",
    "Always check error returns: `if err != nil { ... }` — never assign to `_`.",
    "Replace interface{} / any with specific types or generics (Go 1.18+).",
    "Write table-driven tests with testing.T and t.Run subtests.",
    "Use logrus, zap, or zerolog for structured logging instead of fmt.Print.",
  ].join(" "),

  rust: [
    "Run `cargo clippy -- -D warnings` and address all warnings.",
    "Use Result<T, E> with the ? operator instead of .unwrap() or .expect().",
    "Write unit tests with #[test] attributes inside a mod tests { } block.",
    "Use the tracing or log crate for structured logging instead of println!.",
    "Enable deny(unused_imports) and deny(dead_code) at the crate level.",
  ].join(" "),

  java: [
    "Use SLF4J for logging instead of System.out.println or java.util.logging.",
    "Write JUnit 5 tests with @Test annotations and assertEquals/assertThrows assertions.",
    "Use Bean Validation annotations (@NotNull, @NotBlank, @Valid) for input validation.",
    "Handle checked exceptions properly — do not swallow them in empty catch blocks.",
    "Avoid raw types; use generics and let the compiler enforce type safety.",
  ].join(" "),

  kotlin: [
    "Use coroutines (suspend fun, launch, async) for async code instead of CompletableFuture.",
    "Write Kotest or JUnit 5 tests; use shouldBe and assertFailsWith for assertions.",
    "Use sealed classes for error handling instead of throwing exceptions.",
    "Avoid nullable types without safe calls (?.) or the Elvis operator (?:).",
    "Use SLF4J or kotlin-logging for structured logging instead of println.",
  ].join(" "),

  csharp: [
    "Enable nullable reference types: add <Nullable>enable</Nullable> to your .csproj.",
    "Write xUnit or NUnit tests with [Fact]/[Test] attributes and Assert.Equal/Should() assertions.",
    "Use Microsoft.Extensions.Logging or Serilog for structured logging instead of Console.WriteLine.",
    "Handle exceptions explicitly — never swallow them in empty catch blocks.",
    "Use async Task / async ValueTask for async methods and await all async calls.",
  ].join(" "),

  php: [
    "Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static type analysis.",
    "Add strict_types=1 and full type hints to all function signatures.",
    "Write PHPUnit tests named test* with $this->assert*() or Pest expect() assertions.",
    "Use Monolog or PSR-3 (Psr\\Log) for structured logging instead of var_dump/print_r.",
    "Validate all input with $request->validate() (Laravel) or Symfony Assert constraints.",
  ].join(" "),
};

/**
 * Returns a concise string of language-appropriate improvement hints.
 * Inject into AI agent prompts so suggestions match the project's language.
 */
export function getLanguagePromptHints(lang: SupportedLanguage): string {
  return PROMPT_HINTS[lang];
}

// ---------------------------------------------------------------------------
// Fix overrides — language-appropriate replacements for TS-centric explanations
// ---------------------------------------------------------------------------

/** Maps subcategory name → language-appropriate fix text. */
const FIX_OVERRIDES: Record<SupportedLanguage, Record<string, string>> = {
  ts: {},
  js: {},

  python: {
    "Strict config":
      "Configure mypy or pyright for static type checking. Add [tool.mypy] to pyproject.toml or" +
      " create a mypy.ini file.",
    "Any type count": "Replace `Any` type hints with specific types. Use Optional[T] or Union[A, B] instead of Any.",
    Coverage: "Wrap async functions with try/except blocks. Catch specific exceptions instead of bare `except:`.",
    "Empty catches": "Replace bare `except:` with specific exception types. Log or re-raise caught exceptions.",
    "Structured logging": "Use the logging module or loguru instead of print(). Configure log levels and handlers.",
    "Async patterns": "Use async/await with asyncio. Handle exceptions in async functions with try/except.",
    "Console cleanup": "Remove print() debug calls or replace with logging.debug() / logging.info().",
  },

  go: {
    "Strict config": "Run `go vet` and staticcheck in CI. Add a .golangci.yml for linting configuration.",
    "Any type count":
      "Replace interface{} and any with specific types. Use generics (Go 1.18+) for" + " type-safe abstractions.",
    Coverage: "Check all error returns with `if err != nil { ... }`. Never silently discard errors.",
    "Empty catches": "Replace `_ = someFunc()` with proper error handling: `if err := someFunc(); err != nil { ... }`.",
    "Structured logging": "Use logrus, zap, or zerolog for structured logging instead of fmt.Print statements.",
    "Async patterns": "Handle goroutine errors with channels or errgroup.Group. Always propagate or log errors.",
    "Console cleanup": "Remove fmt.Print/Println debug calls or replace with your structured logger.",
  },

  rust: {
    "Strict config": "Run `cargo clippy -- -D warnings` and enable `#![deny(unused_imports, dead_code)]`.",
    "Any type count":
      "Use concrete types instead of Box<dyn Trait> where possible." + " Apply generics for zero-cost abstractions.",
    Coverage: "Return Result<T, E> and propagate errors with the ? operator instead of .unwrap() or .expect().",
    "Empty catches":
      "Replace .unwrap() / .expect() with proper error handling:" + " `match result { Ok(v) => v, Err(e) => ... }`.",
    "Structured logging": "Use the tracing or log crate for structured logging instead of println! macros.",
    "Async patterns": "Use async/await with tokio or async-std. Return Result<T, E> from async functions.",
    "Console cleanup": "Remove println! / eprintln! debug calls or replace with tracing::debug! / log::debug!.",
  },

  java: {
    "Strict config":
      "Configure maven-compiler-plugin with source/target versions. Enable -Xlint:all and" +
      " use a static analysis tool like SpotBugs or Checkstyle.",
    "Any type count":
      "Replace raw types (List, Map) with generic equivalents (List<String>, Map<String, Object>)." +
      " Avoid Object parameters.",
    Coverage: "Wrap code in try/catch blocks. Never catch and silently discard exceptions.",
    "Empty catches": 'Replace empty catch blocks with logging or rethrowing. At minimum: log.error("message", e).',
    "Structured logging": "Use SLF4J with Logback or Log4j2 for structured logging instead of System.out.println.",
    "Async patterns":
      "Use CompletableFuture.exceptionally() or handle() to handle async errors." + " Avoid fire-and-forget.",
    "Console cleanup":
      "Remove System.out.println / e.printStackTrace() debug calls and replace with SLF4J logger" + " calls.",
  },

  kotlin: {
    "Strict config":
      "Enable strict Kotlin compiler options." + " Add -Werror to treat warnings as errors in build.gradle.kts.",
    "Any type count":
      "Replace Any? with specific nullable types." + " Use sealed classes or Result<T> for typed error handling.",
    Coverage: "Wrap code in try/catch blocks. Use runCatching { } for concise exception handling.",
    "Empty catches":
      "Replace empty catch blocks with logging or rethrowing:" + ' catch (e: Exception) { log.error("msg", e) }.',
    "Structured logging":
      "Use kotlin-logging (KotlinLogging.logger { }) or SLF4J for structured logging instead of" + " println.",
    "Async patterns":
      "Handle coroutine exceptions with CoroutineExceptionHandler or supervisorScope." +
      " Return Result<T> from suspend funs.",
    "Console cleanup": "Remove println() debug calls and replace with logger.debug() or logger.info().",
  },

  csharp: {
    "Strict config": "Enable nullable reference types: add <Nullable>enable</Nullable> to your .csproj file.",
    "Any type count": "Replace object/dynamic types with specific types. Use generics for type-safe abstractions.",
    Coverage: "Wrap async methods in try/catch blocks. Handle exceptions from async Task methods explicitly.",
    "Empty catches":
      "Replace empty catch blocks with logging or rethrowing:" +
      ' catch (Exception ex) { _logger.LogError(ex, "msg"); throw; }',
    "Structured logging":
      "Use Microsoft.Extensions.Logging or Serilog for structured logging" + " instead of Console.WriteLine.",
    "Async patterns":
      "Use async Task / async ValueTask and await all async calls." + " Avoid .Result or .Wait() which can deadlock.",
    "Console cleanup":
      "Remove Console.WriteLine / Debug.WriteLine debug calls" + " and replace with _logger.LogDebug() calls.",
  },

  php: {
    "Strict config":
      "Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis." + " Add declare(strict_types=1).",
    "Any type count":
      "Add full type hints (parameter types, return types) to all functions." +
      " Use union types (PHP 8.0+) where needed.",
    Coverage: "Wrap code in try/catch blocks. Catch specific exception types instead of the base Exception class.",
    "Empty catches":
      "Replace empty catch blocks with logging or rethrowing:" +
      " catch (Exception $e) { Log::error($e->getMessage()); throw $e; }",
    "Structured logging":
      "Use Monolog or PSR-3 Logger interface for structured logging" + " instead of var_dump/print_r/dd.",
    "Async patterns":
      "Handle exceptions in async/reactive code (ReactPHP, Amphp)." + " Use proper promise rejection handlers.",
    "Console cleanup":
      "Remove var_dump(), print_r(), and dd() debug calls." + " Use Log::debug() or logger()->debug() instead.",
  },
};

/**
 * Returns a language-appropriate fix string for a subcategory, or `null` if
 * the default (TS-centric) explanation is fine.
 *
 * Use this in quick-fix and other display contexts to replace TS-specific
 * instructions when the project uses a different language.
 */
export function getFixOverride(subcategoryName: string, lang: SupportedLanguage): string | null {
  return FIX_OVERRIDES[lang][subcategoryName] ?? null;
}

// ---------------------------------------------------------------------------
// Category label adaptation
// ---------------------------------------------------------------------------

/**
 * Returns the display label for the "Type Safety" category adapted to the
 * project language. TypeScript uses "Type Safety"; other languages use the
 * more generic "Type Checking".
 */
export function getTypeSafetyLabel(lang: SupportedLanguage): string {
  if (lang === "ts" || lang === "js") return "Type Safety";
  if (lang === "csharp") return "Type Safety";
  return "Type Checking"; // java, kotlin, python, go, rust, php
}
