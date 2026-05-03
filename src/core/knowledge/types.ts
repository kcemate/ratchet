/**
 * Type definitions for the LLM Knowledge Base.
 *
 * Entries map Ratchet's six scoring categories to actionable patterns,
 * examples, and anti-patterns that agents can reference when generating fixes.
 */

export type KnowledgeSeverity = "low" | "medium" | "high";

export type KnowledgeCategory =
  | "error-handling"
  | "performance"
  | "code-quality"
  | "security"
  | "type-safety"
  | "testing";

export interface KnowledgeEntry {
  /** Unique stable identifier, e.g. 'eh-structured-logging-001' */
  id: string;
  /** One of Ratchet's six scoring categories */
  category: KnowledgeCategory;
  /** Subcategory name matching CATEGORY_SUBCATEGORY_MAP */
  subcategory: string;
  /** Short descriptor or regex string identifying the pattern */
  pattern: string;
  /** Human-readable explanation of what this entry covers */
  description: string;
  /** Impact severity when this pattern is violated */
  severity: KnowledgeSeverity;
  /** Optional language scope (e.g. 'typescript', 'javascript') */
  language?: string;
  /** Optional framework scope (e.g. 'express', 'react') */
  framework?: string;
  /** Code snippets showing correct usage */
  examples: string[];
  /** Code snippets showing the problematic pattern to avoid */
  antiPatterns: string[];
  /** Documentation links or internal references */
  references: string[];
}

export interface KnowledgeBase {
  entries: KnowledgeEntry[];
}

export interface KnowledgeQuery {
  category?: KnowledgeCategory;
  subcategory?: string;
  severity?: KnowledgeSeverity;
  language?: string;
  framework?: string;
  /** Substring match against entry pattern or description */
  text?: string;
}
