/**
 * Intent Plan Schema — Zod validation for Layer 2 of the Autofix Engine v2.
 *
 * A plan describes WHAT to change, not HOW — no code generation.
 * Plans with confidence < 0.3 are rejected as too uncertain to apply safely.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const IntentPlanSchema = z.object({
  /** The kind of edit to make */
  action: z.enum(['insert', 'replace', 'delete', 'wrap']),

  /**
   * [startLine, endLine] — 1-based, inclusive.
   * For 'insert', startLine === endLine (insertion point).
   */
  targetLines: z
    .array(z.number().int().positive())
    .length(2)
    .refine(([start, end]) => end! >= start!, {
      message: 'targetLines[1] must be >= targetLines[0]',
    }),

  /** Human-readable summary of the change */
  description: z.string().min(1),

  /**
   * Code pattern to locate the target region (not exact text).
   * Used for fuzzy matching in the Smart Applier.
   */
  pattern: z.string().min(1),

  /** What the replacement should accomplish (intent, not code) */
  replacement_intent: z.string().min(1),

  /** Import paths that must be present after the fix */
  imports_needed: z.array(z.string()),

  /**
   * Planner confidence in this plan (0.0–1.0).
   * Plans below 0.3 are rejected as too uncertain.
   */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .refine((v) => v >= 0.3, {
      message: 'Plan confidence too low (< 0.3) — rejecting as unsafe',
    }),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentPlan = z.infer<typeof IntentPlanSchema>;

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

export interface ValidationResult {
  success: true;
  plan: IntentPlan;
}

export interface ValidationFailure {
  success: false;
  error: string;
}

/**
 * Validate a raw (unknown) object against the IntentPlan schema.
 * Returns null-safe result — never throws.
 */
export function validateIntentPlan(raw: unknown): ValidationResult | ValidationFailure {
  try {
    const plan = IntentPlanSchema.parse(raw);
    return { success: true, plan };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
