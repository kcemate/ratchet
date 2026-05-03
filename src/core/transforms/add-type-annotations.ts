/**
 * add-type-annotations transform
 *
 * For TypeScript functions with no return type annotation where the body
 * contains a single return statement, infers the obvious return type and
 * adds `: ReturnType` to the function signature.
 *
 * Supported inferences:
 *   - String literal   → : string
 *   - Number literal   → : number
 *   - Boolean literal  → : boolean
 *   - Array literal    → : unknown[]   (conservative)
 *   - null             → : null
 *   - undefined        → : undefined
 *
 * Uses ts-morph for accurate AST traversal.
 *
 * - Only modifies TypeScript files (.ts).
 * - Never modifies test files.
 * - Returns null (unchanged) on any error or if no changes found.
 * - Idempotent: already-annotated functions are skipped.
 */

import { Project, SyntaxKind, Node } from "ts-morph";
import type { ASTTransform, TransformContext } from "./base.js";
import type { Finding } from "../normalize.js";
import { isTestFile } from "./base.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infer the return type string from a single-expression return.
 * Returns null if the type cannot be safely inferred.
 */
function inferReturnType(returnExprText: string): string | null {
  const trimmed = returnExprText.trim();

  // String literals
  if (/^(['"`]).*\1$/.test(trimmed) || /^`[^`]*`$/.test(trimmed)) return "string";

  // Numeric literals
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return "number";

  // Boolean literals
  if (trimmed === "true" || trimmed === "false") return "boolean";

  // null / undefined
  if (trimmed === "null") return "null";
  if (trimmed === "undefined") return "undefined";

  // Array literal (conservative: unknown[])
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return "unknown[]";

  return null;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export const addTypeAnnotationsTransform: ASTTransform = {
  id: "add-type-annotations",
  matchesFindings: [
    "type annotation",
    "missing return type",
    "return type",
    "explicit return type",
    "implicit return",
    "TQ-",
  ],
  languages: ["typescript"],

  canApply(source: string, finding: Finding): boolean {
    if (isTestFile(finding.file ?? "")) return false;
    // Must be TypeScript (has function/arrow function syntax)
    return /function\s+\w+/.test(source) || /=>\s*\{/.test(source) || /=>\s*[^{]/.test(source);
  },

  apply(source: string, finding: Finding, context: TransformContext): string | null {
    if (isTestFile(context.filePath)) return null;
    // Only TypeScript files
    if (!context.filePath.endsWith(".ts") && !context.filePath.endsWith(".tsx")) return null;

    try {
      const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
      const sourceFile = project.createSourceFile("__transform__.ts", source);

      let modified = false;

      // ── Handle regular functions ─────────────────────────────────────────
      const functions = sourceFile.getFunctions();
      for (const fn of functions) {
        // Skip if already has return type annotation
        if (fn.getReturnTypeNode()) continue;

        const body = fn.getBody();
        if (!Node.isBlock(body)) continue;

        const statements = body.getStatements();
        if (statements.length !== 1) continue;

        const stmt = statements[0]!;
        if (!Node.isReturnStatement(stmt)) continue;

        const expr = stmt.getExpression();
        if (!expr) continue;

        const inferredType = inferReturnType(expr.getText());
        if (!inferredType) continue;

        fn.setReturnType(inferredType);
        modified = true;
      }

      // ── Handle arrow functions assigned to variables ─────────────────────
      const varDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
      for (const varDecl of varDeclarations) {
        const initializer = varDecl.getInitializer();
        if (!initializer) continue;
        if (!Node.isArrowFunction(initializer)) continue;

        // Skip if parent variable already has type annotation
        if (varDecl.getTypeNode()) continue;

        const arrowFn = initializer;
        // Skip if arrow function already has return type
        if (arrowFn.getReturnTypeNode()) continue;

        const body = arrowFn.getBody();

        if (Node.isBlock(body)) {
          // Block body: { return X; }
          const statements = body.getStatements();
          if (statements.length !== 1) continue;
          const stmt = statements[0]!;
          if (!Node.isReturnStatement(stmt)) continue;
          const expr = stmt.getExpression();
          if (!expr) continue;
          const inferredType = inferReturnType(expr.getText());
          if (!inferredType) continue;
          arrowFn.setReturnType(inferredType);
          modified = true;
        } else {
          // Concise body: () => expression
          const inferredType = inferReturnType(body.getText());
          if (!inferredType) continue;
          arrowFn.setReturnType(inferredType);
          modified = true;
        }
      }

      if (!modified) return null;

      const result = sourceFile.getFullText();
      return result === source ? null : result;
    } catch {
      return null;
    }
  },
};
