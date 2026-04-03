/**
 * Core logic for `ratchet vision` — builds a Cytoscape.js-compatible graph
 * by combining ratchet scan results with file-level import analysis.
 */
import { readFileSync } from 'fs';
import { join, relative, basename, dirname } from 'path';
import { runScan } from '../core/scanner';
import { findSourceFiles } from './scan-constants.js';
import type { ScanResult } from '../core/scanner';
import type { Provider } from './providers/base.js';

// ── Types
export interface VisionNode {
  id: string;
  label: string;
  score: number;             // 0–100 estimated per-file quality score
  issueCount: number;        // total issues touching this file
  issuesByCategory: Record<string, number>;
  blastRadius: number;       // number of files that import this file
  directory: string;         // relative directory path (for clustering)
}

export interface VisionEdge {
  source: string;
  target: string;
  type: 'import' | 'call' | 'semantic';
  semanticReason?: string;  // LLM's reasoning for the semantic connection
}

export interface RiskCluster {
  id: string;
  label: string;
  files: string[];
  reason: string;
}

export interface VisionGraph {
  nodes: VisionNode[];
  edges: VisionEdge[];
  projectName: string;
  totalScore: number;
  totalNodes: number;   // total before any truncation/filter
  truncated: boolean;
  riskClusters?: RiskCluster[];
  deepMode?: boolean;
}

export interface VisionOptions {
  cwd: string;
  focus?: string;          // file path — show only N-hop neighborhood
  filter?: string;         // issue category to filter by
  maxNodes?: number;       // cap node count (default 500)
  focusHops?: number;      // neighbourhood depth for focus mode (default 2)
  deep?: boolean;          // enable LLM-powered semantic dependency analysis
  provider?: Provider;     // provider for deep mode LLM calls
}

// ── Constants
const MAX_NODES_DEFAULT = 500;
const FOCUS_HOPS_DEFAULT = 2;

/** Penalty weights per severity level, subtracted from base score of 100. */
const SEVERITY_WEIGHT: Record<string, number> = {
  high: 15,
  medium: 8,
  low: 3,
};

// ── Pure helpers (exported for tests)
/**
 * Map a 0–100 score to a hex colour (6-tier cyberpunk scale).
 */
export function nodeColor(score: number): string {
  if (score >= 90) return '#00ff88';
  if (score >= 80) return '#22d3ee';
  if (score >= 60) return '#fbbf24';
  if (score >= 40) return '#f97316';
  if (score >= 20) return '#ef4444';
  return '#ff2d55';
}

/**
 * Map a 0–100 score to a glow rgba colour for cyberpunk node halos.
 */
export function glowColor(score: number): string {
  if (score >= 90) return 'rgba(0,255,136,0.5)';
  if (score >= 80) return 'rgba(34,211,238,0.4)';
  if (score >= 60) return 'rgba(251,191,36,0.35)';
  if (score >= 40) return 'rgba(249,115,22,0.4)';
  if (score >= 20) return 'rgba(239,68,68,0.45)';
  return 'rgba(255,45,85,0.6)';
}

/**
 * Estimate a per-file quality score (0–100) from accumulated severity penalties.
 * @param severityScore  — sum of SEVERITY_WEIGHT values for all issues touching this file
 */
export function computeFileScore(severityScore: number): number {
  return Math.max(0, Math.min(100, 100 - severityScore));
}

// ── Import parsing
/**
 * Extract relative-import target paths from a file's content.
 * Only considers local imports (starts with '.'), skipping node_modules.
 * Tries several extensions to resolve to an actual file in `allFiles`.
 */
export function parseLocalImports(
  content: string,
  filePath: string,
  allFiles: Set<string>,
): string[] {
  const dir = dirname(filePath);
  const seen = new Set<string>();
  const results: string[] = [];

  const patterns = [
    /(?:^|\s)import\s[^'"]*from\s['"]([^'"]+)['"]/gm,
    /(?:^|\s)export\s[^'"]*from\s['"]([^'"]+)['"]/gm,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[1]!;
      if (!specifier.startsWith('.')) continue;

      // Strip .js extension TypeScript emits for resolution
      const base = specifier.replace(/\.js$/, '');

      const candidates = [
        join(dir, base),
        join(dir, base + '.ts'),
        join(dir, base + '.tsx'),
        join(dir, base + '.js'),
        join(dir, base + '/index.ts'),
        join(dir, base + '/index.js'),
      ];

      for (const candidate of candidates) {
        if (allFiles.has(candidate) && !seen.has(candidate)) {
          seen.add(candidate);
          results.push(candidate);
          break;
        }
      }
    }
  }

  return results;
}

// ── Focus mode
/**
 * Given a focus file and a set of edges, return the set of file IDs that are
 * within `hops` steps of the focus file (bidirectional BFS).
 */
