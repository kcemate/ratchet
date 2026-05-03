/**
 * AST Transform Foundation — base interface and helpers.
 *
 * Layer 1 of the Autofix Engine v2: deterministic, zero-LLM fixes.
 * Each transform is idempotent — applying twice yields the same result.
 */

import type { Finding } from "../normalize.js";
import type { RepoContext } from "../familiarize.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransformContext {
  /** Absolute path of the file being transformed */
  filePath: string;
  /** Repo-level context (import style, error handling, logger detection, etc.) */
  repoContext: RepoContext;
  /** Raw import statements already present in the file */
  existingImports: string[];
  /** Test runner name detected by RepoProbe ('vitest', 'jest', etc.) */
  testRunner: string | null;
  /** Whether the repo uses a structured logger (pino, winston, etc.) */
  hasStructuredLogger: boolean;
  /** Import path for the repo's logger, if detected */
  loggerImportPath: string | null;
  /** Logger variable name (default: 'logger') */
  loggerVarName: string;
}

export interface ASTTransform {
  /** Unique identifier for this transform */
  id: string;
  /** Which scanner finding IDs / subcategory names this transform can fix */
  matchesFindings: string[];
  /** Source languages this transform supports */
  languages: ("typescript" | "javascript")[];
  /**
   * Apply the transform. Returns the modified source, or null if the
   * transform cannot safely apply to this finding.
   * Must be idempotent: apply(apply(src)) === apply(src).
   */
  apply(source: string, finding: Finding, context: TransformContext): string | null;
  /**
   * Dry-run validation — can this transform handle this specific finding?
   * Cheaper than apply(); used during scan to tag findings.
   */
  canApply(source: string, finding: Finding): boolean;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Returns true if the file path is a test file (never transform these). */
export function isTestFile(filePath: string): boolean {
  return (
    /__tests__[/\\]/.test(filePath) ||
    /[/\\]test[/\\]/.test(filePath) ||
    /[/\\]spec[/\\]/.test(filePath) ||
    /\.test\.[cm]?[jt]sx?$/.test(filePath) ||
    /\.spec\.[cm]?[jt]sx?$/.test(filePath)
  );
}

/** Returns true for TypeScript/JavaScript files. */
export function isSupportedLanguage(filePath: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(filePath);
}

// ---------------------------------------------------------------------------
// applyTransforms
// ---------------------------------------------------------------------------

export interface TransformResult {
  /** Map from file path → new file content (only modified files included) */
  modifiedFiles: Map<string, string>;
  /** Findings that were handled by a transform (skipped from LLM path) */
  handledFindings: Finding[];
  /** Findings that had no matching transform (still need LLM) */
  unhandledFindings: Finding[];
}

/**
 * Iterate findings, check the transform registry, apply matching transforms.
 * Returns modified file contents plus partitioned findings.
 *
 * @param findings   Prioritized findings from the scan
 * @param fileContents  Map of file path → current file content
 * @param context    Transform execution context
 * @param registry   Map of transform ID → ASTTransform
 */
export function applyTransforms(
  findings: Finding[],
  fileContents: Map<string, string>,
  context: Omit<TransformContext, "filePath" | "existingImports">,
  registry: Map<string, ASTTransform>
): TransformResult {
  const modifiedFiles = new Map<string, string>();
  const handledFindings: Finding[] = [];
  const unhandledFindings: Finding[] = [];

  for (const finding of findings) {
    const filePath = finding.file;
    if (!filePath) {
      unhandledFindings.push(finding);
      continue;
    }

    // Never touch test files
    if (isTestFile(filePath)) {
      unhandledFindings.push(finding);
      continue;
    }

    // Find a matching transform by transformId or by subcategory match
    const transform = finding.transformId
      ? registry.get(finding.transformId)
      : findTransformForFinding(finding, registry);

    if (!transform) {
      unhandledFindings.push(finding);
      continue;
    }

    // Get current content (use already-modified content if this file was touched earlier)
    const currentContent = modifiedFiles.get(filePath) ?? fileContents.get(filePath);
    if (currentContent === undefined) {
      unhandledFindings.push(finding);
      continue;
    }

    // Build per-file context
    const fileContext: TransformContext = {
      ...context,
      filePath,
      existingImports: extractImports(currentContent),
    };

    // Dry-run check
    if (!transform.canApply(currentContent, finding)) {
      unhandledFindings.push(finding);
      continue;
    }

    // Apply
    const result = transform.apply(currentContent, finding, fileContext);
    if (result === null) {
      unhandledFindings.push(finding);
      continue;
    }

    modifiedFiles.set(filePath, result);
    handledFindings.push(finding);
  }

  return { modifiedFiles, handledFindings, unhandledFindings };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function findTransformForFinding(finding: Finding, registry: Map<string, ASTTransform>): ASTTransform | undefined {
  for (const transform of registry.values()) {
    if (
      transform.matchesFindings.some(
        m =>
          finding.subcategory?.toLowerCase().includes(m.toLowerCase()) ||
          finding.message?.toLowerCase().includes(m.toLowerCase()) ||
          finding.ruleId === m
      )
    ) {
      return transform;
    }
  }
  return undefined;
}

function extractImports(source: string): string[] {
  const imports: string[] = [];
  const lines = source.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("import ") || (trimmed.startsWith("const ") && trimmed.includes("require("))) {
      imports.push(trimmed);
    }
  }
  return imports;
}
