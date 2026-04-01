import { describe, it, expect } from 'vitest';
import { generateReport } from '../src/core/report.js';
import type { RatchetRun, Target, Click } from '../src/types.js';
import type { ScanResult } from '../src/commands/scan.js';

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    name: 'api',
    path: 'src/',
    description: 'Improve API code quality',
    ...overrides,
  };
}

function makeClick(overrides: Partial<Click> = {}): Click {
  return {
    number: 1,
    target: 'api',
    analysis: 'Found duplicate error handling logic',
    proposal: 'Extracted shared error handler to reduce duplication',
    filesModified: ['src/api.ts'],
    testsPassed: true,
    commitHash: 'abc1234',
    timestamp: new Date('2026-01-01T00:01:00Z'),
    ...overrides,
  };
}

function makeRun(clicks: Click[], overrides: Partial<RatchetRun> = {}): RatchetRun {
  return {
    id: 'test-run-id',
    target: makeTarget(),
    clicks,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:05:00Z'),
    status: 'completed',
    ...overrides,
  };
}

function makeScan(total: number, overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    projectName: 'test-project',
    total,
    maxTotal: 100,
    categories: [
      { name: 'Testing', emoji: '🧪', score: 12, max: 17, summary: '3 test files' },
      { name: 'Error Handling', emoji: '⚠️ ', score: 11, max: 17, summary: '5 try/catch' },
      { name: 'Types', emoji: '📝', score: 17, max: 17, summary: 'TypeScript, strict' },
      { name: 'Security', emoji: '🔒', score: 14, max: 16, summary: 'no secrets' },
      { name: 'Performance', emoji: '⚡', score: 9, max: 16, summary: 'no await-in-loop' },
      { name: 'Readability', emoji: '📖', score: 9, max: 17, summary: 'short functions' },
    ],
    ...overrides,
  };
}

describe('generateReport', () => {
  it('includes the header', () => {
    const run = makeRun([makeClick()]);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('# 🔧 Ratchet Report');
  });

  it('includes stats line with click count, landed, rolled back, and duration', () => {
    const clicks = [
      makeClick({ number: 1, testsPassed: true }),
      makeClick({ number: 2, testsPassed: false, commitHash: undefined }),
      makeClick({ number: 3, testsPassed: true }),
    ];
    const run = makeRun(clicks);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('3 clicks');
    expect(report).toContain('2 landed');
    expect(report).toContain('1 rolled back');
    expect(report).toContain('5m 0s');
  });

  it('lists landed clicks in What improved section', () => {
    const clicks = [
      makeClick({ number: 1, testsPassed: true, proposal: 'Extracted shared error handler' }),
      makeClick({ number: 2, testsPassed: true, proposal: 'Added input validation to endpoints' }),
    ];
    const run = makeRun(clicks);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('## What improved:');
    expect(report).toContain('**Click 1**');
    expect(report).toContain('Extracted shared error handler');
    expect(report).toContain('**Click 2**');
    expect(report).toContain('Added input validation to endpoints');
  });

  it('shows fallback message when nothing landed', () => {
    const run = makeRun([makeClick({ testsPassed: false, commitHash: undefined })]);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('Nothing landed this run.');
  });

  it('lists rolled back clicks in What was rolled back section', () => {
    const clicks = [
      makeClick({ number: 1, testsPassed: false, commitHash: undefined, analysis: 'Router tests failed after changes' }),
    ];
    const run = makeRun(clicks);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('## What was rolled back:');
    expect(report).toContain('**Click 1**');
    expect(report).toContain('Router tests failed after changes');
  });

  it('shows clean run message when nothing rolled back', () => {
    const run = makeRun([makeClick({ testsPassed: true })]);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('Nothing was rolled back');
  });

  it('includes Before/After section when scan results provided', () => {
    const run = makeRun([makeClick()]);
    const before = makeScan(72);
    const after = makeScan(79, {
      categories: [
        { name: 'Testing', emoji: '🧪', score: 14, max: 17, summary: '5 test files' },
        { name: 'Error Handling', emoji: '⚠️ ', score: 14, max: 17, summary: '8 try/catch' },
        { name: 'Types', emoji: '📝', score: 17, max: 17, summary: 'TypeScript, strict' },
        { name: 'Security', emoji: '🔒', score: 14, max: 16, summary: 'no secrets' },
        { name: 'Performance', emoji: '⚡', score: 11, max: 16, summary: 'no await-in-loop' },
        { name: 'Readability', emoji: '📖', score: 9, max: 17, summary: 'short functions' },
      ],
    });
    const report = generateReport({ run, cwd: '/tmp', scoreBefore: before, scoreAfter: after });
    expect(report).toContain('## Before/After:');
    expect(report).toContain('72/100');
    expect(report).toContain('79/100');
    expect(report).toContain('+7');
  });

  it('omits Before/After when no scan results provided', () => {
    const run = makeRun([makeClick()]);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).not.toContain('## Before/After:');
  });

  it('shows category score changes in Before/After table', () => {
    const run = makeRun([makeClick()]);
    const before = makeScan(72);
    const after = makeScan(79, {
      categories: [
        { name: 'Testing', emoji: '🧪', score: 14, max: 17, summary: 'improved' },
        { name: 'Error Handling', emoji: '⚠️ ', score: 11, max: 17, summary: 'same' },
        { name: 'Types', emoji: '📝', score: 17, max: 17, summary: 'same' },
        { name: 'Security', emoji: '🔒', score: 14, max: 16, summary: 'same' },
        { name: 'Performance', emoji: '⚡', score: 16, max: 16, summary: 'improved' },
        { name: 'Readability', emoji: '📖', score: 7, max: 17, summary: 'worse' },
      ],
    });
    const report = generateReport({ run, cwd: '/tmp', scoreBefore: before, scoreAfter: after });
    // Testing improved by 2 (12 -> 14)
    expect(report).toContain('+2');
    // Performance improved by 7 (9 -> 16)
    expect(report).toContain('+7');
    // Readability worse by 2 (9 -> 7)
    expect(report).toContain('-2');
  });

  it('truncates long proposals to 120 chars', () => {
    const longProposal = 'A'.repeat(200);
    const run = makeRun([makeClick({ proposal: longProposal })]);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('…');
    // Should not contain the full 200-char string
    expect(report).not.toContain('A'.repeat(121));
  });

  it('handles singular click count', () => {
    const run = makeRun([makeClick()]);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('1 click ·');
    expect(report).not.toContain('1 clicks');
  });

  it('includes footer with generation timestamp', () => {
    const run = makeRun([makeClick()]);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(report).toContain('Generated by [Ratchet]');
  });

  it('returns a string (importable by other modules)', () => {
    const run = makeRun([makeClick()]);
    const report = generateReport({ run, cwd: '/tmp' });
    expect(typeof report).toBe('string');
  });
});
