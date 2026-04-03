import type { SupportedLanguage } from '../../core/language-rules.js';

export interface CategoryThreshold {
  categoryName: string;
  threshold: number;
  max: number;
}

export interface GateResult {
  passed: boolean;
  failedCategories: Array<{ name: string; score: number; threshold: number }>;
  totalScore: number;
  totalThreshold: number | null;
}

export interface SubCategory {
  name: string;
  score: number;
  max: number;
  summary: string;
  issuesFound: number;
  issuesDescription?: string;
  locations?: string[];
}

export interface CategoryResult {
  name: string;
  emoji: string;
  score: number;
  max: number;
  summary: string;
  subcategories: SubCategory[];
}

export interface IssueType {
  category: string;
  subcategory: string;
  count: number;
  description: string;
  severity: 'low' | 'medium' | 'high';
  locations?: string[];
}

export interface ScanResult {
  projectName: string;
  total: number;
  maxTotal: number;
  categories: CategoryResult[];
  totalIssuesFound: number;
  issuesByType: IssueType[];
}

export interface Baseline {
  score: number;
  categories: Record<string, number>;
  issues: number;
  savedAt: string;
  version: string;
}

export interface RunScanOptions {
  includeTests?: boolean;
  files?: string[];
  /** Include non-production directories (scripts/, migrations/, seed/, etc.) in scoring. */
  includeNonProduction?: boolean;
  /** Language to use for scoring. Defaults to auto-detection from project files. */
  lang?: SupportedLanguage;
}