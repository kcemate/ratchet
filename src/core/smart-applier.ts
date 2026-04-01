/**
 * Smart Applier — Layer 3 of the Autofix Engine v2.
 *
 * Takes an IntentPlan (JSON fix description) and applies it to a file
 * deterministically. Zero LLM calls.
 *
 * Algorithm:
 *   1. Read the target file (or accept source directly)
 *   2. Find target region: exact lines → fuzzy ±10 → whole-file search
 *   3. Apply action: wrap / replace / insert / delete
 *   4. Add any needed imports after existing imports
 *   5. Validate syntax (bracket balancing)
 *   6. Return { success, modifiedSource, error }
 */

import { readFile } from 'node:fs/promises';
import { renderFromIntent } from './fix-templates.js';
import type { TemplateContext } from './fix-templates.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntentPlan {
  /** What kind of edit to make */
  action: 'insert' | 'replace' | 'delete' | 'wrap';
  /** 1-indexed, inclusive [startLine, endLine] */
  targetLines: [number, number];
  /** Human-readable description of the change */
  description: string;
  /** Code pattern to search for when line numbers drift */
  pattern: string;
  /** Describes what the replacement/insert should accomplish */
  replacement_intent: string;
  /** Import paths that need to be added */
  imports_needed: string[];
  /** 0.0–1.0 confidence from the LLM that generated this plan */
  confidence: number;
}

