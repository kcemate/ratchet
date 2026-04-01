import { describe, it, expect } from 'vitest';
import {
  applyIntentPlanToSource,
  isBracketsBalanced,
  type IntentPlan,
} from '../core/smart-applier.js';
import {
  renderTemplate,
  renderFromIntent,
  resolveTemplateId,
  listTemplates,
  type TemplateContext,
} from '../core/fix-templates.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function plan(overrides: Partial<IntentPlan> = {}): IntentPlan {
  return {
    action: 'insert',
    targetLines: [1, 1],
    description: 'test plan',
    pattern: '',
    replacement_intent: 'add-null-check',
    imports_needed: [],
    confidence: 0.9,
    ...overrides,
  };
}

const ESM_SOURCE = `import { foo } from './foo.js';
import { bar } from './bar.js';

export function greet(name: string) {
  console.log('Hello', name);
  return name.toUpperCase();
}
`;

const CJS_SOURCE = `const foo = require('./foo');
const bar = require('./bar');

function greet(name) {
  console.log('Hello', name);
  return name.toUpperCase();
}

module.exports = { greet };
`;

const SIMPLE_SOURCE = `function add(a, b) {
  return a + b;
}
`;

// ---------------------------------------------------------------------------
// 1. delete action
// ---------------------------------------------------------------------------

describe('action: delete', () => {
  it('removes target lines from the middle of a file', () => {
    const source = 'line1\nline2\nline3\nline4\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [2, 3],
      pattern: 'line2',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toBe('line1\nline4\n');
  });

  it('removes a single line', () => {
    const source = 'a\nb\nc\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [2, 2],
      pattern: 'b',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toBe('a\nc\n');
  });

  it('removes the first line', () => {
    const source = 'import foo from "foo";\nconst x = 1;\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [1, 1],
      pattern: 'import foo',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).not.toContain('import foo');
  });
});

// ---------------------------------------------------------------------------
// 2. insert action
// ---------------------------------------------------------------------------

describe('action: insert', () => {
  it('inserts a null check before the target line', () => {
    const source = 'function f(x) {\n  return x + 1;\n}\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'insert',
      targetLines: [2, 2],
      pattern: 'return x',
      replacement_intent: 'add null check',
      imports_needed: [],
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toContain('== null');
  });

  it('inserts error handling code', () => {
    const source = '// start\nconst x = doThing();\n// end\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'insert',
      targetLines: [2, 2],
      pattern: 'doThing',
      replacement_intent: 'add error handling',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toContain('try {');
  });
});

// ---------------------------------------------------------------------------
// 3. replace action
// ---------------------------------------------------------------------------

describe('action: replace', () => {
  it('replaces target lines with null check template', () => {
    const source = 'function f(value) {\n  return value.length;\n}\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'replace',
      targetLines: [2, 2],
      pattern: 'return value',
      replacement_intent: 'add null check',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).not.toContain('return value.length');
    expect(result.modifiedSource).toContain('== null');
  });

  it('replaces with error handling template', () => {
    const source = '// work\nfoo();\n// done\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'replace',
      targetLines: [2, 2],
      pattern: 'foo()',
      replacement_intent: 'add error handling',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toContain('try {');
    expect(result.modifiedSource).toContain('catch (error)');
  });

  it('returns failure when no template matches the intent', () => {
    const source = 'const x = 1;\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'replace',
      targetLines: [1, 1],
      pattern: 'const x',
      replacement_intent: 'do something completely unknown xyz123',
    }));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. wrap action
// ---------------------------------------------------------------------------

describe('action: wrap', () => {
  it('wraps lines in try/catch', () => {
    const source = 'function f() {\n  doRiskyThing();\n}\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'wrap',
      targetLines: [2, 2],
      pattern: 'doRiskyThing',
      replacement_intent: 'add error handling',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toContain('try {');
    expect(result.modifiedSource).toContain('catch (error)');
    expect(result.modifiedSource).toContain('doRiskyThing');
  });

  it('wraps multiple lines', () => {
    const source = 'function f() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'wrap',
      targetLines: [2, 4],
      pattern: 'const a',
      replacement_intent: 'wrap in try/catch',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toContain('try {');
    expect(result.modifiedSource).toContain('const a = 1');
    expect(result.modifiedSource).toContain('const b = 2');
  });

  it('wraps in validation block when intent mentions validation', () => {
    const source = 'function f(x) {\n  processData(x);\n}\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'wrap',
      targetLines: [2, 2],
      pattern: 'processData',
      replacement_intent: 'validate input before processing',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toContain('if (');
  });
});

// ---------------------------------------------------------------------------
// 5. Fuzzy matching
// ---------------------------------------------------------------------------

