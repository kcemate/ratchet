import { describe, it, expect } from "vitest";
import {
  isLangTestFile,
  LANG_TEST_CASE_PATTERNS,
  LANG_ASSERTION_PATTERNS,
  LANG_DESCRIBE_PATTERNS,
  LANG_EDGE_CASE_PATTERNS,
  LANG_DEBUG_OUTPUT_PATTERNS,
  LANG_LOGGING_GUARD_PATTERNS,
  LANG_TRY_CATCH_PATTERNS,
  LANG_EMPTY_CATCH_PATTERNS,
  LANG_ASYNC_PATTERNS,
  LANG_STRUCTURED_LOG_PATTERNS,
  LANG_CONSOLE_ERROR_PATTERNS,
  LANG_ENV_VAR_PATTERNS,
  LANG_VALIDATION_PATTERNS,
  LANG_ROUTE_PATTERNS,
  type SupportedLanguage,
} from "../core/language-rules.js";

// ---------------------------------------------------------------------------
// isLangTestFile
// ---------------------------------------------------------------------------

describe("isLangTestFile", () => {
  it("detects Python test files starting with test_", () => {
    expect(isLangTestFile("src/test_models.py", "python")).toBe(true);
    expect(isLangTestFile("/project/tests/test_utils.py", "python")).toBe(true);
  });

  it("rejects Python files not starting with test_", () => {
    expect(isLangTestFile("models_test.py", "python")).toBe(false);
    expect(isLangTestFile("utils.py", "python")).toBe(false);
  });

  it("returns false for ts/js/go/rust (handled elsewhere)", () => {
    expect(isLangTestFile("foo.test.ts", "ts")).toBe(false);
    expect(isLangTestFile("foo_test.go", "go")).toBe(false);
    expect(isLangTestFile("foo_test.rs", "rust")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test case patterns
// ---------------------------------------------------------------------------

describe("LANG_TEST_CASE_PATTERNS", () => {
  const langs: SupportedLanguage[] = ["ts", "js", "python", "go", "rust", "java", "kotlin"];

  it("has a pattern for every supported language", () => {
    for (const lang of langs) {
      expect(LANG_TEST_CASE_PATTERNS[lang]).toBeInstanceOf(RegExp);
    }
  });

  it("matches Python test functions", () => {
    const p = new RegExp(LANG_TEST_CASE_PATTERNS.python.source, LANG_TEST_CASE_PATTERNS.python.flags);
    expect("def test_something(self):".match(p)).not.toBeNull();
    expect("def helper():".match(p)).toBeNull();
  });

  it("matches Go test functions", () => {
    const p = new RegExp(LANG_TEST_CASE_PATTERNS.go.source, LANG_TEST_CASE_PATTERNS.go.flags);
    expect("func TestFoo(t *testing.T) {".match(p)).not.toBeNull();
    expect("func helper() {".match(p)).toBeNull();
  });

  it("matches Rust #[test] attributes", () => {
    const p = new RegExp(LANG_TEST_CASE_PATTERNS.rust.source, LANG_TEST_CASE_PATTERNS.rust.flags);
    expect("#[test]".match(p)).not.toBeNull();
    expect("fn helper() {}".match(p)).toBeNull();
  });

  it("matches TS/JS it/test calls", () => {
    const p = new RegExp(LANG_TEST_CASE_PATTERNS.ts.source, LANG_TEST_CASE_PATTERNS.ts.flags);
    expect('it("does x", () => {'.match(p)).not.toBeNull();
    expect('test("does y", () => {'.match(p)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assertion patterns
// ---------------------------------------------------------------------------

describe("LANG_ASSERTION_PATTERNS", () => {
  it("matches Python assert statements", () => {
    const p = LANG_ASSERTION_PATTERNS.python;
    // assertEqual/pytest.raises require ( right after
    expect("assertEqual(a, b)".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("pytest.raises(ValueError)".match(new RegExp(p.source, p.flags))).not.toBeNull();
    // assert with paren (common pytest style)
    expect("assert (result == 42)".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Go t.Error/t.Fatal", () => {
    const p = LANG_ASSERTION_PATTERNS.go;
    expect('t.Errorf("failed: %v", err)'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('t.Fatal("unexpected")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Rust assert macros", () => {
    const p = LANG_ASSERTION_PATTERNS.rust;
    expect("assert!(val)".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("assert_eq!(a, b)".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Describe / grouping patterns
// ---------------------------------------------------------------------------

describe("LANG_DESCRIBE_PATTERNS", () => {
  it("matches Python test class", () => {
    const p = LANG_DESCRIBE_PATTERNS.python!;
    expect("class TestFoo:".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("class Foo:".match(new RegExp(p.source, p.flags))).toBeNull();
  });

  it("matches Go t.Run subtests", () => {
    const p = LANG_DESCRIBE_PATTERNS.go!;
    expect('t.Run("case", func(t *testing.T) {'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Rust mod tests block", () => {
    const p = LANG_DESCRIBE_PATTERNS.rust!;
    expect("mod tests {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Debug output patterns
// ---------------------------------------------------------------------------

describe("LANG_DEBUG_OUTPUT_PATTERNS", () => {
  it("matches Python print()", () => {
    const p = LANG_DEBUG_OUTPUT_PATTERNS.python;
    expect('print("debug")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Go fmt.Println", () => {
    const p = LANG_DEBUG_OUTPUT_PATTERNS.go;
    expect('fmt.Println("debug")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('fmt.Printf("%v", x)'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Rust println! macro", () => {
    const p = LANG_DEBUG_OUTPUT_PATTERNS.rust;
    expect('println!("debug")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('eprintln!("error")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Logging guard patterns
// ---------------------------------------------------------------------------

describe("LANG_LOGGING_GUARD_PATTERNS", () => {
  it("ts/js have no guard (null)", () => {
    expect(LANG_LOGGING_GUARD_PATTERNS.ts).toBeNull();
    expect(LANG_LOGGING_GUARD_PATTERNS.js).toBeNull();
  });

  it("detects Python logging import", () => {
    const p = LANG_LOGGING_GUARD_PATTERNS.python!;
    expect("import logging".match(p)).not.toBeNull();
    expect("from loguru import logger".match(p)).not.toBeNull();
  });

  it("detects Go structured logging", () => {
    const p = LANG_LOGGING_GUARD_PATTERNS.go!;
    expect('logrus.Info("msg")'.match(p)).not.toBeNull();
    expect("zap.NewProduction()".match(p)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error handling patterns
// ---------------------------------------------------------------------------

describe("LANG_TRY_CATCH_PATTERNS", () => {
  it("matches Python try:", () => {
    const p = LANG_TRY_CATCH_PATTERNS.python;
    expect("try:".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Go if err != nil", () => {
    const p = LANG_TRY_CATCH_PATTERNS.go;
    expect("if err != nil {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Rust Result<T, E>", () => {
    const p = LANG_TRY_CATCH_PATTERNS.rust;
    expect("fn foo() -> Result<String, Error> {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});

describe("LANG_EMPTY_CATCH_PATTERNS", () => {
  it("matches Python bare except:", () => {
    const p = LANG_EMPTY_CATCH_PATTERNS.python;
    expect("except:".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("except ValueError:".match(new RegExp(p.source, p.flags))).toBeNull();
  });

  it("matches Go blank error assignment", () => {
    const p = LANG_EMPTY_CATCH_PATTERNS.go;
    expect("_ = doSomething()".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Rust .unwrap()", () => {
    const p = LANG_EMPTY_CATCH_PATTERNS.rust;
    expect("result.unwrap()".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('.expect("msg")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Async patterns
// ---------------------------------------------------------------------------

describe("LANG_ASYNC_PATTERNS", () => {
  it("matches Python async def", () => {
    const p = LANG_ASYNC_PATTERNS.python;
    expect("async def fetch():".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Go goroutine launch", () => {
    const p = LANG_ASYNC_PATTERNS.go;
    expect("go worker(ctx)".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Rust async fn", () => {
    const p = LANG_ASYNC_PATTERNS.rust;
    expect("async fn fetch() -> Result<()> {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Environment variable patterns
// ---------------------------------------------------------------------------

describe("LANG_ENV_VAR_PATTERNS", () => {
  it("matches Python os.getenv", () => {
    const p = LANG_ENV_VAR_PATTERNS.python;
    expect('os.getenv("SECRET_KEY")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('os.environ.get("KEY")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Go os.Getenv", () => {
    const p = LANG_ENV_VAR_PATTERNS.go;
    expect('os.Getenv("SECRET")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("matches Rust std::env::var", () => {
    const p = LANG_ENV_VAR_PATTERNS.rust;
    expect('std::env::var("DATABASE_URL")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('env::var("PORT")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Validation patterns
// ---------------------------------------------------------------------------

describe("LANG_VALIDATION_PATTERNS", () => {
  it("matches Python pydantic/marshmallow", () => {
    const p = LANG_VALIDATION_PATTERNS.python;
    expect("class Foo(BaseModel):".match(new RegExp(p.source, "i"))).not.toBeNull();
    expect("from marshmallow import Schema".match(new RegExp(p.source, "i"))).not.toBeNull();
  });

  it("matches Go validate struct tags", () => {
    const p = LANG_VALIDATION_PATTERNS.go;
    expect('`validate:"required"`'.match(new RegExp(p.source, "i"))).not.toBeNull();
    expect("validate.Struct(req)".match(new RegExp(p.source, "i"))).not.toBeNull();
  });

  it("matches Rust serde/validator", () => {
    const p = LANG_VALIDATION_PATTERNS.rust;
    // serde:: prefix matches \bserde\s*::
    expect("use serde::Deserialize;".match(new RegExp(p.source, "i"))).not.toBeNull();
    // validator::Validate matches directly
    expect("validator::Validate".match(new RegExp(p.source, "i"))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

describe("LANG_ROUTE_PATTERNS", () => {
  it("matches Python Flask/FastAPI routes", () => {
    const p = LANG_ROUTE_PATTERNS.python;
    expect('@app.route("/")'.match(new RegExp(p.source, "i"))).not.toBeNull();
    expect('@router.get("/items")'.match(new RegExp(p.source, "i"))).not.toBeNull();
  });

  it("matches Go HTTP handlers", () => {
    const p = LANG_ROUTE_PATTERNS.go;
    expect('r.GET("/health", handler)'.match(new RegExp(p.source, "i"))).not.toBeNull();
    expect('http.HandleFunc("/", handler)'.match(new RegExp(p.source, "i"))).not.toBeNull();
  });

  it("matches Rust actix-web routes", () => {
    const p = LANG_ROUTE_PATTERNS.rust;
    expect('#[get("/health")]'.match(new RegExp(p.source, "i"))).not.toBeNull();
    expect("web::get().to(handler)".match(new RegExp(p.source, "i"))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge case patterns
// ---------------------------------------------------------------------------

describe("LANG_EDGE_CASE_PATTERNS", () => {
  it("matches Python test functions with error/invalid in name", () => {
    const p = LANG_EDGE_CASE_PATTERNS.python;
    expect("def test_invalid_email(self):".match(new RegExp(p.source, "gi"))).not.toBeNull();
    expect("def test_error_handling(self):".match(new RegExp(p.source, "gi"))).not.toBeNull();
    expect("def test_create_user(self):".match(new RegExp(p.source, "gi"))).toBeNull();
  });

  it("matches Go test functions with Error/Invalid in name", () => {
    const p = LANG_EDGE_CASE_PATTERNS.go;
    expect("func TestInvalidInput(t *testing.T) {".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("func TestFoo(t *testing.T) {".match(new RegExp(p.source, p.flags))).toBeNull();
  });

  it("matches Java method names containing error/invalid/null", () => {
    const p = LANG_EDGE_CASE_PATTERNS.java;
    expect("void testInvalidEmail() {".match(new RegExp(p.source, "gi"))).not.toBeNull();
    expect("void testNullPointer() {".match(new RegExp(p.source, "gi"))).not.toBeNull();
  });

  it("matches Kotlin fun names containing error/invalid/null", () => {
    const p = LANG_EDGE_CASE_PATTERNS.kotlin;
    expect("fun testInvalidEmail() {".match(new RegExp(p.source, "gi"))).not.toBeNull();
    expect("fun testNullInput() {".match(new RegExp(p.source, "gi"))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Java and Kotlin specific patterns
// ---------------------------------------------------------------------------

describe("isLangTestFile — Java and Kotlin", () => {
  it("detects Java test files (*Test.java, *Tests.java, *IT.java)", () => {
    expect(isLangTestFile("src/UserTest.java", "java")).toBe(true);
    expect(isLangTestFile("src/UserTests.java", "java")).toBe(true);
    expect(isLangTestFile("src/UserIT.java", "java")).toBe(true);
  });

  it("rejects non-test Java files", () => {
    expect(isLangTestFile("src/User.java", "java")).toBe(false);
    expect(isLangTestFile("src/TestHelper.java", "java")).toBe(false);
  });

  it("detects Kotlin test files (*Test.kt, *Tests.kt)", () => {
    expect(isLangTestFile("src/UserTest.kt", "kotlin")).toBe(true);
    expect(isLangTestFile("src/UserTests.kt", "kotlin")).toBe(true);
  });

  it("rejects non-test Kotlin files", () => {
    expect(isLangTestFile("src/User.kt", "kotlin")).toBe(false);
  });
});

describe("Java patterns", () => {
  it("LANG_TEST_CASE_PATTERNS matches @Test and @ParameterizedTest", () => {
    const p = LANG_TEST_CASE_PATTERNS.java;
    expect("@Test".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("@ParameterizedTest".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("@Before".match(new RegExp(p.source, p.flags))).toBeNull();
  });

  it("LANG_ASSERTION_PATTERNS matches assertEquals/assertThrows", () => {
    const p = LANG_ASSERTION_PATTERNS.java;
    expect("assertEquals(expected, actual)".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("assertThrows(Exception.class, () -> {".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("assertTrue(result)".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_DESCRIBE_PATTERNS matches @Nested", () => {
    const p = LANG_DESCRIBE_PATTERNS.java!;
    expect("@Nested".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("@Test".match(new RegExp(p.source, p.flags))).toBeNull();
  });

  it("LANG_DEBUG_OUTPUT_PATTERNS matches System.out.println", () => {
    const p = LANG_DEBUG_OUTPUT_PATTERNS.java;
    expect('System.out.println("debug")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('System.err.println("error")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_LOGGING_GUARD_PATTERNS matches SLF4J import", () => {
    const p = LANG_LOGGING_GUARD_PATTERNS.java!;
    expect("import org.slf4j.Logger;".match(p)).not.toBeNull();
    expect("import java.util.logging.Logger;".match(p)).not.toBeNull();
    expect("import org.apache.logging.log4j.Logger;".match(p)).not.toBeNull();
  });

  it("LANG_TRY_CATCH_PATTERNS matches try {", () => {
    const p = LANG_TRY_CATCH_PATTERNS.java;
    expect("try {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_EMPTY_CATCH_PATTERNS matches empty catch blocks", () => {
    const p = LANG_EMPTY_CATCH_PATTERNS.java;
    expect("catch (Exception e) {}".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("catch (Exception e) { log.error(e); }".match(new RegExp(p.source, p.flags))).toBeNull();
  });

  it("LANG_ASYNC_PATTERNS matches CompletableFuture and @Async", () => {
    const p = LANG_ASYNC_PATTERNS.java;
    expect("CompletableFuture<String> future".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("@Async".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("ExecutorService executor".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_STRUCTURED_LOG_PATTERNS matches logger.info/error", () => {
    const p = LANG_STRUCTURED_LOG_PATTERNS.java;
    expect('logger.info("msg")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('log.error("msg")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_CONSOLE_ERROR_PATTERNS matches System.out/err.println and printStackTrace", () => {
    const p = LANG_CONSOLE_ERROR_PATTERNS.java;
    expect('System.out.println("x")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("e.printStackTrace()".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_ENV_VAR_PATTERNS matches System.getenv", () => {
    const p = LANG_ENV_VAR_PATTERNS.java;
    expect('System.getenv("SECRET_KEY")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_VALIDATION_PATTERNS matches Bean Validation annotations", () => {
    const p = LANG_VALIDATION_PATTERNS.java;
    expect("@NotNull".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("@Valid".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("@NotBlank".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_ROUTE_PATTERNS matches Spring MVC and JAX-RS annotations", () => {
    const p = LANG_ROUTE_PATTERNS.java;
    expect('@GetMapping("/users")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('@PostMapping("/users")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('@RequestMapping("/api")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("@GET".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});

describe("Kotlin patterns", () => {
  it("LANG_TEST_CASE_PATTERNS matches @Test and fun test prefix", () => {
    const p = LANG_TEST_CASE_PATTERNS.kotlin;
    expect("@Test".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("fun testSomething() {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_ASSERTION_PATTERNS matches shouldBe and assertFailsWith", () => {
    const p = LANG_ASSERTION_PATTERNS.kotlin;
    expect("result shouldBe 42".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("assertFailsWith<Exception> {".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("assertEquals(a, b)".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_DESCRIBE_PATTERNS matches @Nested and describe {", () => {
    const p = LANG_DESCRIBE_PATTERNS.kotlin!;
    expect("@Nested".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("describe {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_DEBUG_OUTPUT_PATTERNS matches println(", () => {
    const p = LANG_DEBUG_OUTPUT_PATTERNS.kotlin;
    expect('println("debug")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('print("x")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_LOGGING_GUARD_PATTERNS matches kotlin-logging and SLF4J imports", () => {
    const p = LANG_LOGGING_GUARD_PATTERNS.kotlin!;
    expect("import io.github.microutils.logging.KotlinLogging".match(p)).not.toBeNull();
    expect("import org.slf4j.LoggerFactory".match(p)).not.toBeNull();
  });

  it("LANG_TRY_CATCH_PATTERNS matches try {", () => {
    const p = LANG_TRY_CATCH_PATTERNS.kotlin;
    expect("try {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_EMPTY_CATCH_PATTERNS matches empty catch blocks", () => {
    const p = LANG_EMPTY_CATCH_PATTERNS.kotlin;
    expect("catch (e: Exception) {}".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_ASYNC_PATTERNS matches suspend fun, launch, async, runBlocking", () => {
    const p = LANG_ASYNC_PATTERNS.kotlin;
    expect("suspend fun fetchData()".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("launch {".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("async {".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("runBlocking {".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("withContext(Dispatchers.IO) {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_STRUCTURED_LOG_PATTERNS matches logger.info/error", () => {
    const p = LANG_STRUCTURED_LOG_PATTERNS.kotlin;
    expect('logger.info("msg")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('log.error("failed")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_ENV_VAR_PATTERNS matches System.getenv", () => {
    const p = LANG_ENV_VAR_PATTERNS.kotlin;
    expect('System.getenv("DATABASE_URL")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_VALIDATION_PATTERNS matches Bean Validation annotations and require/check", () => {
    const p = LANG_VALIDATION_PATTERNS.kotlin;
    expect("@NotNull".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("require(value != null)".match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect("check(isValid) {".match(new RegExp(p.source, p.flags))).not.toBeNull();
  });

  it("LANG_ROUTE_PATTERNS matches Spring MVC and Ktor route functions", () => {
    const p = LANG_ROUTE_PATTERNS.kotlin;
    expect('@GetMapping("/users")'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('get("/health") {'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('post("/users") {'.match(new RegExp(p.source, p.flags))).not.toBeNull();
    expect('route("/api") {'.match(new RegExp(p.source, p.flags))).not.toBeNull();
  });
});
