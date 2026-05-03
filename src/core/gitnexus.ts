import { spawnSync, spawn } from "child_process";
import { existsSync } from "fs";
import { join, basename } from "path";
import { logger } from "../lib/logger.js";

// ── Per-run caches
// getImpact and queryFlows can be slow (spawns CLI). Cache per target+cwd.
const impactCache = new Map<string, GitNexusImpact | null>();
const flowsCache = new Map<string, string[]>();
const contextCache = new Map<string, GitNexusContext | null>();
const cypherCache = new Map<string, unknown>();

/** Clear all GitNexus caches. Call between runs or in tests. */
export function clearCache(): void {
  impactCache.clear();
  flowsCache.clear();
  contextCache.clear();
  cypherCache.clear();
}

/**
 * Run gitnexus CLI and return the JSON output (synchronous, for backward compat).
 * GitNexus sometimes writes JSON to stderr instead of stdout,
 * so we capture both and return whichever contains JSON.
 */
function runGitNexus(args: string[], cwd: string): string {
  const result = spawnSync("gitnexus", args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();

  // Return whichever has JSON
  if (stdout.startsWith("{") || stdout.startsWith("[")) return stdout;
  if (stderr.startsWith("{") || stderr.startsWith("[")) return stderr;
  return stdout || stderr;
}

/**
 * Run gitnexus CLI asynchronously. Returns stdout/stderr as string.
 * Used for new functions to avoid blocking the event loop.
 */
function runGitNexusAsync(args: string[], cwd: string, timeoutMs = 15_000): Promise<string> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("gitnexus", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // gitnexus not installed
      resolve("");
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      resolve("");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    child.on("error", err => {
      clearTimeout(timer);
      logger.debug({ err }, "gitnexus spawn error");
      resolve("");
    });

    child.on("close", () => {
      if (timedOut) return;
      clearTimeout(timer);
      const stdout = stdoutBuf.trim();
      const stderr = stderrBuf.trim();
      if (stdout.startsWith("{") || stdout.startsWith("[")) {
        resolve(stdout);
      } else if (stderr.startsWith("{") || stderr.startsWith("[")) {
        resolve(stderr);
      } else {
        resolve(stdout || stderr);
      }
    });
  });
}

export interface GitNexusImpact {
  target: string;
  directCallers: string[];
  affectedFiles: string[];
  riskLevel: string;
  /** 0–1 confidence in the impact analysis; parsed from CLI output, defaults to 0.7 */
  confidence: number;
  raw: string;
}

export interface GitNexusContext {
  symbol: string;
  incoming: Record<string, { name: string; filePath: string }[]>;
  outgoing: Record<string, { name: string; filePath: string }[]>;
  raw: string;
}

export interface GitNexusImpactOptions {
  direction?: "upstream" | "downstream";
  depth?: number;
  includeTests?: boolean;
}

export interface GitNexusCluster {
  files: string[];
  issueTypes: string[];
  /** Architectural description of why these files are clustered */
  reason: string;
}

/**
 * Check if GitNexus is indexed for a given repo.
 */
export function isIndexed(cwd: string): boolean {
  return existsSync(join(cwd, ".gitnexus"));
}

/**
 * Detect the GitNexus repo name from the directory name.
 * GitNexus uses the directory basename as the repo identifier.
 */
function getRepoName(cwd: string): string {
  return basename(cwd);
}

/**
 * Parse confidence score from GitNexus JSON output.
 * Falls back to 0.7 (medium confidence) when not present.
 */
