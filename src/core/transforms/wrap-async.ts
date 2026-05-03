/**
 * wrap-async-try-catch transform
 *
 * Wraps the body of async functions/methods that lack a top-level try/catch.
 * Handles: regular functions, arrow functions, class methods.
 * Idempotent: skips functions that already have a top-level try/catch.
 */

import { Project, SyntaxKind, Node } from "ts-morph";
import type { ASTTransform, TransformContext } from "./base.js";
import type { Finding } from "../normalize.js";
import { isTestFile } from "./base.js";

function buildCatchBlock(loggerVar: string): string {
  return `(error) {\n    ${loggerVar}.error('Unhandled async error', error);\n  }`;
}

/**
 * Returns true if the first statement of a function/arrow body is a TryStatement
 * that covers the whole block (i.e., the body is *just* try { ... }).
 */
function bodyAlreadyWrapped(bodyText: string): boolean {
  const trimmed = bodyText.trim();
  // Remove leading/trailing braces if present
  const inner = trimmed.startsWith("{") ? trimmed.slice(1, trimmed.lastIndexOf("}")).trim() : trimmed;
  return inner.startsWith("try ") || inner.startsWith("try{");
}

export const wrapAsyncTransform: ASTTransform = {
  id: "wrap-async-try-catch",
  matchesFindings: [
    "unhandled async",
    "Unhandled async",
    "missing try/catch",
    "async error handling",
    "unhandled promise",
    "EH-",
  ],
  languages: ["typescript", "javascript"],

  canApply(source: string, finding: Finding): boolean {
    if (!source.includes("async ")) return false;
    if (isTestFile(finding.file ?? "")) return false;
    return true;
  },

  apply(source: string, finding: Finding, context: TransformContext): string | null {
    if (isTestFile(context.filePath)) return null;

    const loggerVar = context.loggerVarName ?? "logger";
    const catchRef = context.hasStructuredLogger ? loggerVar : "console";
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile("__transform__.ts", source);

    let modified = false;

    // Collect all async functions
    const asyncFunctions = [
      ...sourceFile.getFunctions().filter(f => f.isAsync()),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction).filter(f => f.isAsync()),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).filter(m => m.isAsync()),
    ];

    for (const fn of asyncFunctions) {
      const body = fn.getBody();
      if (!body) continue;

      const bodyText = body.getText();

      // Skip if already has a top-level try/catch wrapping the entire body
      if (bodyAlreadyWrapped(bodyText)) continue;

      // Get statements inside the body
      let statements: Node[];
      if (Node.isBlock(body)) {
        statements = body.getStatements();
      } else {
        // Arrow function with expression body — wrap the expression
        statements = [body];
      }

      if (statements.length === 0) continue;

      // Skip if the only statement IS a try statement
      if (statements.length === 1 && Node.isTryStatement(statements[0])) continue;

      const indent = "  ";
      const innerIndent = "    ";

      if (Node.isBlock(body)) {
        const stmtsText = statements.map(s => s.getFullText().replace(/\n/g, `\n${indent}`)).join("");
        const newBody = ` {\n${indent}try {${stmtsText.startsWith("\n") ? "" : "\n" + indent}${stmtsText}\n${indent}} catch ${buildCatchBlock(catchRef)}\n}`;
        body.replaceWithText(newBody);
      } else {
        // Expression body arrow: `async () => expr` → `async () => { try { return expr; } catch (error) { ... } }`
        const exprText = body.getText().trim();
        const newBody = `{\n${indent}try {\n${innerIndent}return ${exprText};\n${indent}} catch ${buildCatchBlock(catchRef)}\n}`;
        body.replaceWithText(newBody);
      }

      modified = true;
    }

    if (!modified) return null;

    // Add logger import if needed and not present
    let result = sourceFile.getFullText();
    if (context.hasStructuredLogger && context.loggerImportPath) {
      const alreadyImported = context.existingImports.some(
        i => i.includes(context.loggerVarName) && i.includes(context.loggerImportPath!)
      );
      if (!alreadyImported && !result.includes(context.loggerImportPath)) {
        result = `import { ${context.loggerVarName} } from '${context.loggerImportPath}';\n` + result;
      }
    }

    return result;
  },
};
