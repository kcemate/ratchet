/**
 * Score-aware click prioritizer.
 *
 * Instead of optimizing for "issues fixed" (severity × count × gap),
 * this module optimizes for "points gained per click" by understanding
 * the scoring tier boundaries in scan.ts.
 *
 * For each subcategory, it knows exactly how many issues need to be fixed
 * to cross the next tier threshold, how many points that gains, and how
 * hard the fix is. Then it ranks by points_available / estimated_effort.
 */

import type { ScanResult, CategoryResult } from '../commands/scan.js';
import type { IssueTask } from './issue-backlog.js';

// ─── Tier Definitions ────────────────────────────────────────────────────────
// Each tier: [maxIssueCount, scoreAtOrBelow]
// "If issue count <= maxIssueCount, you get this score."
// Derived directly from scan.ts scoring logic.

export interface TierStep {
  /** Maximum issue count to achieve this score */
  threshold: number;
  /** Score awarded when at or below threshold */
  score: number;
}

export interface SubcategoryTiers {
  name: string;
  maxScore: number;
  /** Tiers sorted from best (fewest issues) to worst. threshold = max count for that score. */
  tiers: TierStep[];
  /** Estimated effort per issue fix: 1=trivial (mechanical), 2=easy, 3=moderate, 5=hard */
  effortPerFix: number;
  /** Whether this can be swept (batch-fixed across files) */
  sweepable: boolean;
  /** Fix description template for agent prompts */
  fixInstruction: string;
}

/**
 * All subcategory tier definitions, derived from scan.ts.
 * The tier thresholds match the exact if/else chains in scan.ts scoring functions.
 */
