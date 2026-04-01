import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  classifyFiles,
  filterByClass,
  type FileClass,
} from '../src/core/file-classifier.js';

const VALID_CLASSES: FileClass[] = ['production', 'test', 'documentation', 'config'];

// ── classifyFile — production ─────────────────────────────────────────────────

describe('classifyFile — production files', () => {
  it('classifies regular .ts files as production', () => {
    const result = classifyFile('src/utils.ts');
    expect(result).toBe('production');
    expect(VALID_CLASSES).toContain(result);
    expect(result).not.toBe('test');
    expect(result).not.toBe('config');
    expect(result).not.toBe('documentation');
  });

  it('classifies .tsx files as production', () => {
    const result = classifyFile('src/components/Button.tsx');
    expect(result).toBe('production');
    expect(result).not.toBe('test');
    expect(result).not.toBe('documentation');
    expect(VALID_CLASSES).toContain(result);
  });

  it('classifies .js files as production', () => {
    const result = classifyFile('lib/index.js');
    expect(result).toBe('production');
    expect(result).not.toBe('config');
    expect(result).not.toBe('test');
  });

  it('classifies a deep nested source file as production', () => {
    const result = classifyFile('src/core/engine/runner.ts');
    expect(result).toBe('production');
    expect(result).not.toBe('test');
    expect(result).not.toBe('documentation');
    expect(typeof result).toBe('string');
  });

  it('classifies .mjs and .cjs files as production', () => {
    const r1 = classifyFile('lib/worker.mjs');
    const r2 = classifyFile('lib/compat.cjs');
    expect(r1).toBe('production');
    expect(r2).toBe('production');
    expect(r1).not.toBe('test');
    expect(r2).not.toBe('config');
  });
});

// ── classifyFile — test files ─────────────────────────────────────────────────

describe('classifyFile — test files', () => {
  it('classifies .test.ts files as test', () => {
    const result = classifyFile('src/utils.test.ts');
    expect(result).toBe('test');
    expect(result).not.toBe('production');
    expect(result).not.toBe('config');
    expect(result).not.toBe('documentation');
    expect(VALID_CLASSES).toContain(result);
  });

  it('classifies .spec.ts files as test', () => {
    const result = classifyFile('src/auth.spec.ts');
    expect(result).toBe('test');
    expect(result).not.toBe('production');
    expect(result).not.toBe('documentation');
  });

  it('classifies .test.js and .spec.js files as test', () => {
    const r1 = classifyFile('lib/utils.test.js');
    const r2 = classifyFile('lib/utils.spec.js');
    expect(r1).toBe('test');
    expect(r2).toBe('test');
    expect(r1).not.toBe('production');
    expect(r2).not.toBe('config');
  });

  it('classifies files in tests/ directory as test', () => {
    const result = classifyFile('tests/something.ts');
    expect(result).toBe('test');
    expect(result).not.toBe('production');
    expect(result).not.toBe('documentation');
    expect(typeof result).toBe('string');
  });

  it('classifies files in __tests__/ directory as test', () => {
    const result = classifyFile('__tests__/utils.ts');
    expect(result).toBe('test');
    expect(result).not.toBe('production');
    expect(VALID_CLASSES).toContain(result);
  });

  it('classifies files in test/ directory as test', () => {
    const result = classifyFile('test/helpers.ts');
    expect(result).toBe('test');
    expect(result).not.toBe('production');
    expect(result).not.toBe('config');
    expect(result).not.toBe('documentation');
  });
});

// ── classifyFile — documentation files ───────────────────────────────────────

