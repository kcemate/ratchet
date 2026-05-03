/**
 * Intent Planner — Layer 2 of the Autofix Engine v2.
 *
 * Given a Finding and relevant source code, prompts a cheap LLM (OllamaCloud /
 * nemotron-3-super:cloud) to produce a structured JSON fix *plan*.
 *
 * Key design constraints:
 *   - Do NOT generate code — describe WHAT to change as JSON.
 *   - Return null on any failure (never throw).
 *   - Retry once if JSON extraction fails (appending a stricter instruction).
 */

import type { Finding } from "./normalize.js";
import { OllamaCloudProvider } from "./providers/ollama-cloud.js";
import { validateIntentPlan } from "./intent-schema.js";
import type { IntentPlan } from "./intent-schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTENT_MODEL = "nemotron-3-super:cloud";

/** Lines of context to include around the finding's target line. */
const CONTEXT_LINES = 20;

// ---------------------------------------------------------------------------
// JSON Extraction — 5-strategy fallback
// ---------------------------------------------------------------------------

/**
 * Try to extract a JSON object from an LLM response string.
 * Strategies (in order):
 *   1. Direct JSON.parse of the whole response.
 *   2. Extract content inside ```json … ``` fences.
 *   3. Find first `{` to last `}` and parse that substring.
 *   4. Line-by-line cleanup: strip non-JSON lines, join, parse.
 *   5. Partial field extraction into a minimal object.
 *
 * Returns the parsed object, or null if all strategies fail.
 */
export function extractJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim();

  // Strategy 1: direct parse
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // continue
  }

  // Strategy 2: ```json ... ``` fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // continue
    }
  }

  // Strategy 3: first { to last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    } catch {
      // continue
    }
  }

  // Strategy 4: line-by-line cleanup — keep only lines that look like JSON
  const jsonLines = text
    .split("\n")
    .filter(line => {
      const t = line.trim();
      return (
        t.startsWith("{") ||
        t.startsWith("}") ||
        t.startsWith('"') ||
        t.startsWith("[") ||
        t.startsWith("]") ||
        /^"[\w_]+"\s*:/.test(t)
      );
    })
    .join("\n");
  if (jsonLines) {
    try {
      return JSON.parse(jsonLines) as Record<string, unknown>;
    } catch {
      // continue
    }
  }

  // Strategy 5: extract partial fields via regex
  const partial: Record<string, unknown> = {};

  const actionMatch = text.match(/"action"\s*:\s*"([^"]+)"/);
  if (actionMatch?.[1]) partial["action"] = actionMatch[1];

  const targetLinesMatch = text.match(/"targetLines"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
  if (targetLinesMatch) partial["targetLines"] = [Number(targetLinesMatch[1]), Number(targetLinesMatch[2])];

  const descMatch = text.match(/"description"\s*:\s*"([^"]+)"/);
  if (descMatch?.[1]) partial["description"] = descMatch[1];

  const patternMatch = text.match(/"pattern"\s*:\s*"([^"]+)"/);
  if (patternMatch?.[1]) partial["pattern"] = patternMatch[1];

  const intentMatch = text.match(/"replacement_intent"\s*:\s*"([^"]+)"/);
  if (intentMatch?.[1]) partial["replacement_intent"] = intentMatch[1];

  const importsMatch = text.match(/"imports_needed"\s*:\s*\[(.*?)\]/s);
  if (importsMatch) {
    try {
      partial["imports_needed"] = JSON.parse(`[${importsMatch[1]}]`) as unknown[];
    } catch {
      partial["imports_needed"] = [];
    }
  }

  const confMatch = text.match(/"confidence"\s*:\s*([\d.]+)/);
  if (confMatch?.[1]) partial["confidence"] = Number(confMatch[1]);

  if (Object.keys(partial).length > 0) return partial;

  return null;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildSourceWindow(source: string, targetLine: number): { window: string; startLine: number; endLine: number } {
  const lines = source.split("\n");
  const startLine = Math.max(1, targetLine - CONTEXT_LINES);
  const endLine = Math.min(lines.length, targetLine + CONTEXT_LINES);

  const window = lines
    .slice(startLine - 1, endLine)
    .map((l, i) => `${startLine + i}: ${l}`)
    .join("\n");

  return { window, startLine, endLine };
}

