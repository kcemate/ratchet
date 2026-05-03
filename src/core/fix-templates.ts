/**
 * Fix template library for the Smart Applier (Layer 3 of Autofix Engine v2).
 *
 * Each template is a pure function: (TemplateContext) => string.
 * Zero LLM calls — all code generation is deterministic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateContext {
  /** Leading whitespace for the outermost block */
  indent: string;
  /** Variable names relevant to the fix (e.g. the function parameter names) */
  variableNames: string[];
  /** 'logger' | 'console' | custom variable name */
  errorHandler: string;
  /** Module style of the target file */
  importStyle: "esm" | "cjs";
}

export type TemplateFn = (context: TemplateContext) => string;

// ---------------------------------------------------------------------------
// Template implementations
// ---------------------------------------------------------------------------

const addErrorHandling: TemplateFn = ({ indent, errorHandler }) => {
  const i = indent;
  const i2 = indent + "  ";
  return [
    `${i}try {`,
    `${i2}// existing code here`,
    `${i}} catch (error) {`,
    `${i2}${errorHandler}.error('Unexpected error', error);`,
    `${i}}`,
  ].join("\n");
};

const addInputValidation: TemplateFn = ({ indent, variableNames, importStyle }) => {
  const i = indent;
  const i2 = indent + "  ";
  const varName = variableNames[0] ?? "input";
  const schemaName = `${varName}Schema`;
  const lines = [
    `${i}const ${schemaName} = z.object({`,
    `${i2}// define expected shape`,
    `${i}});`,
    `${i}const _parsed = ${schemaName}.safeParse(${varName});`,
    `${i}if (!_parsed.success) {`,
    `${i2}throw new Error(\`Invalid input: \${_parsed.error.message}\`);`,
    `${i}}`,
  ];
  return lines.join("\n");
};

const replaceConsoleWithLogger: TemplateFn = ({ indent, importStyle }) => {
  if (importStyle === "cjs") {
    return `${indent}const { logger } = require('./logger');`;
  }
  return `${indent}import { logger } from './logger.js';`;
};

const addReturnType: TemplateFn = ({ indent }) => {
  return `${indent}// TODO: add explicit return type annotation to the function signature`;
};

const addNullCheck: TemplateFn = ({ indent, variableNames }) => {
  const i = indent;
  const i2 = indent + "  ";
  const varName = variableNames[0] ?? "value";
  return [`${i}if (${varName} == null) {`, `${i2}throw new Error(\`${varName} is required\`);`, `${i}}`].join("\n");
};

// ---------------------------------------------------------------------------
// Registry + lookup
// ---------------------------------------------------------------------------

/** Canonical template IDs */
export type TemplateId =
  | "add-error-handling"
  | "add-input-validation"
  | "replace-console-with-logger"
  | "add-return-type"
  | "add-null-check";

const TEMPLATE_REGISTRY = new Map<TemplateId, TemplateFn>([
  ["add-error-handling", addErrorHandling],
  ["add-input-validation", addInputValidation],
  ["replace-console-with-logger", replaceConsoleWithLogger],
  ["add-return-type", addReturnType],
  ["add-null-check", addNullCheck],
]);

/** Keyword → template ID mapping for fuzzy resolution of replacement_intent strings */
const INTENT_KEYWORDS: Array<[string[], TemplateId]> = [
  [["error handling", "try/catch", "try catch", "catch error", "exception"], "add-error-handling"],
  [["input validation", "validate input", "zod", "schema", "validate param"], "add-input-validation"],
  [["console", "logger", "structured log", "replace log"], "replace-console-with-logger"],
  [["return type", "missing return", "annotation", "type annotation"], "add-return-type"],
  [["null check", "undefined check", "null guard", "nullish", "falsy check"], "add-null-check"],
];

/**
 * Resolve a free-form replacement_intent string to a template ID.
 * Returns undefined if no template matches.
 */
export function resolveTemplateId(intent: string): TemplateId | undefined {
  const lower = intent.toLowerCase();
  for (const [keywords, id] of INTENT_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) return id;
  }
  return undefined;
}

/**
 * Get a template function by ID. Returns undefined if not found.
 */
export function getTemplate(id: TemplateId): TemplateFn | undefined {
  return TEMPLATE_REGISTRY.get(id);
}

/**
 * Generate code from a template using a resolved intent string.
 * Returns null if no template matches the intent.
 */
export function renderFromIntent(intent: string, context: TemplateContext): string | null {
  const id = resolveTemplateId(intent);
  if (!id) return null;
  const fn = TEMPLATE_REGISTRY.get(id);
  if (!fn) return null;
  return fn(context);
}

/**
 * Render a template by ID directly.
 */
export function renderTemplate(id: TemplateId, context: TemplateContext): string {
  const fn = TEMPLATE_REGISTRY.get(id);
  if (!fn) throw new Error(`Unknown template: ${id}`);
  return fn(context);
}

/**
 * List all registered template IDs.
 */
export function listTemplates(): TemplateId[] {
  return [...TEMPLATE_REGISTRY.keys()];
}