export interface ApplyResult {
  success: boolean;
  modifiedSource: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a file from disk and apply the intent plan to it.
 * Returns { success: false } on any error — never throws.
 */
export async function applyIntentPlan(
  filePath: string,
  plan: IntentPlan,
): Promise<ApplyResult> {
  let source: string;
  try {
    const buf = await readFile(filePath);
    // Reject binary files (null bytes present)
    if (buf.includes(0x00)) {
      return { success: false, modifiedSource: null, error: 'Binary file — skipped' };
    }
    source = buf.toString('utf8');
  } catch (err) {
    return {
      success: false,
      modifiedSource: null,
      error: `Cannot read file: ${(err as Error).message}`,
    };
  }
  return applyIntentPlanToSource(source, plan);
}

/**
 * Apply an intent plan to an in-memory source string.
 * Useful for testing and for callers that already have file content.
 * Never throws.
 */
export function applyIntentPlanToSource(
  source: string,
  plan: IntentPlan,
  overrideImportStyle?: 'esm' | 'cjs',
): ApplyResult {
  try {
    return _apply(source, plan, overrideImportStyle);
  } catch (err) {
    return {
      success: false,
      modifiedSource: null,
      error: `Unexpected applier error: ${(err as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

function _apply(
  source: string,
  plan: IntentPlan,
  overrideImportStyle?: 'esm' | 'cjs',
): ApplyResult {
  if (source.length === 0) {
    // Empty file: only insert is valid
    if (plan.action !== 'insert') {
      return { success: false, modifiedSource: null, error: 'Empty file — only insert is valid' };
    }
  }

  const importStyle = overrideImportStyle ?? detectImportStyle(source);
  const lines = source.split('\n');

  // ── 1. Find the target region ──────────────────────────────────────────
  const region = findTargetRegion(lines, plan);
  if (region === null) {
    return {
      success: false,
      modifiedSource: null,
      error: `Cannot locate target region (lines ${plan.targetLines[0]}-${plan.targetLines[1]}, pattern: "${plan.pattern}")`,
    };
  }

  const { startIdx, endIdx } = region;

  // Detect indentation from the first target line (fall back to 2 spaces)
  const indent = detectIndent(lines[startIdx] ?? '');

  // ── 2. Apply the action ────────────────────────────────────────────────
  let newLines: string[];
  try {
    newLines = applyAction(lines, startIdx, endIdx, indent, plan, importStyle);
  } catch (err) {
    return {
      success: false,
      modifiedSource: null,
      error: `Action '${plan.action}' failed: ${(err as Error).message}`,
    };
  }

  // ── 3. Add imports ─────────────────────────────────────────────────────
  if (plan.imports_needed.length > 0) {
    newLines = insertImports(newLines, plan.imports_needed, importStyle);
  }

  const modifiedSource = newLines.join('\n');

  // ── 4. Validate syntax ─────────────────────────────────────────────────
  if (!isBracketsBalanced(modifiedSource)) {
    return {
      success: false,
      modifiedSource: null,
      error: 'Syntax validation failed: unbalanced brackets after applying fix',
    };
  }

  return { success: true, modifiedSource };
}

// ---------------------------------------------------------------------------
// Region finding
// ---------------------------------------------------------------------------

interface Region {
  startIdx: number; // 0-indexed
  endIdx: number;   // 0-indexed, inclusive
}

/**
 * Three-tier region finder:
 *   1. Exact line numbers from plan (verify pattern loosely)
 *   2. Fuzzy: search for pattern within ±10 lines of targetLines[0]
 *   3. Fallback: search entire file for pattern
 */
function findTargetRegion(lines: string[], plan: IntentPlan): Region | null {
  const [startLine, endLine] = plan.targetLines;
  const startIdx = startLine - 1; // convert 1-indexed → 0-indexed
  const endIdx = endLine - 1;
  const rangeLen = Math.max(0, endIdx - startIdx);

  // ── Primary: exact lines ───────────────────────────────────────────────
  if (startIdx >= 0 && endIdx >= startIdx && endIdx < lines.length) {
    // Optionally verify the pattern is roughly present in the region
    if (!plan.pattern || regionMatchesPattern(lines, startIdx, endIdx, plan.pattern)) {
      return { startIdx, endIdx };
    }
  }

  // ── Fallback 1: fuzzy ±10 lines ────────────────────────────────────────
  if (plan.pattern) {
    const searchCenter = Math.max(0, startIdx);
    const fuzzyStart = Math.max(0, searchCenter - 10);
    const fuzzyEnd = Math.min(lines.length - 1, searchCenter + 10);
    const patternLine = firstMeaningfulLine(plan.pattern);

    for (let i = fuzzyStart; i <= fuzzyEnd; i++) {
      if (lineMatchesPattern(lines[i], patternLine)) {
        const newEnd = Math.min(lines.length - 1, i + rangeLen);
        return { startIdx: i, endIdx: newEnd };
      }
    }

    // ── Fallback 2: entire file ──────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      if (lineMatchesPattern(lines[i], patternLine)) {
        const newEnd = Math.min(lines.length - 1, i + rangeLen);
        return { startIdx: i, endIdx: newEnd };
      }
    }
  }

  // ── Last resort: use line numbers even without pattern confirmation ─────
  if (startIdx >= 0 && startIdx < lines.length) {
    const clampedEnd = Math.min(lines.length - 1, endIdx < startIdx ? startIdx : endIdx);
    return { startIdx, endIdx: clampedEnd };
  }

  return null;
}

function regionMatchesPattern(
  lines: string[],
  startIdx: number,
  endIdx: number,
  pattern: string,
): boolean {
  const regionText = lines.slice(startIdx, endIdx + 1).join('\n').toLowerCase();
  const key = firstMeaningfulLine(pattern).toLowerCase();
  return key.length === 0 || regionText.includes(key);
}

function lineMatchesPattern(line: string, patternLine: string): boolean {
  if (!patternLine) return false;
  return line.toLowerCase().includes(patternLine.toLowerCase());
}

/** Returns the first non-empty, non-whitespace line of a (possibly multi-line) pattern. */
function firstMeaningfulLine(pattern: string): string {
  const lines = pattern.split('\n');
  for (const l of lines) {
    const t = l.trim();
    if (t.length > 0) return t;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function applyAction(
  lines: string[],
  startIdx: number,
  endIdx: number,
  indent: string,
  plan: IntentPlan,
  importStyle: 'esm' | 'cjs',
): string[] {
  switch (plan.action) {
    case 'delete':
      return [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)];

    case 'insert': {
      const ctx = buildTemplateContext(indent, plan, importStyle);
      const generated = renderFromIntent(plan.replacement_intent, ctx);
      if (generated === null) {
        throw new Error(`No template matches intent: "${plan.replacement_intent}"`);
      }
      const insertLines = generated.split('\n');
      return [
        ...lines.slice(0, startIdx),
        ...insertLines,
        ...lines.slice(startIdx),
      ];
    }

    case 'replace': {
      const ctx = buildTemplateContext(indent, plan, importStyle);
      const generated = renderFromIntent(plan.replacement_intent, ctx);
      if (generated === null) {
        throw new Error(`No template matches intent: "${plan.replacement_intent}"`);
      }
      const replaceLines = generated.split('\n');
      return [
        ...lines.slice(0, startIdx),
        ...replaceLines,
        ...lines.slice(endIdx + 1),
      ];
    }

    case 'wrap': {
      const targetLines = lines.slice(startIdx, endIdx + 1);
      return wrapInTryCatch(lines, startIdx, endIdx, targetLines, indent, plan.replacement_intent);
    }

    default:
      throw new Error(`Unknown action: ${(plan as IntentPlan).action}`);
  }
}

function wrapInTryCatch(
  lines: string[],
  startIdx: number,
  endIdx: number,
  targetLines: string[],
  indent: string,
  intent: string,
): string[] {
  const inner = indent + '  ';
  const intentLower = intent.toLowerCase();

  // Determine what kind of wrap based on intent
  const isValidation =
    intentLower.includes('validat') ||
    intentLower.includes('null check') ||
    intentLower.includes('guard');

  let wrapped: string[];
  if (isValidation) {
    // Wrap in a validation if-block
    wrapped = [
      `${indent}if (true) { // TODO: replace condition`,
      ...targetLines.map((l) => (l.startsWith(indent) ? l : inner + l.trimStart())),
      `${indent}}`,
    ];
  } else {
    // Default: try/catch
    const errHandler = intentLower.includes('logger') ? 'logger' : 'console';
    wrapped = [
      `${indent}try {`,
      ...targetLines.map((l) => (l.startsWith(indent) ? l : inner + l.trimStart())),
      `${indent}} catch (error) {`,
      `${inner}${errHandler}.error('Caught error', error);`,
      `${indent}}`,
    ];
  }

  return [...lines.slice(0, startIdx), ...wrapped, ...lines.slice(endIdx + 1)];
}

function buildTemplateContext(
  indent: string,
  plan: IntentPlan,
  importStyle: 'esm' | 'cjs',
): TemplateContext {
  return {
    indent,
    variableNames: extractVariableNames(plan.pattern),
    errorHandler: 'console',
    importStyle,
  };
}

/** Heuristically extract variable names from a pattern string. */
function extractVariableNames(pattern: string): string[] {
  // Match identifiers that look like variable/param names (camelCase, snake_case)
  const matches = pattern.match(/\b([a-z][a-zA-Z0-9_]*)\b/g) ?? [];
  // Deduplicate and filter out keywords
  const keywords = new Set(['if', 'for', 'while', 'return', 'const', 'let', 'var', 'function', 'async', 'await', 'new', 'this', 'null', 'undefined', 'true', 'false']);
  return [...new Set(matches)].filter((n) => !keywords.has(n)).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Import insertion
// ---------------------------------------------------------------------------

function insertImports(lines: string[], imports: string[], importStyle: 'esm' | 'cjs'): string[] {
  const lastImportIdx = findLastImportLine(lines);

  const toInsert: string[] = [];
  for (const imp of imports) {
    const importLine = formatImport(imp, importStyle);
    // Skip if already present (exact match or contains the module path)
    const alreadyPresent = lines.some(
      (l) => l.trim() === importLine.trim() || (imp.length > 3 && l.includes(imp)),
    );
    if (!alreadyPresent) {
      toInsert.push(importLine);
    }
  }

  if (toInsert.length === 0) return lines;

  const insertAt = lastImportIdx + 1; // insert after last import (or at index 0 if no imports)
  return [...lines.slice(0, insertAt), ...toInsert, ...lines.slice(insertAt)];
}

function formatImport(modulePath: string, style: 'esm' | 'cjs'): string {
  // If the caller already wrote a full import statement, preserve it
  if (modulePath.trim().startsWith('import ') || modulePath.trim().startsWith('const ')) {
    return modulePath;
  }
  const name = moduleToVarName(modulePath);
  if (style === 'cjs') {
    return `const { ${name} } = require('${modulePath}');`;
  }
  return `import { ${name} } from '${modulePath}';`;
}

function moduleToVarName(modulePath: string): string {
  // e.g. './logger' → 'logger', 'some-package' → 'somePackage'
  const base = modulePath.replace(/^.*\//, '').replace(/\.[jt]sx?$/, '');
  return base.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Returns the 0-indexed line of the last import/require statement, or -1 if none. */
function findLastImportLine(lines: string[]): number {
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith('import ') ||
      (trimmed.startsWith('const ') && trimmed.includes('require(')) ||
      (trimmed.startsWith('var ') && trimmed.includes('require('))
    ) {
      lastIdx = i;
    }
  }
  return lastIdx;
}

// ---------------------------------------------------------------------------
// Syntax validation
// ---------------------------------------------------------------------------

/**
 * Simple bracket-balance check.
 * Skips string literals (single, double, template) and comments.
 * Returns false if any bracket type goes negative or ends unbalanced.
 */
export function isBracketsBalanced(source: string): boolean {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }

    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') braces++;
    else if (ch === '}') { braces--; if (braces < 0) return false; }
    else if (ch === '(') parens++;
    else if (ch === ')') { parens--; if (parens < 0) return false; }
    else if (ch === '[') brackets++;
    else if (ch === ']') { brackets--; if (brackets < 0) return false; }
  }

  return braces === 0 && parens === 0 && brackets === 0;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function detectIndent(line: string): string {
  const match = line.match(/^(\s+)/);
  return match ? match[1] : '';
}

function detectImportStyle(source: string): 'esm' | 'cjs' {
  if (/^import\s+/m.test(source)) return 'esm';
  if (/require\s*\(/.test(source)) return 'cjs';
  return 'esm';
}
