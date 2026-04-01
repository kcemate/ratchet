/**
 * Scoring Delta Tests
 *
 * Verifies that programmatically introducing bad patterns into a clean
 * fixture decreases the score in the expected category.
 *
 * If these break, you changed how specific patterns are scored.
 * Update intentionally.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { runScan, type ScanResult } from '../src/commands/scan.js';

const CORPUS = join(__dirname, 'fixtures', 'scoring-corpus');
const tempDirs: string[] = [];

function copyFixtureToTmp(name: string): string {
  const tmp = mkdtempSync(join(tmpdir(), `ratchet-delta-${name}-`));
  cpSync(join(CORPUS, name), tmp, { recursive: true });
  tempDirs.push(tmp);
  return tmp;
}

function getCat(result: ScanResult, name: string) {
  return result.categories.find(c => c.name === name)!;
}

function getSub(result: ScanResult, catName: string, subName: string) {
  return getCat(result, catName).subcategories.find(s => s.name === subName)!;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('scoring deltas: adding bad patterns decreases scores', () => {
  it('adding console.log statements decreases Performance score', async () => {
    const dir = copyFixtureToTmp('minimal-ts');
    const baseline = await runScan(dir);
    const baselineConsole = getSub(baseline, 'Performance', 'Console cleanup');

    // Inject many console.log calls into a source file
    const srcFile = join(dir, 'src', 'math.ts');
    const original = readFileSync(srcFile, 'utf-8');
    const consoleLogs = Array.from({ length: 30 }, (_, i) =>
      `console.log('debug ${i}');`,
    ).join('\n');
    writeFileSync(srcFile, original + '\n' + consoleLogs + '\n');

    const after = await runScan(dir);
    const afterConsole = getSub(after, 'Performance', 'Console cleanup');

    expect(afterConsole.issuesFound).toBeGreaterThan(baselineConsole.issuesFound);
    // Console cleanup sub-score should decrease
    expect(afterConsole.score).toBeLessThan(baselineConsole.score);
  });

  it('adding any types decreases Type Safety score', async () => {
    const dir = copyFixtureToTmp('minimal-ts');
    const baseline = await runScan(dir);
    const baselineAny = getSub(baseline, 'Type Safety', 'Any type count');

    // Inject any types
    const newFile = join(dir, 'src', 'unsafe.ts');
    const anyCode = Array.from({ length: 20 }, (_, i) =>
      `export function unsafe${i}(x: any): any { return x as any; }`,
    ).join('\n');
    writeFileSync(newFile, anyCode + '\n');

    const after = await runScan(dir);
    const afterAny = getSub(after, 'Type Safety', 'Any type count');

    expect(afterAny.issuesFound).toBeGreaterThan(baselineAny.issuesFound);
    expect(afterAny.score).toBeLessThan(baselineAny.score);
  });

  it('adding empty catch blocks decreases Error Handling score', async () => {
    const dir = copyFixtureToTmp('minimal-ts');
    const baseline = await runScan(dir);
    const baselineCatch = getSub(baseline, 'Error Handling', 'Empty catches');

    // Inject empty catch blocks
    const newFile = join(dir, 'src', 'bad-error.ts');
    const emptyCatches = Array.from({ length: 15 }, (_, i) =>
      `export async function fail${i}() { try { await fetch('x'); } catch {} }`,
    ).join('\n');
    writeFileSync(newFile, emptyCatches + '\n');

    const after = await runScan(dir);
    const afterCatch = getSub(after, 'Error Handling', 'Empty catches');

    expect(afterCatch.issuesFound).toBeGreaterThan(baselineCatch.issuesFound);
    expect(afterCatch.score).toBeLessThan(baselineCatch.score);
  });

  it('adding hardcoded secrets decreases Security score', async () => {
    const dir = copyFixtureToTmp('minimal-ts');
    const baseline = await runScan(dir);
    const baselineSecrets = getSub(baseline, 'Security', 'Secrets & env vars');

    // Inject hardcoded secrets
    const newFile = join(dir, 'src', 'secrets.ts');
    writeFileSync(newFile, `
export const config = {
  apiKey: 'sk-abcdefghijklmnopqrstuvwxyz1234567890',
  dbPassword: 'password = "supersecretpassword123"',
  awsKey: 'AKIA1234567890ABCDEF',
};
`);

    const after = await runScan(dir);
    const afterSecrets = getSub(after, 'Security', 'Secrets & env vars');

    expect(afterSecrets.issuesFound).toBeGreaterThan(baselineSecrets.issuesFound);
    expect(afterSecrets.score).toBeLessThan(baselineSecrets.score);
  });

  it('removing test files decreases Testing score', async () => {
    const dir = copyFixtureToTmp('minimal-ts');
    const baseline = await runScan(dir);

    // Remove the test file
    rmSync(join(dir, 'tests', 'math.test.ts'));

    const after = await runScan(dir);
    expect(getCat(after, 'Testing').score).toBeLessThan(getCat(baseline, 'Testing').score);
  });
});
