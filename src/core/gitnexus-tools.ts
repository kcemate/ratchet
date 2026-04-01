/**
 * gitnexus-tools.ts — Agent-accessible GitNexus graph tool descriptions.
 *
 * This module formats GitNexus capabilities as natural-language tool instructions
 * that can be injected into agent prompts. Agents can output GITNEXUS_QUERY markers
 * which are parsed and fulfilled by parseGitNexusQueries().
 */

import {
  getImpactDetailed, runCypher, queryFlowsTargeted,
  getContextWithSource, isIndexed, renameSymbol,
} from './gitnexus.js';
import { logger } from '../lib/logger.js';

/** The marker agents output to request GitNexus data */
export const GITNEXUS_QUERY_MARKER = 'GITNEXUS_QUERY:';

/**
 * Build the graph tool instructions to inject into agent prompts.
 * Only injected when GitNexus is indexed for the repo.
 */
export function buildGraphToolInstructions(cwd: string): string {
  if (!isIndexed(cwd)) return '';

  return `
GRAPH QUERY TOOLS (GitNexus knowledge graph — use these before editing high-risk code):
To check blast radius of a symbol/file, output exactly:
  GITNEXUS_QUERY: impact <filename-or-symbol>
To get execution flows for a concept, output exactly:
  GITNEXUS_QUERY: flows <concept> [--goal <your-goal>]
To get full source + context for a symbol, output exactly:
  GITNEXUS_QUERY: context <symbol-or-file>
To run a raw graph query, output exactly:
  GITNEXUS_QUERY: cypher <cypher-expression>
To do a graph-aware rename (updates all callers + the knowledge graph), output exactly:
  GITNEXUS_QUERY: rename <old-name> <new-name>

The engine will intercept these markers and inject the results before your next action.
Use impact queries before modifying any shared utility or exported function.
`.trim();
}

export interface GitNexusQueryRequest {
  type: 'impact' | 'flows' | 'context' | 'cypher' | 'rename';
  target: string;
  options: Record<string, string>;
  raw: string;
}

/**
 * Parse agent output for GITNEXUS_QUERY markers.
 * Returns all query requests found in the output.
 */
export function parseGitNexusQueries(agentOutput: string): GitNexusQueryRequest[] {
  const queries: GitNexusQueryRequest[] = [];
  const lines = agentOutput.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(GITNEXUS_QUERY_MARKER)) continue;

    const rest = trimmed.slice(GITNEXUS_QUERY_MARKER.length).trim();
    const parts = rest.split(/\s+/);
    const type = parts[0]?.toLowerCase();

    if (!type || !['impact', 'flows', 'context', 'cypher', 'rename'].includes(type)) continue;

    const target = parts[1] ?? '';
    const options: Record<string, string> = {};

    // For rename: second positional arg is the new name
    if (type === 'rename' && parts[2] && !parts[2].startsWith('--')) {
      options['newName'] = parts[2];
    }

    // Parse --key value pairs (starting at index 2 for rename, or 2 for others)
    const optionsStart = type === 'rename' ? 3 : 2;
    for (let i = optionsStart; i < parts.length - 1; i++) {
      if (parts[i]?.startsWith('--')) {
        const key = parts[i]!.slice(2);
        const val = parts[i + 1] ?? '';
        if (!val.startsWith('--')) {
          options[key] = val;
          i++;
        }
      }
    }

    queries.push({
      type: type as GitNexusQueryRequest['type'],
      target,
      options,
      raw: rest,
    });
  }

  return queries;
}

/**
 * Fulfill a list of GitNexus query requests and return formatted results.
 * Results can be injected back into the agent's context.
 */
