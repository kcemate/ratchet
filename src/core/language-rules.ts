/**
 * Language-specific patterns and helpers for multi-language scanning.
 * Provides tailored patterns for Python, Go, and Rust alongside the existing
 * TypeScript/JavaScript rules. All TS/JS behavior is unchanged.
 */

export type SupportedLanguage = 'ts' | 'js' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'csharp' | 'php';

// ---------------------------------------------------------------------------
// Test file detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the file path is a test file for the given language,
 * catching cases that the generic TEST_PATTERNS in scan-constants.ts miss.
 * (Python: test_*.py at the filename start; Go/Rust: already caught by _test. pattern)
 */
export function isLangTestFile(filePath: string, lang: SupportedLanguage): boolean {
  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  if (lang === 'python') {
    return basename.startsWith('test_') && basename.endsWith('.py');
  }
  if (lang === 'java') {
    return (basename.endsWith('Test.java') || basename.endsWith('Tests.java') || basename.endsWith('IT.java'));
  }
  if (lang === 'kotlin') {
    return (basename.endsWith('Test.kt') || basename.endsWith('Tests.kt'));
  }
  if (lang === 'csharp') {
    return (basename.endsWith('Test.cs') || basename.endsWith('Tests.cs'));
  }
  if (lang === 'php') {
    return basename.endsWith('Test.php');
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test case counting
// ---------------------------------------------------------------------------

export const LANG_TEST_CASE_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\b(?:it|test)\s*[.(]/g,
  js: /\b(?:it|test)\s*[.(]/g,
  python: /\bdef\s+test_\w+\s*\(/g,
  go: /\bfunc\s+Test\w+\s*\(\s*t\s+\*testing\./g,
  rust: /#\[test\]/g,
  java: /@(?:Test|ParameterizedTest)\b/g,
  kotlin: /@Test\b|\bfun\s+test\w+\s*\(/g,
  csharp: /\[(?:Test|Fact|Theory|TestMethod)\]/g,
  php: /\bpublic\s+function\s+test\w+\s*\(|\/\*\*\s*@test\s*\*\/|->it\s*\(/g,
};

export const LANG_ASSERTION_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\b(?:expect|assert)\s*[.(]/g,
  js: /\b(?:expect|assert)\s*[.(]/g,
  python: /\b(?:assert\s|assertEqual|assertTrue|assertFalse|assertRaises|pytest\.raises)\s*[(\s]/g,
  go: /\b(?:t\.Error|t\.Fatal|t\.Fail|assert\.|require\.)\s*[(\w]/g,
  rust: /\b(?:assert!|assert_eq!|assert_ne!)\s*\(/g,
  java: /\b(?:assertEquals|assertTrue|assertFalse|assertThrows|assertThat|assertNotNull|assertNull)\s*\(/g,
  kotlin: /\b(?:assertEquals|assertTrue|assertFailsWith|shouldBe)\s*[(<\s]/g,
  csharp: /\b(?:Assert\.Equal|Assert\.True|Assert\.False|Assert\.Throws|Assert\.NotNull)\s*[(<]|\bShould\s*\(\s*\)/g,
  php: /\$this->assert\w+\s*\(|\bassertEquals\s*\(|expect\s*\(/g,
};

/** Pattern to detect test grouping/organization (describe blocks, test classes, etc.) */
export const LANG_DESCRIBE_PATTERNS: Record<SupportedLanguage, RegExp | null> = {
  ts: /\bdescribe\s*[.(]/g,
  js: /\bdescribe\s*[.(]/g,
  python: /\bclass\s+Test\w+/g,
  go: /\bt\.Run\s*\(/g,
  rust: /\bmod\s+tests\s*\{/g,
  java: /@Nested\b/g,
  kotlin: /@Nested\b|\bdescribe\s*\{/g,
  csharp: /\[(?:TestClass|Collection)\b/g,
  php: null,
};

/** Edge/error case test patterns — matched against test function names */
export const LANG_EDGE_CASE_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\b(?:it|test)\s*[.(]['"`][^'"`]*(?:error|invalid|edge|boundary|fail|reject|throw|null|undefined|empty|missing|exceed)[^'"`]*['"`]/gi,
  js: /\b(?:it|test)\s*[.(]['"`][^'"`]*(?:error|invalid|edge|boundary|fail|reject|throw|null|undefined|empty|missing|exceed)[^'"`]*['"`]/gi,
  python: /\bdef\s+test_(?:\w*_)?(?:error|invalid|edge|boundary|fail|none|empty|missing|exceed)\w*\s*\(/gi,
  go: /\bfunc\s+Test\w*(?:Error|Invalid|Edge|Boundary|Fail|Nil|Empty|Missing)\w*\s*\(/g,
  rust: /\bfn\s+test_(?:\w*_)?(?:error|invalid|edge|boundary|fail|none|empty|missing|panic)\w*\s*\(/gi,
  java: /\bvoid\s+\w*(?:error|invalid|edge|boundary|fail|null|empty|exception)\w*\s*\(/gi,
  kotlin: /\bfun\s+\w*(?:error|invalid|edge|boundary|fail|null|empty|exception)\w*\s*\(/gi,
  csharp: /\bvoid\s+\w*(?:error|invalid|edge|boundary|fail|null|empty|exception|throw)\w*\s*\(/gi,
  php: /\bpublic\s+function\s+test\w*(?:error|invalid|edge|boundary|fail|null|empty|exception)\w*\s*\(/gi,
};

// ---------------------------------------------------------------------------
// Console / debug output
// ---------------------------------------------------------------------------

export const LANG_DEBUG_OUTPUT_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\bconsole\.log\s*\(/g,
  js: /\bconsole\.log\s*\(/g,
  python: /\bprint\s*\(/g,
  go: /\bfmt\.(?:Print|Println|Printf)\s*\(/g,
  rust: /\b(?:println!|print!|eprintln!|eprint!)\s*\(/g,
  java: /\bSystem\.(?:out|err)\.println?\s*\(/g,
  kotlin: /\b(?:println|print)\s*\(/g,
  csharp: /\bConsole\.(?:Write|WriteLine)\s*\(|\bDebug\.WriteLine\s*\(/g,
  php: /\bvar_dump\s*\(|\bprint_r\s*\(|\bdd\s*\(/g,
};

/**
 * If any file in the project imports a proper logging library, debug output
 * calls are not penalised (the project has opted into structured logging).
 */
export const LANG_LOGGING_GUARD_PATTERNS: Record<SupportedLanguage, RegExp | null> = {
  ts: null, // TS/JS handled separately via structuredLogCount
  js: null,
  python: /\bimport\s+logging\b|\bfrom\s+(?:logging|loguru)\s+import\b/,
  go: /\b(?:logrus|zap|zerolog)\./,
  rust: /\b(?:tracing::|log::|#\[instrument\])/,
  java: /\bimport\s+(?:org\.slf4j|java\.util\.logging|org\.apache\.logging)\b/,
  kotlin: /\bimport\s+(?:io\.github\.microutils\.logging|org\.slf4j)\b/,
  csharp: /\busing\s+(?:Microsoft\.Extensions\.Logging|Serilog|NLog)\b/,
  php: /\buse\s+(?:Monolog|Psr\\Log)\\/,
};

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export const LANG_TRY_CATCH_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\btry\s*\{/g,
  js: /\btry\s*\{/g,
  python: /\btry\s*:/g,
  go: /\bif\s+err\s*!=\s*nil\s*\{/g,
  rust: /\bResult\s*<[^>]+>/g, // Result<T, E> declarations
  java: /\btry\s*\{/g,
  kotlin: /\btry\s*\{/g,
  csharp: /\btry\s*\{/g,
  php: /\btry\s*\{/g,
};

/** Patterns for "silent failure" — empty catches, ignored errors, panic-on-error */
export const LANG_EMPTY_CATCH_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
  js: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
  python: /\bexcept\s*:/g, // bare except (no exception type) = swallowed error
  go: /\b_\s*(?:,\s*_)?\s*=\s*\w+\s*\(/g, // _ = func() ignores error return
  rust: /\.unwrap\s*\(\s*\)|\.expect\s*\(/g, // panics on error
  java: /\bcatch\s*\([^)]*\)\s*\{\s*\}/g,
  kotlin: /\bcatch\s*\([^)]*\)\s*\{\s*\}/g,
  csharp: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
  php: /\bcatch\s*\([^)]*\)\s*\{\s*\}/g,
};

export const LANG_ASYNC_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\basync\s+function\b|\basync\s*\(/g,
  js: /\basync\s+function\b|\basync\s*\(/g,
  python: /\basync\s+def\s+\w+/g,
  go: /\bgo\s+\w+\s*\(/g, // goroutine launches (async-like)
  rust: /\basync\s+fn\s+\w+/g,
  java: /\bCompletableFuture\b|@Async\b|\bExecutorService\b/g,
  kotlin: /\bsuspend\s+fun\b|\blaunch\s*\{|\basync\s*\{|\brunBlocking\b|\bwithContext\b/g,
  csharp: /\basync\s+Task\b|\basync\s+ValueTask\b/g,
  php: /\byield\b|\bReact\\|Amp\\/g,
};

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

export const LANG_STRUCTURED_LOG_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\b(?:logger|winston|pino|bunyan|log4js)\./g,
  js: /\b(?:logger|winston|pino|bunyan|log4js)\./g,
  python: /\b(?:logger\.|logging\.(?:info|warning|error|debug|critical))\s*\(/g,
  go: /\b(?:log\.|logrus\.|zap\.|zerolog\.)\w+\s*\(/g,
  rust: /\b(?:tracing::|log::|info!|warn!|error!|debug!|trace!)\s*[({]/g,
  java: /\b(?:logger|log)\.(?:info|error|warn|debug)\s*\(/g,
  kotlin: /\b(?:logger|log)\.(?:info|error|warn|debug)\s*\(/g,
  csharp: /\b_logger\.Log\w*\s*\(|Log\.(?:Information|Warning|Error|Debug)\s*\(/g,
  php: /\$this->logger->\w+\s*\(|Log::(?:info|warning|error|debug)\s*\(/g,
};

export const LANG_CONSOLE_ERROR_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\bconsole\.(?:error|warn|log)\s*\(/g,
  js: /\bconsole\.(?:error|warn|log)\s*\(/g,
  python: /\bprint\s*\(/g,
  go: /\bfmt\.(?:Print|Println|Printf|Fprintf|Fprintln)\s*\(/g,
  rust: /\b(?:println!|print!|eprintln!|eprint!)\s*\(/g,
  java: /\bSystem\.(?:out|err)\.print(?:ln)?\s*\(|\.printStackTrace\s*\(\s*\)/g,
  kotlin: /\b(?:println|print)\s*\(/g,
  csharp: /\bConsole\.(?:Write|WriteLine)\s*\(|\bDebug\.WriteLine\s*\(/g,
  php: /\bvar_dump\s*\(|\bprint_r\s*\(|\bdd\s*\(|\becho\s+/g,
};

// ---------------------------------------------------------------------------
// Environment variable access (for secrets scoring)
// ---------------------------------------------------------------------------

export const LANG_ENV_VAR_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\bprocess\.env\b/g,
  js: /\bprocess\.env\b/g,
  python: /\bos\.(?:environ\.get|getenv)\s*\(/g,
  go: /\bos\.Getenv\s*\(/g,
  rust: /\b(?:std::env::var|env::var)\s*\(/g,
  java: /\bSystem\.getenv\s*\(/g,
  kotlin: /\bSystem\.getenv\s*\(/g,
  csharp: /\bEnvironment\.GetEnvironmentVariable\s*\(/g,
  php: /\bgetenv\s*\(|\$_ENV\[|env\s*\(/g,
};

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export const LANG_VALIDATION_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /\b(?:zod|joi|yup|valibot)\b|z\.object\s*\(|Joi\.object\s*\(|z\.string\s*\(|z\.number\s*\(/i,
  js: /\b(?:zod|joi|yup|valibot)\b|z\.object\s*\(|Joi\.object\s*\(|z\.string\s*\(|z\.number\s*\(/i,
  python: /\b(?:BaseModel|pydantic|marshmallow|cerberus|wtforms|django\.forms|validator\s*=)\b/i,
  go: /(?:`validate:|validate\.Struct\s*\(|binding\.Required)/i,
  rust: /\b(?:serde\s*::|#\[validate|validator::Validate|#\[serde\s*\()\b/i,
  java: /@(?:Valid|NotNull|NotBlank|Size|Pattern|Min|Max|Email)\b/g,
  kotlin: /@(?:Valid|NotNull|NotBlank|Size|Pattern)\b|\brequire\s*\(|\bcheck\s*\(/g,
  csharp: /\[(?:Required|StringLength|Range|RegularExpression|EmailAddress)\b|RuleFor\s*\(/g,
  php: /\$request->validate\s*\(|Validator::make\s*\(|Assert\\/g,
};

export const LANG_ROUTE_PATTERNS: Record<SupportedLanguage, RegExp> = {
  ts: /(?:router\.|app\.(?:get|post|put|patch|delete)|@(?:Get|Post|Put|Patch|Delete))/i,
  js: /(?:router\.|app\.(?:get|post|put|patch|delete)|@(?:Get|Post|Put|Patch|Delete))/i,
  python: /(?:@(?:app|router|blueprint)\.(?:route|get|post|put|patch|delete)\s*\()/i,
  go: /(?:\.(?:GET|POST|PUT|PATCH|DELETE)\s*\(|Handle(?:Func)?\s*\()/i,
  rust: /(?:#\[(?:get|post|put|patch|delete)\s*\(|\.route\s*\(|web::(?:get|post|put|delete)\s*\()/i,
  java: /@(?:GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping|GET|POST|PUT|DELETE)\b/g,
  kotlin: /@(?:GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\b|\b(?:get|post|put|delete|route)\s*\(/g,
  csharp: /\[(?:HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\]|Map(?:Get|Post|Put|Delete)\s*\(/g,
  php: /Route::(?:get|post|put|delete|patch)\s*\(|#\[Route\s*\(/g,
};