export const SUBCATEGORY_TIERS: SubcategoryTiers[] = [
  // ── Error Handling ──
  {
    name: 'Structured logging',
    maxScore: 7,
    tiers: [
      // 7 = structured logger only (0 console errors)
      // 5 = structured logger + ≤5 console calls
      // 3 = structured logger + many console calls
      // 1 = console.error/warn only
      // 0 = nothing
      { threshold: 0, score: 7 },  // structured only
      { threshold: 5, score: 5 },  // logger + few console
      { threshold: 999, score: 3 }, // logger + many console
    ],
    effortPerFix: 2,
    sweepable: true,
    fixInstruction: 'Replace console.log/warn/error calls with the structured logger (import from src/core/logger.ts). Ensure logger is the ONLY error/log interface.',
  },
  {
    name: 'Empty catches',
    maxScore: 5,
    tiers: [
      { threshold: 0, score: 5 },
      { threshold: 1, score: 4.5 },
      { threshold: 2, score: 4 },
      { threshold: 3, score: 3 },
      { threshold: 5, score: 2 },
      { threshold: 8, score: 1 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 1,
    sweepable: true,
    fixInstruction: 'Add meaningful error handling to empty catch blocks. At minimum, log the error with the structured logger.',
  },
  {
    name: 'Coverage',
    maxScore: 8,
    tiers: [
      { threshold: 0, score: 8 },
      { threshold: 3, score: 7 },
      { threshold: 8, score: 6 },
      { threshold: 15, score: 5 },
      { threshold: 30, score: 4 },
      { threshold: 50, score: 3 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 3,
    sweepable: true,
    fixInstruction: 'Add try/catch error handling to async functions that lack it. Use structured logger for caught errors.',
  },

  // ── Performance ──
  {
    name: 'Console cleanup',
    maxScore: 5,
    tiers: [
      { threshold: 0, score: 5 },
      { threshold: 3, score: 4 },
      { threshold: 10, score: 3 },
      { threshold: 25, score: 2 },
      { threshold: 75, score: 1 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 1,
    sweepable: true,
    fixInstruction: 'Remove or replace console.log calls with the structured logger. For debug-only logs, remove entirely. For operational logs, use logger.info/debug.',
  },
  {
    name: 'Async patterns',
    maxScore: 3,
    tiers: [
      { threshold: 0, score: 5 },
      { threshold: 1, score: 4 },
      { threshold: 3, score: 3 },
      { threshold: 6, score: 2 },
      { threshold: 999, score: 1 },
    ],
    effortPerFix: 3,
    sweepable: false,
    fixInstruction: 'Refactor await-in-loop patterns to use Promise.all or batch operations instead of sequential awaits inside for/while loops.',
  },
  {
    name: 'Import hygiene',
    maxScore: 2,
    tiers: [
      { threshold: 0, score: 4 },
      { threshold: 2, score: 2 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 2,
    sweepable: false,
    fixInstruction: 'Fix self-imports and barrel file wildcard re-exports.',
  },

  // ── Code Quality ──
  {
    name: 'Line length',
    maxScore: 4,
    tiers: [
      { threshold: 0, score: 6 },
      { threshold: 5, score: 5 },
      { threshold: 15, score: 4 },
      { threshold: 50, score: 3 },
      { threshold: 150, score: 2 },
      { threshold: 500, score: 1 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 1,
    sweepable: true,
    fixInstruction: 'Break lines >120 characters. Use intermediate variables, multi-line function calls, or destructuring. Do NOT change logic, only formatting.',
  },
  {
    name: 'Dead code',
    maxScore: 4,
    tiers: [
      { threshold: 0, score: 6 },
      { threshold: 3, score: 5 },  // only TODOs, no commented code
      { threshold: 8, score: 4 },
      { threshold: 10, score: 2 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 1,
    sweepable: true,
    fixInstruction: 'Resolve or remove TODO comments and commented-out code blocks. Either implement the TODO or delete it with a brief explanation.',
  },
  {
    name: 'Duplication',
    maxScore: 3,
    tiers: [
      { threshold: 0, score: 6 },
      { threshold: 10, score: 5 },
      { threshold: 30, score: 4 },
      { threshold: 100, score: 3 },
      { threshold: 300, score: 2 },
      { threshold: 700, score: 1 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 5,
    sweepable: false,
    fixInstruction: 'Extract duplicated code into shared utility functions. Look for repeated patterns across files and consolidate into a common module.',
  },
  {
    name: 'Function length',
    maxScore: 4,
    tiers: [
      { threshold: 0, score: 4 },
      { threshold: 5, score: 3 },
      { threshold: 999, score: 2 },
    ],
    effortPerFix: 4,
    sweepable: false,
    fixInstruction: 'Split functions >50 lines into smaller, focused helper functions. Extract logical blocks into named functions.',
  },

  // ── Security ──
  {
    name: 'Auth & rate limiting',
    maxScore: 6,
    tiers: [
      { threshold: 0, score: 6 },
      { threshold: 1, score: 4 },
      { threshold: 3, score: 2 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 3,
    sweepable: false,
    fixInstruction: 'Add authentication middleware or rate limiting to unprotected routes/endpoints.',
  },
  {
    name: 'Input validation',
    maxScore: 6,
    tiers: [
      { threshold: 0, score: 6 },
      { threshold: 1, score: 4 },
      { threshold: 3, score: 2 },
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 3,
    sweepable: false,
    fixInstruction: 'Add input validation (e.g., zod schemas) to route handlers that accept user input.',
  },

  // ── Testing ──
  {
    name: 'Test quality',
    maxScore: 8,
    tiers: [
      // Assertions per test ratio thresholds
      { threshold: 0, score: 8 }, // ≥3.0 ratio
      { threshold: 1, score: 6 }, // ≥2.5
      { threshold: 2, score: 4 }, // ≥2.0
      { threshold: 3, score: 2 }, // ≥1.5
      { threshold: 999, score: 0 },
    ],
    effortPerFix: 2,
    sweepable: true,
    fixInstruction: 'Add more assertions to test cases. Each test should have at least 2-3 meaningful assertions checking different aspects of the behavior.',
  },
];

// ─── Tier Analysis ───────────────────────────────────────────────────────────

export interface TierGap {
  /** Subcategory name */
  subcategory: string;
  /** Current score */
  currentScore: number;
  /** Max possible score for this subcategory */
  maxScore: number;
  /** Points available (max - current) */
  pointsAvailable: number;
  /** Current issue count */
  currentCount: number;
  /** How many issues need fixing to reach next tier */
  issuesToNextTier: number;
  /** Points gained by reaching next tier */
  pointsAtNextTier: number;
  /** How many issues to fix for max score */
  issuesToMax: number;
  /** Points gained by reaching max */
  pointsAtMax: number;
  /** ROI: pointsAtNextTier / (issuesToNextTier * effortPerFix) */
  roi: number;
  /** Full ROI to max: pointsAvailable / (issuesToMax * effortPerFix) */
  roiToMax: number;
  /** Effort per fix (1-5 scale) */
  effortPerFix: number;
  /** Whether this is sweepable */
  sweepable: boolean;
  /** Fix instruction for agent */
  fixInstruction: string;
  /** Files affected (if available) */
  files: string[];
}

/**
 * Analyze a scan result and calculate the ROI of fixing each subcategory.
 * Returns gaps sorted by ROI (highest first) — i.e., the cheapest points.
 */
export function analyzeScoreGaps(scan: ScanResult): TierGap[] {
  const gaps: TierGap[] = [];

  for (const category of scan.categories) {
    for (const sub of category.subcategories) {
      const tierDef = SUBCATEGORY_TIERS.find(t => t.name === sub.name);
      if (!tierDef) continue;

      const currentScore = sub.score;
      const maxScore = sub.max;
      const pointsAvailable = maxScore - currentScore;

      // Already maxed out — skip
      if (pointsAvailable <= 0) continue;

      const currentCount = sub.issuesFound;

      // Find current tier and next tier
      let nextTierIssues = 0;
      let nextTierScore = currentScore;
      let maxTierIssues = 0;

      // Walk through tiers from best to worst to find:
      // 1. Next achievable tier (next score jump)
      // 2. Max tier (0 issues)
      const sortedTiers = [...tierDef.tiers].sort((a, b) => a.threshold - b.threshold);

      for (const tier of sortedTiers) {
        // Effective score after Math.min(score, maxScore) capping
        const effectiveScore = Math.min(tier.score, maxScore);
        if (effectiveScore > currentScore && currentCount > tier.threshold) {
          // This tier gives us more points and requires reducing issues below threshold
          if (nextTierScore === currentScore) {
            // First tier above current — this is the "next" tier
            nextTierIssues = currentCount - tier.threshold;
            nextTierScore = effectiveScore;
          }
        }
      }

      // Issues to max = current count (reduce to 0 for max score in most cases)
      // Find the threshold needed for max score
      const maxTier = sortedTiers.find(t => Math.min(t.score, maxScore) === maxScore);
      if (maxTier) {
        maxTierIssues = Math.max(0, currentCount - maxTier.threshold);
      }

      const pointsAtNextTier = nextTierScore - currentScore;
      const effortToNext = Math.max(1, nextTierIssues * tierDef.effortPerFix);
      const effortToMax = Math.max(1, maxTierIssues * tierDef.effortPerFix);

      // ROI = points gained / effort
      const roi = pointsAtNextTier / effortToNext;
      const roiToMax = pointsAvailable / effortToMax;

      // Get affected files from the scan issue list
      const issueEntry = scan.issuesByType?.find(
        i => i.subcategory === sub.name
      );
      const files = issueEntry?.locations ?? sub.locations ?? [];

      gaps.push({
        subcategory: sub.name,
        currentScore,
        maxScore,
        pointsAvailable,
        currentCount,
        issuesToNextTier: nextTierIssues,
        pointsAtNextTier,
        issuesToMax: maxTierIssues,
        pointsAtMax: pointsAvailable,
        roi,
        roiToMax,
        effortPerFix: tierDef.effortPerFix,
        sweepable: tierDef.sweepable,
        fixInstruction: tierDef.fixInstruction,
        files,
      });
    }
  }

  // Sort by ROI descending — cheapest points first
  gaps.sort((a, b) => b.roi - a.roi);

  return gaps;
}

/**
 * Convert tier gaps into prioritized IssueTask backlog items.
 * This replaces the old buildBacklog() priority calculation.
 *
 * Key difference: priority is based on ROI (points per effort unit),
 * not severity × count × gap_ratio. This means the engine will target
 * the changes that move the score most efficiently.
 */
export function buildScoreOptimizedBacklog(scan: ScanResult): IssueTask[] {
  const gaps = analyzeScoreGaps(scan);
  const tasks: IssueTask[] = [];

  for (const gap of gaps) {
    // Map effort to severity for display purposes
    const severity: 'high' | 'medium' | 'low' =
      gap.pointsAvailable >= 3 ? 'high' :
      gap.pointsAvailable >= 2 ? 'medium' : 'low';

    tasks.push({
      category: findCategoryForSubcategory(scan, gap.subcategory),
      subcategory: gap.subcategory,
      description: `${gap.fixInstruction} [ROI: ${gap.roi.toFixed(2)}, +${gap.pointsAtNextTier}pt next tier, +${gap.pointsAvailable}pt max]`,
      count: gap.currentCount,
      severity,
      priority: gap.roi * 100, // Scale up for comparison with old priority values
      sweepFiles: gap.files,
      architectPrompt: gap.sweepable ? undefined : buildArchitectPromptForGap(gap),
    });
  }

  return tasks;
}

/**
 * Build a focused architect prompt for a specific score gap.
 */
function buildArchitectPromptForGap(gap: TierGap): string {
  return [
    `SCORE OPTIMIZATION TARGET: ${gap.subcategory}`,
    `Current: ${gap.currentScore}/${gap.maxScore} (${gap.currentCount} issues)`,
    `Goal: Reduce to ${gap.currentCount - gap.issuesToNextTier} issues for +${gap.pointsAtNextTier} points`,
    `Max: Reduce to ${gap.currentCount - gap.issuesToMax} issues for +${gap.pointsAvailable} points`,
    '',
    `INSTRUCTION: ${gap.fixInstruction}`,
    '',
    gap.files.length > 0
      ? `FILES TO FIX:\n${gap.files.slice(0, 15).map(f => `  - ${f}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n');
}

function findCategoryForSubcategory(scan: ScanResult, subcategory: string): string {
  for (const cat of scan.categories) {
    for (const sub of cat.subcategories) {
      if (sub.name === subcategory) return cat.name;
    }
  }
  return 'Unknown';
}

/**
 * Generate a human-readable plan showing the optimal path to max score.
 */
export function generateScorePlan(scan: ScanResult): string {
  const gaps = analyzeScoreGaps(scan);
  if (gaps.length === 0) return '✅ Already at 100/100!';

  const totalPointsAvailable = gaps.reduce((sum, g) => sum + g.pointsAvailable, 0);
  const lines: string[] = [
    `📊 Score Optimization Plan: ${scan.total}/100 → ${scan.total + totalPointsAvailable}/100`,
    `   ${gaps.length} subcategories to improve, ${totalPointsAvailable} points available`,
    '',
    '   Priority (by ROI — cheapest points first):',
  ];

  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i]!;
    const tierInfo = g.issuesToNextTier > 0
      ? `fix ${g.issuesToNextTier} issues → +${g.pointsAtNextTier}pt`
      : `fix ${g.issuesToMax} issues → +${g.pointsAvailable}pt`;
    lines.push(
      `   ${i + 1}. ${g.subcategory} (${g.currentScore}/${g.maxScore}) — ${tierInfo} [ROI: ${g.roi.toFixed(2)}, effort: ${g.effortPerFix}/5${g.sweepable ? ', sweepable' : ''}]`
    );
  }

  return lines.join('\n');
}
