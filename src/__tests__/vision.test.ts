import { describe, it, expect } from 'vitest';
import {
  nodeColor,
  computeFileScore,
  parseLocalImports,
  getNeighborhood,
} from '../../src/core/vision.js';
import type { VisionEdge, VisionGraph, VisionNode } from '../../src/core/vision.js';
import { generateVisionHTML } from '../../src/commands/vision.js';

// ── nodeColor ─────────────────────────────────────────────────────────────────

describe('nodeColor', () => {
  it('returns red for score < 50', () => {
    expect(nodeColor(0)).toBe('#ef4444');
    expect(nodeColor(49)).toBe('#ef4444');
  });

  it('returns yellow for score 50–80', () => {
    expect(nodeColor(50)).toBe('#f59e0b');
    expect(nodeColor(65)).toBe('#f59e0b');
    expect(nodeColor(80)).toBe('#f59e0b');
  });

  it('returns green for score > 80', () => {
    expect(nodeColor(81)).toBe('#22c55e');
    expect(nodeColor(100)).toBe('#22c55e');
  });
});

// ── computeFileScore ──────────────────────────────────────────────────────────

describe('computeFileScore', () => {
  it('returns 100 for no penalties', () => {
    expect(computeFileScore(0)).toBe(100);
  });

  it('subtracts penalty from 100', () => {
    expect(computeFileScore(15)).toBe(85);
    expect(computeFileScore(50)).toBe(50);
  });

  it('clamps at 0 for large penalties', () => {
    expect(computeFileScore(200)).toBe(0);
  });

  it('never exceeds 100', () => {
    expect(computeFileScore(-10)).toBe(100);
  });
});

// ── parseLocalImports ─────────────────────────────────────────────────────────

describe('parseLocalImports', () => {
  const allFiles = new Set([
    '/project/src/core/utils.ts',
    '/project/src/core/engine.ts',
    '/project/src/lib/cli.ts',
  ]);

  it('resolves a relative .ts import', () => {
    const content = `import { foo } from './utils.js';`;
    const result = parseLocalImports(content, '/project/src/core/main.ts', allFiles);
    expect(result).toContain('/project/src/core/utils.ts');
  });

  it('resolves an import without extension', () => {
    const content = `import bar from './engine';`;
    const result = parseLocalImports(content, '/project/src/core/main.ts', allFiles);
    expect(result).toContain('/project/src/core/engine.ts');
  });

  it('resolves a parent-directory import', () => {
    const content = `import { x } from '../lib/cli.js';`;
    const result = parseLocalImports(content, '/project/src/core/main.ts', allFiles);
    expect(result).toContain('/project/src/lib/cli.ts');
  });

  it('ignores node_modules imports (non-relative)', () => {
    const content = `import chalk from 'chalk'; import path from 'path';`;
    const result = parseLocalImports(content, '/project/src/core/main.ts', allFiles);
    expect(result).toHaveLength(0);
  });

  it('deduplicates repeated imports of the same file', () => {
    const content = [
      `import { a } from './utils.js';`,
      `import { b } from './utils.js';`,
    ].join('\n');
    const result = parseLocalImports(content, '/project/src/core/main.ts', allFiles);
    expect(result.filter(r => r === '/project/src/core/utils.ts')).toHaveLength(1);
  });

  it('handles require() syntax', () => {
    const content = `const x = require('./utils.js');`;
    const result = parseLocalImports(content, '/project/src/core/main.ts', allFiles);
    expect(result).toContain('/project/src/core/utils.ts');
  });

  it('returns empty array when no local imports', () => {
    const content = `export const x = 1;`;
    const result = parseLocalImports(content, '/project/src/core/main.ts', allFiles);
    expect(result).toHaveLength(0);
  });

  it('ignores imports that do not resolve to known files', () => {
    const content = `import something from './unknown-module.js';`;
    const result = parseLocalImports(content, '/project/src/core/main.ts', allFiles);
    expect(result).toHaveLength(0);
  });
});

// ── getNeighborhood ───────────────────────────────────────────────────────────

