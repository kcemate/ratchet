import { describe, it, expect, vi, beforeEach } from "vitest";
import { preflightTestCommand } from "../core/engine.js";

// Mock the runner module to avoid actual process spawning
vi.mock("../core/runner.js", () => ({
  runTests: vi.fn(),
}));

import { runTests } from "../core/runner.js";
const mockRunTests = runTests as ReturnType<typeof vi.fn>;

describe("preflightTestCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves without error when tests pass", async () => {
    mockRunTests.mockResolvedValue({ passed: true, output: "All tests passed", duration: 100 });
    await expect(preflightTestCommand("npm test", "/fake/cwd")).resolves.toBeUndefined();
  });

  it("resolves without error when tests fail (pre-existing failures are OK)", async () => {
    mockRunTests.mockResolvedValue({ passed: false, output: "Test suite failed", duration: 100 });
    await expect(preflightTestCommand("npm test", "/fake/cwd")).resolves.toBeUndefined();
  });

  it("throws when npm error Missing script is in output", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: 'npm error Missing script: "test"\nnpm error',
      duration: 50,
    });
    await expect(preflightTestCommand("npm test", "/fake/cwd")).rejects.toThrow("No working test command");
  });

  it('throws when "Missing script:" appears anywhere in output', async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "Missing script: test\nError!",
      duration: 50,
    });
    await expect(preflightTestCommand("npm test", "/fake/cwd")).rejects.toThrow("No working test command");
  });

  it('throws when "no test specified" appears in output (default npm stub)', async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "Error: no test specified",
      duration: 50,
    });
    await expect(preflightTestCommand("npm test", "/fake/cwd")).rejects.toThrow("No working test command");
  });

  it("includes actionable fix message in the error", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: 'npm error Missing script: "test"',
      duration: 50,
    });
    await expect(preflightTestCommand("npm test", "/fake/cwd")).rejects.toThrow("add a test script to package.json");
  });

  // ——— dependency-not-installed detection (regression: hono on /tmp scenario) ———

  it("throws when JS dependencies are not installed (Cannot find module)", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "Error: Cannot find module 'vitest'\nRequire stack:\n- /tmp/repo/node_modules/.bin/vitest",
      duration: 200,
    });
    await expect(preflightTestCommand("npx vitest run", "/fake/cwd")).rejects.toThrow("Dependencies are not installed");
  });

  it("throws when MODULE_NOT_FOUND is in output", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: 'code: "MODULE_NOT_FOUND",\nrequireStack: [...]',
      duration: 200,
    });
    await expect(preflightTestCommand("npx vitest run", "/fake/cwd")).rejects.toThrow("Dependencies are not installed");
  });

  it("throws when Python deps are missing (ModuleNotFoundError)", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "ModuleNotFoundError: No module named 'pytest'",
      duration: 200,
    });
    await expect(preflightTestCommand("pytest", "/fake/cwd")).rejects.toThrow("Dependencies are not installed");
  });

  it("throws when Python deps are missing (No module named, alternate phrasing)", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "ImportError: No module named django",
      duration: 200,
    });
    await expect(preflightTestCommand("pytest", "/fake/cwd")).rejects.toThrow("Dependencies are not installed");
  });

  it("dep-missing error includes a fix command", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "Error: Cannot find module 'vitest'",
      duration: 200,
    });
    // Generic install hint should be present even without lockfile detection in /fake/cwd
    await expect(preflightTestCommand("npx vitest run", "/fake/cwd")).rejects.toThrow(
      /install your project dependencies/
    );
  });

  // ——— missing test runner binary ———

  it("throws when test runner binary is missing (ENOENT)", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "spawn vitest ENOENT",
      error: "spawn vitest ENOENT",
      duration: 50,
    });
    await expect(preflightTestCommand("vitest run", "/fake/cwd")).rejects.toThrow("Test runner not on PATH");
  });

  it('throws when runner returns the friendly "Test command not found" message', async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "Test command not found: `vitest`",
      error: "Test command not found: `vitest`",
      duration: 5,
    });
    await expect(preflightTestCommand("vitest run", "/fake/cwd")).rejects.toThrow("Test runner not on PATH");
  });

  // ——— negative cases: real test failures still pass through to per-click handling ———

  it("does NOT throw on a normal failing test (let baseline / per-click gate handle it)", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "FAIL src/foo.test.ts > foo() > returns true\n  AssertionError: expected false to be true",
      duration: 1500,
    });
    await expect(preflightTestCommand("npm test", "/fake/cwd")).resolves.toBeUndefined();
  });

  it("does NOT throw on a snapshot mismatch", async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: "Snapshot `Component renders correctly 1` mismatched",
      duration: 1500,
    });
    await expect(preflightTestCommand("npm test", "/fake/cwd")).resolves.toBeUndefined();
  });
});
