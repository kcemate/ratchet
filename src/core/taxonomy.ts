/**
 * Single source of truth for issue subcategory taxonomy.
 *
 * All subcategory names, their structural/local classification, severity weights,
 * and category names are defined here. Other modules import from this file
 * instead of hardcoding their own lists.
 */

// ─── Subcategory type ────────────────────────────────────────────────────────

/**
 * All known issue subcategory names.
 * Keep this in sync with the scanner scorers in scan.ts.
 */
export const ALL_SUBCATEGORIES = [
  // Testing
  'Coverage ratio',
  'Edge case depth',
  'Test quality',
  // Security
  'Secrets & env vars',
  'Input validation',
  'Auth & rate limiting',
  // Type Safety
  'Strict config',
  'Any type count',
  // Error Handling
  'Coverage',
  'Empty catches',
  'Structured logging',
  // Performance
  'Async patterns',
  'Console cleanup',
  'Import hygiene',
  // Code Quality
  'Function length',
  'Line length',
  'Dead code',
  'Duplication',
] as const;

export type IssueSubcategory = (typeof ALL_SUBCATEGORIES)[number];

// ─── Structural vs Local classification ──────────────────────────────────────

/**
 * Structural issue subcategories — problems that require cross-cutting
 * refactoring (architect mode) rather than local fixes.
 */
const _STRUCTURAL: IssueSubcategory[] = [
  'Coverage ratio',    // structural gap in test architecture
  'Edge case depth',   // requires rethinking test strategy
  'Function length',   // decomposition is architectural
  'Dead code',         // often spans multiple modules
  'Duplication',       // cross-cutting by nature
];
export const STRUCTURAL_SUBCATEGORIES: ReadonlySet<string> = new Set(_STRUCTURAL);

/**
 * Local issue subcategories — surgical fixes that don't require
 * broad architectural changes.
 */
const _LOCAL: IssueSubcategory[] = [
  'Test quality',
  'Secrets & env vars',
  'Input validation',
  'Auth & rate limiting',
  'Strict config',
  'Any type count',
  'Coverage',          // Error Handling coverage — add try/catch locally
  'Empty catches',
  'Structured logging',
  'Async patterns',
  'Console cleanup',
  'Import hygiene',
  'Line length',
];
export const LOCAL_SUBCATEGORIES: ReadonlySet<string> = new Set(_LOCAL);

// ─── Compile-time exhaustiveness check ───────────────────────────────────────

// The _STRUCTURAL and _LOCAL arrays are typed as IssueSubcategory[], so only
// valid subcategory names can appear. The runtime check below ensures that
// together they cover ALL_SUBCATEGORIES with no gaps.

// Runtime exhaustiveness check (runs at import time)
const _allClassified: ReadonlySet<string> = new Set([
  ...STRUCTURAL_SUBCATEGORIES,
  ...LOCAL_SUBCATEGORIES,
]);
for (const sub of ALL_SUBCATEGORIES) {
  if (!_allClassified.has(sub)) {
    throw new Error(
      `Taxonomy error: subcategory "${sub}" is not classified as structural or local`,
    );
  }
}

// ─── Severity weights ────────────────────────────────────────────────────────

export const SEVERITY_WEIGHT: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// ─── Category names ──────────────────────────────────────────────────────────

export const CATEGORY_NAMES = [
  'Testing',
  'Security',
  'Type Safety',
  'Error Handling',
  'Performance',
  'Code Quality',
] as const;

export type IssueCategoryName = (typeof CATEGORY_NAMES)[number];
