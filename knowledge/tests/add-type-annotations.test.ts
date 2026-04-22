import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Project, SyntaxKind, Node } from 'ts-morph';
import type { ASTTransform, TransformContext } from './base.js';
import type { Finding } from '../normalize.js';
import { isTestFile } from './base.js';

// Mock the dependencies
vi.mock('ts-morph', () => ({
  Project: vi.fn().mockImplementation(() => ({
    createSourceFile: vi.fn().mockImplementation((_, source) => ({
      getFullText: () => source,
      getFunctions: () => [{
        getReturnTypeNode: () => undefined,
        getBody: () => ({
          getStatements: () => [{
            getText: () => 'return 42;',
          }],
        }),
        setReturnType: vi.fn(),
      }],
      getDescendantsOfKind: vi.fn().mockImplementation((kind) => {
        if (kind === SyntaxKind.VariableDeclaration) {
          return [{
            getInitializer: () => ({
              getText: () => '() => 42',
            }),
            getTypeNode: () => undefined,
          }];
        }
        return [];
      }),
    })),
  })),
  SyntaxKind: {
    VariableDeclaration: 'VariableDeclaration',
  },
  Node: {
    isBlock: (body) => typeof body === 'object' && body.getStatements,
    isReturnStatement: (stmt) => stmt.getText && stmt.getText().startsWith('return'),
    isArrowFunction: (fn) => typeof fn === 'object',
  },
}));

vi.mock('./base.js', () => ({
  isTestFile: vi.fn().mockReturnValue(false),
}));

import { addTypeAnnotationsTransform } from './add-type-annotations.js';

describe('addTypeAnnotationsTransform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null for test files', () => {
    const finding = { file: 'test.spec.ts' };
    const context = { filePath: 'test.spec.ts' };
    const source = 'function foo() { return 42; }';
    
    vi.mocked(isTestFile).mockReturnValue(true);
    
    const result = addTypeAnnotationsTransform.apply(source, finding, context as any);
    expect(result).toBeNull();
  });

  it('should return null for non-TypeScript files', () => {
    const finding = { file: 'module.js' };
    const context = { filePath: 'module.js' };
    const source = 'function foo() { return 42; }';
    
    const result = addTypeAnnotationsTransform.apply(source, finding, context as any);
    expect(result).toBeNull();
  });

  it('should add number return type to function', () => {
    const finding = { file: 'module.ts' };
    const context = { filePath: 'module.ts' };
    const source = 'function foo() { return 42; }';
    
    const result = addTypeAnnotationsTransform.apply(source, finding, context as any);
    expect(result).toContain('function foo(): number');
  });

  it('should add string return type to function', () => {
    const finding = { file: 'module.ts' };
    const context = { filePath: 'module.ts' };
    const source = 'function bar() { return "hello"; }';
    
    const result = addTypeAnnotationsTransform.apply(source, finding, context as any);
    expect(result).toContain('function bar(): string');
  });

  it('should add boolean return type to function', () => {
    const finding = { file: 'module.ts' };
    const context = { filePath: 'module.ts' };
    const source = 'function baz() { return true; }';
    
    const result = addTypeAnnotationsTransform.apply(source, finding, context as any);
    expect(result).toContain('function baz(): boolean');
  });

  it('should add return type to arrow function', () => {
    const finding = { file: 'module.ts' };
    const context = { filePath: 'module.ts' };
    const source = 'const fn = () => 42;';
    
    const result = addTypeAnnotationsTransform.apply(source, finding, context as any);
    expect(result).toContain('(): number');
  });

  it('should not modify functions with existing return types', () => {
    const finding = { file: 'module.ts' };
    const context = { filePath: 'module.ts' };
    const source = 'function foo(): number { return 42; }';
    
    const result = addTypeAnnotationsTransform.apply(source, finding, context as any);
    expect(result).toBeNull();
  });

  it('should handle errors gracefully', () => {
    const finding = { file: 'module.ts' };
    const context = { filePath: 'module.ts' };
    const source = 'invalid syntax';
    
    // Force an error in the transform
    vi.mocked(Project).mockImplementationOnce(() => ({
      createSourceFile: vi.fn().mockImplementation(() => {
        throw new Error('Parse error');
      }),
    }));
    
    const result = addTypeAnnotationsTransform.apply(source, finding, context as any);
    expect(result).toBeNull();
  });
});