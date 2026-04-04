export type {
  KnowledgeEntry,
  KnowledgeBase,
  KnowledgeQuery,
  KnowledgeCategory,
  KnowledgeSeverity,
} from './types.js';

export { loadKnowledge, query, getByCategory, getByPattern, getBySeverity } from './store.js';
export { SEED_ENTRIES } from './seed.js';
