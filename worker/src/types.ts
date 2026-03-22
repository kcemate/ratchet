export type BadgeStyle = 'flat' | 'flat-square' | 'for-the-badge';

export type CategoryName =
  | 'testing'
  | 'security'
  | 'error-handling'
  | 'type-safety'
  | 'performance'
  | 'code-quality';

export const VALID_CATEGORIES: ReadonlySet<string> = new Set<CategoryName>([
  'testing',
  'security',
  'error-handling',
  'type-safety',
  'performance',
  'code-quality',
]);

export interface CategoryScore {
  score: number;
  max: number;
}

export interface ScanResult {
  owner: string;
  repo: string;
  branch: string;
  score: number;
  maxScore: number;
  categories: Record<CategoryName, CategoryScore>;
  timestamp: string;
}

export interface StoredScores {
  current: ScanResult;
  previous?: ScanResult;
}

export interface Env {
  RATCHET_SCORES: KVNamespace;
  API_KEY: string;
}
