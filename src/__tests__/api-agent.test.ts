import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildTestCandidates, extractRelativeImports, applyFileBlocks } from '../core/agents/api.js';

// ── Helper ───────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ratchet-api-agent-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── buildTestCandidates ──────────────────────────────────────────────────────

describe('buildTestCandidates', () => {
  it('generates .test.ts and __tests__/ variants for a src file', () => {
    const candidates = buildTestCandidates('src/utils.ts');
    expect(candidates).toContain('src/utils.test.ts');
    expect(candidates).toContain('src/utils.spec.ts');
    expect(candidates).toContain('src/__tests__/utils.test.ts');
    expect(candidates).toContain('src/__tests__/utils.spec.ts');
  });

  it('generates candidates for root-level file', () => {
    const candidates = buildTestCandidates('foo.ts');
    expect(candidates).toContain('foo.test.ts');
    expect(candidates).toContain('__tests__/foo.test.ts');
  });

  it('handles .tsx extension', () => {
    const candidates = buildTestCandidates('src/components/Button.tsx');
    expect(candidates).toContain('src/components/Button.test.tsx');
    expect(candidates).toContain('src/components/__tests__/Button.test.tsx');
  });

  it('handles nested paths', () => {
    const candidates = buildTestCandidates('src/core/engine.ts');
    expect(candidates).toContain('src/core/engine.test.ts');
    expect(candidates).toContain('src/core/__tests__/engine.test.ts');
  });

  it('returns empty array for unknown extension', () => {
    const candidates = buildTestCandidates('src/schema.graphql');
    expect(candidates).toHaveLength(0);
  });
});

// ── extractRelativeImports ───────────────────────────────────────────────────

describe('extractRelativeImports', () => {
  it('extracts single relative import', () => {
    const content = `import { foo } from './utils';`;
    const imports = extractRelativeImports(content, 'src/index.ts');
    expect(imports.some(p => p.includes('utils'))).toBe(true);
  });

  it('extracts multiple relative imports', () => {
    const content = `
import { a } from './a';
import { b } from './b';
import { c } from '../c';
`;
    const imports = extractRelativeImports(content, 'src/index.ts');
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores node_modules imports', () => {
    const content = `
import { foo } from 'vitest';
import { bar } from 'react';
import { baz } from './local';
`;
    const imports = extractRelativeImports(content, 'src/index.ts');
    expect(imports.every(p => !p.includes('vitest') && !p.includes('react'))).toBe(true);
    expect(imports.some(p => p.includes('local'))).toBe(true);
  });

  it('handles .js extension swapping to .ts', () => {
    const content = `import { foo } from './utils.js';`;
    const imports = extractRelativeImports(content, 'src/index.ts');
    // Should try utils.ts variant
    expect(imports.some(p => p.endsWith('.ts') || p.endsWith('.js'))).toBe(true);
  });

  it('returns deduplicated results', () => {
    const content = `
import { a } from './utils';
import { b } from './utils';
`;
    const imports = extractRelativeImports(content, 'src/index.ts');
    const count = imports.filter(p => p.includes('utils')).length;
    expect(count).toBe(1);
  });

  it('caps results at 8 candidates', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `import { x${i} } from './mod${i}';`).join('\n');
    const imports = extractRelativeImports(lines, 'src/index.ts');
    expect(imports.length).toBeLessThanOrEqual(8);
  });
});

// ── APIAgent.build() — source root resolution ────────────────────────────────

describe('APIAgent.build() — source root resolution', () => {
  it('uses literal path when file exists there', async () => {
    const { APIAgent } = await import('../core/agents/api.js');
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/foo.ts'), 'export const x = 1;');

    const output = await captureFileInjection(tempDir, 'src/foo.ts', undefined);
    expect(output).toContain('src/foo.ts');
    expect(output).toContain('export const x = 1');
  });

  it('resolves to source root when literal path does not exist', async () => {
    const { APIAgent } = await import('../core/agents/api.js');
    // File lives at client/src/foo.ts but agent mentions src/foo.ts
    await mkdir(join(tempDir, 'client', 'src'), { recursive: true });
    await writeFile(join(tempDir, 'client/src/foo.ts'), 'export const y = 2;');

    const output = await captureFileInjection(tempDir, 'src/foo.ts', ['client/src/']);
    expect(output).toContain('client/src/foo.ts');
    expect(output).toContain('export const y = 2');
  });

  it('falls back to original path when no source root resolves', async () => {
    // File doesn't exist anywhere — no crash, just empty fileContents
    const output = await captureFileInjection(tempDir, 'src/missing.ts', ['client/src/']);
    // No file content injected, but build should not throw
    expect(output).toBeDefined();
  });
});