function buildPrompt(finding: Finding, source: string, strictMode = false): string {
  const targetLine = finding.line ?? 1;
  const { window, startLine, endLine } = buildSourceWindow(source, targetLine);

  const strictSuffix = strictMode
    ? "\n\nIMPORTANT: Respond with ONLY valid JSON. No prose, no markdown, no explanation."
    : "";

  return `You are a code quality analyzer. Given a finding and the relevant source code, describe the fix as a structured JSON plan. Do NOT write code. Describe WHAT to change, not HOW.

FINDING:
Category: ${finding.category}
Rule: ${finding.subcategory}
Severity: ${finding.severity}
Description: ${finding.message}
Location: ${finding.file ?? "unknown"}:${targetLine}

SOURCE (lines ${startLine}-${endLine} of ${finding.file ?? "unknown"}):
\`\`\`
${window}
\`\`\`

Respond with ONLY this JSON (no prose, no explanation):
{
  "action": "insert" | "replace" | "delete" | "wrap",
  "targetLines": [startLine, endLine],
  "description": "Human-readable description of the change",
  "pattern": "The code pattern to look for (not exact text)",
  "replacement_intent": "What the replacement should accomplish",
  "imports_needed": ["module/path"] or [],
  "confidence": 0.0-1.0
}${strictSuffix}`;
}

// ---------------------------------------------------------------------------
// IntentPlanner
// ---------------------------------------------------------------------------

export interface IntentPlannerConfig {
  /** Override API key (defaults to OLLAMA_CLOUD_API_KEY env var) */
  apiKey?: string;
  /** Override model (defaults to nemotron-3-super:cloud) */
  model?: string;
  /** Max tokens for LLM response (default: 512) */
  maxTokens?: number;
}

export class IntentPlanner {
  private readonly provider: OllamaCloudProvider;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: IntentPlannerConfig = {}) {
    this.model = config.model ?? INTENT_MODEL;
    this.maxTokens = config.maxTokens ?? 512;
    this.provider = new OllamaCloudProvider({
      provider: "ollama-cloud",
      apiKey: config.apiKey,
      model: this.model,
    });
  }

  /**
   * Generate an intent plan for the given finding.
   *
   * @param finding  The scan finding to fix
   * @param source   Full source content of the file containing the finding
   * @returns        Validated IntentPlan, or null if generation/validation failed
   */
  async plan(finding: Finding, source: string): Promise<IntentPlan | null> {
    // --- First attempt ---
    const raw = await this._callLLM(finding, source, false);
    if (raw === null) return null;

    const extracted = extractJson(raw);
    if (extracted !== null) {
      const result = validateIntentPlan(extracted);
      if (result.success) return result.plan;
    }

    // --- Retry with strict mode ---
    const rawRetry = await this._callLLM(finding, source, true);
    if (rawRetry === null) return null;

    const extractedRetry = extractJson(rawRetry);
    if (extractedRetry === null) return null;

    const retryResult = validateIntentPlan(extractedRetry);
    return retryResult.success ? retryResult.plan : null;
  }

  private async _callLLM(finding: Finding, source: string, strictMode: boolean): Promise<string | null> {
    try {
      const prompt = buildPrompt(finding, source, strictMode);
      return await this.provider.sendMessage(prompt, {
        model: this.model,
        maxTokens: this.maxTokens,
        temperature: 0.1,
      });
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience function
// ---------------------------------------------------------------------------

/**
 * Generate an intent plan using a default-configured planner.
 * Reads API key from OLLAMA_CLOUD_API_KEY env var.
 */
export async function generateIntentPlan(
  finding: Finding,
  source: string,
  config?: IntentPlannerConfig
): Promise<IntentPlan | null> {
  const planner = new IntentPlanner(config);
  return planner.plan(finding, source);
}