export async function fulfillGitNexusQueries(
  queries: GitNexusQueryRequest[],
  cwd: string,
): Promise<string> {
  if (queries.length === 0) return '';

  const results: string[] = [];

  for (const query of queries) {
    try {
      switch (query.type) {
        case 'impact': {
          const impact = await getImpactDetailed(query.target, cwd, {
            direction: query.options['direction'] as 'upstream' | 'downstream' | undefined,
            depth: query.options['depth'] ? parseInt(query.options['depth'], 10) : undefined,
            includeTests: query.options['include-tests'] === 'true',
          });
          if (impact) {
            const dependentCount = impact.directCallers.length + impact.affectedFiles.length;
            results.push(
              `GITNEXUS RESULT [impact ${query.target}]:\n` +
              `  Risk: ${impact.riskLevel} (confidence: ${(impact.confidence * 100).toFixed(0)}%)\n` +
              `  Dependents: ${dependentCount} (${impact.directCallers.length} direct callers, ` +
              `${impact.affectedFiles.length} affected files)\n` +
              `  Affected files: ${impact.affectedFiles.slice(0, 10).join(', ')}` +
              `${impact.affectedFiles.length > 10 ? ` (+${impact.affectedFiles.length - 10} more)` : ''}`,
            );
          } else {
            results.push(`GITNEXUS RESULT [impact ${query.target}]: no data found`);
          }
          break;
        }

        case 'flows': {
          const flows = await queryFlowsTargeted(query.target, cwd, {
            goal: query.options['goal'],
            context: query.options['context'],
            limit: 5,
          });
          if (flows.length > 0) {
            results.push(
              `GITNEXUS RESULT [flows ${query.target}]:\n` +
              flows.map((f, i) => `  ${i + 1}. ${f}`).join('\n'),
            );
          } else {
            results.push(`GITNEXUS RESULT [flows ${query.target}]: no flows found`);
          }
          break;
        }

        case 'context': {
          const ctx = await getContextWithSource(query.target, cwd);
          if (ctx) {
            const callers = ctx.incoming['calls'] ?? [];
            const imports = ctx.outgoing['imports'] ?? [];
            results.push(
              `GITNEXUS RESULT [context ${query.target}]:\n` +
              `  Symbol: ${ctx.symbol}\n` +
              `  Called by: ${callers.map(c => c.name).join(', ') || 'none'}\n` +
              `  Imports: ${imports.map(i => i.filePath).join(', ') || 'none'}` +
              (ctx.source ? `\n  Source preview: ${ctx.source.slice(0, 300)}...` : ''),
            );
          } else {
            results.push(`GITNEXUS RESULT [context ${query.target}]: not found`);
          }
          break;
        }

        case 'cypher': {
          const raw = query.target + (query.options['rest'] ?? '');
          const result = await runCypher(raw, cwd);
          results.push(
            `GITNEXUS RESULT [cypher]:\n  ${JSON.stringify(result, null, 2).slice(0, 500)}`,
          );
          break;
        }

        case 'rename': {
          const oldName = query.target;
          const newName = query.options['newName'] ?? Object.keys(query.options)[0] ?? '';
          if (!newName) {
            results.push(`GITNEXUS RESULT [rename ${oldName}]: missing new name`);
            break;
          }
          const renameResult = await renameSymbol(oldName, newName, cwd);
          if (renameResult.renamedFiles.length > 0) {
            results.push(
              `GITNEXUS RESULT [rename ${oldName} → ${newName}]:\n` +
              `  Renamed in ${renameResult.renamedFiles.length} files: ` +
              `${renameResult.renamedFiles.join(', ')}` +
              (renameResult.previewDiff ? `\n  Diff preview:\n${renameResult.previewDiff.slice(0, 500)}` : ''),
            );
          } else {
            results.push(`GITNEXUS RESULT [rename ${oldName} → ${newName}]: no files renamed`);
          }
          break;
        }
      }
    } catch (err) {
      logger.debug({ err, query }, 'GitNexus query fulfillment failed');
      results.push(`GITNEXUS RESULT [${query.type} ${query.target}]: error — ${String(err)}`);
    }
  }

  return results.join('\n\n');
}
