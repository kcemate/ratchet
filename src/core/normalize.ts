/**
 * FindingNormalizer — bridge between engine outputs and the standard ScanResult.
 *
 * Both ClassicEngine and DeepEngine produce findings that are normalised into
 * a common ScanResult shape. This module provides the utilities for that
 * conversion, plus score-merging logic for hybrid classic+deep runs.
 */

import type { ScanResult, CategoryResult, SubCategory, IssueType } from "../core/scanner";
import { RULE_REGISTRY, getRuleBySubcategory } from "./finding-rules.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Finding {
  /**
   * Deterministic id: stable fingerprint of category+subcategory+file+line.
   * Populated by the normalizer — optional at creation time.
   */
  id?: string;
  /** Machine-readable rule identifier, e.g. 'SEC-001', 'TST-003'. */
  ruleId?: string;
  /** Ratchet category (Testing, Security, Type Safety, Error Handling, Performance, Code Quality). */
  category: string;
  /** Subcategory within the category (e.g. "Coverage ratio", "Secrets & env vars"). */
  subcategory: string;
  /** Severity of the finding. */
  severity: "critical" | "high" | "medium" | "low" | "info";
  /** File path where the finding was detected (optional). */
  file?: string;
  /** Line number within the file (optional). */
  line?: number;
  /** Human-readable description of the issue. */
  message: string;
  /** Confidence score 0–1 (1 = certain, 0.5 = uncertain). */
  confidence: number;
  /** Suggested fix for the finding (optional). */
  suggestion?: string;
  /** Which engine produced this finding. */
  source: "classic" | "deep";
  /** ID of the AST transform that can fix this finding, if one exists. */
  transformId?: string;
  /** How to fix this finding: ast = deterministic transform, intent = cheap LLM, manual = needs human. */
  fixStrategy?: "ast" | "intent" | "manual";
}