export function getNeighborhood(
  focusFile: string,
  edges: VisionEdge[],
  hops: number,
): Set<string> {
  const visited = new Set<string>();
  let frontier = new Set<string>([focusFile]);

  for (let hop = 0; hop <= hops; hop++) {
    for (const id of frontier) visited.add(id);
    if (hop === hops) break;

    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.source) && !visited.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !visited.has(edge.source)) next.add(edge.source);
    }
    frontier = next;
  }

  return visited;
}

// ── Semantic dependency analysis

interface SemanticDepRaw {
  source: string;
  target: string;
  reason: string;
}

interface RiskClusterRaw {
  id: string;
  label: string;
  files: string[];
  reason: string;
}

interface SemanticAnalysisResult {
  semanticDependencies: SemanticDepRaw[];
  riskClusters: RiskClusterRaw[];
}

const MAX_CONTENT_CHARS_PER_FILE = 800;
const MAX_FILES_FOR_SEMANTIC = 40;

/**
 * Send a representative file sample to the LLM and ask it to identify
 * semantic dependencies (data flow, shared state, event coupling) and
 * risk clusters (tightly-coupled file groups).
 */
export async function buildSemanticDependencies(
  files: string[],
  contents: Map<string, string>,
  cwd: string,
  provider: Provider,
): Promise<{ semanticEdges: VisionEdge[]; riskClusters: RiskCluster[] }> {
  // Select a representative sample — prefer smaller files to fit more context
  const sample = [...files]
    .sort((a, b) => (contents.get(a)?.length ?? 0) - (contents.get(b)?.length ?? 0))
    .slice(0, MAX_FILES_FOR_SEMANTIC);

  const fileSnippets = sample
    .map(f => {
      const rel = relative(cwd, f);
      const content = (contents.get(f) ?? '').slice(0, MAX_CONTENT_CHARS_PER_FILE);
      return `=== ${rel} ===\n${content}`;
    })
    .join('\n\n');

  const prompt = `You are a software architect analyzing a codebase for hidden runtime dependencies.

Given these source files (truncated), identify:
1. Semantic dependencies NOT visible as static imports: data flow paths, shared state, event/queue coupling, env-var coupling, dynamic requires.
2. Risk clusters: groups of 2-5 files that are tightly coupled and must be changed together.

Only report dependencies between files that are in the provided list.

FILES:
${fileSnippets}

Respond with ONLY a JSON object matching this exact schema (no prose, no markdown fences):
{
  "semanticDependencies": [
    { "source": "relative/path/a.ts", "target": "relative/path/b.ts", "reason": "brief explanation" }
  ],
  "riskClusters": [
    { "id": "cluster-1", "label": "Short Name", "files": ["rel/path/a.ts", "rel/path/b.ts"], "reason": "why tightly coupled" }
  ]
}

Keep it concise — max 20 semantic dependencies and 5 risk clusters. If none found, return empty arrays.`;

  let raw: string;
  try {
    raw = await provider.sendMessage(prompt, { maxTokens: 1500 });
  } catch {
    return { semanticEdges: [], riskClusters: [] };
  }

  // Parse JSON — strip optional markdown fences
  let parsed: SemanticAnalysisResult;
  try {
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    parsed = JSON.parse(json) as SemanticAnalysisResult;
  } catch {
    return { semanticEdges: [], riskClusters: [] };
  }

  // Build a set of relative-to-absolute file path lookups
  const relToAbs = new Map<string, string>();
  for (const f of files) {
    relToAbs.set(relative(cwd, f), f);
  }

  const semanticEdges: VisionEdge[] = [];
  const edgeSet = new Set<string>();
  for (const dep of parsed.semanticDependencies ?? []) {
    const src = relToAbs.get(dep.source);
    const tgt = relToAbs.get(dep.target);
    if (!src || !tgt || src === tgt) continue;
    const key = `${src}|${tgt}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    semanticEdges.push({ source: src, target: tgt, type: 'semantic', semanticReason: dep.reason });
  }

  const riskClusters: RiskCluster[] = (parsed.riskClusters ?? []).map(c => ({
    id: c.id,
    label: c.label,
    files: c.files.map(f => relToAbs.get(f) ?? f),
    reason: c.reason,
  }));

  return { semanticEdges, riskClusters };
}

// ── Main
export async function buildVisionGraph(options: VisionOptions): Promise<VisionGraph> {
  const {
    cwd,
    focus,
    filter,
    maxNodes = MAX_NODES_DEFAULT,
    focusHops = FOCUS_HOPS_DEFAULT,
    deep = false,
    provider,
  } = options;

  // 1. Scan for per-project scores + issue locations
  const scanResult: ScanResult = await runScan(cwd);

  // 2. Enumerate all source files
  const allSourceFiles = findSourceFiles(cwd);
  const allFileSet = new Set(allSourceFiles);

  // 3. Accumulate per-file issue data from scan locations
  const fileIssues = new Map<
    string,
    { count: number; byCategory: Record<string, number>; severityScore: number }
  >();

  for (const issue of scanResult.issuesByType) {
    const weight = SEVERITY_WEIGHT[issue.severity] ?? 3;
    for (const loc of issue.locations ?? []) {
      if (!fileIssues.has(loc)) {
        fileIssues.set(loc, { count: 0, byCategory: {}, severityScore: 0 });
      }
      const entry = fileIssues.get(loc)!;
      entry.count += 1;
      entry.severityScore += weight;
      entry.byCategory[issue.category] = (entry.byCategory[issue.category] ?? 0) + 1;
    }
  }

  // 4. Parse import edges from file contents
  const fileContents = new Map<string, string>();
  for (const file of allSourceFiles) {
    try {
      fileContents.set(file, readFileSync(file, 'utf-8'));
    } catch {
      // skip unreadable files
    }
  }

  const edgeSet = new Set<string>();
  const edges: VisionEdge[] = [];
  const incomingCount = new Map<string, number>();

  for (const file of allSourceFiles) {
    const content = fileContents.get(file);
    if (!content) continue;
    const imports = parseLocalImports(content, file, allFileSet);
    for (const target of imports) {
      const key = `${file}|${target}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: file, target, type: 'import' });
        incomingCount.set(target, (incomingCount.get(target) ?? 0) + 1);
      }
    }
  }

  // 5. Build nodes
  let nodes: VisionNode[] = allSourceFiles.map(file => {
    const issues = fileIssues.get(file);
    return {
      id: file,
      label: basename(file),
      score: computeFileScore(issues?.severityScore ?? 0),
      issueCount: issues?.count ?? 0,
      issuesByCategory: issues?.byCategory ?? {},
      blastRadius: incomingCount.get(file) ?? 0,
      directory: relative(cwd, dirname(file)),
    };
  });

  const totalNodes = nodes.length;

  // 6. Apply focus mode — keep only N-hop neighborhood
  if (focus) {
    const focusResolved = focus.startsWith('/') ? focus : join(cwd, focus);
    const neighborhood = getNeighborhood(focusResolved, edges, focusHops);
    nodes = nodes.filter(n => neighborhood.has(n.id));
  }

  // 7. Apply category filter — keep nodes with matching issues + direct neighbors
  if (filter) {
    const filterLower = filter.toLowerCase();
    const matchingFiles = new Set<string>();

    for (const issue of scanResult.issuesByType) {
      const matches =
        issue.category.toLowerCase().includes(filterLower) ||
        issue.subcategory.toLowerCase().includes(filterLower);
      if (matches) {
        for (const loc of issue.locations ?? []) matchingFiles.add(loc);
      }
    }

    // Include direct neighbors for context
    const keepSet = new Set(matchingFiles);
    for (const edge of edges) {
      if (matchingFiles.has(edge.source)) keepSet.add(edge.target);
      if (matchingFiles.has(edge.target)) keepSet.add(edge.source);
    }

    nodes = nodes.filter(n => keepSet.has(n.id));
  }

  // 8. Cap at maxNodes — prioritise high blast-radius + high issue-count nodes
  const truncated = nodes.length > maxNodes;
  if (truncated) {
    nodes = nodes
      .sort((a, b) => b.blastRadius + b.issueCount * 2 - (a.blastRadius + a.issueCount * 2))
      .slice(0, maxNodes);
  }

  // 9. Drop edges that reference nodes outside the final set
  const nodeIds = new Set(nodes.map(n => n.id));
  const filteredEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  // 10. Deep mode — overlay semantic edges from LLM analysis
  let riskClusters: RiskCluster[] | undefined;
  if (deep && provider) {
    const { semanticEdges, riskClusters: clusters } = await buildSemanticDependencies(
      [...nodeIds],
      fileContents,
      cwd,
      provider,
    );
    // Dedup semantic edges against import edges
    const importEdgeKeys = new Set(filteredEdges.map(e => `${e.source}|${e.target}`));
    for (const se of semanticEdges) {
      if (!importEdgeKeys.has(`${se.source}|${se.target}`) && nodeIds.has(se.source) && nodeIds.has(se.target)) {
        filteredEdges.push(se);
      }
    }
    riskClusters = clusters.map(c => ({
      ...c,
      files: c.files.filter(f => nodeIds.has(f)),
    })).filter(c => c.files.length >= 2);
  }

  return {
    nodes,
    edges: filteredEdges,
    projectName: scanResult.projectName,
    totalScore: scanResult.total,
    totalNodes,
    truncated,
    ...(riskClusters !== undefined ? { riskClusters, deepMode: true } : {}),
  };
}
