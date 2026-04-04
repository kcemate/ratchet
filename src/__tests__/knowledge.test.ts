import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadKnowledge,
  query,
  getByCategory,
  getByPattern,
  getBySeverity,
  SEED_ENTRIES,
  type KnowledgeBase,
  type KnowledgeEntry,
} from '../core/knowledge/index.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'test-entry-001',
    category: 'error-handling',
    subcategory: 'Empty catches',
    pattern: 'catch\\s*\\(\\)',
    description: 'Empty catch block',
    severity: 'high',
    examples: ['try { op(); } catch (err) { logger.warn(err); }'],
    antiPatterns: ['try { op(); } catch {}'],
    references: [],
    ...overrides,
  };
}

let kb: KnowledgeBase;

beforeEach(() => {
  kb = loadKnowledge(SEED_ENTRIES);
});

// ── loadKnowledge ────────────────────────────────────────────────────────────

describe('loadKnowledge', () => {
  it('loads all seed entries without error', () => {
    expect(kb.entries).toHaveLength(SEED_ENTRIES.length);
  });

  it('returns immutable copy — mutating the input does not affect the store', () => {
    const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })];
    const loaded = loadKnowledge(entries);
    entries.push(makeEntry({ id: 'c' }));
    expect(loaded.entries).toHaveLength(2);
  });

  it('throws on duplicate entry ids', () => {
    const entries = [makeEntry({ id: 'dup' }), makeEntry({ id: 'dup' })];
    expect(() => loadKnowledge(entries)).toThrow('Duplicate knowledge entry id: dup');
  });

  it('accepts an empty list', () => {
    const empty = loadKnowledge([]);
    expect(empty.entries).toHaveLength(0);
  });
});

// ── query ────────────────────────────────────────────────────────────────────

describe('query', () => {
  it('returns all entries when query is empty', () => {
    const results = query(kb, {});
    expect(results).toHaveLength(SEED_ENTRIES.length);
  });

  it('filters by category', () => {
    const results = query(kb, { category: 'security' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.category).toBe('security');
    }
  });

  it('filters by subcategory', () => {
    const results = query(kb, { subcategory: 'Empty catches' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.subcategory).toBe('Empty catches');
    }
  });

  it('filters by severity', () => {
    const results = query(kb, { severity: 'high' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.severity).toBe('high');
    }
  });

  it('combines category and severity filters (AND)', () => {
    const results = query(kb, { category: 'security', severity: 'high' });
    for (const r of results) {
      expect(r.category).toBe('security');
      expect(r.severity).toBe('high');
    }
  });

  it('filters by language', () => {
    const results = query(kb, { language: 'typescript' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.language).toBe('typescript');
    }
  });

  it('filters by framework', () => {
    const results = query(kb, { framework: 'express' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.framework).toBe('express');
    }
  });

  it('filters by text substring (case-insensitive)', () => {
    const results = query(kb, { text: 'promise.all' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array when no entries match', () => {
    const results = query(kb, { category: 'testing', language: 'rust' });
    expect(results).toHaveLength(0);
  });
});

// ── getByCategory ─────────────────────────────────────────────────────────────

describe('getByCategory', () => {
  it('returns entries for each of the six categories', () => {
    const categories = [
      'error-handling',
      'performance',
      'code-quality',
      'security',
      'type-safety',
      'testing',
    ] as const;
    for (const cat of categories) {
      const results = getByCategory(kb, cat);
      expect(results.length, `expected entries for ${cat}`).toBeGreaterThan(0);
    }
  });

  it('returns only entries matching the requested category', () => {
    const results = getByCategory(kb, 'performance');
    for (const r of results) {
      expect(r.category).toBe('performance');
    }
  });
});

// ── getByPattern ──────────────────────────────────────────────────────────────

describe('getByPattern', () => {
  it('finds entries whose pattern contains the search string', () => {
    const results = getByPattern(kb, 'console');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.pattern.toLowerCase()).toContain('console');
    }
  });

  it('is case-insensitive', () => {
    const lower = getByPattern(kb, 'console');
    const upper = getByPattern(kb, 'CONSOLE');
    expect(lower).toEqual(upper);
  });

  it('returns empty array when pattern matches nothing', () => {
    expect(getByPattern(kb, 'zzzzzunlikely')).toHaveLength(0);
  });
});

// ── getBySeverity ─────────────────────────────────────────────────────────────

describe('getBySeverity', () => {
  it('high includes only high-severity entries', () => {
    const results = getBySeverity(kb, 'high');
    for (const r of results) {
      expect(r.severity).toBe('high');
    }
  });

  it('medium includes medium and high entries', () => {
    const results = getBySeverity(kb, 'medium');
    for (const r of results) {
      expect(['medium', 'high']).toContain(r.severity);
    }
  });

  it('low includes all entries', () => {
    const results = getBySeverity(kb, 'low');
    expect(results).toHaveLength(SEED_ENTRIES.length);
  });

  it('high count is a subset of medium count', () => {
    const high = getBySeverity(kb, 'high');
    const medium = getBySeverity(kb, 'medium');
    expect(high.length).toBeLessThanOrEqual(medium.length);
  });
});

// ── seed data integrity ───────────────────────────────────────────────────────

describe('SEED_ENTRIES integrity', () => {
  it('has at least 20 entries', () => {
    expect(SEED_ENTRIES.length).toBeGreaterThanOrEqual(20);
  });

  it('all entry ids are unique', () => {
    const ids = SEED_ENTRIES.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all entries have non-empty examples and antiPatterns', () => {
    for (const entry of SEED_ENTRIES) {
      expect(entry.examples.length, `${entry.id} missing examples`).toBeGreaterThan(0);
      expect(entry.antiPatterns.length, `${entry.id} missing antiPatterns`).toBeGreaterThan(0);
    }
  });

  it('all categories are valid Ratchet scoring categories', () => {
    const valid = new Set([
      'error-handling', 'performance', 'code-quality',
      'security', 'type-safety', 'testing',
    ]);
    for (const entry of SEED_ENTRIES) {
      expect(valid.has(entry.category), `invalid category: ${entry.category}`).toBe(true);
    }
  });

  it('severity is always low | medium | high', () => {
    const valid = new Set(['low', 'medium', 'high']);
    for (const entry of SEED_ENTRIES) {
      expect(valid.has(entry.severity), `invalid severity in ${entry.id}`).toBe(true);
    }
  });
});
