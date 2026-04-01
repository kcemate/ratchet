/**
 * Tests for map --deep integration — semantic dependencies + risk clusters.
 *
 * buildVisionGraph and buildSemanticDependencies are tested with a mock
 * provider so no real API calls are made.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Provider } from '../core/providers/base.js';
import {
  buildSemanticDependencies,
  parseLocalImports,
  type VisionEdge,
  type RiskCluster,
} from '../core/vision.js';
import { generateVisionHTML } from '../commands/vision.js';
import type { VisionGraph } from '../core/vision.js';

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function makeMockProvider(response: string): Provider & { sendMessage: ReturnType<typeof vi.fn> } {
  return {
    name: 'MockProvider',
    tier: 'pro' as const,
    sendMessage: vi.fn().mockResolvedValue(response),
    estimateCost: () => 0,
    supportsStructuredOutput: () => false,
  };
}

const VALID_SEMANTIC_RESPONSE = JSON.stringify({
  semanticDependencies: [
    { source: 'src/a.ts', target: 'src/b.ts', reason: 'A writes to shared DB table that B reads' },
    { source: 'src/b.ts', target: 'src/c.ts', reason: 'B emits events consumed by C' },
  ],
  riskClusters: [
    { id: 'cluster-1', label: 'Auth Core', files: ['src/a.ts', 'src/b.ts'], reason: 'Share JWT state' },
  ],
});

// ---------------------------------------------------------------------------
// buildSemanticDependencies — LLM call and parsing
// ---------------------------------------------------------------------------

describe('buildSemanticDependencies — triggers DeepEngine LLM call', () => {
  it('calls provider.sendMessage with a prompt containing file paths', async () => {
    const provider = makeMockProvider(VALID_SEMANTIC_RESPONSE);
    const files = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'];
    const contents = new Map([
      ['/project/src/a.ts', 'export const a = 1;'],
      ['/project/src/b.ts', 'export const b = 2;'],
      ['/project/src/c.ts', 'export const c = 3;'],
    ]);

    await buildSemanticDependencies(files, contents, '/project', provider);

    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const [prompt] = provider.sendMessage.mock.calls[0] as [string];
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('semantic');
  });
});

// ---------------------------------------------------------------------------
// buildSemanticDependencies — semantic edges added to graph
// ---------------------------------------------------------------------------

describe('buildSemanticDependencies — semantic edges added to graph', () => {
  it('returns edges with type = semantic', async () => {
    const provider = makeMockProvider(VALID_SEMANTIC_RESPONSE);
    const files = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'];
    const contents = new Map(files.map(f => [f, '']));

    const { semanticEdges } = await buildSemanticDependencies(files, contents, '/project', provider);

    expect(semanticEdges.length).toBeGreaterThan(0);
    for (const edge of semanticEdges) {
      expect(edge.type).toBe('semantic');
    }
  });

  it('attaches semanticReason to each edge', async () => {
    const provider = makeMockProvider(VALID_SEMANTIC_RESPONSE);
    const files = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'];
    const contents = new Map(files.map(f => [f, '']));

    const { semanticEdges } = await buildSemanticDependencies(files, contents, '/project', provider);

    for (const edge of semanticEdges) {
      expect(typeof edge.semanticReason).toBe('string');
      expect(edge.semanticReason!.length).toBeGreaterThan(0);
    }
  });

  it('resolves relative paths to absolute paths', async () => {
    const provider = makeMockProvider(VALID_SEMANTIC_RESPONSE);
    const files = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'];
    const contents = new Map(files.map(f => [f, '']));

    const { semanticEdges } = await buildSemanticDependencies(files, contents, '/project', provider);

    for (const edge of semanticEdges) {
      expect(edge.source.startsWith('/')).toBe(true);
      expect(edge.target.startsWith('/')).toBe(true);
    }
  });

  it('does not create self-loops', async () => {
    const selfLoopResponse = JSON.stringify({
      semanticDependencies: [{ source: 'src/a.ts', target: 'src/a.ts', reason: 'self' }],
      riskClusters: [],
    });
    const provider = makeMockProvider(selfLoopResponse);
    const files = ['/project/src/a.ts'];
    const contents = new Map([['/project/src/a.ts', '']]);

    const { semanticEdges } = await buildSemanticDependencies(files, contents, '/project', provider);
    expect(semanticEdges).toHaveLength(0);
  });

  it('ignores edges referencing files not in the input list', async () => {
    const unknownFileResponse = JSON.stringify({
      semanticDependencies: [
        { source: 'src/unknown.ts', target: 'src/a.ts', reason: 'ghost file' },
      ],
      riskClusters: [],
    });
    const provider = makeMockProvider(unknownFileResponse);
    const files = ['/project/src/a.ts'];
    const contents = new Map([['/project/src/a.ts', '']]);

    const { semanticEdges } = await buildSemanticDependencies(files, contents, '/project', provider);
    expect(semanticEdges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildSemanticDependencies — risk cluster detection
// ---------------------------------------------------------------------------

describe('buildSemanticDependencies — risk cluster detection', () => {
  it('returns risk clusters from LLM response', async () => {
    const provider = makeMockProvider(VALID_SEMANTIC_RESPONSE);
    const files = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'];
    const contents = new Map(files.map(f => [f, '']));

    const { riskClusters } = await buildSemanticDependencies(files, contents, '/project', provider);

    expect(riskClusters.length).toBeGreaterThan(0);
    const cluster = riskClusters[0]!;
    expect(cluster.id).toBe('cluster-1');
    expect(cluster.label).toBe('Auth Core');
    expect(cluster.reason).toBe('Share JWT state');
    expect(cluster.files.length).toBeGreaterThan(0);
  });

  it('risk cluster files are resolved to absolute paths', async () => {
    const provider = makeMockProvider(VALID_SEMANTIC_RESPONSE);
    const files = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'];
    const contents = new Map(files.map(f => [f, '']));

    const { riskClusters } = await buildSemanticDependencies(files, contents, '/project', provider);

    for (const cluster of riskClusters) {
      for (const f of cluster.files) {
        expect(f.startsWith('/')).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// buildSemanticDependencies — error handling
// ---------------------------------------------------------------------------

describe('buildSemanticDependencies — error handling', () => {
  it('returns empty result when provider throws', async () => {
    const provider = makeMockProvider('');
    provider.sendMessage = vi.fn().mockRejectedValue(new Error('API error'));
    const files = ['/project/src/a.ts'];
    const contents = new Map([['/project/src/a.ts', '']]);

    const result = await buildSemanticDependencies(files, contents, '/project', provider);
    expect(result.semanticEdges).toHaveLength(0);
    expect(result.riskClusters).toHaveLength(0);
  });

  it('returns empty result when LLM returns malformed JSON', async () => {
    const provider = makeMockProvider('not json at all {{ broken');
    const files = ['/project/src/a.ts'];
    const contents = new Map([['/project/src/a.ts', '']]);

    const result = await buildSemanticDependencies(files, contents, '/project', provider);
    expect(result.semanticEdges).toHaveLength(0);
    expect(result.riskClusters).toHaveLength(0);
  });

  it('handles JSON wrapped in markdown fences', async () => {
    const fencedResponse = '```json\n' + VALID_SEMANTIC_RESPONSE + '\n```';
    const provider = makeMockProvider(fencedResponse);
    const files = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'];
    const contents = new Map(files.map(f => [f, '']));

    const { semanticEdges } = await buildSemanticDependencies(files, contents, '/project', provider);
    expect(semanticEdges.length).toBeGreaterThan(0);
  });

  it('returns empty result when LLM returns empty arrays', async () => {
    const provider = makeMockProvider('{"semanticDependencies":[],"riskClusters":[]}');
    const files = ['/project/src/a.ts'];
    const contents = new Map([['/project/src/a.ts', '']]);

    const result = await buildSemanticDependencies(files, contents, '/project', provider);
    expect(result.semanticEdges).toHaveLength(0);
    expect(result.riskClusters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateVisionHTML — without --deep: unchanged behavior
// ---------------------------------------------------------------------------

describe('generateVisionHTML — without --deep: unchanged behavior', () => {
  const baseGraph: VisionGraph = {
    nodes: [
      { id: '/p/a.ts', label: 'a.ts', score: 80, issueCount: 1, issuesByCategory: {}, blastRadius: 2, directory: '' },
      { id: '/p/b.ts', label: 'b.ts', score: 60, issueCount: 0, issuesByCategory: {}, blastRadius: 0, directory: '' },
    ],
    edges: [
      { source: '/p/a.ts', target: '/p/b.ts', type: 'import' },
    ],
    projectName: 'test-project',
    totalScore: 70,
    totalNodes: 2,
    truncated: false,
  };

  it('generates valid HTML', () => {
    const html = generateVisionHTML(baseGraph);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('test-project');
  });

  it('does not show deep mode when deepMode is false/absent', () => {
    const html = generateVisionHTML(baseGraph);
    // The deep mode meta flag should be false
    expect(html).toContain('"deepMode":false');
  });

  it('import edges serialized without semantic fields', () => {
    const html = generateVisionHTML(baseGraph);
    // Should not contain the semantic legend item as visible
    expect(html).toContain('legend-semantic-item');
    // The edge type should be import
    expect(html).toContain('"edgeType":"import"');
  });
});

// ---------------------------------------------------------------------------
// generateVisionHTML — with --deep: semantic rendering
// ---------------------------------------------------------------------------

describe('generateVisionHTML — with --deep: semantic edge rendering', () => {
  const deepGraph: VisionGraph = {
    nodes: [
      { id: '/p/a.ts', label: 'a.ts', score: 80, issueCount: 0, issuesByCategory: {}, blastRadius: 1, directory: '' },
      { id: '/p/b.ts', label: 'b.ts', score: 75, issueCount: 0, issuesByCategory: {}, blastRadius: 0, directory: '' },
      { id: '/p/c.ts', label: 'c.ts', score: 90, issueCount: 0, issuesByCategory: {}, blastRadius: 0, directory: '' },
    ],
    edges: [
      { source: '/p/a.ts', target: '/p/b.ts', type: 'import' },
      { source: '/p/b.ts', target: '/p/c.ts', type: 'semantic', semanticReason: 'B emits events consumed by C' },
    ],
    projectName: 'deep-project',
    totalScore: 82,
    totalNodes: 3,
    truncated: false,
    deepMode: true,
    riskClusters: [
      { id: 'rc-1', label: 'Core Auth', files: ['/p/a.ts', '/p/b.ts'], reason: 'Share session state' },
    ],
  };

  it('includes semantic edge in cytoscape elements', () => {
    const html = generateVisionHTML(deepGraph);
    expect(html).toContain('"edgeType":"semantic"');
  });

  it('includes semanticReason in edge data', () => {
    const html = generateVisionHTML(deepGraph);
    expect(html).toContain('B emits events consumed by C');
  });

  it('sets deepMode to true in META', () => {
    const html = generateVisionHTML(deepGraph);
    expect(html).toContain('"deepMode":true');
  });

  it('includes risk clusters in META', () => {
    const html = generateVisionHTML(deepGraph);
    expect(html).toContain('Core Auth');
    expect(html).toContain('Share session state');
  });

  it('includes dashed edge CSS style for semantic edges', () => {
    const html = generateVisionHTML(deepGraph);
    expect(html).toContain('legend-edge-semantic');
  });

  it('includes risk cluster section CSS', () => {
    const html = generateVisionHTML(deepGraph);
    expect(html).toContain('risk-cluster-item');
    expect(html).toContain('risk-cluster-label');
  });

  it('includes JS that renders risk clusters when deepMode is true', () => {
    const html = generateVisionHTML(deepGraph);
    expect(html).toContain('risk-clusters-section');
    expect(html).toContain('META.deepMode');
  });
});

// ---------------------------------------------------------------------------
// parseLocalImports — unchanged by --deep
// ---------------------------------------------------------------------------

describe('parseLocalImports — unchanged by deep mode', () => {
  it('still resolves static import edges correctly', () => {
    const files = new Set(['/p/src/b.ts', '/p/src/c.ts']);
    const content = `import { foo } from './b.js';\nimport { bar } from './c.js';`;
    const imports = parseLocalImports(content, '/p/src/a.ts', files);
    expect(imports).toContain('/p/src/b.ts');
    expect(imports).toContain('/p/src/c.ts');
  });
});
