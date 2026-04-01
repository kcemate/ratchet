import type { ScanResult, IssueType } from '../commands/scan.js';
import type { ClickGuards } from '../types.js';

export interface IssueClassification {
  category: string;
  subcategory: string;
  hitCount: number;
  fileCount: number;
  type: 'single-file' | 'cross-cutting' | 'architectural';
  files: string[];
  recommendation?: string;
}

export interface ClassificationSummary {
  crossCutting: IssueClassification[];
  architectural: IssueClassification[];
  singleFile: IssueClassification[];
  hasAnyCrossCutting: boolean;
  recommendedCommand: string;
}

// Subcategories that inherently require architectural changes when cross-cutting
const ARCHITECTURAL_SUBCATEGORIES = new Set([
  'Structured logging',
  'Duplication',
  'Strict config',
]);

function uniqueFiles(locations: string[]): string[] {
  return [...new Set(
    locations.map(f => (f.includes(':') ? f.split(':')[0]! : f)),
  )];
}

function classifyOne(issue: IssueType, guards: ClickGuards): IssueClassification {
  const files = uniqueFiles(issue.locations ?? []);
  const fileCount = files.length;

  const isCrossCutting = fileCount > guards.maxFilesChanged;

  let type: 'single-file' | 'cross-cutting' | 'architectural';
  let recommendation: string | undefined;

  if (!isCrossCutting) {
    type = 'single-file';
  } else if (ARCHITECTURAL_SUBCATEGORIES.has(issue.subcategory)) {
    type = 'architectural';
    if (issue.subcategory === 'Structured logging') {
      recommendation = 'needs --guards refactor or --architect';
    } else if (issue.subcategory === 'Duplication') {
      recommendation = 'needs extract-then-propagate plan';
    } else {
      recommendation = 'needs --architect';
    }
  } else {
    type = 'cross-cutting';
    recommendation = 'needs --guards refactor or --architect';
  }

  return {
    category: issue.category,
    subcategory: issue.subcategory,
    hitCount: issue.count,
    fileCount,
    type,
    files,
    recommendation,
  };
}

export function classifyIssues(scanResult: ScanResult, guards: ClickGuards): IssueClassification[] {
  return scanResult.issuesByType
    .filter(issue => issue.count > 0)
    .map(issue => classifyOne(issue, guards));
}

export function summarizeClassifications(classifications: IssueClassification[]): ClassificationSummary {
  const crossCutting = classifications.filter(c => c.type === 'cross-cutting');
  const architectural = classifications.filter(c => c.type === 'architectural');
  const singleFile = classifications.filter(c => c.type === 'single-file');
  const hasAnyCrossCutting = crossCutting.length > 0 || architectural.length > 0;

  const recommendedCommand = hasAnyCrossCutting
    ? 'ratchet torque --plan-first --guards refactor -c 5'
    : 'ratchet torque -c 5';

  return { crossCutting, architectural, singleFile, hasAnyCrossCutting, recommendedCommand };
}