function parseConfidence(parsed: Record<string, unknown>): number {
  const raw = parsed.confidence ?? parsed.confidence_score ?? parsed.confidenceScore;
  if (typeof raw === "number" && raw >= 0 && raw <= 1) return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 0 && n <= 1) return n;
  }
  return 0.7; // default: medium confidence
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
    const args = ["impact", fileName, "--repo", getRepoName(cwd)];
    if (target.includes("/")) {
      args.push("--file", target);
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
      riskLevel: parsed.risk_level ?? parsed.riskLevel ?? "unknown",
      confidence: parseConfidence(parsed),
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
 * Run `gitnexus impact <target>` with advanced options (direction, depth, include-tests).
 * Async — does not block the event loop.
 * Returns null if GitNexus is not available or the target isn't found.
 */
export async function getImpactDetailed(
  target: string,
  cwd: string,
  options: GitNexusImpactOptions = {}
): Promise<GitNexusImpact | null> {
  if (!isIndexed(cwd)) return null;

  const cacheKey = `${cwd}::detailed::${target}::${JSON.stringify(options)}`;
  if (impactCache.has(cacheKey)) return impactCache.get(cacheKey)!;

  try {
    const fileName = basename(target);
    const args = ["impact", fileName, "--repo", getRepoName(cwd)];
    if (target.includes("/")) args.push("--file", target);
    if (options.direction) args.push("--direction", options.direction);
    if (options.depth !== undefined) args.push("--depth", String(options.depth));
    if (options.includeTests) args.push("--include-tests");

    const raw = await runGitNexusAsync(args, cwd);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed.error) return null;

    const directCallers: string[] = [];
    const affectedFiles: string[] = [];

    for (const item of parsed.impact_summary ?? []) {
      if (item.filePath) affectedFiles.push(item.filePath);
      if (item.name) directCallers.push(item.name);
    }
    for (const item of parsed.upstream ?? []) {
      if (item.filePath && !affectedFiles.includes(item.filePath)) affectedFiles.push(item.filePath);
      if (item.name && !directCallers.includes(item.name)) directCallers.push(item.name);
    }
    for (const item of parsed.downstream ?? []) {
      if (item.filePath && !affectedFiles.includes(item.filePath)) affectedFiles.push(item.filePath);
      if (item.name && !directCallers.includes(item.name)) directCallers.push(item.name);
    }

    const result: GitNexusImpact = {
      target,
      directCallers,
      affectedFiles,
      riskLevel: parsed.risk_level ?? parsed.riskLevel ?? "unknown",
      confidence: parseConfidence(parsed),
      raw,
    };
    impactCache.set(cacheKey, result);
    return result;
  } catch (err) {
    logger.debug({ err, target }, "getImpactDetailed failed");
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
    const args = ["context", fileName, "--repo", getRepoName(cwd)];
    if (fileOrSymbol.includes("/")) {
      args.push("--file", fileOrSymbol);
    }

    const raw = runGitNexus(args, cwd);

    const parsed = JSON.parse(raw);
    if (parsed.status === "not_found" || parsed.error) return null;

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
 * Run `gitnexus context <symbol> --content` to get full source code for a symbol.
 * Async — does not block the event loop.
 * Returns null if GitNexus is not available.
 */
export async function getContextWithSource(
  symbol: string,
  cwd: string
): Promise<(GitNexusContext & { source?: string }) | null> {
  if (!isIndexed(cwd)) return null;

  try {
    const fileName = basename(symbol);
    const args = ["context", fileName, "--repo", getRepoName(cwd), "--content"];
    if (symbol.includes("/")) args.push("--file", symbol);

    const raw = await runGitNexusAsync(args, cwd);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed.status === "not_found" || parsed.error) return null;

    return {
      symbol: parsed.symbol?.name ?? symbol,
      incoming: parsed.incoming ?? {},
      outgoing: parsed.outgoing ?? {},
      source: parsed.source ?? parsed.content ?? undefined,
      raw,
    };
  } catch (err) {
    logger.debug({ err, symbol }, "getContextWithSource failed");
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
    const raw = runGitNexus(["query", concept, "--repo", getRepoName(cwd)], cwd);

    const parsed = JSON.parse(raw);
    const processes = parsed.processes ?? parsed;
    if (!Array.isArray(processes)) return [];

    const result = processes
      .slice(0, limit)
      .map((p: { summary?: string; id?: string }) => p.summary ?? p.id ?? "")
      .filter(Boolean);
    flowsCache.set(cacheKey, result);
    return result;
  } catch {
    flowsCache.set(cacheKey, []);
    return [];
  }
}

/**
 * Run `gitnexus query <concept> --context --goal <goal>` for better-targeted flow discovery.
 * Async — does not block the event loop.
 */
export async function queryFlowsTargeted(
  concept: string,
  cwd: string,
  options: { context?: string; goal?: string; limit?: number } = {}
): Promise<string[]> {
  if (!isIndexed(cwd)) return [];

  try {
    const args = ["query", concept, "--repo", getRepoName(cwd)];
    if (options.context) args.push("--context", options.context);
    if (options.goal) args.push("--goal", options.goal);

    const raw = await runGitNexusAsync(args, cwd);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const processes = parsed.processes ?? parsed;
    if (!Array.isArray(processes)) return [];

    return processes
      .slice(0, options.limit ?? 5)
      .map((p: { summary?: string; id?: string }) => p.summary ?? p.id ?? "")
      .filter(Boolean);
  } catch (err) {
    logger.debug({ err, concept }, "queryFlowsTargeted failed");
    return [];
  }
}

/**
 * Run `gitnexus cypher <query>` — raw Cypher query against the knowledge graph.
 * Async — does not block the event loop.
 * Returns raw parsed JSON result or null on failure.
 */
export async function runCypher(query: string, cwd: string): Promise<unknown> {
  if (!isIndexed(cwd)) return null;

  const cacheKey = `${cwd}::cypher::${query}`;
  if (cypherCache.has(cacheKey)) return cypherCache.get(cacheKey);

  try {
    const args = ["cypher", query, "--repo", getRepoName(cwd)];
    const raw = await runGitNexusAsync(args, cwd, 20_000);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed.error) return null;

    cypherCache.set(cacheKey, parsed);
    return parsed;
  } catch (err) {
    logger.debug({ err, query }, "runCypher failed");
    return null;
  }
}

