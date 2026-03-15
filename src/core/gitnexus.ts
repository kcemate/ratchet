import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, basename } from 'path';

/**
 * Run gitnexus CLI and return the JSON output.
 * GitNexus sometimes writes JSON to stderr instead of stdout,
 * so we capture both and return whichever contains JSON.
 */
function runGitNexus(args: string[], cwd: string): string {
  const result = spawnSync('gitnexus', args, {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();

  // Return whichever has JSON
  if (stdout.startsWith('{') || stdout.startsWith('[')) return stdout;
  if (stderr.startsWith('{') || stderr.startsWith('[')) return stderr;
  return stdout || stderr;
}

export interface GitNexusImpact {
  target: string;
  directCallers: string[];
  affectedFiles: string[];
  riskLevel: string;
  raw: string;
}

export interface GitNexusContext {
  symbol: string;
  incoming: Record<string, { name: string; filePath: string }[]>;
  outgoing: Record<string, { name: string; filePath: string }[]>;
  raw: string;
}

/**
 * Check if GitNexus is indexed for a given repo.
 */
export function isIndexed(cwd: string): boolean {
  return existsSync(join(cwd, '.gitnexus'));
}

/**
 * Detect the GitNexus repo name from the directory name.
 * GitNexus uses the directory basename as the repo identifier.
 */
function getRepoName(cwd: string): string {
  return basename(cwd);
}

/**
 * Run `gitnexus impact <target>` to get blast radius analysis.
 * Returns null if GitNexus is not available or the target isn't found.
 */
export function getImpact(target: string, cwd: string): GitNexusImpact | null {
  if (!isIndexed(cwd)) return null;

  try {
    const fileName = basename(target);
    const args = ['impact', fileName, '--repo', getRepoName(cwd)];
    if (target.includes('/')) {
      args.push('--file', target);
    }
    const raw = runGitNexus(args, cwd);

    const parsed = JSON.parse(raw);
    if (parsed.error) return null;

    const directCallers: string[] = [];
    const affectedFiles: string[] = [];

    if (parsed.impact_summary) {
      for (const item of parsed.impact_summary) {
        if (item.filePath) affectedFiles.push(item.filePath);
        if (item.name) directCallers.push(item.name);
      }
    }

    if (parsed.upstream) {
      for (const item of parsed.upstream) {
        if (item.filePath && !affectedFiles.includes(item.filePath)) {
          affectedFiles.push(item.filePath);
        }
        if (item.name && !directCallers.includes(item.name)) {
          directCallers.push(item.name);
        }
      }
    }

    return {
      target,
      directCallers,
      affectedFiles,
      riskLevel: parsed.risk_level ?? parsed.riskLevel ?? 'unknown',
      raw,
    };
  } catch {
    return null;
  }
}

/**
 * Run `gitnexus context <file>` to get dependency map (imports, callers, callees).
 * Returns null if GitNexus is not available.
 */
export function getContext(fileOrSymbol: string, cwd: string): GitNexusContext | null {
  if (!isIndexed(cwd)) return null;

  try {
    const fileName = basename(fileOrSymbol);
    const args = ['context', fileName, '--repo', getRepoName(cwd)];
    if (fileOrSymbol.includes('/')) {
      args.push('--file', fileOrSymbol);
    }

    const raw = runGitNexus(args, cwd);

    const parsed = JSON.parse(raw);
    if (parsed.status === 'not_found' || parsed.error) return null;

    return {
      symbol: parsed.symbol?.name ?? fileOrSymbol,
      incoming: parsed.incoming ?? {},
      outgoing: parsed.outgoing ?? {},
      raw,
    };
  } catch {
    return null;
  }
}

/**
 * Run `gitnexus query <concept>` to find execution flows.
 * Returns the top N process summaries.
 */
export function queryFlows(concept: string, cwd: string, limit = 5): string[] {
  if (!isIndexed(cwd)) return [];

  try {
    const raw = runGitNexus(['query', concept, '--repo', getRepoName(cwd)], cwd);

    const parsed = JSON.parse(raw);
    const processes = parsed.processes ?? parsed;
    if (!Array.isArray(processes)) return [];

    return processes
      .slice(0, limit)
      .map((p: { summary?: string; id?: string }) => p.summary ?? p.id ?? '')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Build a concise intelligence briefing for a target file.
 * Combines context (deps) + impact (blast radius) into a prompt-ready string.
 * Returns empty string if GitNexus is not available.
 */
export function buildIntelligenceBriefing(targetPath: string, cwd: string): string {
  // Normalize path: strip leading ./ which Ratchet targets often have
  const normalizedPath = targetPath.replace(/^\.\//, '');
  const ctx = getContext(normalizedPath, cwd);
  if (!ctx) return '';

  const lines: string[] = ['GITNEXUS INTELLIGENCE (knowledge graph):'];

  // Dependencies this file imports
  const imports = ctx.outgoing['imports'] ?? [];
  if (imports.length > 0) {
    lines.push(`  Imports from: ${imports.map((i) => i.filePath).join(', ')}`);
  }

  // What imports this file
  const importedBy = ctx.incoming['imports'] ?? [];
  if (importedBy.length > 0) {
    lines.push(`  Imported by: ${importedBy.map((i) => i.filePath).join(', ')}`);
  }

  // Callers
  const callers = ctx.incoming['calls'] ?? [];
  if (callers.length > 0) {
    lines.push(`  Called by: ${callers.map((c) => `${c.name} (${c.filePath})`).join(', ')}`);
  }

  // Callees
  const callees = ctx.outgoing['calls'] ?? [];
  if (callees.length > 0) {
    lines.push(`  Calls into: ${callees.map((c) => `${c.name} (${c.filePath})`).join(', ')}`);
  }

  if (lines.length === 1) return ''; // no useful info found

  lines.push('');
  lines.push('  ⚠ Do NOT break any of the above relationships. If you change a function signature,');
  lines.push('    check that all callers still work. If you move/rename exports, update all importers.');

  return lines.join('\n');
}
