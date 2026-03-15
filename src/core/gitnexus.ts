import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, basename } from 'path';

// ── Per-run caches ──────────────────────────────────────────
// getImpact and queryFlows can be slow (spawns CLI). Cache per target+cwd.
const impactCache = new Map<string, GitNexusImpact | null>();
const flowsCache = new Map<string, string[]>();
const contextCache = new Map<string, GitNexusContext | null>();

/** Clear all GitNexus caches. Call between runs or in tests. */
export function clearCache(): void {
  impactCache.clear();
  flowsCache.clear();
  contextCache.clear();
}

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

  const cacheKey = `${cwd}::${target}`;
  if (impactCache.has(cacheKey)) return impactCache.get(cacheKey)!;

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

    const result: GitNexusImpact = {
      target,
      directCallers,
      affectedFiles,
      riskLevel: parsed.risk_level ?? parsed.riskLevel ?? 'unknown',
      raw,
    };
    impactCache.set(cacheKey, result);
    return result;
  } catch {
    impactCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Run `gitnexus context <file>` to get dependency map (imports, callers, callees).
 * Returns null if GitNexus is not available.
 */
export function getContext(fileOrSymbol: string, cwd: string): GitNexusContext | null {
  if (!isIndexed(cwd)) return null;

  const cacheKey = `${cwd}::${fileOrSymbol}`;
  if (contextCache.has(cacheKey)) return contextCache.get(cacheKey)!;

  try {
    const fileName = basename(fileOrSymbol);
    const args = ['context', fileName, '--repo', getRepoName(cwd)];
    if (fileOrSymbol.includes('/')) {
      args.push('--file', fileOrSymbol);
    }

    const raw = runGitNexus(args, cwd);

    const parsed = JSON.parse(raw);
    if (parsed.status === 'not_found' || parsed.error) return null;

    const result: GitNexusContext = {
      symbol: parsed.symbol?.name ?? fileOrSymbol,
      incoming: parsed.incoming ?? {},
      outgoing: parsed.outgoing ?? {},
      raw,
    };
    contextCache.set(cacheKey, result);
    return result;
  } catch {
    contextCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Run `gitnexus query <concept>` to find execution flows.
 * Returns the top N process summaries.
 */
export function queryFlows(concept: string, cwd: string, limit = 5): string[] {
  if (!isIndexed(cwd)) return [];

  const cacheKey = `${cwd}::${concept}::${limit}`;
  if (flowsCache.has(cacheKey)) return flowsCache.get(cacheKey)!;

  try {
    const raw = runGitNexus(['query', concept, '--repo', getRepoName(cwd)], cwd);

    const parsed = JSON.parse(raw);
    const processes = parsed.processes ?? parsed;
    if (!Array.isArray(processes)) return [];

    const result = processes
      .slice(0, limit)
      .map((p: { summary?: string; id?: string }) => p.summary ?? p.id ?? '')
      .filter(Boolean);
    flowsCache.set(cacheKey, result);
    return result;
  } catch {
    flowsCache.set(cacheKey, []);
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

/**
 * Assess risk score for a file based on blast radius (number of dependents).
 * Returns 0–1: 0 = isolated, 1 = very high impact (≥10 dependents).
 * Gracefully returns 0 if GitNexus is not indexed.
 */
export function assessFileRisk(filePath: string, cwd: string): number {
  const impact = getImpact(filePath, cwd);
  if (!impact) return 0;
  const dependentCount = impact.directCallers.length + impact.affectedFiles.length;
  return Math.min(1, dependentCount / 10);
}

/**
 * Group files into dependency clusters — files that share imports are grouped together.
 * Useful for sweep mode: fixing tightly-coupled files in the same click.
 * Returns the original list as a single cluster if GitNexus is not indexed.
 */
export function getDependencyClusters(files: string[], cwd: string): string[][] {
  if (!isIndexed(cwd) || files.length === 0) return files.length > 0 ? [files] : [];

  // Collect dependency sets per file
  const fileDeps = new Map<string, Set<string>>();
  for (const file of files) {
    const normalized = file.replace(/^\.\//, '');
    const ctx = getContext(normalized, cwd);
    if (!ctx) continue;
    const deps = new Set<string>();
    for (const imp of ctx.outgoing['imports'] ?? []) deps.add(imp.filePath);
    for (const imp of ctx.incoming['imports'] ?? []) deps.add(imp.filePath);
    fileDeps.set(file, deps);
  }

  // Union-find: cluster files that share at least one dependency
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };

  for (const file of files) {
    if (!parent.has(file)) parent.set(file, file);
  }

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const depsA = fileDeps.get(files[i]!) ?? new Set();
      const depsB = fileDeps.get(files[j]!) ?? new Set();
      for (const d of depsA) {
        if (depsB.has(d)) {
          union(files[i]!, files[j]!);
          break;
        }
      }
    }
  }

  // Group by root
  const clusters = new Map<string, string[]>();
  for (const file of files) {
    const root = find(file);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(file);
  }

  return [...clusters.values()];
}