describe('getNeighborhood', () => {
  const edges: VisionEdge[] = [
    { source: 'a', target: 'b', type: 'import' },
    { source: 'b', target: 'c', type: 'import' },
    { source: 'c', target: 'd', type: 'import' },
    { source: 'x', target: 'y', type: 'import' },
  ];

  it('returns just the focus node at 0 hops', () => {
    const result = getNeighborhood('a', edges, 0);
    expect([...result]).toEqual(['a']);
  });

  it('returns focus + direct neighbours at 1 hop', () => {
    const result = getNeighborhood('b', edges, 1);
    expect(result.has('a')).toBe(true);  // incoming
    expect(result.has('b')).toBe(true);  // self
    expect(result.has('c')).toBe(true);  // outgoing
    expect(result.has('d')).toBe(false); // 2 hops away
  });

  it('expands correctly at 2 hops', () => {
    const result = getNeighborhood('b', edges, 2);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
    expect(result.has('d')).toBe(true);
  });

  it('excludes disconnected subgraph', () => {
    const result = getNeighborhood('a', edges, 3);
    expect(result.has('x')).toBe(false);
    expect(result.has('y')).toBe(false);
  });

  it('handles focus node with no edges gracefully', () => {
    const result = getNeighborhood('solo', edges, 2);
    expect([...result]).toEqual(['solo']);
  });
});

// ── generateVisionHTML ────────────────────────────────────────────────────────

function makeGraph(overrides: Partial<VisionGraph> = {}): VisionGraph {
  const node: VisionNode = {
    id: '/project/src/core/engine.ts',
    label: 'engine.ts',
    score: 72,
    issueCount: 3,
    issuesByCategory: { 'Error Handling': 2, 'Performance': 1 },
    blastRadius: 5,
    directory: 'src/core',
  };
  return {
    nodes: [node],
    edges: [],
    projectName: 'my-project',
    totalScore: 72,
    totalNodes: 1,
    truncated: false,
    ...overrides,
  };
}

describe('generateVisionHTML', () => {
  it('returns a string containing doctype', () => {
    const html = generateVisionHTML(makeGraph());
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('includes Cytoscape.js CDN script tag', () => {
    const html = generateVisionHTML(makeGraph());
    expect(html).toContain('cytoscape');
    expect(html).toContain('unpkg.com/cytoscape');
  });

  it('embeds the project name in the title', () => {
    const html = generateVisionHTML(makeGraph());
    expect(html).toContain('my-project');
  });

  it('embeds total score', () => {
    const html = generateVisionHTML(makeGraph({ totalScore: 88 }));
    expect(html).toContain('88');
  });

  it('embeds node data with correct count', () => {
    const graph = makeGraph({
      nodes: [
        { id: '/a.ts', label: 'a.ts', score: 90, issueCount: 0, issuesByCategory: {}, blastRadius: 0, directory: '.' },
        { id: '/b.ts', label: 'b.ts', score: 45, issueCount: 2, issuesByCategory: { 'Security': 2 }, blastRadius: 1, directory: '.' },
      ],
      totalNodes: 2,
    });
    const html = generateVisionHTML(graph);
    expect(html).toContain('a.ts');
    expect(html).toContain('b.ts');
  });

  it('shows truncation warning when graph is truncated', () => {
    const html = generateVisionHTML(makeGraph({ truncated: true, totalNodes: 600, nodes: [
      { id: '/a.ts', label: 'a.ts', score: 90, issueCount: 0, issuesByCategory: {}, blastRadius: 0, directory: '.' },
    ]}));
    expect(html).toContain('truncated');
  });

  it('includes sidebar with search, filter, and legend sections', () => {
    const html = generateVisionHTML(makeGraph());
    expect(html).toContain('id="search"');
    expect(html).toContain('id="cat-filter"');
    expect(html).toContain('Legend');
  });

  it('includes ARIA labels for accessibility', () => {
    const html = generateVisionHTML(makeGraph());
    expect(html).toContain('aria-label');
    expect(html).toContain('role=');
  });

  it('applies correct color for red score node', () => {
    const graph = makeGraph({
      nodes: [{
        id: '/bad.ts', label: 'bad.ts', score: 30,
        issueCount: 5, issuesByCategory: {}, blastRadius: 0, directory: '.',
      }],
    });
    const html = generateVisionHTML(graph);
    expect(html).toContain('#ef4444');
  });

  it('applies correct color for green score node', () => {
    const graph = makeGraph({
      nodes: [{
        id: '/good.ts', label: 'good.ts', score: 95,
        issueCount: 0, issuesByCategory: {}, blastRadius: 3, directory: '.',
      }],
    });
    const html = generateVisionHTML(graph);
    expect(html).toContain('#22c55e');
  });

  it('embeds edges in element data', () => {
    const graph = makeGraph({
      nodes: [
        { id: '/a.ts', label: 'a.ts', score: 80, issueCount: 0, issuesByCategory: {}, blastRadius: 0, directory: '.' },
        { id: '/b.ts', label: 'b.ts', score: 80, issueCount: 0, issuesByCategory: {}, blastRadius: 1, directory: '.' },
      ],
      edges: [{ source: '/a.ts', target: '/b.ts', type: 'import' }],
    });
    const html = generateVisionHTML(graph);
    // edges array should appear in embedded JSON
    expect(html).toContain('"edges"');
  });
});
