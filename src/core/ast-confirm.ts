import ts from 'typescript';

export type ASTRule = 'empty-catch' | 'console-usage' | 'hardcoded-secret';

/**
 * Confirm regex matches using AST analysis. Returns the count of REAL issues
 * (vs false positives from regex matching strings/comments that survived stripping).
 */
export function confirmWithAST(content: string, rule: ASTRule): number {
  try {
    const sf = ts.createSourceFile('check.ts', content, ts.ScriptTarget.Latest, true);
    switch (rule) {
      case 'empty-catch': return countEmptyCatches(sf);
      case 'console-usage': return countConsoleUsage(sf);
      case 'hardcoded-secret': return countHardcodedSecrets(sf);
    }
  } catch {
    // AST parse failure — fall back to regex count (return -1 to signal no override)
    return -1;
  }
}

function countEmptyCatches(sf: ts.SourceFile): number {
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isCatchClause(node)) {
      const block = node.block;
      // A catch is only "empty" if it has no statements AND no leading/trailing comments.
      // Comment-only catches (e.g. // intentionally empty) are considered documented intent.
      if (block.statements.length === 0) {
        const text = sf.text.slice(block.getStart(sf) + 1, block.getEnd() - 1).trim();
        const hasComment = /\/\/|\/\*/.test(text);
        if (!hasComment) count++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

function countConsoleUsage(sf: ts.SourceFile): number {
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const obj = node.expression.expression;
      if (ts.isIdentifier(obj) && obj.text === 'console') count++;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

function isSecretName(name: string): boolean {
  return /key|secret|token|password|apikey|api_key/.test(name.toLowerCase());
}

function isRealSecretValue(val: string): boolean {
  return val.length > 8 && !/example|placeholder|xxx|test|your[-_]?/i.test(val);
}

function countHardcodedSecrets(sf: ts.SourceFile): number {
  let count = 0;
  function visit(node: ts.Node) {
    // Variable declarations: const apiKey = 'value'
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const varName = node.name.getText(sf);
      if (isSecretName(varName) && isRealSecretValue(node.initializer.text)) {
        count++;
      }
    }
    // Object property assignments: { apiKey: 'value' }
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
      const propName = ts.isIdentifier(node.name) ? node.name.text :
                       ts.isStringLiteral(node.name) ? node.name.text : '';
      if (isSecretName(propName) && isRealSecretValue(node.initializer.text)) {
        count++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}
