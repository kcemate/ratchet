/**
 * Deep Engine response parser.
 *
 * Converts raw LLM text responses into typed Finding[] arrays.
 * Handles markdown code fences, validates required fields, and
 * infers the category field from the ruleId using RULE_REGISTRY.
 */

import type { Finding } from '../normalize.js';
import { RULE_REGISTRY } from '../finding-rules.js';
import { logger } from '../../lib/logger.js';
import type { Category } from './deep-prompts.js';

// ---------------------------------------------------------------------------
// Raw shape returned by the LLM (before validation)
// ---------------------------------------------------------------------------

interface RawFinding {
  ruleId?: unknown;
  subcategory?: unknown;
  severity?: unknown;
  file?: unknown;
  line?: unknown;
  message?: unknown;
  confidence?: unknown;
  suggestion?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract JSON array text from an LLM response using a multi-strategy fallback chain.
 *
 * Strategy order:
 *   1. Direct JSON.parse — response is already valid JSON
 *   2. Extract from ```json ... ``` or ``` ... ``` fenced blocks
 *   3. Find the first [ ... ] bracket pair in the response
 *   4. Extract individual JSON objects {...} from prose and wrap in array
 *   5. Return raw text (will fail at JSON.parse, caught by caller)
 */
function extractJson(response: string): string {
  const trimmed = response.trim();

  // Strategy 1: Already valid JSON (common for well-behaved models like Kimi)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch { /* fall through */ }
  }

  // Strategy 2: Extract from markdown code fences
  // Try all fenced blocks, pick the one that parses as JSON
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(response)) !== null) {
    const candidate = fenceMatch[1]?.trim();
    if (candidate) {
      try {
        JSON.parse(candidate);
        return candidate;
      } catch { /* try next fence */ }
    }
  }

  // Strategy 3: Bracket extraction — find outermost [ ... ]
  const arrayStart = response.indexOf('[');
  const arrayEnd = response.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const candidate = response.slice(arrayStart, arrayEnd + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch { /* fall through */ }
  }

  // Strategy 4: Extract individual JSON objects from prose
  // Models like GLM-5 embed valid JSON objects in reasoning text
  const objectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  const objects: string[] = [];
  let objMatch: RegExpExecArray | null;
  while ((objMatch = objectRegex.exec(response)) !== null) {
    const candidate = objMatch[0];
    try {
      const parsed = JSON.parse(candidate);
      // Must look like a finding (has message or ruleId)
      if (parsed && typeof parsed === 'object' && (parsed.message || parsed.ruleId)) {
        objects.push(candidate);
      }
    } catch { /* skip non-JSON matches */ }
  }
  if (objects.length > 0) {
    return `[${objects.join(',')}]`;
  }

  // Strategy 5: Return raw (will fail at parse, caller handles gracefully)
  return trimmed;
}

const VALID_SEVERITIES = new Set<string>(['critical', 'high', 'medium', 'low', 'info']);

function isValidSeverity(s: unknown): s is Finding['severity'] {
  return typeof s === 'string' && VALID_SEVERITIES.has(s);
}

/**
 * Infer the Ratchet category for a finding.
 *
 * Priority:
 *   1. Lookup ruleId in RULE_REGISTRY.
 *   2. Fall back to the prompt category.
 */
function inferCategory(ruleId: string | undefined, fallback: Category): string {
  if (ruleId && RULE_REGISTRY[ruleId]) {
    return RULE_REGISTRY[ruleId]!.category;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse an LLM response string into Finding[].
 *
 * @param response   Raw text from the LLM (may contain markdown code fences).
 * @param category   The category this prompt was asking about (used as fallback
 *                   when the ruleId cannot be resolved from RULE_REGISTRY).
 * @returns          Validated findings with source:'deep' set. Returns [] on
 *                   any parse error — never throws.
 */
export function parseDeepFindings(response: string, category: Category): Finding[] {
  const jsonText = extractJson(response);

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    logger.warn({ err, preview: jsonText.slice(0, 200) }, 'DeepEngine: failed to parse LLM JSON response');
    return [];
  }

  if (!Array.isArray(raw)) {
    logger.warn({ preview: jsonText.slice(0, 200) }, 'DeepEngine: LLM response was not a JSON array');
    return [];
  }

  const findings: Finding[] = [];

  for (const item of raw as RawFinding[]) {
    // Required: message
    if (typeof item.message !== 'string' || !item.message.trim()) {
      logger.debug({ item }, 'DeepEngine: skipping finding with missing message');
      continue;
    }

    // Required: subcategory
    if (typeof item.subcategory !== 'string' || !item.subcategory.trim()) {
      logger.debug({ item }, 'DeepEngine: skipping finding with missing subcategory');
      continue;
    }

    // severity — default to 'medium' if missing/invalid
    const severity: Finding['severity'] = isValidSeverity(item.severity) ? item.severity : 'medium';

    // ruleId — optional but useful
    const ruleId = typeof item.ruleId === 'string' ? item.ruleId : undefined;

    // category — infer from ruleId or fall back to the prompt category
    const resolvedCategory = inferCategory(ruleId, category);

    // file — optional
    const file = typeof item.file === 'string' && item.file.trim() ? item.file.trim() : undefined;

    // line — optional integer
    let line: number | undefined;
    if (typeof item.line === 'number' && Number.isInteger(item.line) && item.line > 0) {
      line = item.line;
    } else if (typeof item.line === 'string') {
      const parsed = parseInt(item.line, 10);
      if (!isNaN(parsed) && parsed > 0) line = parsed;
    }

    // confidence — clamp to [0, 1]
    let confidence = 0.8; // reasonable default
    if (typeof item.confidence === 'number' && isFinite(item.confidence)) {
      confidence = Math.max(0, Math.min(1, item.confidence));
    }

    // suggestion — optional
    const suggestion = typeof item.suggestion === 'string' && item.suggestion.trim()
      ? item.suggestion.trim()
      : undefined;

    findings.push({
      ruleId,
      category: resolvedCategory,
      subcategory: item.subcategory.trim(),
      severity,
      file,
      line,
      message: item.message.trim(),
      confidence,
      suggestion,
      source: 'deep',
    });
  }

  return findings;
}
