/**
 * add-empty-catch-handler transform
 *
 * Finds empty catch blocks (catch(e) {} or catch {}) and adds error logging.
 * Uses ts-morph AST to locate CatchClause nodes with empty blocks.
 * Idempotent: if catch already has content, it is left untouched.
 * Never modifies test files.
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import type { ASTTransform, TransformContext } from './base.js';
import type { Finding } from '../normalize.js';
import { isTestFile } from './base.js';

export const addCatchHandlerTransform: ASTTransform = {
  id: 'add-empty-catch-handler',
  matchesFindings: [
    'empty catch',
    'Empty catch',
    'swallowed error',
    'silent catch',
    'catch block',
    'empty error handler',
    'EH-',
  ],
  languages: ['typescript', 'javascript'],

  canApply(source: string, finding: Finding): boolean {
    if (isTestFile(finding.file ?? '')) return false;
    // Quick regex check before full AST parse
    return /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(source);
  },

  apply(source: string, finding: Finding, context: TransformContext): string | null {
    if (isTestFile(context.filePath)) return null;

    const loggerVar = context.loggerVarName ?? 'logger';
    const catchRef = context.hasStructuredLogger ? loggerVar : 'console';

    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('__transform__.ts', source);

    const tryCatchStatements = sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement);
    let modified = false;

    for (const tryStmt of tryCatchStatements) {
      const catchClause = tryStmt.getCatchClause();
      if (!catchClause) continue;

      const block = catchClause.getBlock();
      const statements = block.getStatements();

      // Only modify if the catch block is truly empty
      if (statements.length > 0) continue;

      // Get the catch variable name (e.g. `e` in `catch(e)`)
      const varDecl = catchClause.getVariableDeclaration();
      const errVar = varDecl?.getName() ?? 'error';

      block.addStatements(`${catchRef}.error('Caught error', ${errVar});`);
      modified = true;
    }

    if (!modified) return null;

    let result = sourceFile.getFullText();

    // Add logger import if needed
    if (context.hasStructuredLogger && context.loggerImportPath) {
      const alreadyImported =
        result.includes(`from '${context.loggerImportPath}'`) ||
        result.includes(`from "${context.loggerImportPath}"`);
      if (!alreadyImported) {
        result = `import { ${loggerVar} } from '${context.loggerImportPath}';\n` + result;
      }
    }

    return result;
  },
};
