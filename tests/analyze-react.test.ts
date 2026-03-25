import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runDeepAnalyze } from '../src/core/analyze-react.js';
import type { ScanResult } from '../src/commands/scan.js';
import type { Target } from '../src/types.js';

// Mock gitnexus module — we don't want CLI calls in unit tests
vi.mock('../src/core/gitnexus.js', () => ({
  isIndexed: () => false,
  getImpact: () => null,
  getContext: () => null,
  queryFlows: () => [],
}));

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-react-'));
}

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    total: 72,
    maxTotal: 100,
    totalIssuesFound: 15,
    categories: [],
    issuesByType: [
      { subcategory: 'console-log', count: 5, locations: ['src/api.ts', 'src/utils.ts'] },
      { subcategory: 'missing-tests', count: 3, locations: ['src/core.ts'] },
      { subcategory: 'line-length', count: 7, locations: ['src/long.ts'] },
    ],
    ...overrides,
  } as ScanResult;
}

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    name: 'src',
    path: 'src/',
    description: 'Source code',
    testCommand: 'npx vitest run',
    autoCommit: false,
    ...overrides,
  } as Target;
}

describe('runDeepAnalyze', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    // Create a minimal src directory so file reads don't fail
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/api.ts'), '// placeholder\nexport function api() {}\n');
    writeFileSync(join(dir, 'src/utils.ts'), '// placeholder\nexport const util = 1;\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a valid ReactAnalysis object', async () => {
    const scan = makeScan();
    const target = makeTarget();

    const result = await runDeepAnalyze(scan, target, dir);

    expect(result).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(['low', 'medium', 'high', 'critical']).toContain(result.riskLevel);
    expect(Array.isArray(result.proposedChanges)).toBe(true);
    expect(Array.isArray(result.executionOrder)).toBe(true);
    expect(Array.isArray(result.blastRadiusConcerns)).toBe(true);
    expect(Array.isArray(result.turns)).toBe(true);
    expect(result.toolCallsUsed).toBeGreaterThanOrEqual(0);
    expect(typeof result.summary).toBe('string');
  });

  it('produces exactly 3 turns', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    expect(result.turns).toHaveLength(3);
  });

  it('turn phases are read, investigate, plan in order', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    expect(result.turns[0]!.phase).toBe('read');
    expect(result.turns[1]!.phase).toBe('investigate');
    expect(result.turns[2]!.phase).toBe('plan');
  });

  it('total tool calls does not exceed MAX_TURNS (6)', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    expect(result.toolCallsUsed).toBeLessThanOrEqual(6);
  });

  it('produces proposed changes for issues found in scan', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    // Should propose changes for files mentioned in issue locations
    expect(result.proposedChanges.length).toBeGreaterThan(0);
  });

  it('without GitNexus index, blast radius concerns is empty array', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    expect(result.blastRadiusConcerns).toEqual([]);
  });

  it('risk level is low when no blast concerns', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    expect(result.riskLevel).toBe('low');
  });

  it('confidence is between 0.1 and 1.0', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });

  it('handles scan with no issue locations gracefully', async () => {
    const emptyScan = makeScan({
      issuesByType: [{ subcategory: 'lint', count: 2, locations: [] }],
    });
    const result = await runDeepAnalyze(emptyScan, makeTarget({ path: 'src/api.ts' }), dir);
    expect(result).toBeDefined();
    expect(result.turns).toHaveLength(3);
  });

  it('summary string contains key fields', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    expect(result.summary).toContain('turns');
    expect(result.summary).toContain('tool calls');
    expect(result.summary).toContain('risk=');
    expect(result.summary).toContain('confidence=');
  });

  it('execution order contains no duplicates', async () => {
    const result = await runDeepAnalyze(makeScan(), makeTarget(), dir);
    const unique = new Set(result.executionOrder);
    expect(unique.size).toBe(result.executionOrder.length);
  });
});
