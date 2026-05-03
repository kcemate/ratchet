import type { Target, RatchetConfig, ClickGuards } from "../types.js";
import { GUARD_PROFILES } from "../types.js";

/** Guard profile escalation chain: tight → refactor → broad → atomic */
export const GUARD_ESCALATION_ORDER: Array<import("../types.js").GuardProfileName> = [
  "tight",
  "refactor",
  "broad",
  "atomic",
];

/**
 * Given the current resolved guards, return the next level up in the escalation chain.
 * Returns null if already at atomic or if guards can't be matched to a known profile.
 */
export function nextGuardProfile(
  current: ClickGuards | null
): { name: import("../types.js").GuardProfileName; guards: ClickGuards | null } | null {
  if (current === null) return null; // already atomic
  // Match current guards to a known profile
  const currentIdx = GUARD_ESCALATION_ORDER.findIndex(name => {
    const profile = GUARD_PROFILES[name];
    if (profile === null && current === null) return true;
    if (profile === null || current === null) return false;
    return profile.maxFilesChanged === current.maxFilesChanged && profile.maxLinesChanged === current.maxLinesChanged;
  });
  if (currentIdx === -1 || currentIdx >= GUARD_ESCALATION_ORDER.length - 1) return null;
  const nextName = GUARD_ESCALATION_ORDER[currentIdx + 1];
  return { name: nextName, guards: GUARD_PROFILES[nextName] };
}

/** Detect guard-rejection rollbacks from click rollbackReason */
export function isGuardRejection(reason?: string): boolean {
  if (!reason) return false;
  return (
    reason.startsWith("Too many lines changed:") ||
    reason.startsWith("Too many files changed:") ||
    reason.startsWith("Single file changed too many lines")
  );
}

/**
 * Resolve click guards for a run.
 * Priority: config.guards (set by CLI) > target.guards > focusCategory auto-elevate > mode defaults.
 * Returns null for atomic (no limits).
 */
export function resolveGuards(
  target: Target,
  config: Pick<RatchetConfig, "guards">,
  mode: "normal" | "sweep" | "architect",
  focusCategory?: string
): ClickGuards | null {
  // config.guards is set by CLI (highest priority)
  const source = config.guards !== undefined ? config.guards : target.guards;
  if (source !== undefined) {
    if (source === null) return null;
    if (typeof source === "string") return GUARD_PROFILES[source];
    return source;
  }
  // Auto-elevate to refactor (12 files / 280 lines) for testing — test creation is cross-cutting
  if (focusCategory === "testing") return GUARD_PROFILES.refactor;
  // Mode defaults
  if (mode === "architect") return GUARD_PROFILES.broad;
  if (mode === "sweep") return GUARD_PROFILES.sweep;
  return GUARD_PROFILES.tight;
}