export interface NormalizedResult {
  findings: Finding[];
  /** The standard Ratchet score output derived from these findings. */
  scanResult: ScanResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable fingerprint of a finding — used as its id and as a dedup lookup key. */
function fingerprintFinding(f: Omit<Finding, "id" | "ruleId">): string {
  return `${f.category}::${f.subcategory}::${f.file ?? ""}::${f.line ?? 0}`;
}

/** Map finding severity → IssueType severity (3-level). */
function toIssueSeverity(s: Finding["severity"]): "high" | "medium" | "low" {
  if (s === "critical" || s === "high") return "high";
  if (s === "medium") return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// FindingDeduplicator
// ---------------------------------------------------------------------------

/**
 * Deduplicates findings from Classic + Deep that reference the same issue.
 *
 * Dedup key: category + subcategory + file + line range (±5 lines).
 * Tie-breaking: higher confidence wins; Deep wins on equal confidence.
 */
export class FindingDeduplicator {
  deduplicate(findings: Finding[]): Finding[] {
    // Map from a canonical key → the winning finding for that key.
    const slots = new Map<string, Finding>();

    for (const f of findings) {
      const matched = this._findSlot(slots, f);
      if (matched === null) {
        // No nearby duplicate — insert with its own fingerprint as slot key.
        slots.set(fingerprintFinding(f), { ...f, id: fingerprintFinding(f) });
      } else {
        const [slotKey, existing] = matched;
        const keep = this._pickWinner(existing, f);
        slots.set(slotKey, { ...keep, id: slotKey });
      }
    }

    return [...slots.values()];
  }

  private _findSlot(slots: Map<string, Finding>, candidate: Finding): [string, Finding] | null {
    for (const [key, existing] of slots) {
      if (
        existing.category === candidate.category &&
        existing.subcategory === candidate.subcategory &&
        existing.file === candidate.file &&
        Math.abs((existing.line ?? 0) - (candidate.line ?? 0)) <= 5
      ) {
        return [key, existing];
      }
    }
    return null;
  }

  private _pickWinner(a: Finding, b: Finding): Finding {
    if (b.confidence > a.confidence) return b;
    if (a.confidence > b.confidence) return a;
    // Equal confidence — prefer Deep (more semantic detail).
    return b.source === "deep" ? b : a;
  }
}

// ---------------------------------------------------------------------------
// FindingAggregator
// ---------------------------------------------------------------------------

/**
 * Groups findings by category and subcategory, then converts them into the
 * CategoryResult / SubCategory structures expected by ScanResult.
 *
 * Score calculation: each finding deducts from the subcategory's maxScore
 * based on severity (critical → zero out, high → 50 % of max per finding,
 * medium → 1 pt, low/info → 0.5 pt).
 */
export class FindingAggregator {
  aggregate(findings: Finding[]): {
    categories: CategoryResult[];
    totalIssuesFound: number;
    issuesByType: IssueType[];
  } {
    // Group findings by category → subcategory.
    type SubMap = Map<string, Finding[]>;
    const catMap = new Map<string, SubMap>();

    for (const f of findings) {
      if (!catMap.has(f.category)) catMap.set(f.category, new Map());
      const subMap = catMap.get(f.category)!;
      if (!subMap.has(f.subcategory)) subMap.set(f.subcategory, []);
      subMap.get(f.subcategory)!.push(f);
    }

    const CATEGORY_META: Record<string, { emoji: string; max: number }> = {
      Testing: { emoji: "🧪", max: 25 },
      Security: { emoji: "🔒", max: 15 },
      "Type Safety": { emoji: "📝", max: 15 },
      "Error Handling": { emoji: "⚠️ ", max: 20 },
      Performance: { emoji: "⚡", max: 10 },
      "Code Quality": { emoji: "📖", max: 15 },
    };

    const categories: CategoryResult[] = [];
    const issuesByType: IssueType[] = [];
    let totalIssuesFound = 0;

    for (const [catName, subMap] of catMap) {
      const meta = CATEGORY_META[catName] ?? { emoji: "📋", max: 0 };
      const subcategories: SubCategory[] = [];

      for (const [subName, subFindings] of subMap) {
        const rule = getRuleBySubcategory(catName, subName);
        const maxScore = rule?.maxScore ?? 0;
        const score = this._calculateScore(maxScore, subFindings);
        const issuesFound = subFindings.length;
        const summary = subFindings[0]?.message ?? "";

        subcategories.push({
          name: subName,
          score,
          max: maxScore,
          summary,
          issuesFound,
          issuesDescription: subFindings.map(f => f.message).join("; "),
          locations: subFindings.filter(f => f.file).map(f => (f.line != null ? `${f.file}:${f.line}` : f.file!)),
        });

        // Use the finding's own severity (not SEVERITY_MAP) so the normalizer
        // preserves the engine's assessment rather than overriding it.
        const severityForIssue = toIssueSeverity(subFindings[0]?.severity ?? "low");

        issuesByType.push({
          category: catName,
          subcategory: subName,
          count: issuesFound,
          description: subFindings.map(f => f.message).join("; "),
          severity: severityForIssue,
          locations: subFindings.filter(f => f.file).map(f => (f.line != null ? `${f.file}:${f.line}` : f.file!)),
        });

        totalIssuesFound += issuesFound;
      }

      const catScore = Math.min(
        subcategories.reduce((s, sc) => s + sc.score, 0),
        meta.max
      );

      categories.push({
        name: catName,
        emoji: meta.emoji,
        score: catScore,
        max: meta.max,
        summary: subcategories
          .map(sc => sc.summary)
          .filter(Boolean)
          .join(", "),
        subcategories,
      });
    }

    // Sort issuesByType: high → medium → low, then by count desc.
    const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    issuesByType.sort((a, b) => {
      const d = (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
      return d !== 0 ? d : b.count - a.count;
    });

    return { categories, totalIssuesFound, issuesByType };
  }

  private _calculateScore(maxScore: number, findings: Finding[]): number {
    let score = maxScore;
    for (const f of findings) {
      switch (f.severity) {
        case "critical":
          score = 0;
          break;
        case "high":
          score -= maxScore * 0.5;
          break;
        case "medium":
          score -= 1;
          break;
        case "low":
          score -= 0.5;
          break;
        case "info":
          score -= 0.25;
          break;
      }
    }
    return Math.max(0, Math.round(score));
  }
}

// ---------------------------------------------------------------------------
// normalizeFindings
// ---------------------------------------------------------------------------

const _deduplicator = new FindingDeduplicator();
const _aggregator = new FindingAggregator();

/**
 * Converts a flat list of Findings into a NormalizedResult with a ScanResult.
 *
 * Pipeline:
 *   1. Attach id + ruleId to every finding.
 *   2. Deduplicate (same category/subcategory/file/line ±5).
 *   3. Aggregate into CategoryResult[] with calculated scores.
 *   4. Build and return NormalizedResult.
 */
export function normalizeFindings(findings: Finding[], _specVersion?: string): NormalizedResult {
  // 1. Attach id + ruleId.
  const annotated = findings.map(f => {
    const rule = getRuleBySubcategory(f.category, f.subcategory);
    return {
      ...f,
      id: f.id ?? fingerprintFinding(f),
      ruleId: f.ruleId ?? rule?.id,
    };
  });

  // 2. Deduplicate.
  const deduped = _deduplicator.deduplicate(annotated);

  // 3. Aggregate.
  const { categories, totalIssuesFound, issuesByType } = _aggregator.aggregate(deduped);

  const total = categories.reduce((s, c) => s + c.score, 0);
  const maxTotal = categories.reduce((s, c) => s + c.max, 0);

  // 4. Build ScanResult.
  const scanResult: ScanResult = {
    projectName: "unknown",
    total,
    maxTotal,
    categories,
    totalIssuesFound,
    issuesByType,
  };

  return { findings: deduped, scanResult };
}

// ---------------------------------------------------------------------------
// mergeScores
// ---------------------------------------------------------------------------

/**
 * Merge a classic heuristic score with a deep LLM-derived score.
 *
 * Strategy (from architecture spec):
 *   - If the deep score differs from classic by more than 1 point, deep wins.
 *   - Otherwise, average the two scores.
 *
 * Rationale: deep analysis is more accurate for semantic issues (incomplete
 * error handling, meaningless tests) but may be noisier — so for near-equal
 * scores we blend rather than blindly override.
 */
export function mergeScores(classic: number, deep: number): number {
  if (Math.abs(deep - classic) > 1) return deep;
  return Math.round((classic + deep) / 2);
}

// ---------------------------------------------------------------------------
// mergeResults
// ---------------------------------------------------------------------------

/**
 * Merge two full ScanResults (Classic + Deep) into a single authoritative result.
 *
 * Per-subcategory scores use mergeScores(). Summaries prefer Deep when present.
 * Issues lists are combined and deduplicated by category+subcategory.
 */
export function mergeResults(classic: ScanResult, deep: ScanResult): ScanResult {
  const deepCatMap = new Map(deep.categories.map(c => [c.name, c]));

  const mergedCategories: CategoryResult[] = classic.categories.map(classicCat => {
    const deepCat = deepCatMap.get(classicCat.name);
    if (!deepCat) return classicCat;

    const deepSubMap = new Map(deepCat.subcategories.map(s => [s.name, s]));

    const mergedSubs: SubCategory[] = classicCat.subcategories.map(classicSub => {
      const deepSub = deepSubMap.get(classicSub.name);
      if (!deepSub) return classicSub;

      return {
        ...classicSub,
        score: mergeScores(classicSub.score, deepSub.score),
        summary: deepSub.summary && deepSub.summary.length > 0 ? deepSub.summary : classicSub.summary,
        issuesFound: Math.max(classicSub.issuesFound, deepSub.issuesFound),
        locations: [...(classicSub.locations ?? []), ...(deepSub.locations ?? [])].filter(
          (v, i, arr) => arr.indexOf(v) === i
        ), // unique
      };
    });

    const mergedScore = Math.min(
      mergedSubs.reduce((s, sc) => s + sc.score, 0),
      classicCat.max
    );

    return {
      ...classicCat,
      score: mergedScore,
      summary: deepCat.summary && deepCat.summary.length > 0 ? deepCat.summary : classicCat.summary,
      subcategories: mergedSubs,
    };
  });

  const total = mergedCategories.reduce((s, c) => s + c.score, 0);
  const maxTotal = mergedCategories.reduce((s, c) => s + c.max, 0);

  // Merge issuesByType: combine, deduplicate by category+subcategory keeping max count.
  const issueMap = new Map<string, IssueType>();
  for (const issue of [...classic.issuesByType, ...deep.issuesByType]) {
    const key = `${issue.category}::${issue.subcategory}`;
    const existing = issueMap.get(key);
    if (!existing || issue.count > existing.count) {
      issueMap.set(key, issue);
    }
  }

  const issuesByType = [...issueMap.values()];
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  issuesByType.sort((a, b) => {
    const d = (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
    return d !== 0 ? d : b.count - a.count;
  });

  const totalIssuesFound = issuesByType.reduce((s, i) => s + i.count, 0);

  return {
    projectName: classic.projectName,
    total,
    maxTotal,
    categories: mergedCategories,
    totalIssuesFound,
    issuesByType,
  };
}

// ---------------------------------------------------------------------------
// removeResolvedFindings
// ---------------------------------------------------------------------------

/**
 * Returns a copy of a Deep ScanResult with findings for changed files removed.
 *
 * Called after each click: files touched by the agent are assumed to have had
 * their Deep findings addressed (or superseded by the fresh Classic rescan).
 * Issue counts and scores for affected subcategories are scaled proportionally
 * based on how many of their known locations survive.
 *
 * Subcategories without location data are left unchanged — we have no way to
 * determine whether their issues were in the modified files.
 */
export function removeResolvedFindings(deepResult: ScanResult, changedFiles: string[]): ScanResult {
  if (changedFiles.length === 0) return deepResult;

  const changedSet = new Set(changedFiles);

  /** True if a "file:line" or "file" location string references a changed file. */
  function inChangedFile(location: string): boolean {
    const filePart = location.includes(":") ? location.split(":")[0]! : location;
    if (changedSet.has(filePart)) return true;
    // Handle absolute vs relative path mismatches (one ends with the other).
    for (const cf of changedSet) {
      if (filePart.endsWith(cf) || cf.endsWith(filePart)) return true;
    }
    return false;
  }

  const categories = deepResult.categories.map(cat => {
    const subcategories = cat.subcategories.map(sub => {
      const locs = sub.locations ?? [];
      if (locs.length === 0) return sub; // no location data — leave as-is

      const remainingLocs = locs.filter(loc => !inChangedFile(loc));
      if (remainingLocs.length === locs.length) return sub; // nothing changed

      const ratio = remainingLocs.length / locs.length;
      const newIssuesFound = Math.round(sub.issuesFound * ratio);
      // Proportionally restore the score: fewer issues → fewer deductions.
      const originalDeduction = sub.max - sub.score;
      const newScore = Math.min(sub.max, Math.round(sub.max - originalDeduction * ratio));

      return { ...sub, score: newScore, issuesFound: newIssuesFound, locations: remainingLocs };
    });

    const catScore = Math.min(
      subcategories.reduce((s, sc) => s + sc.score, 0),
      cat.max
    );

    return { ...cat, score: catScore, subcategories };
  });

  const total = categories.reduce((s, c) => s + c.score, 0);

  // Sync issuesByType counts with the updated subcategory data.
  const issuesByType = deepResult.issuesByType
    .map(issue => {
      const cat = categories.find(c => c.name === issue.category);
      const sub = cat?.subcategories.find(s => s.name === issue.subcategory);
      return sub != null ? { ...issue, count: sub.issuesFound } : issue;
    })
    .filter(i => i.count > 0);

  const totalIssuesFound = issuesByType.reduce((s, i) => s + i.count, 0);

  return { ...deepResult, total, categories, issuesByType, totalIssuesFound };
}

// ---------------------------------------------------------------------------
// Re-export rule utilities for consumers
// ---------------------------------------------------------------------------

export { RULE_REGISTRY, getRuleBySubcategory } from "./finding-rules.js";