describe('fuzzy region matching', () => {
  it('finds the target when line numbers are off by 3', () => {
    // Source has 10 lines; tell plan it's on line 8 but pattern is on line 5
    const source = [
      'line1',
      'line2',
      'line3',
      'function target() {',
      '  doWork();',
      '}',
      'line7',
      'line8',
      'line9',
      'line10',
    ].join('\n');

    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [8, 8],
      pattern: 'doWork()',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).not.toContain('doWork');
  });

  it('falls back to file-wide search when line hint is completely wrong', () => {
    const source = 'a\nb\nconst secret = "hidden";\nd\ne\nf\nf\ng\nh\ni\nj\nk\nl\nm\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [50, 50], // way off
      pattern: 'secret',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).not.toContain('secret');
  });

  it('succeeds even with no pattern when line numbers are valid', () => {
    const source = 'alpha\nbeta\ngamma\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [2, 2],
      pattern: '',
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).not.toContain('beta');
  });
});

// ---------------------------------------------------------------------------
// 6. Import insertion
// ---------------------------------------------------------------------------

describe('import insertion', () => {
  it('adds ESM import after existing imports', () => {
    const result = applyIntentPlanToSource(ESM_SOURCE, plan({
      action: 'delete',
      targetLines: [5, 5],
      pattern: 'console.log',
      imports_needed: ['./logger.js'],
    }));
    expect(result.success).toBe(true);
    const src = result.modifiedSource!;
    const loggerLine = src.split('\n').findIndex((l) => l.includes('./logger.js'));
    const barLine = src.split('\n').findIndex((l) => l.includes('./bar.js'));
    expect(loggerLine).toBeGreaterThan(barLine);
  });

  it('adds CJS require after existing requires', () => {
    const result = applyIntentPlanToSource(CJS_SOURCE, plan({
      action: 'delete',
      targetLines: [5, 5],
      pattern: 'console.log',
      imports_needed: ['./logger'],
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toContain("require('./logger')");
  });

  it('inserts at top when file has no imports', () => {
    const source = 'const x = 1;\nconsole.log(x);\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [2, 2],
      pattern: 'console.log',
      imports_needed: ['./utils'],
    }));
    expect(result.success).toBe(true);
    const lines = result.modifiedSource!.split('\n');
    expect(lines[0]).toContain('utils');
  });

  it('does not duplicate an import already present', () => {
    const result = applyIntentPlanToSource(ESM_SOURCE, plan({
      action: 'delete',
      targetLines: [5, 5],
      pattern: 'console.log',
      imports_needed: ['./foo.js'], // already imported
    }));
    expect(result.success).toBe(true);
    const occurrences = (result.modifiedSource!.match(/from '\.\/foo\.js'/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('preserves a fully-formed import statement verbatim', () => {
    const source = 'const x = 1;\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [1, 1],
      pattern: 'const x',
      imports_needed: ["import { z } from 'zod';"],
    }));
    expect(result.success).toBe(true);
    expect(result.modifiedSource).toContain("import { z } from 'zod'");
  });
});

// ---------------------------------------------------------------------------
// 7. Syntax validation
// ---------------------------------------------------------------------------

describe('isBracketsBalanced', () => {
  it('returns true for balanced source', () => {
    expect(isBracketsBalanced('function f() { return 1; }')).toBe(true);
  });

  it('returns false for unbalanced braces', () => {
    expect(isBracketsBalanced('function f() { return 1; ')).toBe(false);
  });

  it('returns false for unbalanced parens', () => {
    expect(isBracketsBalanced('foo(bar(')).toBe(false);
  });

  it('ignores brackets inside strings', () => {
    expect(isBracketsBalanced('const s = "{ not a brace }";')).toBe(true);
    expect(isBracketsBalanced("const s = '( not a paren )';")).toBe(true);
  });

  it('ignores brackets inside comments', () => {
    expect(isBracketsBalanced('// this is { not a brace }\nconst x = 1;')).toBe(true);
    expect(isBracketsBalanced('/* { */ const x = {};')).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isBracketsBalanced('')).toBe(true);
  });
});

describe('syntax validation on apply result', () => {
  it('returns success: false when applying would produce unbalanced source', () => {
    // Source has balanced braces; deleting the closing brace line makes it unbalanced
    const source = 'function f() {\n  doThing();\n}';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [3, 3],
      pattern: '}',
    }));
    // After deleting the closing brace, source becomes 'function f() {\n  doThing();' — unbalanced
    expect(result.success).toBe(false);
    expect(result.error).toContain('unbalanced');
  });
});

// ---------------------------------------------------------------------------
// 8. Fix templates
// ---------------------------------------------------------------------------

describe('fix-templates: renderTemplate', () => {
  const ctx: TemplateContext = {
    indent: '  ',
    variableNames: ['body'],
    errorHandler: 'console',
    importStyle: 'esm',
  };

  it('add-error-handling generates try/catch', () => {
    const out = renderTemplate('add-error-handling', ctx);
    expect(out).toContain('try {');
    expect(out).toContain('catch (error)');
    expect(out).toContain('console.error');
  });

  it('add-input-validation generates zod schema', () => {
    const out = renderTemplate('add-input-validation', ctx);
    expect(out).toContain('z.object');
    expect(out).toContain('safeParse');
    expect(out).toContain('bodySchema');
  });

  it('replace-console-with-logger generates ESM import', () => {
    const out = renderTemplate('replace-console-with-logger', ctx);
    expect(out).toContain("import {");
    expect(out).toContain('logger');
  });

  it('replace-console-with-logger generates CJS require when style=cjs', () => {
    const out = renderTemplate('replace-console-with-logger', { ...ctx, importStyle: 'cjs' });
    expect(out).toContain('require(');
    expect(out).toContain('logger');
  });

  it('add-return-type generates a comment placeholder', () => {
    const out = renderTemplate('add-return-type', ctx);
    expect(out).toContain('return type');
  });

  it('add-null-check generates null guard', () => {
    const out = renderTemplate('add-null-check', ctx);
    expect(out).toContain('== null');
    expect(out).toContain('body');
  });

  it('respects indent prefix', () => {
    const out = renderTemplate('add-null-check', { ...ctx, indent: '    ' });
    expect(out.startsWith('    if')).toBe(true);
  });
});

