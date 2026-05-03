import type { ScanResult } from "../core/scanner";
import { STRUCTURAL_SUBCATEGORIES, LOCAL_SUBCATEGORIES, SEVERITY_WEIGHT } from "./taxonomy.js";

export interface ClickAllocation {
  architectClicks: number;
  surgicalClicks: number;
  reasoning: string;
}

/**
 * Dynamically allocate clicks between architect (structural) and surgical (local) phases.
 *
 * Logic:
 * - If structural issues > 40% of total weighted severity → architect gets 60%
 * - If structural issues > 25% → architect gets 40%
 * - Otherwise → architect gets 20%
 *
 * Always at least 1 architect click and 1 surgical click.
 */
export function allocateClicks(scan: ScanResult, totalClicks: number): ClickAllocation {
  if (totalClicks <= 0) {
    return { architectClicks: 0, surgicalClicks: 0, reasoning: "No clicks to allocate." };
  }

  if (totalClicks === 1) {
    return {
      architectClicks: 1,
      surgicalClicks: 0,
      reasoning: "Only 1 click — using architect for maximum structural impact.",
    };
  }

  let structuralWeight = 0;
  let localWeight = 0;
  let otherWeight = 0;

  for (const issue of scan.issuesByType ?? []) {
    const weight = SEVERITY_WEIGHT[issue.severity] ?? 1;
    const totalIssueWeight = weight * issue.count;

    if (STRUCTURAL_SUBCATEGORIES.has(issue.subcategory)) {
      structuralWeight += totalIssueWeight;
    } else if (LOCAL_SUBCATEGORIES.has(issue.subcategory)) {
      localWeight += totalIssueWeight;
    } else {
      // Unknown subcategory — split evenly
      structuralWeight += totalIssueWeight * 0.5;
      otherWeight += totalIssueWeight;
    }
  }

  const totalWeight = structuralWeight + localWeight + otherWeight;
  const structuralRatio = totalWeight > 0 ? structuralWeight / totalWeight : 0;

  let architectRatio: number;
  let rationale: string;

  if (structuralRatio > 0.4) {
    architectRatio = 0.6;
    rationale = `${Math.round(structuralRatio * 100)}% structural severity → architect-heavy (60%)`;
  } else if (structuralRatio > 0.25) {
    architectRatio = 0.4;
    rationale = `${Math.round(structuralRatio * 100)}% structural severity → balanced (40% architect)`;
  } else {
    architectRatio = 0.2;
    rationale = `${Math.round(structuralRatio * 100)}% structural severity → surgical-heavy (20% architect)`;
  }

  let architectClicks = Math.round(totalClicks * architectRatio);
  let surgicalClicks = totalClicks - architectClicks;

  // Enforce minimums: always at least 1 of each
  if (architectClicks < 1) {
    architectClicks = 1;
    surgicalClicks = totalClicks - 1;
  }
  if (surgicalClicks < 1) {
    surgicalClicks = 1;
    architectClicks = totalClicks - 1;
  }

  const reasoning =
    `${rationale}. ` +
    `Structural weight: ${structuralWeight.toFixed(0)}, Local weight: ${localWeight.toFixed(0)}, ` +
    `Total issues: ${scan.totalIssuesFound}. ` +
    `Allocating ${architectClicks} architect + ${surgicalClicks} surgical clicks.`;

  return { architectClicks, surgicalClicks, reasoning };
}
