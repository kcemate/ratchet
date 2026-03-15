import { describe, it, expect } from 'vitest';
import {
  ALL_SUBCATEGORIES,
  STRUCTURAL_SUBCATEGORIES,
  LOCAL_SUBCATEGORIES,
  SEVERITY_WEIGHT,
  CATEGORY_NAMES,
} from '../src/core/taxonomy.js';

describe('Taxonomy — single source of truth', () => {
  it('every subcategory is classified as structural or local', () => {
    for (const sub of ALL_SUBCATEGORIES) {
      const isClassified =
        STRUCTURAL_SUBCATEGORIES.has(sub) || LOCAL_SUBCATEGORIES.has(sub);
      expect(isClassified, `"${sub}" is not classified as structural or local`).toBe(true);
    }
  });

  it('structural and local sets do not overlap', () => {
    for (const sub of STRUCTURAL_SUBCATEGORIES) {
      expect(
        LOCAL_SUBCATEGORIES.has(sub),
        `"${sub}" is in both STRUCTURAL and LOCAL`,
      ).toBe(false);
    }
  });

  it('structural + local covers all subcategories (no extras)', () => {
    const allClassified = new Set([
      ...STRUCTURAL_SUBCATEGORIES,
      ...LOCAL_SUBCATEGORIES,
    ]);
    expect(allClassified.size).toBe(ALL_SUBCATEGORIES.length);
  });

  it('no extra subcategories in structural or local that are not in ALL_SUBCATEGORIES', () => {
    const allSet = new Set<string>(ALL_SUBCATEGORIES);
    for (const sub of STRUCTURAL_SUBCATEGORIES) {
      expect(allSet.has(sub), `"${sub}" in STRUCTURAL but not ALL_SUBCATEGORIES`).toBe(true);
    }
    for (const sub of LOCAL_SUBCATEGORIES) {
      expect(allSet.has(sub), `"${sub}" in LOCAL but not ALL_SUBCATEGORIES`).toBe(true);
    }
  });

  it('SEVERITY_WEIGHT covers high, medium, low', () => {
    expect(SEVERITY_WEIGHT).toHaveProperty('high', 3);
    expect(SEVERITY_WEIGHT).toHaveProperty('medium', 2);
    expect(SEVERITY_WEIGHT).toHaveProperty('low', 1);
  });

  it('CATEGORY_NAMES contains expected categories', () => {
    expect(CATEGORY_NAMES).toContain('Testing');
    expect(CATEGORY_NAMES).toContain('Security');
    expect(CATEGORY_NAMES).toContain('Type Safety');
    expect(CATEGORY_NAMES).toContain('Error Handling');
    expect(CATEGORY_NAMES).toContain('Performance');
    expect(CATEGORY_NAMES).toContain('Code Quality');
    expect(CATEGORY_NAMES.length).toBe(6);
  });
});