describe('classifyFile — documentation files', () => {
  it('classifies .md files as documentation', () => {
    const result = classifyFile('README.md');
    expect(result).toBe('documentation');
    expect(result).not.toBe('production');
    expect(result).not.toBe('test');
    expect(result).not.toBe('config');
    expect(VALID_CLASSES).toContain(result);
  });

  it('classifies .txt files as documentation', () => {
    const result = classifyFile('notes.txt');
    expect(result).toBe('documentation');
    expect(result).not.toBe('production');
    expect(result).not.toBe('config');
  });

  it('classifies files in docs/ directory as documentation', () => {
    const result = classifyFile('docs/api.ts');
    expect(result).toBe('documentation');
    expect(result).not.toBe('production');
    expect(result).not.toBe('test');
    expect(typeof result).toBe('string');
  });

  it('classifies files in examples/ directory as documentation', () => {
    const result = classifyFile('examples/basic.ts');
    expect(result).toBe('documentation');
    expect(result).not.toBe('production');
    expect(result).not.toBe('config');
    expect(VALID_CLASSES).toContain(result);
  });

  it('classifies explanations.ts as documentation', () => {
    const result = classifyFile('src/core/explanations.ts');
    expect(result).toBe('documentation');
    expect(result).not.toBe('production');
    expect(result).not.toBe('test');
    expect(result).not.toBe('config');
  });

  it('classifies .example.ts and .example.js files as documentation', () => {
    const r1 = classifyFile('src/config.example.ts');
    const r2 = classifyFile('src/config.example.js');
    expect(r1).toBe('documentation');
    expect(r2).toBe('documentation');
    expect(r1).not.toBe('production');
    expect(r2).not.toBe('config');
  });
});

// ── classifyFile — config files ───────────────────────────────────────────────

describe('classifyFile — config files', () => {
  it('classifies .json files as config', () => {
    const result = classifyFile('package.json');
    expect(result).toBe('config');
    expect(result).not.toBe('production');
    expect(result).not.toBe('test');
    expect(result).not.toBe('documentation');
    expect(VALID_CLASSES).toContain(result);
  });

  it('classifies .yml and .yaml files as config', () => {
    const r1 = classifyFile('.github/workflows/ci.yml');
    const r2 = classifyFile('docker-compose.yaml');
    expect(r1).toBe('config');
    expect(r2).toBe('config');
    expect(r1).not.toBe('production');
    expect(r2).not.toBe('documentation');
  });

  it('classifies .toml files as config', () => {
    const result = classifyFile('Cargo.toml');
    expect(result).toBe('config');
    expect(result).not.toBe('production');
    expect(result).not.toBe('test');
    expect(typeof result).toBe('string');
  });

  it('classifies *.config.ts and *.config.js files as config', () => {
    const r1 = classifyFile('vitest.config.ts');
    const r2 = classifyFile('webpack.config.js');
    const r3 = classifyFile('vite.config.mjs');
    expect(r1).toBe('config');
    expect(r2).toBe('config');
    expect(r3).toBe('config');
    expect(r1).not.toBe('production');
  });

  it('classifies dotrc files as config', () => {
    const r1 = classifyFile('.eslintrc');
    const r2 = classifyFile('.babelrc');
    expect(r1).toBe('config');
    expect(r2).toBe('config');
    expect(r1).not.toBe('production');
    expect(r2).not.toBe('test');
  });
});

// ── classifyFiles ─────────────────────────────────────────────────────────────

