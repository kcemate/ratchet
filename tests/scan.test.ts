import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runScan, type ScanResult } from '../src/commands/scan.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-scan-'));
}

describe('runScan', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a ScanResult with all 6 categories', async () => {
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n');
    const result = await runScan(dir);

    expect(result.categories).toHaveLength(6);
    expect(result.maxTotal).toBe(100);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it('uses package.json name as projectName', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-cool-app', scripts: { test: 'vitest run' } }));
    const result = await runScan(dir);
    expect(result.projectName).toBe('my-cool-app');
  });

  it('falls back to directory name when no package.json', async () => {
    const result = await runScan(dir);
    // Directory name is the tmp dir base name
    expect(result.projectName).toBeTruthy();
  });

  describe('Testing category', () => {
    it('scores 0 for testing when no test files exist', async () => {
      writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { start: 'node .' } }));
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Testing')!;
      expect(cat.score).toBe(0);
    });

    it('awards points for test files', async () => {
      writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n');
      writeFileSync(join(dir, 'index.test.ts'), 'import { x } from "./index"; expect(x).toBe(1);\n');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { test: 'vitest run' } }));
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Testing')!;
      expect(cat.score).toBeGreaterThan(0);
    });

    it('awards points for test script in package.json', async () => {
      writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { test: 'vitest run' } }));
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Testing')!;
      // Should get at least the test script points
      expect(cat.score).toBeGreaterThan(0);
      expect(cat.summary).toContain('test script');
    });
  });

  describe('Error Handling category', () => {
    it('awards points for try/catch blocks', async () => {
      writeFileSync(join(dir, 'app.ts'), `
async function fetchData() {
  try {
    const result = await fetch('https://api.example.com');
    return result.json();
  } catch (err) {
    console.error(err);
  }
}
`);
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Error Handling')!;
      expect(cat.score).toBeGreaterThan(6);
      expect(cat.summary).toContain('try/catch');
    });

    it('penalizes empty catch blocks', async () => {
      const withEmpty = `
async function bad() {
  try {
    await fetch('x');
  } catch {}
}
`;
      const withHandler = `
async function good() {
  try {
    await fetch('x');
  } catch (e) {
    console.error(e);
  }
}
`;
      writeFileSync(join(dir, 'bad.ts'), withEmpty);
      const badResult = await runScan(dir);
      const badCat = badResult.categories.find(c => c.name === 'Error Handling')!;

      rmSync(join(dir, 'bad.ts'));
      writeFileSync(join(dir, 'good.ts'), withHandler);
      const goodResult = await runScan(dir);
      const goodCat = goodResult.categories.find(c => c.name === 'Error Handling')!;

      expect(goodCat.score).toBeGreaterThanOrEqual(badCat.score);
    });
  });

  describe('Types category', () => {
    it('returns low score for JS-only project', async () => {
      writeFileSync(join(dir, 'index.js'), 'module.exports = { x: 1 };\n');
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Types')!;
      expect(cat.score).toBe(0);
      expect(cat.summary).toContain('JavaScript');
    });

    it('awards points for TypeScript with strict mode', async () => {
      writeFileSync(join(dir, 'index.ts'), 'export function add(a: number, b: number): number { return a + b; }\n');
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Types')!;
      expect(cat.score).toBeGreaterThanOrEqual(8); // TypeScript (3) + strict (5)
      expect(cat.summary).toContain('strict mode');
    });

    it('deducts for any types', async () => {
      const withAny = 'export function process(data: any): any { return data; }\n'.repeat(20);
      const withoutAny = 'export function process(data: string): string { return data; }\n'.repeat(20);

      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));

      writeFileSync(join(dir, 'app.ts'), withAny);
      const anyResult = await runScan(dir);
      const anyCat = anyResult.categories.find(c => c.name === 'Types')!;

      writeFileSync(join(dir, 'app.ts'), withoutAny);
      const cleanResult = await runScan(dir);
      const cleanCat = cleanResult.categories.find(c => c.name === 'Types')!;

      expect(cleanCat.score).toBeGreaterThan(anyCat.score);
    });
  });

  describe('Security category', () => {
    it('awards full security points for clean code', async () => {
      writeFileSync(join(dir, 'app.ts'), `
const apiUrl = process.env.API_URL;
export async function fetchData() {
  const res = await fetch(apiUrl!);
  return res.json();
}
`);
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Security')!;
      expect(cat.summary).toContain('no hardcoded secrets');
      expect(cat.summary).toContain('uses env vars');
      expect(cat.summary).toContain('no eval()');
    });

    it('flags hardcoded API keys', async () => {
      writeFileSync(join(dir, 'config.ts'), `
const apiKey = 'sk-abcdefghijklmnopqrstuvwx';
export { apiKey };
`);
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Security')!;
      expect(cat.summary).toContain('potential secret');
    });

    it('flags eval() usage', async () => {
      writeFileSync(join(dir, 'unsafe.ts'), `
function run(code: string) {
  return eval(code);
}
`);
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Security')!;
      expect(cat.summary).toContain('eval()');
    });
  });

  describe('Performance category', () => {
    it('awards points for no console.log and no await-in-loop', async () => {
      writeFileSync(join(dir, 'app.ts'), `
export async function fetchAll(ids: string[]): Promise<string[]> {
  const results = await Promise.all(ids.map(id => fetch(id).then(r => r.text())));
  return results;
}
`);
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Performance')!;
      expect(cat.score).toBeGreaterThanOrEqual(14);
    });

    it('detects console.log in source files', async () => {
      writeFileSync(join(dir, 'app.ts'), `
export function process(x: number): number {
  console.log('processing', x);
  console.log('done');
  console.log('extra');
  console.log('more');
  console.log('five');
  console.log('six');
  return x * 2;
}
`);
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Performance')!;
      expect(cat.summary).toContain('console.log');
    });
  });

  describe('Readability category', () => {
    it('awards points for short functions and no long lines', async () => {
      writeFileSync(join(dir, 'app.ts'), `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`);
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Readability')!;
      expect(cat.score).toBeGreaterThan(10);
    });

    it('detects commented-out code', async () => {
      writeFileSync(join(dir, 'app.ts'), `
export function add(a: number, b: number): number {
  // const debug = true;
  // if (debug) {
  // return a + b + 1;
  // }
  // const old = a - b;
  return a + b;
}
`);
      const result = await runScan(dir);
      const cat = result.categories.find(c => c.name === 'Readability')!;
      expect(cat.summary).toContain('commented-out');
    });
  });

  describe('score totals', () => {
    it('total equals sum of category scores', async () => {
      writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n');
      const result = await runScan(dir);
      const sum = result.categories.reduce((acc, c) => acc + c.score, 0);
      expect(result.total).toBe(sum);
    });

    it('maxTotal is always 100', async () => {
      const result = await runScan(dir);
      expect(result.maxTotal).toBe(100);
    });

    it('scores improve with better code', async () => {
      // Bad code: JS, no tests, hardcoded secrets, console.log everywhere
      writeFileSync(join(dir, 'bad.js'), `
const password = 'supersecretpassword123';
function doStuff(x) {
  console.log(x);
  console.log(x);
  console.log(x);
  console.log(x);
  console.log(x);
  console.log(x);
  return x;
}
`);
      const badResult = await runScan(dir);

      rmSync(join(dir, 'bad.js'));

      // Good code: TypeScript, strict, env vars, no secrets, no console.log
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'good-app', scripts: { test: 'vitest run' } }));
      writeFileSync(join(dir, 'app.ts'), `
const apiUrl = process.env.API_URL ?? '';

export async function fetchData(): Promise<string> {
  try {
    const res = await fetch(apiUrl);
    return res.text();
  } catch (err) {
    throw new Error(\`Fetch failed: \${String(err)}\`);
  }
}
`);
      writeFileSync(join(dir, 'app.test.ts'), `
import { describe, it, expect } from 'vitest';
describe('app', () => {
  it('works', () => expect(true).toBe(true));
});
`);

      const goodResult = await runScan(dir);
      expect(goodResult.total).toBeGreaterThan(badResult.total);
    });
  });
});
