/**
 * remove-dead-code transform
 *
 * Removes statements that are unreachable because they appear after a
 * return / throw / break / continue in the same block.
 *
 * Uses ts-morph for accurate block-level analysis:
 *   1. Find all return/throw/break/continue statements
 *   2. Collect sibling statements that appear after them in the same block
 *   3. Remove those unreachable siblings
 *
 * - Never modifies test files.
 * - Returns null (unchanged) if no dead code is found.
 * - Idempotent: running twice produces the same result.
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import type { ASTTransform, TransformContext } from './base.js';
import type { Finding } from '../normalize.js';
import { isTestFile } from './base.js';

// ---------------------------------------------------------------------------
// Terminators: statements that unconditionally end control flow
// ---------------------------------------------------------------------------

const TERMINATOR_KINDS = new Set([
  SyntaxKind.ReturnStatement,
  SyntaxKind.ThrowStatement,
  SyntaxKind.BreakStatement,
  SyntaxKind.ContinueStatement,
]);

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export const removeDeadCodeTransform: ASTTransform = {
  id: 'remove-dead-code',
  matchesFindings: [
    'dead code',
    'unreachable',
    'unreachable code',
    'unreachable statement',
    'after return',
    'DQ-dead',
    'no-unreachable',
  ],
  languages: ['typescript', 'javascript'],

  canApply(source: string, finding: Finding): boolean {
    if (isTestFile(finding.file ?? '')) return false;
    // Quick check: file must have a return/throw/break/continue followed by more code
    return /\breturn\b|\bthrow\b|\bbreak\b|\bcontinue\b/.test(source);
  },

  apply(source: string, finding: Finding, context: TransformContext): string | null {
    if (isTestFile(context.filePath)) return null;
    if (!source.trim()) return null;

    try {
      const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
      const sourceFile = project.createSourceFile('__transform__.ts', source);

      // Collect all unreachable nodes to remove (in reverse order to preserve indices)
      const toRemove: import('ts-morph').Statement[] = [];

      // Walk all block-like nodes
      const blocks = sourceFile.getDescendantsOfKind(SyntaxKind.Block);

      for (const block of blocks) {
        const statements = block.getStatements();
        let foundTerminator = false;

        for (const stmt of statements) {
          if (foundTerminator) {
            // This statement is unreachable
            toRemove.push(stmt);
          } else if (TERMINATOR_KINDS.has(stmt.getKind())) {
            foundTerminator = true;
          }
        }
      }

      if (toRemove.length === 0) return null;

      // Remove in reverse document order to preserve positions
      const sorted = toRemove.sort((a, b) => b.getStart() - a.getStart());
      for (const stmt of sorted) {
        stmt.remove();
      }

      const result = sourceFile.getFullText();
      return result === source ? null : result;
    } catch {
      return null;
    }
  },
};
