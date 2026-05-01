import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shellSource = readFileSync(join(process.cwd(), 'src/core/agents/shell.ts'), 'utf8');

describe('shell prompt source', () => {
  it('keeps SEARCH BLOCK RULES inside valid string fragments', () => {
    expect(shellSource).toContain('Ensure your replacement code is syntactically valid');
    expect(shellSource).toContain('`OUTPUT FORMAT (output NOTHING except this):\\n\\n` +');
    expect(shellSource).not.toContain('`OUTPUT FORMAT (output NOTHING except this):\\n\\n`OUTPUT');
    expect(shellSource).not.toContain('rollback."\\n\n  );');
  });
});
