/**
 * Tests verifying sweep batch-size configuration.
 *
 * Sweep mode is designed for bulk mechanical fixes (e.g. line-length across
 * 174 files). A batch size of 6 would produce 29 batches but only 4 sweep
 * clicks touch 24 files — not enough to cross tier thresholds. Batch size 25
 * ensures meaningful coverage per click.
 */
import { describe, it, expect } from 'vitest';
import { chunk } from '../../src/core/engine.js';

describe('sweep batch size via chunk helper', () => {
  it('chunk(files, 25) produces batches of at most 25 files', () => {
    const files = Array.from({ length: 60 }, (_, i) => `src/file${i}.ts`);
    const batches = chunk(files, 25);

    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(25);
    }
    expect(batches.flat().length).toBe(60);
  });

  it('4 sweep clicks at batch size 25 cover ≥100 files from a 174-file set', () => {
    const files = Array.from({ length: 174 }, (_, i) => `src/file${i}.ts`);
    const batches = chunk(files, 25);
    const clicksToRun = Math.min(4, batches.length);
    const filesCovered = batches.slice(0, clicksToRun).flat().length;

    expect(filesCovered).toBeGreaterThanOrEqual(100);
  });

  it('4 sweep clicks at OLD batch size 6 only cover 24 files (documents the regression)', () => {
    const files = Array.from({ length: 174 }, (_, i) => `src/file${i}.ts`);
    const batches = chunk(files, 6);
    const clicksToRun = Math.min(4, batches.length);
    const filesCovered = batches.slice(0, clicksToRun).flat().length;

    // Old behaviour: only 24 files in 4 clicks — batch size 25 quadruples coverage
    expect(filesCovered).toBeLessThanOrEqual(24);
  });

  it('batch size 25 covers 4x more files than batch size 6 in the same click budget', () => {
    const files = Array.from({ length: 174 }, (_, i) => `src/file${i}.ts`);
    const batchesNew = chunk(files, 25);
    const batchesOld = chunk(files, 6);
    const clicksToRun = 4;

    const newCoverage = batchesNew.slice(0, clicksToRun).flat().length;
    const oldCoverage = batchesOld.slice(0, clicksToRun).flat().length;

    expect(newCoverage).toBeGreaterThan(oldCoverage * 3);
  });
});
