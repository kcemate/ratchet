import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('applyFileBlocks', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ratchet-api-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes a single file block to disk', async () => {
    const { applyFileBlocks } = await import('../core/agents/api.js');
    const output = `Here's the fix:

FILE: src/utils.ts
\`\`\`typescript
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

MODIFIED: src/utils.ts`;

    const { written } = await applyFileBlocks(output, tempDir);
    expect(written).toEqual(['src/utils.ts']);

    const content = await readFile(join(tempDir, 'src/utils.ts'), 'utf-8');
    expect(content).toContain('export function add');
    expect(content).toContain('return a + b');
  });

  it('writes multiple file blocks', async () => {
    const { applyFileBlocks } = await import('../core/agents/api.js');
    const output = `FILE: src/a.ts
\`\`\`
const a = 1;
\`\`\`

FILE: src/b.ts
\`\`\`
const b = 2;
\`\`\`

MODIFIED: src/a.ts
MODIFIED: src/b.ts`;

    const { written } = await applyFileBlocks(output, tempDir);
    expect(written).toHaveLength(2);
    expect(written).toContain('src/a.ts');
    expect(written).toContain('src/b.ts');
  });

  it('rejects absolute paths', async () => {
    const { applyFileBlocks } = await import('../core/agents/api.js');
    const output = `FILE: /etc/passwd
\`\`\`
hacked
\`\`\``;

    const { written } = await applyFileBlocks(output, tempDir);
    expect(written).toHaveLength(0);
  });

  it('rejects path traversal', async () => {
    const { applyFileBlocks } = await import('../core/agents/api.js');
    const output = `FILE: ../../../etc/passwd
\`\`\`
hacked
\`\`\``;

    const { written } = await applyFileBlocks(output, tempDir);
    expect(written).toHaveLength(0);
  });

  it('rejects non-source file extensions', async () => {
    const { applyFileBlocks } = await import('../core/agents/api.js');
    const output = `FILE: src/script.sh
\`\`\`
rm -rf /
\`\`\``;

    const { written } = await applyFileBlocks(output, tempDir);
    expect(written).toHaveLength(0);
  });

  it('handles empty output gracefully', async () => {
    const { applyFileBlocks } = await import('../core/agents/api.js');
    const { written, searchMisses } = await applyFileBlocks('No code blocks here', tempDir);
    expect(written).toHaveLength(0);
    expect(searchMisses).toBe(0);
  });

  it('creates nested directories as needed', async () => {
    const { applyFileBlocks } = await import('../core/agents/api.js');
    const output = `FILE: src/deep/nested/dir/file.ts
\`\`\`
export const x = 42;
\`\`\``;

    const { written } = await applyFileBlocks(output, tempDir);
    expect(written).toEqual(['src/deep/nested/dir/file.ts']);
    const content = await readFile(join(tempDir, 'src/deep/nested/dir/file.ts'), 'utf-8');
    expect(content).toContain('export const x = 42');
  });
});
