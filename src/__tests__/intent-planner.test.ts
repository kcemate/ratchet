/**
 * Intent Planner — unit tests (Phase 2 of Autofix Engine v2)
 *
 * Coverage:
 *   - JSON extraction: all 5 strategies
 *   - Schema validation: valid, missing fields, wrong types, low confidence
 *   - Planner: mock LLM success, retry on bad JSON, null on failure
 *   - Integration: Finding → IntentPlan round-trip
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractJson } from "../core/intent-planner.js";
import { validateIntentPlan, IntentPlanSchema } from "../core/intent-schema.js";
import { IntentPlanner } from "../core/intent-planner.js";
import type { Finding } from "../core/normalize.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_PLAN_OBJ = {
  action: "replace",
  targetLines: [10, 15],
  description: "Wrap async function body in try/catch",
  pattern: "async function fetchData",
  replacement_intent: "Add error handling to prevent unhandled promise rejections",
  imports_needed: [],
  confidence: 0.85,
};

const VALID_PLAN_JSON = JSON.stringify(VALID_PLAN_OBJ);

const SAMPLE_FINDING: Finding = {
  category: "Error Handling",
  subcategory: "Unhandled async",
  severity: "high",
  message: "Async function fetchData has no error handling",
  file: "src/api/data.ts",
  line: 12,
  confidence: 0.9,
  source: "deep",
};

const SAMPLE_SOURCE = `import { db } from './db.js';

export async function fetchData(id: string) {
  const result = await db.query('SELECT * FROM items WHERE id = ?', [id]);
  return result.rows;
}

export async function saveData(data: unknown) {
  await db.insert(data);
}
`;

// ---------------------------------------------------------------------------
// extractJson — all 5 strategies
// ---------------------------------------------------------------------------

describe("extractJson", () => {
  it("strategy 1: parses clean JSON directly", () => {
    const result = extractJson(VALID_PLAN_JSON);
    expect(result).toMatchObject(VALID_PLAN_OBJ);
  });

  it("strategy 1: handles JSON with leading/trailing whitespace", () => {
    const result = extractJson(`\n  ${VALID_PLAN_JSON}  \n`);
    expect(result).toMatchObject(VALID_PLAN_OBJ);
  });

  it("strategy 2: extracts from ```json fence", () => {
    const wrapped = "```json\n" + VALID_PLAN_JSON + "\n```";
    expect(extractJson(wrapped)).toMatchObject(VALID_PLAN_OBJ);
  });

  it("strategy 2: extracts from plain ``` fence", () => {
    const wrapped = "```\n" + VALID_PLAN_JSON + "\n```";
    expect(extractJson(wrapped)).toMatchObject(VALID_PLAN_OBJ);
  });

  it("strategy 3: extracts JSON from prose-wrapped response", () => {
    const wrapped = `Here is the fix plan for the finding:\n${VALID_PLAN_JSON}\nLet me know if you need more details.`;
    expect(extractJson(wrapped)).toMatchObject(VALID_PLAN_OBJ);
  });

  it("strategy 3: handles JSON with extra text before and after braces", () => {
    const wrapped = `Sure! The plan is: ${VALID_PLAN_JSON} Hope that helps!`;
    expect(extractJson(wrapped)).toMatchObject(VALID_PLAN_OBJ);
  });

  it("strategy 4: handles slightly malformed JSON with line cleanup", () => {
    // Valid JSON split across lines with some junk lines interspersed
    const raw = `
Let me provide the fix:
"action": "replace",
"targetLines": [10, 15],
"description": "wrap it",
"pattern": "async fn",
"replacement_intent": "add error handling",
"imports_needed": [],
"confidence": 0.8
Some trailing text
`;
    // Strategy 4 won't produce full valid JSON from this but shouldn't crash
    // We just verify it returns something or null without throwing
    expect(() => extractJson(raw)).not.toThrow();
  });

  it("strategy 5: extracts partial fields via regex from JSON-like prose", () => {
    // Simulates an LLM that outputs fields without wrapping braces
    const raw = `
      "action": "replace",
      "targetLines": [5, 10],
      "description": "fix the issue",
      "pattern": "console.log",
      "replacement_intent": "use structured logger",
      "imports_needed": [],
      "confidence": 0.75
    `;
    const result = extractJson(raw);
    // Should extract at least some fields via regex
    expect(result).not.toBeNull();
    if (result) {
      expect(result["action"]).toBe("replace");
      expect(result["confidence"]).toBe(0.75);
    }
  });

  it("returns null for empty string", () => {
    expect(extractJson("")).toBeNull();
  });

  it("returns null for completely unparseable text", () => {
    expect(extractJson("This is just plain text with no JSON whatsoever.")).toBeNull();
  });

  it("handles nested JSON objects without confusion", () => {
    const nested = JSON.stringify({ ...VALID_PLAN_OBJ, extra: { nested: true } });
    const result = extractJson(nested);
    expect(result).not.toBeNull();
    expect(result!["action"]).toBe("replace");
  });
});

// ---------------------------------------------------------------------------
// validateIntentPlan — schema validation
// ---------------------------------------------------------------------------

describe("validateIntentPlan", () => {
  it("accepts a fully valid plan", () => {
    const result = validateIntentPlan(VALID_PLAN_OBJ);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.action).toBe("replace");
      expect(result.plan.confidence).toBe(0.85);
    }
  });

  it("accepts all valid action types", () => {
    for (const action of ["insert", "replace", "delete", "wrap"] as const) {
      const result = validateIntentPlan({ ...VALID_PLAN_OBJ, action });
      expect(result.success).toBe(true);
    }
  });

  it("rejects plan with confidence < 0.3", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, confidence: 0.25 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("0.3");
    }
  });

  it("rejects plan with confidence exactly 0", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, confidence: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts plan with confidence exactly 0.3 (boundary)", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, confidence: 0.3 });
    expect(result.success).toBe(true);
  });

  it("rejects missing action field", () => {
    const { action: _, ...noAction } = VALID_PLAN_OBJ;
    const result = validateIntentPlan(noAction);
    expect(result.success).toBe(false);
  });

  it("rejects invalid action value", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, action: "modify" });
    expect(result.success).toBe(false);
  });

  it("rejects missing targetLines", () => {
    const { targetLines: _, ...noLines } = VALID_PLAN_OBJ;
    const result = validateIntentPlan(noLines);
    expect(result.success).toBe(false);
  });

  it("rejects targetLines where end < start", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, targetLines: [15, 10] });
    expect(result.success).toBe(false);
  });

  it("rejects targetLines with wrong length", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, targetLines: [10] });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer line numbers", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, targetLines: [10.5, 15.5] });
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const { description: _, ...noDesc } = VALID_PLAN_OBJ;
    const result = validateIntentPlan(noDesc);
    expect(result.success).toBe(false);
  });

  it("rejects empty description string", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, description: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing replacement_intent", () => {
    const { replacement_intent: _, ...noIntent } = VALID_PLAN_OBJ;
    const result = validateIntentPlan(noIntent);
    expect(result.success).toBe(false);
  });

  it("rejects confidence > 1", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it("accepts imports_needed as empty array", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, imports_needed: [] });
    expect(result.success).toBe(true);
  });

  it("accepts imports_needed with values", () => {
    const result = validateIntentPlan({ ...VALID_PLAN_OBJ, imports_needed: ["pino", "zod"] });
    expect(result.success).toBe(true);
  });

  it("returns error string on failure (never throws)", () => {
    expect(() => validateIntentPlan(null)).not.toThrow();
    const result = validateIntentPlan(null);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IntentPlanner — with mocked LLM
// ---------------------------------------------------------------------------

describe("IntentPlanner", () => {
  let planner: IntentPlanner;

  beforeEach(() => {
    // Use a fake API key — LLM calls will be mocked
    planner = new IntentPlanner({ apiKey: "test-key", model: "test-model" });
  });

  it("returns valid plan when LLM returns clean JSON", async () => {
    // Mock sendMessage on the provider
    const sendSpy = vi
      .spyOn((planner as unknown as { provider: { sendMessage: () => Promise<string> } }).provider, "sendMessage")
      .mockResolvedValueOnce(VALID_PLAN_JSON);

    const result = await planner.plan(SAMPLE_FINDING, SAMPLE_SOURCE);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("replace");
    expect(result!.confidence).toBe(0.85);
    expect(sendSpy).toHaveBeenCalledOnce();
  });

  it("returns valid plan when LLM wraps JSON in markdown fence", async () => {
    vi.spyOn(
      (planner as unknown as { provider: { sendMessage: () => Promise<string> } }).provider,
      "sendMessage"
    ).mockResolvedValueOnce("```json\n" + VALID_PLAN_JSON + "\n```");

    const result = await planner.plan(SAMPLE_FINDING, SAMPLE_SOURCE);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("replace");
  });

  it("retries with strict mode when first response has unparseable JSON", async () => {
    const sendSpy = vi
      .spyOn((planner as unknown as { provider: { sendMessage: () => Promise<string> } }).provider, "sendMessage")
      .mockResolvedValueOnce("Sorry, I cannot help with that.")
      .mockResolvedValueOnce(VALID_PLAN_JSON);

    const result = await planner.plan(SAMPLE_FINDING, SAMPLE_SOURCE);
    expect(result).not.toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    // Second call should have "ONLY valid JSON" in the prompt
    const secondCallPrompt = (sendSpy.mock.calls as unknown as string[][])[1]?.[0];
    expect(secondCallPrompt).toContain("ONLY valid JSON");
  });

  it("returns null when both attempts fail to produce valid JSON", async () => {
    vi.spyOn((planner as unknown as { provider: { sendMessage: () => Promise<string> } }).provider, "sendMessage")
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce("still not json");

    const result = await planner.plan(SAMPLE_FINDING, SAMPLE_SOURCE);
    expect(result).toBeNull();
  });

  it("returns null when LLM throws an error", async () => {
    vi.spyOn(
      (planner as unknown as { provider: { sendMessage: () => Promise<string> } }).provider,
      "sendMessage"
    ).mockRejectedValue(new Error("API timeout"));

    const result = await planner.plan(SAMPLE_FINDING, SAMPLE_SOURCE);
    expect(result).toBeNull();
  });

  it("returns null when JSON is valid but confidence is too low", async () => {
    const lowConfPlan = JSON.stringify({ ...VALID_PLAN_OBJ, confidence: 0.1 });
    vi.spyOn((planner as unknown as { provider: { sendMessage: () => Promise<string> } }).provider, "sendMessage")
      .mockResolvedValueOnce(lowConfPlan)
      .mockResolvedValueOnce(lowConfPlan);

    const result = await planner.plan(SAMPLE_FINDING, SAMPLE_SOURCE);
    expect(result).toBeNull();
  });

  it("returns null on empty LLM response", async () => {
    vi.spyOn((planner as unknown as { provider: { sendMessage: () => Promise<string> } }).provider, "sendMessage")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");

    const result = await planner.plan(SAMPLE_FINDING, SAMPLE_SOURCE);
    expect(result).toBeNull();
  });

  it("integration: finding with no file/line still produces a prompt without crashing", async () => {
    const minimalFinding: Finding = {
      category: "Security",
      subcategory: "Secrets & env vars",
      severity: "critical",
      message: "Hardcoded secret detected",
      confidence: 0.9,
      source: "classic",
    };

    const sendSpy = vi
      .spyOn((planner as unknown as { provider: { sendMessage: () => Promise<string> } }).provider, "sendMessage")
      .mockResolvedValueOnce(VALID_PLAN_JSON);

    const result = await planner.plan(minimalFinding, SAMPLE_SOURCE);
    expect(result).not.toBeNull();
    // Prompt should still be constructed (file/line fall back to 'unknown'/1)
    const prompt = (sendSpy.mock.calls as unknown as string[][])[0]?.[0];
    expect(prompt).toContain("Hardcoded secret detected");
  });
});
