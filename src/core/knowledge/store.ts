/**
 * In-memory knowledge base store.
 *
 * All operations are pure functions — no side effects, no I/O.
 * The caller is responsible for constructing the KnowledgeBase from seed data.
 */

import type { KnowledgeBase, KnowledgeEntry, KnowledgeCategory, KnowledgeQuery, KnowledgeSeverity } from './types.js';

/**
 * Construct a KnowledgeBase from a flat list of entries.
 * Validates that all ids are unique.
 */
export function loadKnowledge(entries: KnowledgeEntry[]): KnowledgeBase {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`Duplicate knowledge entry id: ${entry.id}`);
    }
    seen.add(entry.id);
  }
  return { entries: [...entries] };
}

/**
 * Query the knowledge base by any combination of fields.
 * All non-undefined filters are ANDed together.
 * Text filter matches substring of pattern or description (case-insensitive).
 */
export function query(kb: KnowledgeBase, q: KnowledgeQuery): KnowledgeEntry[] {
  return kb.entries.filter(entry => {
    if (q.category !== undefined && entry.category !== q.category) return false;
    if (q.subcategory !== undefined && entry.subcategory !== q.subcategory) return false;
    if (q.severity !== undefined && entry.severity !== q.severity) return false;
    if (q.language !== undefined && entry.language !== q.language) return false;
    if (q.framework !== undefined && entry.framework !== q.framework) return false;
    if (q.text !== undefined) {
      const needle = q.text.toLowerCase();
      const haystack = `${entry.pattern} ${entry.description}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * Return all entries belonging to the given category.
 */
export function getByCategory(kb: KnowledgeBase, category: KnowledgeCategory): KnowledgeEntry[] {
  return kb.entries.filter(e => e.category === category);
}

/**
 * Return entries whose pattern contains the given substring (case-insensitive).
 */
export function getByPattern(kb: KnowledgeBase, pattern: string): KnowledgeEntry[] {
  const needle = pattern.toLowerCase();
  return kb.entries.filter(e => e.pattern.toLowerCase().includes(needle));
}

/**
 * Return all entries at or above the given severity.
 * Order: low < medium < high.
 */
export function getBySeverity(kb: KnowledgeBase, severity: KnowledgeSeverity): KnowledgeEntry[] {
  const rank: Record<KnowledgeSeverity, number> = { low: 0, medium: 1, high: 2 };
  const minRank = rank[severity];
  return kb.entries.filter(e => rank[e.severity] >= minRank);
}