// ── APIAgent.build() — guard limits ─────────────────────────────────────────

describe('APIAgent.build() — guard limits', () => {
  it('reads only 1 file when no clickGuards set (backward compat default)', async () => {
    // Create two candidate files
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/a.ts'), 'export const a = 1;');
    await writeFile(join(tempDir, 'src/b.ts'), 'export const b = 2;');

    const capturedPrompt = await capturePrompt(
      tempDir,
      // Prompt references two files
      `Path: src/a.ts\nPath: src/b.ts\nFix the issue.`,
      undefined, // no clickGuards
    );
    // Only one file's content should appear in the editable section
    const editableSection = capturedPrompt.split('READ-ONLY CONTEXT')[0];
    const fileCount = (editableSection.match(/--- FILE:/g) ?? []).length;
    expect(fileCount).toBe(1);
  });

  it('reads up to maxFiles when clickGuards.maxFiles > 1', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/a.ts'), 'export const a = 1;');
    await writeFile(join(tempDir, 'src/b.ts'), 'export const b = 2;');

    const capturedPrompt = await capturePrompt(
      tempDir,
      `Path: src/a.ts\nPath: src/b.ts\nFix the issue.`,
      { maxFiles: 2, maxLines: 50 },
    );
    const editableSection = capturedPrompt.split('READ-ONLY CONTEXT')[0];
    const fileCount = (editableSection.match(/--- FILE:/g) ?? []).length;
    expect(fileCount).toBe(2);
  });

  it('prompt contains correct maxFiles/maxLines from guards', async () => {
    const capturedPrompt = await capturePrompt(
      tempDir,
      'Fix the issue.',
      { maxFiles: 3, maxLines: 60 },
    );
    expect(capturedPrompt).toContain('Modify at most 3 file(s)');
    expect(capturedPrompt).toContain('at most 60 total lines');
  });

  it('prompt defaults to 1 file / 20 lines when no guards', async () => {
    const capturedPrompt = await capturePrompt(tempDir, 'Fix the issue.', undefined);
    expect(capturedPrompt).toContain('Modify at most 1 file(s)');
    expect(capturedPrompt).toContain('at most 20 total lines');
  });
});

// ── APIAgent.build() — read-only context ────────────────────────────────────

