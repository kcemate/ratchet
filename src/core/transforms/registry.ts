/**
 * Transform Registry — maps finding pattern IDs to ASTTransform implementations.
 *
 * Use registerTransform() to add new transforms.
 * Use getTransform() to look up by ID.
 * tagFindingsWithTransforms() enriches findings during scan time (free — no LLM).
 */

import type { ASTTransform } from './base.js';
import type { Finding } from '../normalize.js';
import { wrapAsyncTransform } from './wrap-async.js';
import { replaceConsoleTransform } from './replace-console.js';
import { addCatchHandlerTransform } from './add-catch-handler.js';
import { removeUnusedImportsTransform } from './remove-unused-imports.js';
import { addTypeAnnotationsTransform } from './add-type-annotations.js';
import { removeDeadCodeTransform } from './remove-dead-code.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, ASTTransform>();

export function registerTransform(transform: ASTTransform): void {
  registry.set(transform.id, transform);
}

export function getTransform(id: string): ASTTransform | null {
  return registry.get(id) ?? null;
}

/** Returns a read-only snapshot of all registered transforms. */
export function listTransforms(): ASTTransform[] {
  return [...registry.values()];
}

// ---------------------------------------------------------------------------
// Pre-register Phase 1 transforms
// ---------------------------------------------------------------------------

registerTransform(wrapAsyncTransform);
registerTransform(replaceConsoleTransform);
registerTransform(addCatchHandlerTransform);
registerTransform(removeUnusedImportsTransform);
registerTransform(addTypeAnnotationsTransform);
registerTransform(removeDeadCodeTransform);

// ---------------------------------------------------------------------------
// Finding tagging — run at scan time to mark findings that can be auto-fixed
// ---------------------------------------------------------------------------

/**
 * Enrich findings with transformId + fixStrategy.
 * This is O(findings × transforms) but both are small — no LLM involved.
 * Mutates findings in place and returns the same array.
 */
export function tagFindingsWithTransforms(
  findings: Finding[],
  fileContents?: Map<string, string>,
): Finding[] {
  for (const finding of findings) {
    if (finding.transformId) continue; // already tagged

    for (const transform of registry.values()) {
      const matchesLanguage = transform.languages.includes('typescript') || transform.languages.includes('javascript');
      if (!matchesLanguage) continue;

      const matchesFinding = transform.matchesFindings.some(
        pattern =>
          finding.subcategory?.toLowerCase().includes(pattern.toLowerCase()) ||
          finding.message?.toLowerCase().includes(pattern.toLowerCase()) ||
          finding.ruleId?.startsWith(pattern),
      );

      if (!matchesFinding) continue;

      // Optional: do a canApply check if source is available
      if (fileContents && finding.file) {
        const source = fileContents.get(finding.file);
        if (source && !transform.canApply(source, finding)) continue;
      }

      finding.transformId = transform.id;
      finding.fixStrategy = 'ast';
      break;
    }

    // Default to 'intent' if no transform matched
    if (!finding.fixStrategy) {
      finding.fixStrategy = 'intent';
    }
  }

  return findings;
}

export { registry as transformRegistry };