/**
 * Run `gitnexus augment <pattern>` — augment search patterns with graph context.
 * Async — does not block the event loop.
 */
export async function augmentPattern(pattern: string, cwd: string): Promise<string[]> {
  if (!isIndexed(cwd)) return [];

  try {
    const args = ["augment", pattern, "--repo", getRepoName(cwd)];
    const raw = await runGitNexusAsync(args, cwd);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const results = parsed.results ?? parsed.augmented ?? [];
    if (!Array.isArray(results)) return [];
    return results.map((r: { pattern?: string; query?: string }) => r.pattern ?? r.query ?? "").filter(Boolean);
  } catch (err) {
    logger.debug({ err, pattern }, "augmentPattern failed");
    return [];
  }
}

/**
 * Run `gitnexus analyze` to re-index the repo.
 * Async, non-blocking — fire and forget.
 * Returns a Promise that resolves when indexing completes (or fails silently).
 */
export async function reindex(cwd: string, force = false): Promise<boolean> {
  try {
    const args = ["analyze", "--repo", getRepoName(cwd)];
    if (force) args.push("--force");
    const raw = await runGitNexusAsync(args, cwd, 120_000);
    logger.debug({ cwd, force }, "gitnexus reindex complete");
    return raw.length > 0;
  } catch (err) {
    logger.debug({ err, cwd }, "gitnexus reindex failed (non-fatal)");
    return false;
  }
}

/**
 * Detect impact of git-changed files using `gitnexus impact`.
 * Returns all impacted symbols/files for the given scope (file paths).
 * Async — does not block the event loop.
 */
export async function detectChanges(scope: string[], cwd: string): Promise<GitNexusImpact[]> {
  if (!isIndexed(cwd) || scope.length === 0) return [];

  const results: GitNexusImpact[] = [];
  for (const file of scope) {
    const impact = await getImpactDetailed(file, cwd, { direction: "upstream" });
    if (impact) results.push(impact);
  }
  return results;
}

/**
 * Query Cypher-based dependency clusters for a set of files.
 * Groups files by architectural community using graph traversal.
 * Falls back to import-based union-find if Cypher fails.
 */
