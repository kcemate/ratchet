/**
 * replace-console-logger transform
 *
 * Replaces console.log/warn/error/info/debug calls with a structured logger.
 * - If the repo has a logger file, imports that.
 * - Otherwise falls back to console (no-op guard keeps this idempotent).
 * - Never modifies test files.
 * - Idempotent: if calls are already replaced, second pass does nothing.
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import type { ASTTransform, TransformContext } from './base.js';
import type { Finding } from '../normalize.js';
import { isTestFile } from './base.js';

const CONSOLE_METHODS = ['log', 'warn', 'error', 'info', 'debug'] as const;
type ConsoleMethod = typeof CONSOLE_METHODS[number];

/** Map console method → logger method (log → info for structured loggers) */
const METHOD_MAP: Record<ConsoleMethod, string> = {
  log: 'info',
  warn: 'warn',
  error: 'error',
  info: 'info',
  debug: 'debug',
};

export const replaceConsoleTransform: ASTTransform = {
  id: 'replace-console-logger',
  matchesFindings: [
    'console',
    'Console.*',
    'console.log',
    'console in production',
    'structured logging',
    'replace console',
    'CQ-',
  ],
  languages: ['typescript', 'javascript'],

  canApply(source: string, finding: Finding): boolean {
    if (isTestFile(finding.file ?? '')) return false;
    return CONSOLE_METHODS.some(m => source.includes(`console.${m}(`));
  },

  apply(source: string, finding: Finding, context: TransformContext): string | null {
    if (isTestFile(context.filePath)) return null;

    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('__transform__.ts', source);

    const loggerVar = context.loggerVarName ?? 'logger';
    let replacementCount = 0;

    // Find all console.X() calls
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExpressions) {
      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) continue;

      const obj = expr.getExpression();
      const method = expr.getName();

      if (obj.getText() !== 'console') continue;
      if (!CONSOLE_METHODS.includes(method as ConsoleMethod)) continue;

      const mappedMethod = METHOD_MAP[method as ConsoleMethod];
      const args = call.getArguments().map(a => a.getText()).join(', ');

      call.replaceWithText(`${loggerVar}.${mappedMethod}(${args})`);
      replacementCount++;
    }

    if (replacementCount === 0) return null;

    let result = sourceFile.getFullText();

    // Add logger import if needed
    if (context.hasStructuredLogger && context.loggerImportPath) {
      const alreadyImported =
        result.includes(`from '${context.loggerImportPath}'`) ||
        result.includes(`from "${context.loggerImportPath}"`);
      if (!alreadyImported) {
        result = `import { ${loggerVar} } from '${context.loggerImportPath}';\n` + result;
      }
    } else if (!context.hasStructuredLogger) {
      // No structured logger — create a minimal one inline if console not already imported
      const alreadyHasLogger =
        result.includes(`const ${loggerVar}`) || result.includes(`import.*${loggerVar}`);
      if (!alreadyHasLogger) {
        // Prepend minimal logger shim (maps to console methods)
        const shim = [
          `const ${loggerVar} = {`,
          `  info: (...args: unknown[]) => console.info(...args),`,
          `  warn: (...args: unknown[]) => console.warn(...args),`,
          `  error: (...args: unknown[]) => console.error(...args),`,
          `  debug: (...args: unknown[]) => console.debug(...args),`,
          `};`,
          '',
        ].join('\n');
        result = shim + result;
      }
    }

    return result;
  },
};
