import { describe, it, expect } from 'vitest';
import { generateScoreCard, generateCommitSuffix, generatePRDescription } from '../../src/core/pr-comment.js';
import type { ScanResult } from '../../src/commands/scan.js';

// --- Helpers ---

function makeScan(total: number, cats: Array<{ name: string; score: number; max: number }>): ScanResult {
  return {
    projectName: 'test-project',
    total,
    maxTotal: 100,
    categories: cats.map((c) => ({
      name: c.name,
      emoji: '🧪',
      score: c.score,
      max: c.max,
      summary: '',
      subcategories: [],
    })),
    totalIssuesFound: 0,
    issuesByType: [],
  };
}

const DEFAULT_CATS = [
  { name: 'Testing', score: 3, max: 25 },
  { name: 'Security', score: 5, max: 15 },
  { name: 'Type Safety', score: 10, max: 15 },
  { name: 'Error Handling', score: 14, max: 20 },
  { name: 'Performance', score: 8, max: 10 },
  { name: 'Code Quality', score: 10, max: 15 },
];

// before: total 50, after: total 67 — Testing and Security improved
const BEFORE = makeScan(50, DEFAULT_CATS);
const AFTER = makeScan(67, [
  { name: 'Testing', score: 6, max: 25 },
  { name: 'Security', score: 15, max: 15 }, // max reached
  { name: 'Type Safety', score: 10, max: 15 },
  { name: 'Error Handling', score: 14, max: 20 },
  { name: 'Performance', score: 8, max: 10 },
  { name: 'Code Quality', score: 14, max: 15 },
]);

// --- generateScoreCard ---

describe('generateScoreCard', () => {
  it('includes overall before → after score', () => {
    const card = generateScoreCard(BEFORE, AFTER);
    expect(card).toContain('50 → 67');
  });

  it('shows positive delta with + sign', () => {
    const card = generateScoreCard(BEFORE, AFTER);
    expect(card).toContain('+17');
  });

  it('only shows dimensions that changed', () => {
    const card = generateScoreCard(BEFORE, AFTER);
    expect(card).toContain('Testing');
    expect(card).toContain('Security');
    expect(card).not.toContain('Type Safety');
    expect(card).not.toContain('Error Handling');
    expect(card).not.toContain('Performance');
  });

  it('uses ✅ emoji when dimension reaches max', () => {
    const card = generateScoreCard(BEFORE, AFTER);
    // Security went from 5/15 to 15/15 — should be ✅
    expect(card).toContain('✅');
    const lines = card.split('\n');
    const secLine = lines.find((l) => l.includes('Security'));
    expect(secLine).toContain('✅');
  });

  it('uses ⬆️ emoji for improvement short of max', () => {
    const card = generateScoreCard(BEFORE, AFTER);
    const lines = card.split('\n');
    const testLine = lines.find((l) => l.includes('Testing'));
    expect(testLine).toContain('⬆️');
  });

  it('includes "Powered by Ratchet" footer by default', () => {
    const card = generateScoreCard(BEFORE, AFTER);
    expect(card).toContain('Powered by Ratchet');
    expect(card).toContain('https://ratchetcli.com');
  });

  it('omits footer when footer=false', () => {
    const card = generateScoreCard(BEFORE, AFTER, { footer: false });
    expect(card).not.toContain('Powered by Ratchet');
    expect(card).not.toContain('ratchetcli.com');
  });

  it('uses ⬇️ emoji for regression', () => {
    const regressed = makeScan(40, [
      { name: 'Testing', score: 1, max: 25 },
      { name: 'Security', score: 5, max: 15 },
      { name: 'Type Safety', score: 10, max: 15 },
      { name: 'Error Handling', score: 14, max: 20 },
      { name: 'Performance', score: 8, max: 10 },
      { name: 'Code Quality', score: 2, max: 15 },
    ]);
    const card = generateScoreCard(AFTER, regressed);
    const lines = card.split('\n');
    const testLine = lines.find((l) => l.includes('Testing'));
    expect(testLine).toContain('⬇️');
  });

  it('shows negative delta for regression', () => {
    const regressed = makeScan(40, DEFAULT_CATS.map((c) =>
      c.name === 'Testing' ? { ...c, score: 1 } : c,
    ));
    const card = generateScoreCard(BEFORE, regressed);
    // Testing went from 3 → 1, delta = -2
    expect(card).toContain('-2');
  });

  it('handles unchanged score — shows only overall line', () => {
    const card = generateScoreCard(BEFORE, BEFORE);
    const lines = card.split('\n').filter((l) => l.trim());
    // Only: header + overall + footer lines (no dimension lines since none changed)
    expect(card).toContain('50 → 50');
    expect(card).not.toContain('Testing');
    expect(card).not.toContain('Security');
  });

  it('handles perfect score', () => {
    const perfect = makeScan(100, DEFAULT_CATS.map((c) => ({ ...c, score: c.max })));
    const card = generateScoreCard(BEFORE, perfect);
    expect(card).toContain('50 → 100');
  });

  it('starts with 🔩 Ratchet improved this codebase:', () => {
    const card = generateScoreCard(BEFORE, AFTER);
    expect(card.startsWith('🔩 Ratchet improved this codebase:')).toBe(true);
  });
});