describe('classifyFiles', () => {
  it('returns a Map with one entry per file', () => {
    const files = ['src/utils.ts', 'tests/utils.test.ts', 'package.json'];
    const result = classifyFiles(files);
    expect(result.size).toBe(3);
    expect(result.has('src/utils.ts')).toBe(true);
    expect(result.has('tests/utils.test.ts')).toBe(true);
    expect(result.has('package.json')).toBe(true);
  });

  it('correctly classifies each file in the map', () => {
    const files = ['src/app.ts', 'app.test.ts', 'README.md', 'tsconfig.json'];
    const result = classifyFiles(files);
    expect(result.get('src/app.ts')).toBe('production');
    expect(result.get('app.test.ts')).toBe('test');
    expect(result.get('README.md')).toBe('documentation');
    expect(result.get('tsconfig.json')).toBe('config');
  });

  it('returns empty map for empty input', () => {
    const result = classifyFiles([]);
    expect(result.size).toBe(0);
    expect(result instanceof Map).toBe(true);
  });

  it('all values in the map are valid FileClass types', () => {
    const files = ['src/a.ts', 'b.test.ts', 'docs/c.ts', 'd.json'];
    const result = classifyFiles(files);
    for (const [, cls] of result) {
      expect(VALID_CLASSES).toContain(cls);
    }
    expect(result.size).toBe(4);
  });

  it('handles many files of different types', () => {
    const files = [
      'src/index.ts', 'src/utils.ts',
      'tests/index.test.ts', 'tests/utils.test.ts',
      'README.md', 'CHANGELOG.md',
      'package.json', 'tsconfig.json',
    ];
    const result = classifyFiles(files);
    expect(result.size).toBe(8);
    const productions = [...result.values()].filter(v => v === 'production');
    const tests = [...result.values()].filter(v => v === 'test');
    const docs = [...result.values()].filter(v => v === 'documentation');
    const configs = [...result.values()].filter(v => v === 'config');
    expect(productions.length).toBe(2);
    expect(tests.length).toBe(2);
    expect(docs.length).toBe(2);
    expect(configs.length).toBe(2);
  });
});

// ── filterByClass ─────────────────────────────────────────────────────────────

describe('filterByClass', () => {
  const files = ['src/app.ts', 'app.test.ts', 'README.md', 'tsconfig.json'];
  const classifications = classifyFiles(files);

  it('filters to production files only', () => {
    const result = filterByClass(files, classifications, 'production');
    expect(result).toHaveLength(1);
    expect(result).toContain('src/app.ts');
    expect(result).not.toContain('app.test.ts');
    expect(result).not.toContain('README.md');
  });

  it('filters to test files only', () => {
    const result = filterByClass(files, classifications, 'test');
    expect(result).toHaveLength(1);
    expect(result).toContain('app.test.ts');
    expect(result).not.toContain('src/app.ts');
    expect(result).not.toContain('tsconfig.json');
  });

  it('filters to documentation files only', () => {
    const result = filterByClass(files, classifications, 'documentation');
    expect(result).toHaveLength(1);
    expect(result).toContain('README.md');
    expect(result).not.toContain('src/app.ts');
  });

  it('filters to config files only', () => {
    const result = filterByClass(files, classifications, 'config');
    expect(result).toHaveLength(1);
    expect(result).toContain('tsconfig.json');
    expect(result).not.toContain('README.md');
  });

  it('supports filtering by multiple classes', () => {
    const result = filterByClass(files, classifications, 'production', 'test');
    expect(result).toHaveLength(2);
    expect(result).toContain('src/app.ts');
    expect(result).toContain('app.test.ts');
    expect(result).not.toContain('README.md');
    expect(result).not.toContain('tsconfig.json');
  });

  it('returns all files when all classes are included', () => {
    const result = filterByClass(files, classifications, 'production', 'test', 'documentation', 'config');
    expect(result).toHaveLength(4);
    expect(result).toContain('src/app.ts');
    expect(result).toContain('app.test.ts');
    expect(result).toContain('README.md');
    expect(result).toContain('tsconfig.json');
  });

  it('returns empty array for empty file list', () => {
    const result = filterByClass([], classifications, 'production');
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it('defaults to production for files not in the map', () => {
    const emptyMap = new Map<string, FileClass>();
    const result = filterByClass(['unknown.ts'], emptyMap, 'production');
    expect(result).toContain('unknown.ts');
    expect(result).toHaveLength(1);
    expect(Array.isArray(result)).toBe(true);
  });

  it('preserves file order from input', () => {
    const result = filterByClass(files, classifications, 'production', 'test', 'documentation', 'config');
    expect(result[0]).toBe('src/app.ts');
    expect(result[1]).toBe('app.test.ts');
    expect(result[2]).toBe('README.md');
    expect(result[3]).toBe('tsconfig.json');
  });
});