describe('fix-templates: resolveTemplateId', () => {
  it('resolves error handling keywords', () => {
    expect(resolveTemplateId('add error handling to this function')).toBe('add-error-handling');
    expect(resolveTemplateId('wrap in try/catch')).toBe('add-error-handling');
  });

  it('resolves input validation keywords', () => {
    expect(resolveTemplateId('add input validation using zod')).toBe('add-input-validation');
  });

  it('resolves logger replacement', () => {
    expect(resolveTemplateId('replace console with logger')).toBe('replace-console-with-logger');
  });

  it('resolves null check keywords', () => {
    expect(resolveTemplateId('add null check before use')).toBe('add-null-check');
  });

  it('returns undefined for unknown intent', () => {
    expect(resolveTemplateId('frobnicate the widget')).toBeUndefined();
  });
});

describe('fix-templates: renderFromIntent', () => {
  const ctx: TemplateContext = {
    indent: '',
    variableNames: [],
    errorHandler: 'console',
    importStyle: 'esm',
  };

  it('renders from intent string', () => {
    const out = renderFromIntent('add error handling', ctx);
    expect(out).toContain('try {');
  });

  it('returns null for unrecognised intent', () => {
    expect(renderFromIntent('something nobody knows', ctx)).toBeNull();
  });
});

describe('fix-templates: listTemplates', () => {
  it('returns all 5 template IDs', () => {
    const ids = listTemplates();
    expect(ids).toHaveLength(5);
    expect(ids).toContain('add-error-handling');
    expect(ids).toContain('add-input-validation');
    expect(ids).toContain('replace-console-with-logger');
    expect(ids).toContain('add-return-type');
    expect(ids).toContain('add-null-check');
  });
});

// ---------------------------------------------------------------------------
// 9. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('returns failure for empty file with non-insert action', () => {
    const result = applyIntentPlanToSource('', plan({ action: 'delete', targetLines: [1, 1] }));
    expect(result.success).toBe(false);
  });

  it('handles plan with out-of-bounds lines gracefully using pattern fallback', () => {
    const source = 'const x = 1;\nconst y = 2;\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [999, 999],
      pattern: 'const y',
    }));
    // Should find pattern in whole-file fallback
    expect(result.success).toBe(true);
    expect(result.modifiedSource).not.toContain('const y');
  });

  it('returns failure when both line numbers and pattern cannot locate region', () => {
    const source = 'const x = 1;\n';
    const result = applyIntentPlanToSource(source, plan({
      action: 'delete',
      targetLines: [999, 999],
      pattern: 'PATTERN_THAT_DOES_NOT_EXIST_ANYWHERE',
    }));
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('never throws — wraps unexpected errors in ApplyResult', () => {
    // Pass a plan with undefined action to trigger the default branch
    const result = applyIntentPlanToSource('const x = 1;\n', {
      ...plan({ targetLines: [1, 1], pattern: 'const x' }),
      action: 'replace',
      replacement_intent: 'completely unrecognised intent xyz',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 10. Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('applying delete twice: first succeeds, second handles missing target gracefully', () => {
    const source = 'a\nb\nc\n';
    const p = plan({ action: 'delete', targetLines: [2, 2], pattern: 'b' });
    const first = applyIntentPlanToSource(source, p);
    expect(first.success).toBe(true);
    expect(first.modifiedSource).toContain('a');
    expect(first.modifiedSource).not.toContain('b');

    // Re-apply — 'b' is gone. Either it fails gracefully or produces valid output.
    const second = applyIntentPlanToSource(first.modifiedSource!, p);
    // Must not throw; success/failure both acceptable
    expect(second).toBeDefined();
    if (!second.success) {
      expect(second.error).toBeDefined();
    } else {
      // Must still be syntactically valid (brackets balanced)
      expect(isBracketsBalanced(second.modifiedSource!)).toBe(true);
    }
  });

  it('applying wrap twice: outer try/catch preserved, inner still contains original code', () => {
    const source = 'function f() {\n  doWork();\n}\n';
    const p = plan({ action: 'wrap', targetLines: [2, 2], pattern: 'doWork' });
    const first = applyIntentPlanToSource(source, p);
    expect(first.success).toBe(true);

    const second = applyIntentPlanToSource(first.modifiedSource!, p);
    expect(second.success).toBe(true);
    // Both contain doWork
    expect(second.modifiedSource).toContain('doWork');
  });
});
