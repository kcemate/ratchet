/**
 * Plan-First Mode — validates an IntentPlan before executing it.
 *
 * Validates:
 *   1. Target file exists
 *   2. Target lines exist in the file (file has enough lines)
 *   3. Pattern appears in the file (guards against stale plans)
 *   4. imports_needed reference resolvable modules (relative paths exist)
 *
 * Returns a PlanValidation; if valid=false the caller should skip this plan
 * and try the next issue rather than waste a click on a broken plan.
 */

import { access, readFile } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import type { IntentPlan } from './smart-applier.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanValidation {
  valid: boolean;
  errors: string[];
  resolvedPaths: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that an IntentPlan is sound before passing it to the SmartApplier.
 * Never throws — always returns a PlanValidation.
 *
 * @param plan  The generated intent plan to validate.
 * @param cwd   Working directory for resolving relative paths.
 * @param filePath  Absolute or cwd-relative path to the target file.
 */
export async function validatePlan(
  plan: IntentPlan,
  cwd: string,
  filePath?: string,
): Promise<PlanValidation> {
  const errors: string[] = [];
  const resolvedPaths: string[] = [];

  try {
    // ── 1. Check confidence threshold ──────────────────────────────────────
    if (plan.confidence < 0.3) {
      errors.push(`Low confidence: ${plan.confidence.toFixed(2)} < 0.3 threshold`);
    }

    // ── 2. Target file existence ────────────────────────────────────────────
    let source: string | null = null;
    if (filePath) {
      const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
      try {
        await access(absPath);
        resolvedPaths.push(absPath);
        source = await readFile(absPath, 'utf8');
      } catch {
        errors.push(`Target file not found: ${filePath}`);
      }
    }

    // ── 3. Target lines exist ───────────────────────────────────────────────
    if (source !== null) {
      const lineCount = source.split('\n').length;
      const [startLine, endLine] = plan.targetLines;
      if (startLine > lineCount) {
        errors.push(`Target start line ${startLine} exceeds file length (${lineCount} lines)`);
      } else if (endLine > lineCount) {
        errors.push(`Target end line ${endLine} exceeds file length (${lineCount} lines)`);
      }

      // ── 4. Pattern appears in file ────────────────────────────────────────
      if (plan.pattern && plan.pattern.trim().length > 0) {
        const normalised = source.replace(/\r\n/g, '\n');
        if (!normalised.includes(plan.pattern)) {
          // Try a whitespace-normalised comparison before failing
          const sourceWs = normalised.replace(/\s+/g, ' ');
          const patternWs = plan.pattern.replace(/\s+/g, ' ').trim();
          if (!sourceWs.includes(patternWs)) {
            errors.push(`Pattern not found in file: "${plan.pattern.slice(0, 60)}..."`);
          }
        }
      }
    }

    // ── 5. imports_needed are resolvable ───────────────────────────────────
    for (const importPath of plan.imports_needed) {
      if (!importPath || importPath.trim().length === 0) continue;

      if (importPath.startsWith('.')) {
        // Relative import — check if the file exists
        const base = filePath
          ? resolve(cwd, filePath, '..')
          : cwd;
        const candidates = [
          resolve(base, importPath),
          resolve(base, importPath + '.ts'),
          resolve(base, importPath + '.js'),
          resolve(base, importPath, 'index.ts'),
          resolve(base, importPath, 'index.js'),
        ];
        let found = false;
        for (const candidate of candidates) {
          try {
            await access(candidate);
            resolvedPaths.push(candidate);
            found = true;
            break;
          } catch {
            // continue
          }
        }
        if (!found) {
          errors.push(`Relative import not resolvable: "${importPath}"`);
        }
      } else {
        // Package or builtin — try require.resolve from cwd
        try {
          const req = createRequire(join(cwd, '_dummy_.js'));
          const resolved = req.resolve(importPath);
          resolvedPaths.push(resolved);
        } catch {
          // Non-fatal: could be a type-only import or built-in not resolvable via require
          // Don't fail the plan over this — just note it
        }
      }
    }
  } catch (err) {
    errors.push(`Validation error: ${(err as Error).message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    resolvedPaths,
  };
}
