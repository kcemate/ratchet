import ts from "typescript";

export type ASTRule =
  | "empty-catch"
  | "console-usage"
  | "hardcoded-secret"
  | "todo-fixme"
  | "type-any"
  | "complex-function"
  | "test-assertion";

/**
 * Confirm regex matches using AST analysis. Returns the count of REAL issues
 * (vs false positives from regex matching strings/comments that survived stripping).
 */
export function confirmWithAST(content: string, rule: ASTRule): number {
  try {
    const sf = ts.createSourceFile("check.ts", content, ts.ScriptTarget.Latest, true);
    switch (rule) {
      case "empty-catch":
        return countEmptyCatches(sf);
      case "console-usage":
        return countConsoleUsage(sf);
      case "hardcoded-secret":
        return countHardcodedSecrets(sf);
      case "todo-fixme":
        return countTodoFixme(sf);
      case "type-any":
        return countTypeAny(sf);
      case "complex-function":
        return countComplexFunctions(sf);
      case "test-assertion":
        return countTestAssertions(sf);
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
      if (ts.isIdentifier(obj) && obj.text === "console") count++;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  // Match compound secret-like names (api_key, secretKey, authToken, etc.)
  // but NOT bare "key" (used for identifiers like challenge template keys, storage keys)
  return (
    /(?:api[_-]?key|secret(?:key)?|auth[_-]?token|password|passwd|private[_-]?key)/.test(lower) ||
    (/(?:_key|Key)/.test(name) && !/storage.key|cache.key|sort.key|lookup.key/i.test(lower))
  );
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
      const propName = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteral(node.name)
          ? node.name.text
          : "";
      if (isSecretName(propName) && isRealSecretValue(node.initializer.text)) {
        count++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

// ---------------------------------------------------------------------------
// count todo/fixme/hack/xxx markers that appear in real comments
// (not inside string literals or template expressions)
// ---------------------------------------------------------------------------

function countTodoFixme(sf: ts.SourceFile): number {
  const text = sf.text;
  const todoPattern = /\b(?:TODO|FIXME|HACK|XXX)\b/g;

  // Collect ranges of string/template/regex literals so we can skip them.
  // Comments are NOT AST nodes, so they'll never be excluded — they'll always match.
  const literalRanges: Array<[number, number]> = [];
  function collect(node: ts.Node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      literalRanges.push([node.getStart(sf), node.getEnd()]);
    }
    ts.forEachChild(node, collect);
  }
  collect(sf);

  let count = 0;
  todoPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = todoPattern.exec(text)) !== null) {
    const pos = match.index;
    if (!literalRanges.some(([start, end]) => pos >= start && pos < end)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// type-any: count actual `any` type keyword usages in the AST
// (excludes occurrences inside string literals or comments)
// ---------------------------------------------------------------------------

function countTypeAny(sf: ts.SourceFile): number {
  let count = 0;
  function visit(node: ts.Node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) count++;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

// ---------------------------------------------------------------------------
// complex-function: count functions whose cyclomatic complexity exceeds a
// threshold (>= 10 branching nodes: if, ternary, switch case, loops, catch)
// ---------------------------------------------------------------------------

const COMPLEXITY_THRESHOLD = 10;

function countComplexFunctions(sf: ts.SourceFile): number {
  let count = 0;

  function countBranching(fnNode: ts.Node): number {
    let branches = 0;
    function walk(node: ts.Node) {
      // Stop descending into nested function boundaries
      if (
        node !== fnNode &&
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node))
      )
        return;
      if (
        ts.isIfStatement(node) ||
        ts.isCaseClause(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node) ||
        ts.isCatchClause(node) ||
        ts.isConditionalExpression(node)
      ) {
        branches++;
      }
      ts.forEachChild(node, walk);
    }
    ts.forEachChild(fnNode, walk);
    return branches;
  }

  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      if (countBranching(node) >= COMPLEXITY_THRESHOLD) count++;
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return count;
}

// ---------------------------------------------------------------------------
// test-assertion: count actual test call expressions (it/test/describe/expect)
// Used to confirm regex-based test-quality counts in the Testing scorer.
// ---------------------------------------------------------------------------

// Matches it() and test() declarations (same scope as the totalTestCases regex in scan.ts)
const TEST_CASE_NAMES = new Set(["it", "test"]);

function countTestAssertions(sf: ts.SourceFile): number {
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // Direct calls: it(), test()
      if (ts.isIdentifier(callee) && TEST_CASE_NAMES.has(callee.text)) {
        count++;
      }
      // Chained calls: it.skip(), it.each(), it.only(), test.each()
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        TEST_CASE_NAMES.has(callee.expression.text)
      ) {
        count++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}
