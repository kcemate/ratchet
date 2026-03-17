/**
 * Core logic for `ratchet vision` — builds a Cytoscape.js-compatible graph
 * by combining ratchet scan results with file-level import analysis.
 */
import { readFileSync } from 'fs';
import { join, relative, basename, dirname } from 'path';
import { runScan } from '../commands/scan.js';
import { findSourceFiles } from './scan-constants.js';
import type { ScanResult } from '../commands/scan.js';

// ── Types ────────────────────────────────────────────────────────────────────

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
  type: 'import' | 'call';
}

export interface VisionGraph {
  nodes: VisionNode[];
  edges: VisionEdge[];
  projectName: string;
  totalScore: number;
  totalNodes: number;   // total before any truncation/filter
  truncated: boolean;
}

export interface VisionOptions {
  cwd: string;
  focus?: string;          // file path — show only N-hop neighborhood
  filter?: string;         // issue category to filter by
  maxNodes?: number;       // cap node count (default 500)
  focusHops?: number;      // neighbourhood depth for focus mode (default 2)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_NODES_DEFAULT = 500;
const FOCUS_HOPS_DEFAULT = 2;

/** Penalty weights per severity level, subtracted from base score of 100. */
const SEVERITY_WEIGHT: Record<string, number> = {
  high: 15,
  medium: 8,
  low: 3,
};

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Map a 0–100 score to a hex colour.
 * < 50  → red   #ef4444
 * 50–80 → yellow #f59e0b
 * > 80  → green  #22c55e
 */
export function nodeColor(score: number): string {
  if (score < 50) return '#ef4444';
  if (score <= 80) return '#f59e0b';
  return '#22c55e';
}

/**
 * Estimate a per-file quality score (0–100) from accumulated severity penalties.
 * @param severityScore  — sum of SEVERITY_WEIGHT values for all issues touching this file
 */
export function computeFileScore(severityScore: number): number {
  return Math.max(0, Math.min(100, 100 - severityScore));
}

// ── Import parsing ────────────────────────────────────────────────────────────

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

// ── Focus mode ────────────────────────────────────────────────────────────────

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

// ── Main ──────────────────────────────────────────────────────────────────────

export async function buildVisionGraph(options: VisionOptions): Promise<VisionGraph> {
  const {
    cwd,
    focus,
    filter,
    maxNodes = MAX_NODES_DEFAULT,
    focusHops = FOCUS_HOPS_DEFAULT,
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

  return {
    nodes,
    edges: filteredEdges,
    projectName: scanResult.projectName,
    totalScore: scanResult.total,
    totalNodes,
    truncated,
  };
}
