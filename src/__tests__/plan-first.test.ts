/**
 * Plan-First Mode — unit tests
 * Tests validatePlan with real and fake paths.
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { validatePlan } from "../core/plan-first.js";
import type { IntentPlan } from "../core/smart-applier.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<IntentPlan> = {}): IntentPlan {
  return {
    action: "replace",
    targetLines: [2, 3],
    description: "Fix logging call",
    pattern: "console.log(",
    replacement_intent: "Replace console.log with logger.info",
    imports_needed: [],
    confidence: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup a temp dir with a real file for fs-based tests
// ---------------------------------------------------------------------------

let tmpDir: string;
let tmpFile: string;

const FILE_CONTENT = [
  'import { foo } from "./foo";',
  'console.log("hello");',
  'console.log("world");',
  "export default foo;",
].join("\n");

async function setupTempDir() {
  tmpDir = join(tmpdir(), `plan-first-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  tmpFile = join(tmpDir, "service.ts");
  await writeFile(tmpFile, FILE_CONTENT, "utf8");
}

async function teardownTempDir() {
  await rm(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validatePlan", () => {
  // Setup temp dir before all tests in this suite
  let setup = false;
  async function ensureSetup() {
    if (!setup) {
      await setupTempDir();
      setup = true;
    }
  }

  it("returns valid=true for a well-formed plan with existing file", async () => {
    await ensureSetup();
    const plan = makePlan({ pattern: "console.log(" });
    const result = await validatePlan(plan, tmpDir, "service.ts");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    await teardownTempDir();
    setup = false;
  });

  it("returns valid=false when file does not exist", async () => {
    const plan = makePlan();
    const result = await validatePlan(plan, tmpdir(), "nonexistent-file-xyz.ts");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("not found"))).toBe(true);
  });

  it("returns valid=false when target lines exceed file length", async () => {
    await ensureSetup();
    const plan = makePlan({ targetLines: [100, 200] });
    const result = await validatePlan(plan, tmpDir, "service.ts");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("exceeds file length"))).toBe(true);
    await teardownTempDir();
    setup = false;
  });

  it("returns valid=false when pattern not in file", async () => {
    await ensureSetup();
    const plan = makePlan({ pattern: "this_pattern_does_not_exist_xyz_abc" });
    const result = await validatePlan(plan, tmpDir, "service.ts");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Pattern not found"))).toBe(true);
    await teardownTempDir();
    setup = false;
  });

  it("returns valid=true when pattern matches the file", async () => {
    await ensureSetup();
    const plan = makePlan({ targetLines: [2, 3], pattern: 'console.log("hello");' });
    const result = await validatePlan(plan, tmpDir, "service.ts");
    expect(result.valid).toBe(true);
    await teardownTempDir();
    setup = false;
  });

  it("returns valid=false for confidence below threshold", async () => {
    const plan = makePlan({ confidence: 0.1 });
    const result = await validatePlan(plan, tmpdir());
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("confidence"))).toBe(true);
  });

  it("returns valid=true with confidence exactly at threshold", async () => {
    // confidence = 0.3 should pass (>= 0.3 threshold in intent-schema is < 0.3 reject)
    const plan = makePlan({ confidence: 0.3 });
    // No file path — only confidence check
    const result = await validatePlan(plan, tmpdir());
    expect(result.errors.some(e => e.includes("confidence"))).toBe(false);
  });

  it("resolvedPaths includes the target file path when valid", async () => {
    await ensureSetup();
    const plan = makePlan({ pattern: "console.log(" });
    const result = await validatePlan(plan, tmpDir, "service.ts");
    expect(result.resolvedPaths.some(p => p.includes("service.ts"))).toBe(true);
    await teardownTempDir();
    setup = false;
  });

  it("returns valid=false for nonexistent relative import", async () => {
    await ensureSetup();
    const plan = makePlan({
      pattern: "console.log(",
      imports_needed: ["./nonexistent-module-xyz"],
    });
    const result = await validatePlan(plan, tmpDir, "service.ts");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("not resolvable"))).toBe(true);
    await teardownTempDir();
    setup = false;
  });

  it("accepts node builtin imports without error", async () => {
    const plan = makePlan({ imports_needed: ["fs", "path", "crypto"] });
    const result = await validatePlan(plan, tmpdir());
    // node builtins should not add errors (non-fatal)
    expect(result.errors.filter(e => e.includes("not resolvable"))).toHaveLength(0);
  });
});
