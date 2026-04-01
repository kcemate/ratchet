import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { generatePDF, writePDF } from '../src/core/pdf-report.js';
import type { RatchetRun, Target, Click } from '../src/types.js';
import type { ScanResult } from '../src/commands/scan.js';

function makeTarget(overrides: Partial<Target> = {}): Target {
  return { name: 'api', path: 'src/', description: 'Improve API quality', ...overrides };
}

function makeClick(overrides: Partial<Click> = {}): Click {
  return {
    number: 1,
    target: 'api',
    analysis: 'Found duplicate error handling',
    proposal: 'Extracted shared error handler',
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
      { name: 'Error Handling', emoji: '⚠️', score: 11, max: 17, summary: '5 try/catch' },
      { name: 'Types', emoji: '📝', score: 17, max: 17, summary: 'TypeScript, strict' },
      { name: 'Security', emoji: '🔒', score: 14, max: 16, summary: 'no secrets' },
      { name: 'Performance', emoji: '⚡', score: 9, max: 16, summary: 'no await-in-loop' },
      { name: 'Readability', emoji: '📖', score: 9, max: 17, summary: 'short functions' },
    ],
    ...overrides,
  };
}

describe('generatePDF', () => {
  it('returns a Buffer', async () => {
    const run = makeRun([makeClick()]);
    const buf = await generatePDF({ run, cwd: '/tmp' });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('starts with %PDF header (valid PDF)', async () => {
    const run = makeRun([makeClick()]);
    const buf = await generatePDF({ run, cwd: '/tmp' });
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('generates PDF with clicks that landed', async () => {
    const clicks = [
      makeClick({ number: 1, testsPassed: true }),
      makeClick({ number: 2, testsPassed: false, commitHash: undefined }),
    ];
    const run = makeRun(clicks);
    const buf = await generatePDF({ run, cwd: '/tmp' });
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('generates PDF with before/after scores', async () => {
    const run = makeRun([makeClick()]);
    const scoreBefore = makeScan(72);
    const scoreAfter = makeScan(85, {
      categories: [
        { name: 'Testing', emoji: '🧪', score: 16, max: 17, summary: 'improved' },
        { name: 'Error Handling', emoji: '⚠️', score: 14, max: 17, summary: 'improved' },
        { name: 'Types', emoji: '📝', score: 17, max: 17, summary: 'same' },
        { name: 'Security', emoji: '🔒', score: 16, max: 16, summary: 'perfect' },
        { name: 'Performance', emoji: '⚡', score: 13, max: 16, summary: 'improved' },
        { name: 'Readability', emoji: '📖', score: 9, max: 17, summary: 'same' },
      ],
    });
    const buf = await generatePDF({ run, cwd: '/tmp', scoreBefore, scoreAfter });
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('handles zero clicks gracefully', async () => {
    const run = makeRun([]);
    const buf = await generatePDF({ run, cwd: '/tmp' });
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });
});

describe('writePDF', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-pdf-test-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes PDF file and returns path', async () => {
    const run = makeRun([makeClick()]);
    const pdfPath = await writePDF({ run, cwd: tmpDir });

    expect(pdfPath).toMatch(/api-ratchet-report\.pdf$/);

    const fileContent = await readFile(pdfPath);
    expect(fileContent.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('creates docs directory if it does not exist', async () => {
    const run = makeRun([makeClick({ number: 2 })]);
    const pdfPath = await writePDF({ run, cwd: tmpDir });
    expect(pdfPath).toContain('docs');

    const fileContent = await readFile(pdfPath);
    expect(Buffer.isBuffer(fileContent)).toBe(true);
  });
});
