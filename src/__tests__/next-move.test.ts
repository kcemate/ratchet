import { describe, it, expect } from 'vitest';
import { generateNextMoveRecommendation } from '../core/score-optimizer.js';
import type { ScanResult } from '../commands/scan.js';

function makeScan(overrides: Partial<ScanResult> & { total: number }): ScanResult {
  return {
    projectName: 'test',
    maxTotal: 100,
    totalIssuesFound: 0,
    issuesByType: [],
    categories: [],
    ...overrides,
  };
}

// Test quality: score=2/8, 22 issues across 11 files → architect threshold met (>10 hits, >5 files)
const lowScoreWithTestingGap: ScanResult = makeScan({
  total: 55,
  categories: [
    {
      name: 'Testing',
      emoji: '🧪',
      score: 13,
      max: 25,
      summary: '',
      subcategories: [
        {
          name: 'Test quality',
          score: 2,
          max: 8,
          summary: '',
          issuesFound: 22,
          locations: Array.from({ length: 11 }, (_, i) => `src/file${i}.ts`),
        },
      ],
    },
  ],
});

const highScore: ScanResult = makeScan({
  total: 97,
  categories: [
    {
      name: 'Code Quality',
      emoji: '✨',
      score: 19,
      max: 20,
      summary: '',
      subcategories: [
        {
          name: 'Dead code',
          score: 5,
          max: 6,
          summary: '',
          issuesFound: 2,
          locations: ['src/a.ts'],
        },
      ],
    },
  ],
});

const smallGapsOnly: ScanResult = makeScan({
  total: 88,
  categories: [
    {
      name: 'Code Quality',
      emoji: '✨',
      score: 18,
      max: 20,
      summary: '',
      subcategories: [
        {
          name: 'Dead code',
          score: 4,
          max: 6,
          summary: '',
          issuesFound: 3,
          locations: ['src/a.ts'],
        },
      ],
    },
  ],
});

describe('generateNextMoveRecommendation', () => {
  it('recommends architect mode and focus-category when testing gap has many hits across many files', () => {
    const result = generateNextMoveRecommendation(lowScoreWithTestingGap);
    expect(result).toContain('Next best move');
    expect(result).toContain('--focus-category testing');
    expect(result).toContain('--mode architect');
    expect(result).toContain('-n 5');
    expect(result).toContain('ratchet torque');
  });

  it('returns congrats message when score is 95+', () => {
    const result = generateNextMoveRecommendation(highScore);
    expect(result).toContain('🎉');
    expect(result).toContain('97/100');
    expect(result).not.toContain('ratchet torque');
  });

  it('suggests ratchet improve when only small gaps remain', () => {
    const result = generateNextMoveRecommendation(smallGapsOnly);
    expect(result).toContain('ratchet improve');
    expect(result).not.toContain('ratchet torque');
  });

  it('does not include architect flag when hits are low', () => {
    const scan = makeScan({
      total: 70,
      categories: [
        {
          name: 'Error Handling',
          emoji: '🛡️',
          score: 5,
          max: 20,
          summary: '',
          subcategories: [
            {
              name: 'Empty catches',
              score: 1,
              max: 5,
              summary: '',
              issuesFound: 4,
              locations: ['src/a.ts', 'src/b.ts'],
            },
          ],
        },
      ],
    });
    const result = generateNextMoveRecommendation(scan);
    expect(result).toContain('ratchet torque');
    expect(result).not.toContain('--mode architect');
  });
});