// --- generateCommitSuffix ---

describe('generateCommitSuffix', () => {
  it('is compact — at most 3 lines with footer, 2 without', () => {
    const suffix = generateCommitSuffix(BEFORE, AFTER, { footer: false });
    const lines = suffix.split('\n').filter((l) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it('is under 5 lines total including footer', () => {
    const suffix = generateCommitSuffix(BEFORE, AFTER);
    const lines = suffix.split('\n');
    expect(lines.length).toBeLessThan(5);
  });

  it('includes before → after score', () => {
    const suffix = generateCommitSuffix(BEFORE, AFTER);
    expect(suffix).toContain('50 → 67');
  });

  it('includes changed dimension names', () => {
    const suffix = generateCommitSuffix(BEFORE, AFTER);
    expect(suffix).toContain('Testing');
    expect(suffix).toContain('Security');
  });

  it('omits unchanged dimensions', () => {
    const suffix = generateCommitSuffix(BEFORE, AFTER);
    expect(suffix).not.toContain('Type Safety');
  });

  it('includes ratchetcli.com footer by default', () => {
    const suffix = generateCommitSuffix(BEFORE, AFTER);
    expect(suffix).toContain('ratchetcli.com');
  });

  it('omits footer when footer=false', () => {
    const suffix = generateCommitSuffix(BEFORE, AFTER, { footer: false });
    expect(suffix).not.toContain('ratchetcli.com');
  });

  it('handles no changed dimensions gracefully', () => {
    const suffix = generateCommitSuffix(BEFORE, BEFORE);
    expect(suffix).toContain('50 → 50');
  });
});

// --- generatePRDescription ---

describe('generatePRDescription', () => {
  it('includes overall score change in header', () => {
    const desc = generatePRDescription(BEFORE, AFTER, []);
    expect(desc).toContain('50/100 → 67/100');
    expect(desc).toContain('+17');
  });

  it('includes all dimensions in a table', () => {
    const desc = generatePRDescription(BEFORE, AFTER, []);
    expect(desc).toContain('Testing');
    expect(desc).toContain('Security');
    expect(desc).toContain('Type Safety');
  });

  it('includes ±0 for unchanged dimensions', () => {
    const desc = generatePRDescription(BEFORE, AFTER, []);
    expect(desc).toContain('±0');
  });

  it('includes file change list when provided', () => {
    const desc = generatePRDescription(BEFORE, AFTER, ['src/api/users.ts', 'src/auth.ts']);
    expect(desc).toContain('src/api/users.ts');
    expect(desc).toContain('src/auth.ts');
    expect(desc).toContain('Files changed');
  });

  it('omits files section when changes array is empty', () => {
    const desc = generatePRDescription(BEFORE, AFTER, []);
    expect(desc).not.toContain('Files changed');
  });

  it('includes Ratchet footer link by default', () => {
    const desc = generatePRDescription(BEFORE, AFTER, []);
    expect(desc).toContain('Powered by');
    expect(desc).toContain('ratchetcli.com');
  });

  it('omits footer when footer=false', () => {
    const desc = generatePRDescription(BEFORE, AFTER, [], { footer: false });
    expect(desc).not.toContain('Powered by');
    expect(desc).not.toContain('ratchetcli.com');
  });

  it('is valid markdown with ## header', () => {
    const desc = generatePRDescription(BEFORE, AFTER, []);
    expect(desc).toContain('## 🔩 Ratchet Score Improvement');
  });

  it('includes a markdown table', () => {
    const desc = generatePRDescription(BEFORE, AFTER, []);
    expect(desc).toContain('| Dimension |');
    expect(desc).toContain('|---|');
  });

  it('handles perfect score edge case', () => {
    const perfect = makeScan(100, DEFAULT_CATS.map((c) => ({ ...c, score: c.max })));
    const desc = generatePRDescription(BEFORE, perfect, []);
    expect(desc).toContain('50/100 → 100/100');
  });
});
