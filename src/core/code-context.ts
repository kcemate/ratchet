/**
 * Shared code-context utilities for context-aware regex matching.
 *
 * Primary export: stripCommentsAndStrings — removes comments and string
 * literals from JS/TS source so that pattern matching only hits real code.
 */

/**
 * Strip single-line comments, multi-line comments, and string literals from
 * TypeScript/JavaScript source so that pattern matching only hits real code.
 *
 * Replacement strategy: replace stripped regions with whitespace of equal
 * length to preserve character offsets (makes regex match positions stable,
 * though we only care about presence, not position).
 */
export function stripCommentsAndStrings(source: string): string {
  let result = '';
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // Single-line comment: // …
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      result += ' ';
      continue;
    }

    // Multi-line comment: /* … */
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len - 1 && !(source[i] === '*' && source[i + 1] === '/')) {
        result += source[i] === '\n' ? '\n' : ' '; // preserve newlines for line count
        i++;
      }
      i += 2; // skip closing */
      result += ' ';
      continue;
    }

    // Template literal: ` … `
    if (ch === '`') {
      i++;
      while (i < len && source[i] !== '`') {
        if (source[i] === '\\') i++; // skip escaped char
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i++; // skip closing `
      result += ' ';
      continue;
    }

    // Single-quoted string: ' … '
    if (ch === "'") {
      i++;
      while (i < len && source[i] !== "'" && source[i] !== '\n') {
        if (source[i] === '\\') i++;
        result += ' ';
        i++;
      }
      i++; // skip closing '
      result += ' ';
      continue;
    }

    // Double-quoted string: " … "
    if (ch === '"') {
      i++;
      while (i < len && source[i] !== '"' && source[i] !== '\n') {
        if (source[i] === '\\') i++;
        result += ' ';
        i++;
      }
      i++; // skip closing "
      result += ' ';
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}
