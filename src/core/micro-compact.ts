/**
 * micro-compact.ts — Lightweight prompt compaction for agent context overflow.
 *
 * Inspired by Claude Code's micro-compaction strategy: when a prompt is close to
 * overflowing the model context window but doesn't warrant full compaction, apply
 * a series of targeted trims to bring it within bounds.
 *
 * Strategy (applied in order until prompt fits):
 *   1. Remove code comments from injected file contents
 *   2. Collapse consecutive blank lines
 *   3. Truncate the middle of large file blocks (keep first/last 20 lines)
 *   4. Drop lowest-priority context blocks (READ-ONLY sections)
 */

/** Ratio of model context window at which micro-compaction kicks in. */
export const MICRO_COMPACT_THRESHOLD = 0.8;

/** Default estimated model context window in characters (100K chars ≈ ~50K tokens). */
export const DEFAULT_CONTEXT_WINDOW_CHARS = 100_000;

/** Lines kept at head/tail when truncating large file blocks. */
const TRUNCATE_KEEP_LINES = 20;

/**
 * Remove single-line and block comments from a file content string.
 * Preserves string literals and does not attempt to be a full parser.
 */
export function removeCodeComments(text: string): string {
  // Remove block comments (/* ... */)
  let result = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove single-line comments (// ...) — but not inside strings (best effort)
  result = result.replace(/(?<!["'`])\/\/[^\n]*/g, "");
  return result;
}

/**
 * Collapse 3+ consecutive blank lines into 2 blank lines.
 */
export function collapseBlankLines(text: string): string {
  return text.replace(/(\n\s*){3,}/g, "\n\n");
}

/**
 * Truncate the middle of a large file block, keeping the first and last N lines.
 * Only applies to blocks with more than 2 * keepLines lines.
 */
export function truncateFileBlock(content: string, keepLines: number = TRUNCATE_KEEP_LINES): string {
  const lines = content.split("\n");
  if (lines.length <= keepLines * 2) return content;
  const head = lines.slice(0, keepLines);
  const tail = lines.slice(-keepLines);
  const trimmedCount = lines.length - keepLines * 2;
  return [...head, `[...${trimmedCount} lines trimmed...]`, ...tail].join("\n");
}

/**
 * Apply truncation to all FILE blocks in the prompt.
 * Matches both --- FILE: ... --- and --- READ-ONLY: ... --- style blocks.
 */
export function truncateFileBlocks(prompt: string, keepLines: number = TRUNCATE_KEEP_LINES): string {
  // Match FILE blocks: --- FILE: path --- ... --- END FILE ---
  return prompt.replace(/(--- FILE:[^\n]*---\n)([\s\S]*?)(--- END FILE ---)/g, (_, header, content, footer) => {
    return header + truncateFileBlock(content, keepLines) + footer;
  });
}

/**
 * Drop READ-ONLY context blocks (lowest priority — they are supplemental context only).
 * These are injected as --- READ-ONLY: path --- ... --- END READ-ONLY --- blocks.
 */
export function dropReadOnlyBlocks(prompt: string): string {
  return prompt.replace(/\n?--- READ-ONLY:[^\n]*---\n[\s\S]*?--- END READ-ONLY ---\n?/g, "");
}

/**
 * Remove code comments from all FILE blocks in the prompt.
 */
export function removeCommentsFromFileBlocks(prompt: string): string {
  return prompt.replace(/(--- FILE:[^\n]*---\n)([\s\S]*?)(--- END FILE ---)/g, (_, header, content, footer) => {
    return header + removeCodeComments(content) + footer;
  });
}

/**
 * Micro-compact a prompt to fit within maxChars.
 *
 * Applies compaction steps in order of least → most destructive until the prompt
 * fits. If the prompt already fits, returns it unchanged.
 *
 * @param prompt - The prompt string to compact
 * @param maxChars - Maximum character count target
 * @returns The compacted prompt (may still exceed maxChars if all steps are exhausted)
 */
export function microCompact(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;

  // Step 1: Remove code comments from file blocks
  let result = removeCommentsFromFileBlocks(prompt);
  if (result.length <= maxChars) return result;

  // Step 2: Collapse consecutive blank lines
  result = collapseBlankLines(result);
  if (result.length <= maxChars) return result;

  // Step 3: Truncate middle of large file blocks
  result = truncateFileBlocks(result);
  if (result.length <= maxChars) return result;

  // Step 4 (last resort): Drop read-only context blocks
  result = dropReadOnlyBlocks(result);

  return result;
}

/**
 * Check whether a prompt should be micro-compacted given a context window estimate.
 *
 * @param promptLength - Length of the prompt in characters
 * @param contextWindowChars - Estimated context window in characters
 * @param threshold - Fraction (0–1) at which compaction kicks in (default 0.8)
 */
export function shouldMicroCompact(
  promptLength: number,
  contextWindowChars: number = DEFAULT_CONTEXT_WINDOW_CHARS,
  threshold: number = MICRO_COMPACT_THRESHOLD
): boolean {
  return promptLength > contextWindowChars * threshold;
}
