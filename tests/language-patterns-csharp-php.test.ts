/**
 * Pattern tests for C# and PHP language support.
 * Verifies all LANG_* pattern maps match the expected code patterns.
 */

import { describe, it, expect } from 'vitest';
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
} from '../src/core/language-rules.js';

function matches(pattern: RegExp, code: string): boolean {
  const p = new RegExp(pattern.source, pattern.flags);
  return p.test(code);
}

function matchCount(pattern: RegExp, code: string): number {
  const p = new RegExp(pattern.source, 'g');
  return (code.match(p) ?? []).length;
}

// ---------------------------------------------------------------------------
// C# — isLangTestFile
// ---------------------------------------------------------------------------

describe('isLangTestFile — csharp', () => {
  it('matches *Test.cs', () => {
    expect(isLangTestFile('src/UserTest.cs', 'csharp')).toBe(true);
  });
  it('matches *Tests.cs', () => {
    expect(isLangTestFile('src/UserTests.cs', 'csharp')).toBe(true);
  });
  it('does not match regular .cs files', () => {
    expect(isLangTestFile('src/User.cs', 'csharp')).toBe(false);
    expect(isLangTestFile('src/UserService.cs', 'csharp')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PHP — isLangTestFile
// ---------------------------------------------------------------------------

describe('isLangTestFile — php', () => {
  it('matches *Test.php', () => {
    expect(isLangTestFile('tests/UserTest.php', 'php')).toBe(true);
  });
  it('does not match regular .php files', () => {
    expect(isLangTestFile('src/User.php', 'php')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C# — test case patterns
// ---------------------------------------------------------------------------

describe('LANG_TEST_CASE_PATTERNS — csharp', () => {
  const p = LANG_TEST_CASE_PATTERNS.csharp;

  it('matches [Test]', () => expect(matches(p, '[Test]')).toBe(true));
  it('matches [Fact]', () => expect(matches(p, '[Fact]')).toBe(true));
  it('matches [Theory]', () => expect(matches(p, '[Theory]')).toBe(true));
  it('matches [TestMethod]', () => expect(matches(p, '[TestMethod]')).toBe(true));
  it('does not match plain method', () => expect(matches(p, 'void SomeMethod()')).toBe(false));
});

// ---------------------------------------------------------------------------
// PHP — test case patterns
// ---------------------------------------------------------------------------

describe('LANG_TEST_CASE_PATTERNS — php', () => {
  const p = LANG_TEST_CASE_PATTERNS.php;

  it('matches public function testSomething', () => {
    expect(matches(p, 'public function testUserLogin()')).toBe(true);
  });
  it('matches /** @test */', () => {
    expect(matches(p, '/** @test */')).toBe(true);
  });
  it('matches ->it(', () => {
    expect(matches(p, "->it('does something'")).toBe(true);
  });
  it('does not match non-test methods', () => {
    expect(matches(p, 'public function getUser()')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C# — assertion patterns
// ---------------------------------------------------------------------------

describe('LANG_ASSERTION_PATTERNS — csharp', () => {
  const p = LANG_ASSERTION_PATTERNS.csharp;

  it('matches Assert.Equal(', () => expect(matches(p, 'Assert.Equal(expected, actual)')).toBe(true));
  it('matches Assert.True(', () => expect(matches(p, 'Assert.True(result)')).toBe(true));
  it('matches Assert.Throws(', () => expect(matches(p, 'Assert.Throws<Exception>(')).toBe(true));
  it('matches Assert.NotNull(', () => expect(matches(p, 'Assert.NotNull(obj)')).toBe(true));
  it('matches Should(', () => expect(matches(p, 'result.Should()')).toBe(true));
});

// ---------------------------------------------------------------------------
// PHP — assertion patterns
// ---------------------------------------------------------------------------

describe('LANG_ASSERTION_PATTERNS — php', () => {
  const p = LANG_ASSERTION_PATTERNS.php;

  it('matches $this->assertEquals(', () => {
    expect(matches(p, '$this->assertEquals(1, $result)')).toBe(true);
  });
  it('matches $this->assertTrue(', () => {
    expect(matches(p, '$this->assertTrue($result)')).toBe(true);
  });
  it('matches assertEquals(', () => {
    expect(matches(p, 'assertEquals(1, $val)')).toBe(true);
  });
  it('matches expect(', () => {
    expect(matches(p, 'expect($value)')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C# — describe/grouping patterns
// ---------------------------------------------------------------------------

describe('LANG_DESCRIBE_PATTERNS — csharp', () => {
  const p = LANG_DESCRIBE_PATTERNS.csharp!;

  it('matches [TestClass]', () => expect(matches(p, '[TestClass]')).toBe(true));
  it('matches [Collection]', () => expect(matches(p, '[Collection("integration")]')).toBe(true));
});

// ---------------------------------------------------------------------------
// PHP — describe patterns (null)
// ---------------------------------------------------------------------------

describe('LANG_DESCRIBE_PATTERNS — php', () => {
  it('is null (PHPUnit has no describe grouping)', () => {
    expect(LANG_DESCRIBE_PATTERNS.php).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C# — debug output patterns
// ---------------------------------------------------------------------------

describe('LANG_DEBUG_OUTPUT_PATTERNS — csharp', () => {
  const p = LANG_DEBUG_OUTPUT_PATTERNS.csharp;

  it('matches Console.WriteLine(', () => expect(matches(p, 'Console.WriteLine("debug")')).toBe(true));
  it('matches Console.Write(', () => expect(matches(p, 'Console.Write("x")')).toBe(true));
  it('matches Debug.WriteLine(', () => expect(matches(p, 'Debug.WriteLine("trace")')).toBe(true));
  it('does not match logger calls', () => expect(matches(p, '_logger.LogInformation("msg")')).toBe(false));
});

// ---------------------------------------------------------------------------
// PHP — debug output patterns
// ---------------------------------------------------------------------------

describe('LANG_DEBUG_OUTPUT_PATTERNS — php', () => {
  const p = LANG_DEBUG_OUTPUT_PATTERNS.php;

  it('matches var_dump(', () => expect(matches(p, 'var_dump($data)')).toBe(true));
  it('matches print_r(', () => expect(matches(p, 'print_r($data)')).toBe(true));
  it('matches dd(', () => expect(matches(p, 'dd($user)')).toBe(true));
});

// ---------------------------------------------------------------------------
// C# — logging guard
// ---------------------------------------------------------------------------

describe('LANG_LOGGING_GUARD_PATTERNS — csharp', () => {
  const p = LANG_LOGGING_GUARD_PATTERNS.csharp!;

  it('matches using Microsoft.Extensions.Logging', () => {
    expect(matches(p, 'using Microsoft.Extensions.Logging;')).toBe(true);
  });
  it('matches using Serilog', () => {
    expect(matches(p, 'using Serilog;')).toBe(true);
  });
  it('matches using NLog', () => {
    expect(matches(p, 'using NLog;')).toBe(true);
  });
  it('does not match unrelated using', () => {
    expect(matches(p, 'using System.IO;')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PHP — logging guard
// ---------------------------------------------------------------------------

describe('LANG_LOGGING_GUARD_PATTERNS — php', () => {
  const p = LANG_LOGGING_GUARD_PATTERNS.php!;

  it('matches use Monolog\\', () => {
    expect(matches(p, 'use Monolog\\Logger;')).toBe(true);
  });
  it('matches use Psr\\Log\\', () => {
    expect(matches(p, 'use Psr\\Log\\LoggerInterface;')).toBe(true);
  });
  it('does not match unrelated use', () => {
    expect(matches(p, 'use Illuminate\\Http\\Request;')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C# — try/catch + empty catch
// ---------------------------------------------------------------------------

describe('LANG_TRY_CATCH_PATTERNS — csharp', () => {
  it('matches try {', () => {
    expect(matches(LANG_TRY_CATCH_PATTERNS.csharp, 'try {')).toBe(true);
  });
});

describe('LANG_EMPTY_CATCH_PATTERNS — csharp', () => {
  const p = LANG_EMPTY_CATCH_PATTERNS.csharp;

  it('matches empty catch (Exception ex) {}', () => {
    expect(matches(p, 'catch (Exception ex) {}')).toBe(true);
  });
  it('matches empty catch {}', () => {
    expect(matches(p, 'catch {}')).toBe(true);
  });
  it('does not match catch with body', () => {
    expect(matches(p, 'catch (Exception ex) { throw; }')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PHP — try/catch + empty catch
// ---------------------------------------------------------------------------

describe('LANG_TRY_CATCH_PATTERNS — php', () => {
  it('matches try {', () => {
    expect(matches(LANG_TRY_CATCH_PATTERNS.php, 'try {')).toBe(true);
  });
});

describe('LANG_EMPTY_CATCH_PATTERNS — php', () => {
  const p = LANG_EMPTY_CATCH_PATTERNS.php;

  it('matches empty catch (Exception $e) {}', () => {
    expect(matches(p, 'catch (Exception $e) {}')).toBe(true);
  });
  it('does not match catch with body', () => {
    expect(matches(p, 'catch (Exception $e) { Log::error($e); }')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C# — async patterns
// ---------------------------------------------------------------------------

describe('LANG_ASYNC_PATTERNS — csharp', () => {
  const p = LANG_ASYNC_PATTERNS.csharp;

  it('matches async Task', () => expect(matches(p, 'async Task GetUser()')).toBe(true));
  it('matches async ValueTask', () => expect(matches(p, 'async ValueTask<int> Compute()')).toBe(true));
  it('does not match non-async', () => expect(matches(p, 'Task GetUser()')).toBe(false));
});

// ---------------------------------------------------------------------------
// PHP — async patterns
// ---------------------------------------------------------------------------

describe('LANG_ASYNC_PATTERNS — php', () => {
  const p = LANG_ASYNC_PATTERNS.php;

  it('matches yield', () => expect(matches(p, 'yield $value;')).toBe(true));
});

// ---------------------------------------------------------------------------
// C# — structured logging
// ---------------------------------------------------------------------------

describe('LANG_STRUCTURED_LOG_PATTERNS — csharp', () => {
  const p = LANG_STRUCTURED_LOG_PATTERNS.csharp;

  it('matches _logger.LogInformation(', () => {
    expect(matches(p, '_logger.LogInformation("msg")')).toBe(true);
  });
  it('matches _logger.LogError(', () => {
    expect(matches(p, '_logger.LogError(ex, "error")')).toBe(true);
  });
  it('matches Log.Information(', () => {
    expect(matches(p, 'Log.Information("event {Name}", name)')).toBe(true);
  });
  it('matches Log.Warning(', () => {
    expect(matches(p, 'Log.Warning("something")')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PHP — structured logging
// ---------------------------------------------------------------------------

describe('LANG_STRUCTURED_LOG_PATTERNS — php', () => {
  const p = LANG_STRUCTURED_LOG_PATTERNS.php;

  it('matches $this->logger->info(', () => {
    expect(matches(p, '$this->logger->info("msg")')).toBe(true);
  });
  it('matches Log::info(', () => {
    expect(matches(p, 'Log::info("msg")')).toBe(true);
  });
  it('matches Log::error(', () => {
    expect(matches(p, 'Log::error("err")')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C# — env var patterns
// ---------------------------------------------------------------------------

describe('LANG_ENV_VAR_PATTERNS — csharp', () => {
  it('matches Environment.GetEnvironmentVariable(', () => {
    expect(matches(
      LANG_ENV_VAR_PATTERNS.csharp,
      'var key = Environment.GetEnvironmentVariable("API_KEY");',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PHP — env var patterns
// ---------------------------------------------------------------------------

describe('LANG_ENV_VAR_PATTERNS — php', () => {
  const p = LANG_ENV_VAR_PATTERNS.php;

  it('matches getenv(', () => expect(matches(p, 'getenv("DB_HOST")')).toBe(true));
  it('matches $_ENV[', () => expect(matches(p, '$_ENV["DB_HOST"]')).toBe(true));
  it('matches env(', () => expect(matches(p, 'env("APP_KEY")')).toBe(true));
});

// ---------------------------------------------------------------------------
// C# — validation patterns
// ---------------------------------------------------------------------------

describe('LANG_VALIDATION_PATTERNS — csharp', () => {
  const p = LANG_VALIDATION_PATTERNS.csharp;

  it('matches [Required]', () => expect(matches(p, '[Required]')).toBe(true));
  it('matches [StringLength]', () => expect(matches(p, '[StringLength(100)]')).toBe(true));
  it('matches RuleFor(', () => expect(matches(p, 'RuleFor(x => x.Name)')).toBe(true));
});

// ---------------------------------------------------------------------------
// PHP — validation patterns
// ---------------------------------------------------------------------------

describe('LANG_VALIDATION_PATTERNS — php', () => {
  const p = LANG_VALIDATION_PATTERNS.php;

  it('matches $request->validate(', () => {
    expect(matches(p, '$request->validate([')).toBe(true);
  });
  it('matches Validator::make(', () => {
    expect(matches(p, 'Validator::make($data, $rules)')).toBe(true);
  });
  it('matches Assert\\', () => {
    expect(matches(p, 'use Symfony\\Component\\Validator\\Constraints as Assert\\')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C# — route patterns
// ---------------------------------------------------------------------------

describe('LANG_ROUTE_PATTERNS — csharp', () => {
  const p = LANG_ROUTE_PATTERNS.csharp;

  it('matches [HttpGet]', () => expect(matches(p, '[HttpGet]')).toBe(true));
  it('matches [HttpPost]', () => expect(matches(p, '[HttpPost]')).toBe(true));
  it('matches MapGet(', () => expect(matches(p, 'app.MapGet("/users",')).toBe(true));
  it('matches MapPost(', () => expect(matches(p, 'app.MapPost("/users",')).toBe(true));
});

// ---------------------------------------------------------------------------
// PHP — route patterns
// ---------------------------------------------------------------------------

describe('LANG_ROUTE_PATTERNS — php', () => {
  const p = LANG_ROUTE_PATTERNS.php;

  it('matches Route::get(', () => {
    expect(matches(p, 'Route::get("/users", [UserController::class, "index"])')).toBe(true);
  });
  it('matches Route::post(', () => {
    expect(matches(p, 'Route::post("/users", [UserController::class, "store"])')).toBe(true);
  });
  it('matches #[Route(', () => {
    expect(matches(p, '#[Route("/users", name: "users")]')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C# — console error patterns
// ---------------------------------------------------------------------------

describe('LANG_CONSOLE_ERROR_PATTERNS — csharp', () => {
  const p = LANG_CONSOLE_ERROR_PATTERNS.csharp;

  it('matches Console.WriteLine(', () => expect(matches(p, 'Console.WriteLine("err")')).toBe(true));
  it('matches Debug.WriteLine(', () => expect(matches(p, 'Debug.WriteLine("trace")')).toBe(true));
});

// ---------------------------------------------------------------------------
// PHP — console error patterns
// ---------------------------------------------------------------------------

describe('LANG_CONSOLE_ERROR_PATTERNS — php', () => {
  const p = LANG_CONSOLE_ERROR_PATTERNS.php;

  it('matches var_dump(', () => expect(matches(p, 'var_dump($data)')).toBe(true));
  it('matches print_r(', () => expect(matches(p, 'print_r($data, true)')).toBe(true));
  it('matches dd(', () => expect(matches(p, 'dd($request)')).toBe(true));
  it('matches echo ', () => expect(matches(p, 'echo $message;')).toBe(true));
});
