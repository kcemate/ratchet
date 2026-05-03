import type { ClickGuards } from "../types.js";
import { GUARD_PROFILES } from "../types.js";
import type { IssueTask } from "./issue-backlog.js";
import type { FixabilityScore } from "./fixability.js";

/** Config files that indicate high-risk changes (structural impact). */
const HIGH_RISK_CONFIG_PATTERNS = [
  "tsconfig",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".eslintrc",
  ".babelrc",
  "webpack.config",
  "vite.config",
  "rollup.config",
  "jest.config",
  "vitest.config",
];

/** Patterns that indicate import/formatting-only tasks (low risk). */
const LOW_RISK_IMPORT_PATTERNS = [
  /^import[/ ]/i,
  /formatting/i,
  /whitespace/i,
  /trailing[\s-]space/i,
  /unused[\s-]import/i,
  /sort[\s-]import/i,
  /lint/i,
  /prettier/i,
  /eslint[\s-]fix/i,
];

/**
 * Classify the risk level of an IssueTask using pattern-based heuristics.
 *
 * Risk classification:
 *   - 'low'  → test-only tasks, import/formatting tasks
 *   - 'high' → many files (>5), config files, cross-cutting tasks
 *   - 'medium' → everything else
 *
 * Inspired by Claude Code's 9,409-line safety classifier — a simpler version
 * that covers the most impactful cases with minimal complexity.
 */
export function classifyRisk(task: IssueTask): "low" | "medium" | "high" {
  const fileCount = task.sweepFiles?.length ?? 1;
  const subcategory = (task.subcategory ?? "").toLowerCase();
  const description = (task.description ?? "").toLowerCase();
  const files = task.sweepFiles ?? [];

  // HIGH: cross-cutting fix mode indicates structural changes
  if (task.fixMode === "architect") {
    return "high";
  }

  // HIGH: many files (>5 files touched = high blast radius)
  if (fileCount > 5) {
    return "high";
  }

  // HIGH: any config files touched
  const touchesConfig = files.some(f => HIGH_RISK_CONFIG_PATTERNS.some(pattern => f.toLowerCase().includes(pattern)));
  if (touchesConfig) {
    return "high";
  }

  // LOW: task only touches test files
  const allTestFiles =
    files.length > 0 &&
    files.every(f => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__") || f.includes("/test/"));
  if (allTestFiles) {
    return "low";
  }

  // LOW: subcategory or description suggests import/formatting only
  const isLowRiskByPattern = LOW_RISK_IMPORT_PATTERNS.some(
    pattern => pattern.test(subcategory) || pattern.test(description)
  );
  if (isLowRiskByPattern) {
    return "low";
  }

  return "medium";
}

export interface GuardSelection {
  guards: ClickGuards | null;
  profileName: string;
  reason: string;
}

/** New profile for api-agent sweep: slightly wider than tight but not full refactor */
const API_SWEEP_GUARDS: ClickGuards = { maxFilesChanged: 3, maxLinesChanged: 60 };

/** Subcategories where test creation is cross-cutting — always at least refactor guards */
const TEST_SUBCATEGORIES = ["Coverage ratio", "Test quality"];

/**
 * Select click guards for a task based on fixability recommendation and fix mode.
 *
 * Lookup table:
 *   api-agent  + torque → tight     (3 files / 40 lines)
 *   api-agent  + sweep  → api-sweep (3 files / 60 lines)
 *   shell-agent + torque → refactor (12 files / 280 lines)
 *   shell-agent + sweep  → broad    (20 files / 500 lines)
 *   architect            → broad    (20 files / 500 lines)
 *   skip                 → tight    (safe default)
 *   Coverage ratio / Test quality subcategory → refactor minimum (cross-cutting)
 *   No fixability provided → fall back to mode-based defaults (mirrors resolveGuards)
 */
export function selectGuards(task: IssueTask, fixability?: FixabilityScore): GuardSelection {
  // No fixability — fall back to mode-based defaults (mirrors resolveGuards behaviour)
  if (!fixability) {
    if (task.fixMode === "architect") {
      return {
        guards: GUARD_PROFILES.broad,
        profileName: "broad",
        reason: "no fixability — architect mode default",
      };
    }
    if (task.fixMode === "sweep") {
      return {
        guards: GUARD_PROFILES.sweep,
        profileName: "sweep",
        reason: "no fixability — sweep mode default",
      };
    }
    return {
      guards: GUARD_PROFILES.tight,
      profileName: "tight",
      reason: "no fixability — torque mode default",
    };
  }

  // Test subcategories are cross-cutting — always use at least refactor guards
  if (TEST_SUBCATEGORIES.includes(task.subcategory)) {
    return {
      guards: GUARD_PROFILES.refactor,
      profileName: "refactor",
      reason: `test subcategory (${task.subcategory}) — cross-cutting, elevated to refactor`,
    };
  }

  const { recommendation } = fixability;
  const fixMode = task.fixMode;

  // Apply risk-based guard adjustment from classifyRisk()
  const risk = classifyRisk(task);

  switch (recommendation) {
    case "api-agent":
      if (fixMode === "sweep") {
        // High risk: tighten sweep guards back to tight
        if (risk === "high") {
          return {
            guards: GUARD_PROFILES.tight,
            profileName: "tight",
            reason: "api-agent + sweep + high risk → tight (config/cross-cutting detected)",
          };
        }
        return {
          guards: API_SWEEP_GUARDS,
          profileName: "api-sweep",
          reason: "api-agent + sweep → api-sweep (3 files / 60 lines)",
        };
      }
      // Low risk: loosen to api-sweep for faster iteration
      if (risk === "low") {
        return {
          guards: API_SWEEP_GUARDS,
          profileName: "api-sweep",
          reason: "api-agent + torque + low risk → api-sweep (test/formatting only)",
        };
      }
      return {
        guards: GUARD_PROFILES.tight,
        profileName: "tight",
        reason: "api-agent + torque → tight (3 files / 40 lines)",
      };

    case "shell-agent":
      if (fixMode === "sweep") {
        // High risk: tighten broad → refactor
        if (risk === "high") {
          return {
            guards: GUARD_PROFILES.refactor,
            profileName: "refactor",
            reason: "shell-agent + sweep + high risk → refactor (config/cross-cutting detected)",
          };
        }
        return {
          guards: GUARD_PROFILES.broad,
          profileName: "broad",
          reason: "shell-agent + sweep → broad (20 files / 500 lines)",
        };
      }
      // High risk: tighten refactor → tight
      if (risk === "high") {
        return {
          guards: GUARD_PROFILES.tight,
          profileName: "tight",
          reason: "shell-agent + torque + high risk → tight (config/cross-cutting detected)",
        };
      }
      // Low risk: loosen refactor → broad
      if (risk === "low") {
        return {
          guards: GUARD_PROFILES.broad,
          profileName: "broad",
          reason: "shell-agent + torque + low risk → broad (test/formatting only)",
        };
      }
      return {
        guards: GUARD_PROFILES.refactor,
        profileName: "refactor",
        reason: "shell-agent + torque → refactor (12 files / 280 lines)",
      };

    case "architect":
      return {
        guards: GUARD_PROFILES.broad,
        profileName: "broad",
        reason: "architect recommendation → broad (20 files / 500 lines)",
      };

    case "skip":
    default:
      return {
        guards: GUARD_PROFILES.tight,
        profileName: "tight",
        reason: "skip recommendation → tight (safe default, 3 files / 40 lines)",
      };
  }
}
