import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';
import type { ASTTransform, TransformContext } from './base.js';
import type { Finding } from '../normalize.js';
import { isTestFile } from './base.js';

// Mock the dependencies
vi.mock('ts-morph', () => ({
  Project: vi.fn().mockImplementation(() => ({
    createSourceFile: vi.fn().mockImplementation((_, source) => ({
      getFullText: () => source,
      getDescendantsOfKind: vi.fn().mockImplementation((kind) => {
        if (kind === SyntaxKind.TryStatement) {
          return [{
            getCatchClause: () => ({
              getBlock: () => ({
                getStatements: () => [],
                addStatements: vi.fn(),
              }),
              getVariableDeclaration: () => ({
                getName: () => 'e',
              }),
            }),
          }];
        }
        return [];
      }),
    })),
  })),
  SyntaxKind: {
    TryStatement: 'TryStatement',
  },
}));

vi.mock('./base.js', () => ({
  isTestFile: vi.fn().mockReturnValue(false),
}));

import { addCatchHandlerTransform } from './add-catch-handler.js';

describe('addCatchHandlerTransform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null for test files', () => {
    const finding = { file: 'test.spec.ts' };
    const context = { filePath: 'test.spec.ts' };
    const source = 'try {} catch(e) {}';
    
    vi.mocked(isTestFile).mockReturnValue(true);
    
    const result = addCatchHandlerTransform.apply(source, finding, context as any);
    expect(result).toBeNull();
  });

  it('should add error logging to empty catch block', () => {
    const finding = { file: 'module.ts' };
    const context = {
      filePath: 'module.ts',
      hasStructuredLogger: false,
      loggerVarName: 'console',
    };
    const source = 'try { risky(); } catch(e) {}';
    
    const result = addCatchHandlerTransform.apply(source, finding, context as any);
    expect(result).toContain('console.error(\'Caught error\', e);');
  });

  it('should use structured logger when available', () => {
    const finding = { file: 'module.ts' };
    const context = {
      filePath: 'module.ts',
      hasStructuredLogger: true,
      loggerVarName: 'logger',
      loggerImportPath: './logger.js',
    };
    const source = 'try { risky(); } catch(error) {}';
    
    const result = addCatchHandlerTransform.apply(source, finding, context as any);
    expect(result).toContain('logger.error(\'Caught error\', error);');
    expect(result).toContain("import { logger } from './logger.js';");
  });

  it('should not modify catch blocks that already have content', () => {
    const finding = { file: 'module.ts' };
    const context = { filePath: 'module.ts', hasStructuredLogger: false };
    const source = 'try { risky(); } catch(e) { console.log(e); }';
    
    const result = addCatchHandlerTransform.apply(source, finding, context as any);
    expect(result).toBeNull();
  });

  it('should handle catch without variable declaration', () => {
    const finding = { file: 'module.ts' };
    const context = { filePath: 'module.ts', hasStructuredLogger: false };
    const source = 'try { risky(); } catch {}';
    
    // Mock the variable declaration to return undefined
    vi.mocked(Project).mockImplementationOnce(() => ({
      createSourceFile: vi.fn().mockImplementation((_, source) => ({
        getFullText: () => source,
        getDescendantsOfKind: vi.fn().mockImplementation((kind) => {
          if (kind === SyntaxKind.TryStatement) {
            return [{
              getCatchClause: () => ({
                getBlock: () => ({
                  getStatements: () => [],
                  addStatements: vi.fn(),
                }),
                getVariableDeclaration: () => undefined,
              }),
            }];
          }
          return [];
        }),
      })),
    }));
    
    const result = addCatchHandlerTransform.apply(source, finding, context as any);
    expect(result).toContain('console.error(\'Caught error\', error);');
  });
});