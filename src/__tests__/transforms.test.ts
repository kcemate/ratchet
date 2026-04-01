/**
 * AST Transform Foundation — unit tests
 * Phase 1: wrap-async, replace-console, add-catch-handler, registry, applyTransforms
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { wrapAsyncTransform } from '../core/transforms/wrap-async.js';
import { replaceConsoleTransform } from '../core/transforms/replace-console.js';
import { addCatchHandlerTransform } from '../core/transforms/add-catch-handler.js';
import {
  getTransform,
  registerTransform,
  listTransforms,
  tagFindingsWithTransforms,
  transformRegistry,
} from '../core/transforms/registry.js';
import { applyTransforms, isTestFile, isSupportedLanguage } from '../core/transforms/base.js';
import type { TransformContext } from '../core/transforms/base.js';
import type { Finding } from '../core/normalize.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    category: 'Error Handling',
    subcategory: 'unhandled async',
    severity: 'high',
    message: 'Async function has no error handling',
    confidence: 0.9,
    source: 'classic',
    file: 'src/service.ts',
    ...overrides,
  };
}

function makeContext(overrides: Partial<TransformContext> = {}): TransformContext {
  return {
    filePath: 'src/service.ts',
    repoContext: {} as any,
    existingImports: [],
    testRunner: 'vitest',
    hasStructuredLogger: false,
    loggerImportPath: null,
    loggerVarName: 'logger',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// wrap-async tests
// ---------------------------------------------------------------------------

describe('wrap-async transform', () => {
  const ctx = makeContext();
  const finding = makeFinding({ file: 'src/service.ts', subcategory: 'unhandled async' });

  it('wraps a simple async function body', () => {
    const source = `async function fetchData() {\n  const result = await getData();\n  return result;\n}\n`;
    const result = wrapAsyncTransform.apply(source, finding, ctx);
    expect(result).not.toBeNull();
    expect(result).toContain('try {');
    expect(result).toContain('} catch (error) {');
    expect(result).toContain('console.error');
  });

  it('wraps an async arrow function', () => {
    const source = `const handler = async (req, res) => {\n  const data = await fetchData();\n  res.json(data);\n};\n`;
    const result = wrapAsyncTransform.apply(source, finding, ctx);
    expect(result).not.toBeNull();
    expect(result).toContain('try {');
    expect(result).toContain('} catch');
  });

  it('wraps an async class method', () => {
    const source = `class Service {\n  async getData() {\n    return await fetch('/api');\n  }\n}\n`;
    const result = wrapAsyncTransform.apply(source, finding, ctx);
    expect(result).not.toBeNull();
    expect(result).toContain('try {');
  });

  it('skips function already wrapped in try/catch', () => {
    const source = `async function safe() {\n  try {\n    await doWork();\n  } catch (e) {\n    console.error(e);\n  }\n}\n`;
    const result = wrapAsyncTransform.apply(source, finding, ctx);
    expect(result).toBeNull();
  });

  it('returns null for source with no async functions', () => {
    const source = `function sync() {\n  return 42;\n}\n`;
    const result = wrapAsyncTransform.apply(source, finding, ctx);
    expect(result).toBeNull();
  });

  it('uses structured logger when configured', () => {
    const logCtx = makeContext({
      hasStructuredLogger: true,
      loggerImportPath: '../lib/logger.js',
      loggerVarName: 'logger',
    });
    const source = `async function run() {\n  await doTask();\n}\n`;
    const result = wrapAsyncTransform.apply(source, finding, logCtx);
    expect(result).not.toBeNull();
    expect(result).toContain('logger.error');
  });

  it('adds logger import when structured logger is configured', () => {
    const logCtx = makeContext({
      hasStructuredLogger: true,
      loggerImportPath: '../lib/logger.js',
      loggerVarName: 'logger',
    });
    const source = `async function run() {\n  await doTask();\n}\n`;
    const result = wrapAsyncTransform.apply(source, finding, logCtx)!;
    expect(result).toContain(`import { logger } from '../lib/logger.js'`);
  });

  it('does not add duplicate logger import', () => {
    const logCtx = makeContext({
      hasStructuredLogger: true,
      loggerImportPath: '../lib/logger.js',
      loggerVarName: 'logger',
      existingImports: [`import { logger } from '../lib/logger.js';`],
    });
    const source = `import { logger } from '../lib/logger.js';\nasync function run() {\n  await doTask();\n}\n`;
    const result = wrapAsyncTransform.apply(source, finding, logCtx)!;
    const importCount = (result.match(/from '\.\.\/lib\/logger\.js'/g) ?? []).length;
    expect(importCount).toBe(1);
  });

  it('skips test files', () => {
    const testCtx = makeContext({ filePath: 'src/__tests__/service.test.ts' });
    const source = `async function test() {\n  await doWork();\n}\n`;
    const result = wrapAsyncTransform.apply(source, finding, testCtx);
    expect(result).toBeNull();
  });

  it('canApply returns true for async source', () => {
    const source = `async function f() { return 1; }`;
    expect(wrapAsyncTransform.canApply(source, finding)).toBe(true);
  });

  it('canApply returns false when no async', () => {
    const source = `function f() { return 1; }`;
    expect(wrapAsyncTransform.canApply(source, finding)).toBe(false);
  });

  it('is idempotent (applying twice produces same result)', () => {
    const source = `async function run() {\n  await doTask();\n}\n`;
    const first = wrapAsyncTransform.apply(source, finding, ctx)!;
    const second = wrapAsyncTransform.apply(first, finding, ctx);
    // Second application should return null (already wrapped) or same content
    expect(second === null || second === first).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// replace-console tests
// ---------------------------------------------------------------------------

describe('replace-console transform', () => {
  const ctx = makeContext();
  const finding = makeFinding({ subcategory: 'console in production', file: 'src/app.ts' });

  it('replaces console.log', () => {
    const source = `console.log('hello', value);\n`;
    const result = replaceConsoleTransform.apply(source, finding, ctx);
    expect(result).not.toBeNull();
    expect(result).not.toContain('console.log');
    expect(result).toContain('logger.info');
  });

  it('replaces console.error', () => {
    const source = `console.error('failed', err);\n`;
    const result = replaceConsoleTransform.apply(source, finding, ctx);
    expect(result).toContain('logger.error');
  });

  it('replaces console.warn', () => {
    const source = `console.warn('deprecated');\n`;
    const result = replaceConsoleTransform.apply(source, finding, ctx);
    expect(result).toContain('logger.warn');
  });

  it('replaces console.info', () => {
    const source = `console.info('started');\n`;
    const result = replaceConsoleTransform.apply(source, finding, ctx);
    expect(result).toContain('logger.info');
  });

  it('replaces console.debug', () => {
    const source = `console.debug('trace', obj);\n`;
    const result = replaceConsoleTransform.apply(source, finding, ctx);
    expect(result).toContain('logger.debug');
  });

  it('skips test files (*.test.ts)', () => {
    const testCtx = makeContext({ filePath: 'src/app.test.ts' });
    const source = `console.log('test output');\n`;
    const result = replaceConsoleTransform.apply(source, finding, testCtx);
    expect(result).toBeNull();
  });

  it('skips test files (__tests__/ dir)', () => {
    const testCtx = makeContext({ filePath: 'src/__tests__/app.ts' });
    const source = `console.log('test output');\n`;
    const result = replaceConsoleTransform.apply(source, finding, testCtx);
    expect(result).toBeNull();
  });

  it('adds structured logger import when configured', () => {
    const logCtx = makeContext({
      hasStructuredLogger: true,
      loggerImportPath: '../lib/logger.js',
      loggerVarName: 'logger',
    });
    const source = `console.log('hello');\n`;
    const result = replaceConsoleTransform.apply(source, finding, logCtx)!;
    expect(result).toContain(`import { logger } from '../lib/logger.js'`);
  });

  it('does not duplicate logger import', () => {
    const logCtx = makeContext({
      hasStructuredLogger: true,
      loggerImportPath: '../lib/logger.js',
      loggerVarName: 'logger',
    });
    const source = `import { logger } from '../lib/logger.js';\nconsole.log('hi');\n`;
    const result = replaceConsoleTransform.apply(source, finding, logCtx)!;
    const count = (result.match(/from '\.\.\/lib\/logger\.js'/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('returns null when no console calls present', () => {
    const source = `const x = 1;\n`;
    const result = replaceConsoleTransform.apply(source, finding, ctx);
    expect(result).toBeNull();
  });

  it('is idempotent for structured logger', () => {
    const logCtx = makeContext({
      hasStructuredLogger: true,
      loggerImportPath: '../lib/logger.js',
      loggerVarName: 'logger',
    });
    const source = `console.log('test');\n`;
    const first = replaceConsoleTransform.apply(source, finding, logCtx)!;
    const second = replaceConsoleTransform.apply(first, finding, logCtx);
    // No more console calls in first result — second must be null
    expect(second).toBeNull();
  });

  it('canApply returns true when console calls present', () => {
    expect(replaceConsoleTransform.canApply(`console.log('x');`, finding)).toBe(true);
  });

  it('canApply returns false for test files', () => {
    const testFinding = makeFinding({ file: 'src/__tests__/app.test.ts' });
    expect(replaceConsoleTransform.canApply(`console.log('x');`, testFinding)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// add-catch-handler tests
// ---------------------------------------------------------------------------

describe('add-catch-handler transform', () => {
  const ctx = makeContext();
  const finding = makeFinding({ subcategory: 'empty catch', file: 'src/service.ts' });

  it('fills an empty catch block', () => {
    const source = `try {\n  doWork();\n} catch (e) {\n}\n`;
    const result = addCatchHandlerTransform.apply(source, finding, ctx);
    expect(result).not.toBeNull();
    expect(result).toContain('console.error');
  });

  it('does not modify a catch block with content', () => {
    const source = `try {\n  doWork();\n} catch (e) {\n  console.error(e);\n}\n`;
    const result = addCatchHandlerTransform.apply(source, finding, ctx);
    expect(result).toBeNull();
  });

  it('uses logger when structured logger configured', () => {
    const logCtx = makeContext({
      hasStructuredLogger: true,
      loggerImportPath: '../lib/logger.js',
      loggerVarName: 'logger',
    });
    const source = `try {\n  doWork();\n} catch (err) {\n}\n`;
    const result = addCatchHandlerTransform.apply(source, finding, logCtx)!;
    expect(result).toContain('logger.error');
  });

  it('uses the catch variable name from the clause', () => {
    const source = `try {\n  doWork();\n} catch (myError) {\n}\n`;
    const result = addCatchHandlerTransform.apply(source, finding, ctx)!;
    expect(result).toContain('myError');
  });

  it('handles nested catch blocks', () => {
    const source = `try {\n  try {\n    inner();\n  } catch (inner) {}\n  outer();\n} catch (e) {}\n`;
    const result = addCatchHandlerTransform.apply(source, finding, ctx)!;
    expect(result).not.toBeNull();
    // Both empty catches should be filled
    const errorCount = (result.match(/console\.error/g) ?? []).length;
    expect(errorCount).toBeGreaterThanOrEqual(2);
  });

  it('skips test files', () => {
    const testCtx = makeContext({ filePath: 'src/__tests__/service.test.ts' });
    const source = `try { doWork(); } catch (e) {}\n`;
    const result = addCatchHandlerTransform.apply(source, finding, testCtx);
    expect(result).toBeNull();
  });

  it('returns null when no empty catch blocks exist', () => {
    const source = `const x = 1 + 2;\n`;
    const result = addCatchHandlerTransform.apply(source, finding, ctx);
    expect(result).toBeNull();
  });

  it('is idempotent', () => {
    const source = `try {\n  doWork();\n} catch (e) {\n}\n`;
    const first = addCatchHandlerTransform.apply(source, finding, ctx)!;
    const second = addCatchHandlerTransform.apply(first, finding, ctx);
    // After first apply, block is no longer empty
    expect(second).toBeNull();
  });

  it('canApply detects empty catch', () => {
    expect(addCatchHandlerTransform.canApply('try {} catch (e) {}', finding)).toBe(true);
  });

  it('canApply returns false for test file findings', () => {
    const testFinding = makeFinding({ file: 'src/__tests__/x.test.ts' });
    expect(addCatchHandlerTransform.canApply('try {} catch (e) {}', testFinding)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe('transform registry', () => {
  it('getTransform returns wrap-async-try-catch', () => {
    const t = getTransform('wrap-async-try-catch');
    expect(t).not.toBeNull();
    expect(t?.id).toBe('wrap-async-try-catch');
  });

  it('getTransform returns replace-console-logger', () => {
    const t = getTransform('replace-console-logger');
    expect(t).not.toBeNull();
  });

  it('getTransform returns add-empty-catch-handler', () => {
    const t = getTransform('add-empty-catch-handler');
    expect(t).not.toBeNull();
  });

  it('getTransform returns null for unknown id', () => {
    expect(getTransform('does-not-exist')).toBeNull();
  });

  it('registerTransform adds a new transform', () => {
    const stub = {
      id: 'test-stub-transform',
      matchesFindings: ['stub-test'],
      languages: ['typescript' as const],
      apply: () => null,
      canApply: () => false,
    };
    registerTransform(stub);
    expect(getTransform('test-stub-transform')).toBe(stub);
    // Cleanup
    transformRegistry.delete('test-stub-transform');
  });

  it('listTransforms returns all registered transforms', () => {
    const all = listTransforms();
    expect(all.length).toBeGreaterThanOrEqual(3);
    const ids = all.map(t => t.id);
    expect(ids).toContain('wrap-async-try-catch');
    expect(ids).toContain('replace-console-logger');
    expect(ids).toContain('add-empty-catch-handler');
  });

  it('tagFindingsWithTransforms sets transformId on matching finding', () => {
    const findings: Finding[] = [
      makeFinding({ subcategory: 'unhandled async', fixStrategy: undefined, transformId: undefined }),
    ];
    tagFindingsWithTransforms(findings);
    expect(findings[0].transformId).toBe('wrap-async-try-catch');
    expect(findings[0].fixStrategy).toBe('ast');
  });

  it('tagFindingsWithTransforms sets fixStrategy=intent for unmatched findings', () => {
    const findings: Finding[] = [
      makeFinding({ subcategory: 'something exotic with no transform', fixStrategy: undefined }),
    ];
    tagFindingsWithTransforms(findings);
    expect(findings[0].fixStrategy).toBe('intent');
    expect(findings[0].transformId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyTransforms integration tests
// ---------------------------------------------------------------------------

describe('applyTransforms', () => {
  const baseCtx = {
    repoContext: {} as any,
    testRunner: 'vitest',
    hasStructuredLogger: false,
    loggerImportPath: null,
    loggerVarName: 'logger',
  };

  it('applies matching transform to a file', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/service.ts', subcategory: 'empty catch' }),
    ];
    const fileContents = new Map([['src/service.ts', `try { doWork(); } catch (e) {}\n`]]);
    const { modifiedFiles, handledFindings } = applyTransforms(
      findings, fileContents, baseCtx, transformRegistry,
    );
    expect(handledFindings).toHaveLength(1);
    expect(modifiedFiles.has('src/service.ts')).toBe(true);
  });

  it('puts unmatched findings in unhandledFindings', () => {
    const findings: Finding[] = [
      makeFinding({ subcategory: 'no matching transform exists', file: 'src/x.ts' }),
    ];
    const fileContents = new Map([['src/x.ts', `const x = 1;\n`]]);
    const { unhandledFindings, handledFindings } = applyTransforms(
      findings, fileContents, baseCtx, transformRegistry,
    );
    expect(unhandledFindings).toHaveLength(1);
    expect(handledFindings).toHaveLength(0);
  });

  it('skips findings with no file path', () => {
    const findings: Finding[] = [makeFinding({ file: undefined, subcategory: 'empty catch' })];
    const { unhandledFindings } = applyTransforms(findings, new Map(), baseCtx, transformRegistry);
    expect(unhandledFindings).toHaveLength(1);
  });

  it('skips test file findings', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/__tests__/svc.test.ts', subcategory: 'empty catch' }),
    ];
    const fileContents = new Map([['src/__tests__/svc.test.ts', `try {} catch (e) {}\n`]]);
    const { unhandledFindings } = applyTransforms(findings, fileContents, baseCtx, transformRegistry);
    expect(unhandledFindings).toHaveLength(1);
  });

  it('applies multiple transforms to the same file (chained)', () => {
    // Two findings on the same file — second uses already-modified content
    const findings: Finding[] = [
      makeFinding({ file: 'src/multi.ts', subcategory: 'empty catch' }),
      makeFinding({ file: 'src/multi.ts', subcategory: 'console in production' }),
    ];
    const fileContents = new Map([
      ['src/multi.ts', `try { doWork(); } catch (e) {}\nconsole.log('hi');\n`],
    ]);
    const { handledFindings, modifiedFiles } = applyTransforms(
      findings, fileContents, baseCtx, transformRegistry,
    );
    expect(handledFindings.length).toBeGreaterThanOrEqual(1);
    expect(modifiedFiles.has('src/multi.ts')).toBe(true);
  });

  it('gracefully handles missing file content', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/missing.ts', subcategory: 'empty catch' }),
    ];
    const { unhandledFindings } = applyTransforms(findings, new Map(), baseCtx, transformRegistry);
    expect(unhandledFindings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// isTestFile / isSupportedLanguage helpers
// ---------------------------------------------------------------------------

describe('base helpers', () => {
  it('isTestFile detects __tests__ dir', () => {
    expect(isTestFile('src/__tests__/foo.ts')).toBe(true);
  });

  it('isTestFile detects .test.ts suffix', () => {
    expect(isTestFile('src/app.test.ts')).toBe(true);
  });

  it('isTestFile detects .spec.ts suffix', () => {
    expect(isTestFile('src/app.spec.ts')).toBe(true);
  });

  it('isTestFile returns false for production files', () => {
    expect(isTestFile('src/app.ts')).toBe(false);
  });

  it('isSupportedLanguage returns true for .ts', () => {
    expect(isSupportedLanguage('src/app.ts')).toBe(true);
  });

  it('isSupportedLanguage returns true for .js', () => {
    expect(isSupportedLanguage('src/app.js')).toBe(true);
  });

  it('isSupportedLanguage returns false for .py', () => {
    expect(isSupportedLanguage('src/app.py')).toBe(false);
  });
});
