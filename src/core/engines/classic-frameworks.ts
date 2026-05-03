import type { CategoryResult } from "../../core/scanner";
import { adjustScoreForFrameworks } from "../framework-profiles.js";
import type { Framework } from "../framework-detector.js";

export type ScoringCategory =
  | "Testing"
  | "Security"
  | "Type Safety"
  | "Error Handling"
  | "Performance"
  | "Code Quality";

export function applyFrameworkAdjustments(categories: CategoryResult[], frameworks: Framework[]): CategoryResult[] {
  return categories.map(cat => {
    let adjustedScore = cat.score;

    // Adjust score based on detected frameworks
    if (frameworks.length > 0) {
      adjustedScore = adjustScoreForFrameworks(frameworks, cat.name as ScoringCategory, cat.score);
    }

    // If no adjustment, keep original score
    return {
      ...cat,
      score: Math.round(adjustedScore),
      summary: [
        cat.summary,
        frameworks.length > 0 ? `(Framework adjustment: ${frameworks.map(f => f.name).join(", ")})` : undefined,
      ]
        .filter(Boolean)
        .join(", "),
    };
  });
}