describe('APIAgent.build() — read-only context injection', () => {
  it('injects test file as READ-ONLY CONTEXT when found', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/utils.ts'), 'export const util = () => {};');
    await writeFile(join(tempDir, 'src/utils.test.ts'), `it('works', () => {});`);

    const capturedPrompt = await capturePrompt(
      tempDir,
      `Path: src/utils.ts\nFix the function.`,
      { maxFiles: 1, maxLines: 20 },
    );
    expect(capturedPrompt).toContain('READ-ONLY CONTEXT');
    expect(capturedPrompt).toContain('utils.test.ts');
    expect(capturedPrompt).toContain(`it('works'`);
  });

  it('injects imported file as READ-ONLY CONTEXT', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/helpers.ts'), 'export const helper = 42;');
    await writeFile(
      join(tempDir, 'src/main.ts'),
      `import { helper } from './helpers';\nexport const x = helper;`,
    );

    const capturedPrompt = await capturePrompt(
      tempDir,
      `Path: src/main.ts\nFix the import.`,
      { maxFiles: 1, maxLines: 20 },
    );
    expect(capturedPrompt).toContain('READ-ONLY CONTEXT');
    expect(capturedPrompt).toContain('helpers');
    expect(capturedPrompt).toContain('export const helper = 42');
  });

  it('does not include read-only context when no related files exist', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/standalone.ts'), 'export const x = 1;');

    const capturedPrompt = await capturePrompt(
      tempDir,
      `Path: src/standalone.ts\nFix the value.`,
      { maxFiles: 1, maxLines: 20 },
    );
    expect(capturedPrompt).not.toContain('READ-ONLY CONTEXT');
  });

  it('does not include an import as read-only if it is already in the editable set', async () => {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src/a.ts'), `import { b } from './b';\nexport const a = 1;`);
    await writeFile(join(tempDir, 'src/b.ts'), 'export const b = 2;');

    const capturedPrompt = await capturePrompt(
      tempDir,
      `Path: src/a.ts\nPath: src/b.ts\nFix both.`,
      { maxFiles: 2, maxLines: 50 },
    );
    // b.ts should appear in FILE CONTENTS (editable), not as READ-ONLY
    const readOnlySection = capturedPrompt.split('READ-ONLY CONTEXT')[1] ?? '';
    expect(readOnlySection).not.toContain('--- READ-ONLY: src/b.ts');
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock APIAgent, call build(), and return the prompt sent to the provider. */
async function capturePrompt(
  cwd: string,
  proposal: string,
  guards: { maxFiles: number; maxLines: number } | undefined,
): Promise<string> {
  const { APIAgent } = await import('../core/agents/api.js');
  let capturedPrompt = '';
  const mockProvider = {
    sendMessage: async (prompt: string) => {
      capturedPrompt = prompt;
      return '';
    },
  };
  const agent = new APIAgent({ provider: mockProvider as never });
  if (guards) agent.clickGuards = guards;
  // Set _issueDrivenClick = false so build() wraps in buildBuildPrompt
  await agent.build(proposal, cwd);
  return capturedPrompt;
}

/** Capture the prompt and return the file-injection section only. */
async function captureFileInjection(
  cwd: string,
  promptFilePath: string,
  sourceRoots: string[] | undefined,
): Promise<string> {
  const { APIAgent } = await import('../core/agents/api.js');
  let capturedPrompt = '';
  const mockProvider = {
    sendMessage: async (prompt: string) => {
      capturedPrompt = prompt;
      return '';
    },
  };
  const agent = new APIAgent({ provider: mockProvider as never });
  if (sourceRoots) agent.sourceRoots = sourceRoots;
  agent.clickGuards = { maxFiles: 1, maxLines: 20 };
  await agent.build(`Path: ${promptFilePath}\nFix the issue.`, cwd);
  return capturedPrompt;
}

// ── applyFileBlocks: pre-flight search text verification (fix 6) ─────────────

describe('applyFileBlocks — pre-flight search text verification (fix 6)', () => {
  it('applies edit when search text matches exactly', async () => {
    await writeFile(join(tempDir, 'target.ts'), 'const x = 1;\nconst y = 2;\n');
    const output = [
      'EDIT: target.ts',
      '<<<<<<< SEARCH',
      'const x = 1;',
      '=======',
      'const x = 42;',
      '>>>>>>> REPLACE',
      'MODIFIED: target.ts',
    ].join('\n');

    const { written, searchMisses } = await applyFileBlocks(output, tempDir);
    expect(written).toContain('target.ts');
    expect(searchMisses).toBe(0);
    const content = await readFile(join(tempDir, 'target.ts'), 'utf-8');
    expect(content).toContain('const x = 42;');
  });

  it('returns searchMisses > 0 when search text not found in file', async () => {
    await writeFile(join(tempDir, 'target.ts'), 'const x = 1;\n');
    const output = [
      'EDIT: target.ts',
      '<<<<<<< SEARCH',
      'const NONEXISTENT = 999;',
      '=======',
      'const NONEXISTENT = 0;',
      '>>>>>>> REPLACE',
    ].join('\n');

    const { written, searchMisses } = await applyFileBlocks(output, tempDir);
    expect(written).toHaveLength(0);
    expect(searchMisses).toBe(1);
  });

  it('returns success=false in build() when all EDIT blocks fail search match', async () => {
    await writeFile(join(tempDir, 'src.ts'), 'const a = 1;\n');
    const { APIAgent: APIAgentClass } = await import('../core/agents/api.js');
    const mockProvider = {
      sendMessage: async () => [
        'EDIT: src.ts',
        '<<<<<<< SEARCH',
        'THIS TEXT DOES NOT EXIST IN FILE',
        '=======',
        'replacement',
        '>>>>>>> REPLACE',
      ].join('\n'),
    };
    const agent = new APIAgentClass({ provider: mockProvider as never });
    const result = await agent.build('Fix the issue.', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('search text not found');
  });

  it('returns written files when at least one EDIT block succeeds', async () => {
    await writeFile(join(tempDir, 'a.ts'), 'const x = 1;\n');
    const output = [
      // Good edit
      'EDIT: a.ts',
      '<<<<<<< SEARCH',
      'const x = 1;',
      '=======',
      'const x = 99;',
      '>>>>>>> REPLACE',
      // Bad edit (nonexistent text) — should be counted as miss but not fail overall
      'EDIT: a.ts',
      '<<<<<<< SEARCH',
      'NONEXISTENT LINE',
      '=======',
      'replacement',
      '>>>>>>> REPLACE',
    ].join('\n');
    const { written, searchMisses } = await applyFileBlocks(output, tempDir);
    expect(written).toContain('a.ts');
    expect(searchMisses).toBe(1);
  });
});