export async function getCypherClusters(
  files: string[],
  cwd: string,
  issueTypes: string[] = []
): Promise<GitNexusCluster[]> {
  if (!isIndexed(cwd) || files.length === 0) return [];

  try {
    // Query: find communities of files connected by calls/imports
    const fileList = files.map(f => `"${f}"`).join(", ");
    const cypher =
      `MATCH (f:File)-[:IMPORTS|CALLS*1..3]-(g:File) WHERE f.path IN [${fileList}] AND g.path IN [${fileList}] ` +
      `RETURN f.path as source, g.path as target, count(*) as strength ORDER BY strength DESC`;

    const result = await runCypher(cypher, cwd);
    if (!result || !Array.isArray((result as { rows?: unknown[] }).rows)) {
      return [];
    }

    const rows = (result as { rows: { source: string; target: string; strength: number }[] }).rows;

    // Build adjacency map
    const adjacency = new Map<string, Set<string>>();
    for (const file of files) {
      adjacency.set(file, new Set());
    }
    for (const row of rows) {
      adjacency.get(row.source)?.add(row.target);
      adjacency.get(row.target)?.add(row.source);
    }

    // BFS clustering
    const visited = new Set<string>();
    const clusters: GitNexusCluster[] = [];

    for (const file of files) {
      if (visited.has(file)) continue;
      const cluster: string[] = [];
      const queue = [file];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        cluster.push(current);
        for (const neighbor of adjacency.get(current) ?? []) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      clusters.push({
        files: cluster,
        issueTypes,
        reason: cluster.length > 1 ? "connected via calls/imports in graph" : "isolated file",
      });
    }

    return clusters;
  } catch (err) {
    logger.debug({ err }, "getCypherClusters failed — falling back to import clustering");
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
  const normalizedPath = targetPath.replace(/^\.\//, "");
  const ctx = getContext(normalizedPath, cwd);
  if (!ctx) return "";

  const lines: string[] = ["GITNEXUS INTELLIGENCE (knowledge graph):"];

  // Leiden community / cluster membership
  const community = getCommunityInfoSync(normalizedPath, cwd);
  if (community) {
    lines.push(
      `  Community: This file belongs to the [${community.label}] cluster ` +
        `(cohesion: ${community.cohesion.toFixed(2)})`
    );
  }

  // Dependencies this file imports
  const imports = ctx.outgoing["imports"] ?? [];
  if (imports.length > 0) {
    lines.push(`  Imports from: ${imports.map(i => i.filePath).join(", ")}`);
  }

  // What imports this file
  const importedBy = ctx.incoming["imports"] ?? [];
  if (importedBy.length > 0) {
    lines.push(`  Imported by: ${importedBy.map(i => i.filePath).join(", ")}`);
  }

  // Callers
  const callers = ctx.incoming["calls"] ?? [];
  if (callers.length > 0) {
    lines.push(`  Called by: ${callers.map(c => `${c.name} (${c.filePath})`).join(", ")}`);
  }

  // Callees
  const callees = ctx.outgoing["calls"] ?? [];
  if (callees.length > 0) {
    lines.push(`  Calls into: ${callees.map(c => `${c.name} (${c.filePath})`).join(", ")}`);
  }

  if (lines.length === 1) return ""; // no useful info found

  // Impact / risk level
  const impact = getImpact(normalizedPath, cwd);
  if (impact) {
    const dependentCount = impact.directCallers.length + impact.affectedFiles.length;
    lines.push(
      `  Risk level: ${impact.riskLevel} (${dependentCount} dependents, ` +
        `confidence: ${(impact.confidence * 100).toFixed(0)}%)`
    );
  }

  lines.push("");
  lines.push("  ⚠ Do NOT break any of the above relationships. If you change a function signature,");
  lines.push("    check that all callers still work. If you move/rename exports, update all importers.");

  return lines.join("\n");
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

export interface GitNexusCommunityInfo {
  /** Human-readable cluster label (e.g. "Auth", "API", "Database") */
  label: string;
  /** Cohesion score 0–1: how tightly connected the community members are */
  cohesion: number;
}

/**
 * Get Leiden community/cluster info for a file from the GitNexus knowledge graph.
 * Returns { label, cohesion } or null if GitNexus is unavailable or the file is unclustered.
 */
export async function getCommunityInfo(filePath: string, cwd: string): Promise<GitNexusCommunityInfo | null> {
  if (!isIndexed(cwd)) return null;

  try {
    const normalized = filePath.replace(/^\.\//, "");
    const args = ["community", basename(normalized), "--repo", getRepoName(cwd)];
    if (normalized.includes("/")) args.push("--file", normalized);

    const raw = await runGitNexusAsync(args, cwd);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed.error) return null;

    const label = parsed.label ?? parsed.community ?? parsed.cluster ?? parsed.community_label;
    if (!label) return null;

    const cohesion =
      typeof parsed.cohesion === "number"
        ? parsed.cohesion
        : typeof parsed.cohesion_score === "number"
          ? parsed.cohesion_score
          : 0.5;

    return { label: String(label), cohesion };
  } catch (err) {
    logger.debug({ err, filePath }, "getCommunityInfo failed");
    return null;
  }
}

/**
 * Synchronous community info lookup — used inside buildIntelligenceBriefing.
 * Falls back to null on any error.
 */
function getCommunityInfoSync(filePath: string, cwd: string): GitNexusCommunityInfo | null {
  if (!isIndexed(cwd)) return null;

  try {
    const normalized = filePath.replace(/^\.\//, "");
    const args = ["community", basename(normalized), "--repo", getRepoName(cwd)];
    if (normalized.includes("/")) args.push("--file", normalized);

    const raw = runGitNexus(args, cwd);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed.error) return null;

    const label = parsed.label ?? parsed.community ?? parsed.cluster ?? parsed.community_label;
    if (!label) return null;

    const cohesion =
      typeof parsed.cohesion === "number"
        ? parsed.cohesion
        : typeof parsed.cohesion_score === "number"
          ? parsed.cohesion_score
          : 0.5;

    return { label: String(label), cohesion };
  } catch {
    return null;
  }
}

/**
 * Compute an entry-point score for a file.
 * Entry points are user-facing files with few/no importers (CLI commands, main handlers).
 * Score = 1 / (1 + total_incoming_refs): 1.0 = pure entry point, approaches 0 for shared utilities.
 * Returns 0.5 (neutral) when GitNexus is unavailable.
 */
export function getEntryPointScore(filePath: string, cwd: string): number {
  if (!isIndexed(cwd)) return 0.5;

  const normalized = filePath.replace(/^\.\//, "");
  const ctx = getContext(normalized, cwd);
  if (!ctx) return 0.5;

  const importedBy = ctx.incoming["imports"] ?? [];
  const callers = ctx.incoming["calls"] ?? [];
  const totalIncoming = importedBy.length + callers.length;

  // Files with 0 importers are pure entry points (score=1.0)
  // Shared utilities with many importers score closer to 0
  return 1 / (1 + totalIncoming);
}

export interface GitNexusRenameResult {
  renamedFiles: string[];
  previewDiff: string;
}

/**
 * Run `gitnexus rename <oldName> <newName> --repo <repo>` for graph-aware symbol renaming.
 * Updates all callers, importers, and the knowledge graph in one operation.
 * Returns renamedFiles (paths touched) and previewDiff (unified diff preview).
 * Gracefully returns empty result if GitNexus is unavailable.
 */
export async function renameSymbol(oldName: string, newName: string, cwd: string): Promise<GitNexusRenameResult> {
  if (!isIndexed(cwd)) return { renamedFiles: [], previewDiff: "" };

  try {
    const args = ["rename", oldName, newName, "--repo", getRepoName(cwd)];
    const raw = await runGitNexusAsync(args, cwd, 20_000);
    if (!raw) return { renamedFiles: [], previewDiff: "" };

    const parsed = JSON.parse(raw);
    if (parsed.error) return { renamedFiles: [], previewDiff: "" };

    return {
      renamedFiles: parsed.renamed_files ?? parsed.renamedFiles ?? [],
      previewDiff: parsed.preview_diff ?? parsed.previewDiff ?? parsed.diff ?? "",
    };
  } catch (err) {
    logger.debug({ err, oldName, newName }, "renameSymbol failed");
    return { renamedFiles: [], previewDiff: "" };
  }
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
    const normalized = file.replace(/^\.\//, "");
    const ctx = getContext(normalized, cwd);
    if (!ctx) continue;
    const deps = new Set<string>();
    for (const imp of ctx.outgoing["imports"] ?? []) deps.add(imp.filePath);
    for (const imp of ctx.incoming["imports"] ?? []) deps.add(imp.filePath);
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

export interface GitNexusApiImpact {
  routes: Array<{ path: string; handler: string; methods: string[] }>;
  shapeIssues: Array<{ route: string; expected: string; actual: string }>;
  risk: string;
}

/**
 * Run `gitnexus api_impact <routeOrEndpoint>` — API route impact analysis.
 * Returns affected routes, handler info, shape issues, and risk level.
 * Graceful no-op if GitNexus is not indexed or api_impact is unavailable.
 */
export async function getApiImpact(routeOrEndpoint: string, cwd: string): Promise<GitNexusApiImpact | null> {
  if (!isIndexed(cwd)) return null;

  try {
    const args = ["api_impact", routeOrEndpoint, "--repo", getRepoName(cwd)];
    const raw = await runGitNexusAsync(args, cwd);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.error) return null;

    const routes = Array.isArray(parsed.routes) ? (parsed.routes as GitNexusApiImpact["routes"]) : [];
    const shapeIssues = Array.isArray(parsed.shape_issues ?? parsed.shapeIssues)
      ? ((parsed.shape_issues ?? parsed.shapeIssues) as GitNexusApiImpact["shapeIssues"])
      : [];
    const risk = typeof parsed.risk === "string" ? parsed.risk : "unknown";

    return { routes, shapeIssues, risk };
  } catch (err) {
    logger.debug({ err, routeOrEndpoint }, "getApiImpact failed (non-fatal)");
    return null;
  }
}
