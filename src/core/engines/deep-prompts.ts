/**
 * Deep Engine prompt templates — one per Ratchet category.
 *
 * Each builder returns a complete prompt string that includes:
 *   - The batch of source files to analyse
 *   - Semantic focus areas specific to that category
 *   - The exact JSON schema the LLM must return
 */

export interface FileContent {
  path: string;
  content: string;
}

/** All six Ratchet categories, in the order they should be analysed. */
export const CATEGORIES = [
  'Security',
  'Testing',
  'Type Safety',
  'Error Handling',
  'Performance',
  'Code Quality',
] as const;

export type Category = (typeof CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFiles(files: FileContent[]): string {
  return files
    .map(f => `=== ${f.path} ===\n${f.content}`)
    .join('\n\n');
}

const FINDING_SCHEMA = `[
  {
    "ruleId": "<rule id from list above>",
    "subcategory": "<subcategory name>",
    "severity": "critical" | "high" | "medium" | "low",
    "file": "relative/path/to/file.ts",
    "line": <line number, integer>,
    "message": "<concrete description of the specific issue>",
    "confidence": <0.0 to 1.0>,
    "suggestion": "<specific, actionable fix>"
  }
]`;

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export function buildSecurityPrompt(files: FileContent[]): string {
  return `You are a security-focused code reviewer performing semantic analysis. \
Analyse the source files below for REAL security vulnerabilities — issues that regex cannot catch \
because they require understanding data flow and intent.

FOCUS AREAS:
1. Data flow from untrusted sources (req.body, req.params, req.query, URL params, user input, \
file uploads) into sensitive sinks (database queries, file system writes, HTML rendering, \
shell command execution, deserialization)
2. Authentication / authorization bypass paths (missing auth checks, privilege escalation, \
insecure direct object references)
3. Race conditions in concurrent operations that could be exploited
4. Insecure cryptographic usage (weak algorithms like MD5/SHA1 for passwords, static IVs, \
predictable token generation, keys in source)
5. Information disclosure (stack traces in API responses, internal paths, verbose error messages, \
debug endpoints left in production)
6. Missing rate limiting or brute-force protection on sensitive endpoints (login, password reset, \
OTP verification)

DO NOT flag:
- Issues already caught by static analysis (missing imports, syntax errors, dead code)
- Theoretical vulnerabilities with no concrete attack path
- Best-practice suggestions that are not actual vulnerabilities
- Already-mitigated issues (where a fix is clearly present nearby)

RULE IDs AND SUBCATEGORIES:
- SEC-001: "Secrets & env vars" — hardcoded credentials, tokens, keys
- SEC-002: "Input validation" — unvalidated user input reaching sensitive sinks
- SEC-003: "Auth & rate limiting" — auth bypasses, missing rate limiting

Return ONLY a valid JSON array (no markdown prose, no explanations outside the JSON):
${FINDING_SCHEMA}

If no issues are found, return an empty array: []

SOURCE FILES:
${formatFiles(files)}`;
}

// ---------------------------------------------------------------------------
// Testing
// ---------------------------------------------------------------------------

export function buildTestingPrompt(files: FileContent[]): string {
  return `You are a test-quality expert performing semantic analysis. \
Analyse the source files below — focusing on TEST FILES — for quality issues that static analysis \
cannot detect.

FOCUS AREAS:
1. Tests that never actually fail: assertions that are always true, \
empty test bodies, tests that pass regardless of the code under test
2. Missing coverage for critical paths: authentication flows, payment logic, \
data-destructive operations, error branches that aren't tested
3. Assertion quality: tests with no assertions, assertions that only test \
that a function returns without checking its output, duplicate assertions
4. Test isolation problems: tests that depend on global state or execution order, \
shared mutable state between test cases
5. Misleading test names: tests named "should work" that test unrelated behaviour, \
or copy-pasted test names that don't describe what's actually tested

RULE IDs AND SUBCATEGORIES:
- TST-001: "Coverage ratio" — critical paths lacking any test coverage
- TST-002: "Edge case depth" — missing edge cases for error paths / boundary values
- TST-003: "Test quality" — empty assertions, tests that always pass, missing assertions

Return ONLY a valid JSON array:
${FINDING_SCHEMA}

If no issues are found, return an empty array: []

SOURCE FILES:
${formatFiles(files)}`;
}

// ---------------------------------------------------------------------------
// Type Safety
// ---------------------------------------------------------------------------

export function buildTypeSafetyPrompt(files: FileContent[]): string {
  return `You are a type-safety expert performing semantic analysis. \
Analyse the source files below for type-safety issues that go beyond what the compiler catches.

FOCUS AREAS:
1. Unsafe type assertions that circumvent the type system (\`as any\`, \`as unknown as X\`, \
non-null assertions on values that could legitimately be null)
2. \`any\` type propagation chains: a single \`any\` that widens to infect many downstream types
3. Runtime type mismatches: places where the declared type and actual runtime shape diverge \
(e.g. JSON.parse results used without validation, API responses cast without checking)
4. Generic abuse: overly permissive generic constraints (\`<T = any>\`) that provide false type safety
5. Missing discriminant checks: union types used without narrowing, leading to potential \
property-access errors at runtime

RULE IDs AND SUBCATEGORIES:
- TYP-001: "Strict config" — patterns that suggest loose type checking is being worked around
- TYP-002: "Any type count" — unsafe any usage, unchecked type assertions, any propagation

Return ONLY a valid JSON array:
${FINDING_SCHEMA}

If no issues are found, return an empty array: []

SOURCE FILES:
${formatFiles(files)}`;
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

export function buildErrorHandlingPrompt(files: FileContent[]): string {
  return `You are an error-handling expert performing semantic analysis. \
Analyse the source files below for error-handling issues that static analysis cannot detect.

FOCUS AREAS:
1. Swallowed errors on critical paths: catch blocks that log-and-continue for operations \
where failure should halt execution (payments, data writes, auth)
2. Missing error boundaries: async functions that can throw but have no upstream catch
3. Inconsistent error formats: some paths throw Error objects, others return null/undefined, \
others throw strings — making it impossible for callers to handle errors reliably
4. Overly broad catches: \`catch (e) {}\` or \`catch (e) { return null }\` hiding real failures
5. Unhandled promise rejection patterns: floating promises (no await, no .catch())
6. Error messages that leak implementation details to end users

RULE IDs AND SUBCATEGORIES:
- EH-001: "Coverage" — missing error handling on critical async paths
- EH-002: "Empty catches" — swallowed errors, overly broad catch blocks
- EH-003: "Structured logging" — raw console.error / print in production instead of structured logger

Return ONLY a valid JSON array:
${FINDING_SCHEMA}

If no issues are found, return an empty array: []

SOURCE FILES:
${formatFiles(files)}`;
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export function buildPerformancePrompt(files: FileContent[]): string {
  return `You are a performance expert performing semantic analysis. \
Analyse the source files below for performance issues that static analysis cannot detect.

FOCUS AREAS:
1. N+1 query patterns: loops that issue a database/API call per iteration when \
a single batched call would suffice
2. Unbounded async loops: \`for...of\` / \`while\` loops with \`await\` inside that \
run sequentially when Promise.all() would parallelize safely
3. Memory leaks: event listeners or timers registered inside components/handlers \
without cleanup, large objects held in module-level variables
4. Unnecessary recomputation: expensive operations (sorts, filters, regex compiles) \
repeated in hot paths instead of cached or memoized
5. Missing pagination / limits: database queries or API calls that fetch unbounded \
result sets

RULE IDs AND SUBCATEGORIES:
- PRF-001: "Async patterns" — await-in-loop, missed Promise.all opportunities
- PRF-002: "Console cleanup" — debug logging left in hot paths
- PRF-003: "Import hygiene" — large barrel imports, circular dependencies

Return ONLY a valid JSON array:
${FINDING_SCHEMA}

If no issues are found, return an empty array: []

SOURCE FILES:
${formatFiles(files)}`;
}

// ---------------------------------------------------------------------------
// Code Quality
// ---------------------------------------------------------------------------

export function buildCodeQualityPrompt(files: FileContent[]): string {
  return `You are a code-quality expert performing semantic analysis. \
Analyse the source files below for quality issues beyond what linters catch.

FOCUS AREAS:
1. Functions that do too many things: a function with multiple distinct responsibilities \
that should be split (not just long — semantically overloaded)
2. Misleading names: variables, functions, or classes whose name implies different \
behaviour from what they actually do
3. Copy-paste with subtle differences: near-identical code blocks where one has a \
slightly different condition or variable — indicating a copy-paste bug risk
4. Dead code paths: conditions that are always true/false given the surrounding context, \
unreachable branches
5. Abstraction leaks: internal implementation details exposed in public APIs, \
making callers depend on internals they shouldn't know about

RULE IDs AND SUBCATEGORIES:
- CQ-001: "Function length" — semantically overloaded functions (not just line count)
- CQ-002: "Line length" — expressions so complex they need decomposition
- CQ-003: "Dead code" — unreachable / always-true/false branches, dead code paths
- CQ-004: "Duplication" — copy-paste blocks with subtle dangerous differences

Return ONLY a valid JSON array:
${FINDING_SCHEMA}

If no issues are found, return an empty array: []

SOURCE FILES:
${formatFiles(files)}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Return the appropriate prompt builder for a given category. */
export function buildPromptForCategory(category: Category, files: FileContent[]): string {
  switch (category) {
    case 'Security':      return buildSecurityPrompt(files);
    case 'Testing':       return buildTestingPrompt(files);
    case 'Type Safety':   return buildTypeSafetyPrompt(files);
    case 'Error Handling':return buildErrorHandlingPrompt(files);
    case 'Performance':   return buildPerformancePrompt(files);
    case 'Code Quality':  return buildCodeQualityPrompt(files);
  }
}
