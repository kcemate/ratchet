/**
 * Rule Registry — maps every ClassicEngine subcategory to a machine-readable ruleId.
 *
 * Used by the Finding Normalization Layer to attach ruleId to findings and to look
 * up maxScore when aggregating findings into CategoryResult structures.
 */

export interface RuleDefinition {
  id: string;
  category: string;
  subcategory: string;
  /** Maximum score this subcategory contributes. */
  maxScore: number;
  description: string;
}

export const RULE_REGISTRY: Record<string, RuleDefinition> = {
  // ── Testing (25 pts) ──────────────────────────────────────────────────────
  'TST-001': {
    id: 'TST-001',
    category: 'Testing',
    subcategory: 'Coverage ratio',
    maxScore: 8,
    description: 'Test file to source file ratio',
  },
  'TST-002': {
    id: 'TST-002',
    category: 'Testing',
    subcategory: 'Edge case depth',
    maxScore: 9,
    description: 'Edge case and error path test coverage',
  },
  'TST-003': {
    id: 'TST-003',
    category: 'Testing',
    subcategory: 'Test quality',
    maxScore: 8,
    description: 'Assertion density and test structure',
  },

  // ── Security (15 pts) ────────────────────────────────────────────────────
  'SEC-001': {
    id: 'SEC-001',
    category: 'Security',
    subcategory: 'Secrets & env vars',
    maxScore: 3,
    description: 'Hardcoded secrets detection',
  },
  'SEC-002': {
    id: 'SEC-002',
    category: 'Security',
    subcategory: 'Input validation',
    maxScore: 6,
    description: 'Input validation coverage',
  },
  'SEC-003': {
    id: 'SEC-003',
    category: 'Security',
    subcategory: 'Auth & rate limiting',
    maxScore: 6,
    description: 'Authentication and rate limiting',
  },

  // ── Type Safety (15 pts) ─────────────────────────────────────────────────
  'TYP-001': {
    id: 'TYP-001',
    category: 'Type Safety',
    subcategory: 'Strict config',
    maxScore: 7,
    description: 'Strict TypeScript / type checker configuration',
  },
  'TYP-002': {
    id: 'TYP-002',
    category: 'Type Safety',
    subcategory: 'Any type count',
    maxScore: 8,
    description: 'Density of any / interface{} / Any type usage',
  },

  // ── Error Handling (20 pts) ──────────────────────────────────────────────
  'EH-001': {
    id: 'EH-001',
    category: 'Error Handling',
    subcategory: 'Coverage',
    maxScore: 8,
    description: 'Try/catch coverage relative to async functions',
  },
  'EH-002': {
    id: 'EH-002',
    category: 'Error Handling',
    subcategory: 'Empty catches',
    maxScore: 5,
    description: 'Empty catch blocks / silently swallowed errors',
  },
  'EH-003': {
    id: 'EH-003',
    category: 'Error Handling',
    subcategory: 'Structured logging',
    maxScore: 7,
    description: 'Structured logger usage vs raw console calls',
  },

  // ── Performance (10 pts) ─────────────────────────────────────────────────
  'PRF-001': {
    id: 'PRF-001',
    category: 'Performance',
    subcategory: 'Async patterns',
    maxScore: 3,
    description: 'Await-in-loop anti-pattern detection',
  },
  'PRF-002': {
    id: 'PRF-002',
    category: 'Performance',
    subcategory: 'Console cleanup',
    maxScore: 5,
    description: 'Debug console.log / print statements in production code',
  },
  'PRF-003': {
    id: 'PRF-003',
    category: 'Performance',
    subcategory: 'Import hygiene',
    maxScore: 2,
    description: 'Self-referential imports and barrel re-export sprawl',
  },

  // ── Code Quality (15 pts) ────────────────────────────────────────────────
  'CQ-001': {
    id: 'CQ-001',
    category: 'Code Quality',
    subcategory: 'Function length',
    maxScore: 4,
    description: 'Average function length and complexity',
  },
  'CQ-002': {
    id: 'CQ-002',
    category: 'Code Quality',
    subcategory: 'Line length',
    maxScore: 4,
    description: 'Lines exceeding 120 characters',
  },
  'CQ-003': {
    id: 'CQ-003',
    category: 'Code Quality',
    subcategory: 'Dead code',
    maxScore: 4,
    description: 'Commented-out code and TODO/FIXME markers',
  },
  'CQ-004': {
    id: 'CQ-004',
    category: 'Code Quality',
    subcategory: 'Duplication',
    maxScore: 3,
    description: 'Repeated identical code lines across source files',
  },
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Reverse-lookup: (category, subcategory) → RuleDefinition. */
const _subkeyToRule = new Map<string, RuleDefinition>(
  Object.values(RULE_REGISTRY).map(r => [`${r.category}::${r.subcategory}`, r]),
);

export function getRuleBySubcategory(
  category: string,
  subcategory: string,
): RuleDefinition | undefined {
  return _subkeyToRule.get(`${category}::${subcategory}`);
}

/** All unique categories in declaration order (deduped). */
export const RULE_CATEGORIES: string[] = [...new Set(
  Object.values(RULE_REGISTRY).map(r => r.category),
)];
