/**
 * remove-unused-imports transform
 *
 * Detects ES6/TypeScript imports where the imported identifier is never
 * referenced in the file body (after stripping all import lines).
 *
 * Uses regex-based detection — no AST required, making it fast and safe.
 * Handles: named imports, default imports, namespace imports (import * as X).
 * Does NOT remove side-effect-only imports (import 'module').
 *
 * - Never modifies test files.
 * - Idempotent: running twice produces the same result.
 * - Returns null (unchanged) on any error.
 */

import type { ASTTransform, TransformContext } from "./base.js";
import type { Finding } from "../normalize.js";
import { isTestFile } from "./base.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedImport {
  /** Full import statement line (one physical line) */
  line: string;
  /** Zero-based line index */
  lineIndex: number;
  /** All local identifiers introduced by this import */
  identifiers: string[];
  /** True if this is a side-effect-only import (import 'foo') */
  sideEffect: boolean;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a single import line and return the local identifiers it introduces.
 * Returns null for lines that are not import statements.
 */
function parseImportLine(line: string): ParsedImport | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("import ") && !trimmed.startsWith("import{")) return null;
  // Side-effect-only: import 'foo' or import "foo"
  if (/^import\s+['"]/.test(trimmed)) {
    return { line, lineIndex: 0, identifiers: [], sideEffect: true };
  }

  const identifiers: string[] = [];

  // Namespace import: import * as X from '...'
  const namespaceMatch = trimmed.match(/import\s+\*\s+as\s+(\w+)/);
  if (namespaceMatch) {
    identifiers.push(namespaceMatch[1]!);
  }

  // Named imports: import { X, Y as Z } from '...'
  const namedMatch = trimmed.match(/import\s*\{([^}]+)\}/);
  if (namedMatch) {
    for (const part of namedMatch[1]!.split(",")) {
      const trimPart = part.trim();
      if (!trimPart) continue;
      // 'X as Y' → use Y (local name)
      const asMatch = trimPart.match(/\w+\s+as\s+(\w+)/);
      if (asMatch) {
        identifiers.push(asMatch[1]!);
      } else if (/^\w+$/.test(trimPart)) {
        identifiers.push(trimPart);
      }
    }
  }

  // Default import: import X from '...' (no braces, not namespace)
  if (!namedMatch && !namespaceMatch) {
    const defaultMatch = trimmed.match(/^import\s+(\w+)\s+from\s/);
    if (defaultMatch) {
      identifiers.push(defaultMatch[1]!);
    }
    // Combined default + named: import X, { Y } from '...'
    const combinedDefault = trimmed.match(/^import\s+(\w+)\s*,\s*\{/);
    if (combinedDefault) {
      identifiers.push(combinedDefault[1]!);
    }
  }

  // Combined: import X, { Y } from '...'
  if (namedMatch) {
    const combinedDefault = trimmed.match(/^import\s+(\w+)\s*,\s*\{/);
    if (combinedDefault) {
      identifiers.push(combinedDefault[1]!);
    }
  }

  return { line, lineIndex: 0, identifiers, sideEffect: false };
}

/**
 * Check if an identifier is used in the file body (i.e., outside all import lines).
 */
function isIdentifierUsed(identifier: string, bodySource: string): boolean {
  // Word boundary check: identifier must appear as a standalone token
  const pattern = new RegExp(`(?<![\\w$])${escapeRegex(identifier)}(?![\\w$])`, "");
  return pattern.test(bodySource);
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export const removeUnusedImportsTransform: ASTTransform = {
  id: "remove-unused-imports",
  matchesFindings: ["unused import", "unused variable", "no-unused-vars", "import.*never used", "DQ-unused"],
  languages: ["typescript", "javascript"],

  canApply(source: string, finding: Finding): boolean {
    if (isTestFile(finding.file ?? "")) return false;
    // Quick check: file must have import statements
    return /^import\s/m.test(source);
  },

  apply(source: string, finding: Finding, context: TransformContext): string | null {
    if (isTestFile(context.filePath)) return null;
    if (!source.trim()) return null;

    try {
      const lines = source.split("\n");

      // Collect all import line indices and their parsed data
      const parsedImports: ParsedImport[] = [];
      for (let i = 0; i < lines.length; i++) {
        const parsed = parseImportLine(lines[i]!);
        if (parsed) {
          parsed.lineIndex = i;
          parsedImports.push(parsed);
        }
      }

      if (parsedImports.length === 0) return null;

      // Build the "body" = everything except import lines
      const importLineIndices = new Set(parsedImports.map(p => p.lineIndex));
      const bodyLines = lines.filter((_, i) => !importLineIndices.has(i));
      const bodySource = bodyLines.join("\n");

      // Find which import lines to remove entirely
      const linesToRemove = new Set<number>();

      for (const parsed of parsedImports) {
        if (parsed.sideEffect) continue;
        if (parsed.identifiers.length === 0) continue;

        // Check if ALL identifiers from this import are unused
        const unusedIdentifiers = parsed.identifiers.filter(id => !isIdentifierUsed(id, bodySource));

        if (unusedIdentifiers.length === parsed.identifiers.length) {
          // All identifiers unused — remove the whole import line
          linesToRemove.add(parsed.lineIndex);
        } else if (unusedIdentifiers.length > 0) {
          // Partial: some used, some not — remove only the unused named imports
          // (Only safe to do for named imports, not default/namespace)
          const namedMatch = parsed.line.trim().match(/import\s*\{([^}]+)\}/);
          if (namedMatch) {
            const keptParts = namedMatch[1]!.split(",").filter(part => {
              const trimPart = part.trim();
              const localName = trimPart.match(/\w+\s+as\s+(\w+)/)?.[1] ?? trimPart;
              return !unusedIdentifiers.includes(localName);
            });
            if (keptParts.length === 0) {
              linesToRemove.add(parsed.lineIndex);
            }
            // Note: we skip partial removal for safety — removing some named imports
            // risks syntax errors with combined imports. Whole-line removal only.
          }
        }
      }

      if (linesToRemove.size === 0) return null;

      const result = lines.filter((_, i) => !linesToRemove.has(i)).join("\n");

      return result === source ? null : result;
    } catch {
      return null;
    }
  },
};
