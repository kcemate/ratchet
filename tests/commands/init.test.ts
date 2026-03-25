import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectProject, buildConfig, classifyRepo } from '../../src/commands/init.js';
import type { DetectedProject } from '../../src/commands/init.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ratchet-init-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('detectProject', () => {
  it('detects npm project (package.json)', async () => {
    await writeFile(join(tmp, 'package.json'), '{}');
    const result = await detectProject(tmp);
    expect(result.type).toBe('node');
    expect(result.testCommand).toBe('npm test');
    expect(result.packageManager).toBe('npm');
  });

  it('detects yarn project (yarn.lock)', async () => {
    await writeFile(join(tmp, 'package.json'), '{}');
    await writeFile(join(tmp, 'yarn.lock'), '');
    const result = await detectProject(tmp);
    expect(result.type).toBe('node');
    expect(result.testCommand).toBe('yarn test');
    expect(result.packageManager).toBe('yarn');
  });

  it('detects pnpm project (pnpm-lock.yaml)', async () => {
    await writeFile(join(tmp, 'package.json'), '{}');
    await writeFile(join(tmp, 'pnpm-lock.yaml'), '');
    const result = await detectProject(tmp);
    expect(result.type).toBe('node');
    expect(result.testCommand).toBe('pnpm test');
    expect(result.packageManager).toBe('pnpm');
  });

  it('detects python project (pytest.ini)', async () => {
    await writeFile(join(tmp, 'pytest.ini'), '');
    const result = await detectProject(tmp);
    expect(result.type).toBe('python');
    expect(result.testCommand).toBe('pytest');
  });

  it('detects python project (pyproject.toml)', async () => {
    await writeFile(join(tmp, 'pyproject.toml'), '');
    const result = await detectProject(tmp);
    expect(result.type).toBe('python');
    expect(result.testCommand).toBe('pytest');
  });

  it('detects python project (setup.py)', async () => {
    await writeFile(join(tmp, 'setup.py'), '');
    const result = await detectProject(tmp);
    expect(result.type).toBe('python');
    expect(result.testCommand).toBe('pytest');
  });

  it('detects go project (go.mod)', async () => {
    await writeFile(join(tmp, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');
    const result = await detectProject(tmp);
    expect(result.type).toBe('go');
    expect(result.testCommand).toBe('go test ./...');
  });

  it('detects rust project (Cargo.toml)', async () => {
    await writeFile(join(tmp, 'Cargo.toml'), '[package]\nname = "app"\n');
    const result = await detectProject(tmp);
    expect(result.type).toBe('rust');
    expect(result.testCommand).toBe('cargo test');
  });

  it('detects make project (Makefile)', async () => {
    await writeFile(join(tmp, 'Makefile'), 'test:\n\techo test\n');
    const result = await detectProject(tmp);
    expect(result.type).toBe('make');
    expect(result.testCommand).toBe('make test');
  });

  it('falls back to unknown for empty directory', async () => {
    const result = await detectProject(tmp);
    expect(result.type).toBe('unknown');
    expect(result.testCommand).toBe('npm test');
  });

  it('prefers pnpm over yarn when both lockfiles exist', async () => {
    await writeFile(join(tmp, 'package.json'), '{}');
    await writeFile(join(tmp, 'pnpm-lock.yaml'), '');
    await writeFile(join(tmp, 'yarn.lock'), '');
    const result = await detectProject(tmp);
    expect(result.testCommand).toBe('pnpm test');
  });
});

describe('buildConfig', () => {
  const project: DetectedProject = {
    type: 'node',
    testCommand: 'npm test',
    packageManager: 'npm',
  };

  it('includes agent and model fields', () => {
    const config = buildConfig(project, 'src');
    expect(config).toContain('agent: claude-code');
    expect(config).toContain('model: claude-sonnet-4-6');
  });

  it('includes the detected test command', () => {
    const config = buildConfig(project, 'src');
    expect(config).toContain('test_command: npm test');
  });

  it('sets default click count to 7', () => {
    const config = buildConfig(project, 'src');
    expect(config).toContain('clicks: 7');
  });

  it('appends trailing slash to path', () => {
    const config = buildConfig(project, 'src');
    expect(config).toContain('path: src/');
  });

  it('handles path already ending with slash', () => {
    const config = buildConfig(project, 'src/');
    expect(config).toContain('path: src/');
    // Should not double-slash
    expect(config).not.toContain('path: src//');
  });

  it('includes boundaries section as comments', () => {
    const config = buildConfig(project, 'src');
    expect(config).toContain('# boundaries:');
  });

  it('generates valid target name from path', () => {
    const config = buildConfig(project, 'src/api');
    expect(config).toContain('name: api');
  });

  it('uses different test commands per project type', () => {
    const goProject: DetectedProject = { type: 'go', testCommand: 'go test ./...' };
    const config = buildConfig(goProject, 'pkg');
    expect(config).toContain('test_command: go test ./...');
  });
});

describe('classifyRepo', () => {
  it('classifies an empty directory as unknown project', async () => {
    const result = await classifyRepo(tmp);
    expect(result.framework).toBe('Unknown project');
    expect(result.excludeDirs).toEqual([]);
  });

  it('classifies a plain Node.js project (no framework deps)', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ name: 'my-lib' }));
    const result = await classifyRepo(tmp);
    expect(result.framework).toBe('Node.js library');
  });

  it('classifies a Next.js project by next.config.js', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
    const result = await classifyRepo(tmp);
    expect(result.framework).toBe('Next.js app');
  });

  it('classifies a React app by react dependency', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ dependencies: { react: '18.0.0' } }));
    const result = await classifyRepo(tmp);
    expect(result.framework).toBe('React app');
  });

  it('classifies an Express project', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ dependencies: { express: '4.18.0' } }));
    const result = await classifyRepo(tmp);
    expect(result.framework).toBe('Express API');
  });

  it('detects migrations/ as an exclude dir', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ name: 'app' }));
    const { mkdir } = await import('fs/promises');
    await mkdir(join(tmp, 'migrations'));
    const result = await classifyRepo(tmp);
    expect(result.excludeDirs).toContain('migrations/');
  });

  it('detects __fixtures__/ as an exclude dir', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ name: 'app' }));
    const { mkdir } = await import('fs/promises');
    await mkdir(join(tmp, '__fixtures__'));
    const result = await classifyRepo(tmp);
    expect(result.excludeDirs).toContain('__fixtures__/');
  });

  it('detects multiple exclude dirs at once', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ name: 'app' }));
    const { mkdir } = await import('fs/promises');
    await mkdir(join(tmp, 'migrations'));
    await mkdir(join(tmp, 'fixtures'));
    await mkdir(join(tmp, 'scripts'));
    const result = await classifyRepo(tmp);
    expect(result.excludeDirs).toContain('migrations/');
    expect(result.excludeDirs).toContain('fixtures/');
    expect(result.excludeDirs).toContain('scripts/');
  });

  it('returns no excludeDirs for a minimal project', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ name: 'clean-app' }));
    const result = await classifyRepo(tmp);
    expect(result.excludeDirs).toEqual([]);
  });

  it('classifies Go project without package.json', async () => {
    await writeFile(join(tmp, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');
    const result = await classifyRepo(tmp);
    expect(result.framework).toBe('Go project');
  });

  it('prefers Next.js over React when both deps exist', async () => {
    await writeFile(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { next: '14.0.0', react: '18.0.0' } }),
    );
    const result = await classifyRepo(tmp);
    expect(result.framework).toBe('Next.js app');
  });
});
