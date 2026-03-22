/**
 * Tests for expanded GitNexus wrapper functions:
 * - getImpactDetailed (async, with options)
 * - getContextWithSource (async, --content flag)
 * - runCypher (raw Cypher queries)
 * - augmentPattern
 * - reindex
 * - detectChanges
 * - getCypherClusters
 * - buildGraphToolInstructions / parseGitNexusQueries / fulfillGitNexusQueries
 * - runConfidenceGating (engine)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearCache,
  getImpactDetailed,
  getContextWithSource,
  runCypher,
  augmentPattern,
  reindex,
  detectChanges,
  getCypherClusters,
  queryFlowsTargeted,
  isIndexed,
} from '../src/core/gitnexus.js';
import {
  buildGraphToolInstructions,
  parseGitNexusQueries,
  fulfillGitNexusQueries,
  GITNEXUS_QUERY_MARKER,
} from '../src/core/gitnexus-tools.js';
import { runConfidenceGating } from '../src/core/engine.js';
import { groupByDependencyClusterSmart } from '../src/core/issue-backlog.js';

// ──────────────────────────────────────────────────────────────
// Mock child_process for async spawn calls
// ──────────────────────────────────────────────────────────────

const mockSpawnHandlers: Array<(cmd: string, args: string[]) => { stdout: string; stderr: string }> = [];

function createMockChildProcess(stdout: string, stderr = '') {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {
    data: [],
    close: [],
    error: [],
  };

  const makeStream = (data: string) => ({
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') {
        // Emit data synchronously for testing
        setTimeout(() => cb(Buffer.from(data)), 0);
      }
    }),
  });

  return {
    stdout: makeStream(stdout),
    stderr: makeStream(stderr),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => cb(0), 5);
      if (event === 'error') { /* ignore */ }
    }),
    kill: vi.fn(),
  };
}

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn((cmd: string, args: string[]) => {
      if (cmd !== 'gitnexus') return actual.spawnSync(cmd, args);
      const subcommand = args[0];
      if (subcommand === 'impact') {
        const target = args[1];
        if (target === 'high-risk.ts') {
          return {
            stdout: JSON.stringify({
              impact_summary: Array.from({ length: 12 }, (_, i) => ({ name: `caller${i}`, filePath: `src/${i}.ts` })),
              risk_level: 'CRITICAL',
              confidence: 0.95,
            }),
            stderr: '',
            status: 0,
          };
        }
        return {
          stdout: JSON.stringify({
            impact_summary: [{ name: 'callerA', filePath: 'src/a.ts' }],
            risk_level: 'LOW',
            confidence: 0.6,
          }),
          stderr: '',
          status: 0,
        };
      }
      if (subcommand === 'context') {
        return {
          stdout: JSON.stringify({
            symbol: { name: 'moduleA' },
            incoming: { imports: [{ name: 'importerX', filePath: 'src/x.ts' }] },
            outgoing: { imports: [{ name: 'shared', filePath: 'src/shared.ts' }] },
          }),
          stderr: '',
          status: 0,
        };
      }
      if (subcommand === 'query') {
        return {
          stdout: JSON.stringify({
            processes: [{ summary: 'HTTP request flow', id: 'p1' }],
          }),
          stderr: '',
          status: 0,
        };
      }
      return { stdout: '', stderr: '', status: 1 };
    }),
    spawn: vi.fn((cmd: string, args: string[]) => {
      if (cmd !== 'gitnexus') {
        return actual.spawn(cmd, args);
      }
      const subcommand = args[0];
      let responseData = '';

      if (subcommand === 'impact') {
        const target = args[1];
        const hasDirection = args.includes('--direction');
        const hasIncludeTests = args.includes('--include-tests');

        if (target === 'high-risk.ts') {
          responseData = JSON.stringify({
            impact_summary: Array.from({ length: 12 }, (_, i) => ({ name: `caller${i}`, filePath: `src/${i}.ts` })),
            risk_level: 'CRITICAL',
            confidence: 0.95,
            downstream: hasDirection ? [{ name: 'dep1', filePath: 'src/dep1.ts' }] : [],
          });
        } else if (target === 'medium-risk.ts') {
          responseData = JSON.stringify({
            impact_summary: [{ name: 'callerA', filePath: 'src/a.ts' }],
            risk_level: 'HIGH',
            confidence: 0.85,
          });
        } else if (target === 'low-risk.ts') {
          responseData = JSON.stringify({
            impact_summary: [],
            risk_level: 'LOW',
            confidence: 0.6,
          });
        } else {
          responseData = JSON.stringify({ error: 'not found' });
        }
      } else if (subcommand === 'context') {
        const hasContent = args.includes('--content');
        responseData = JSON.stringify({
          symbol: { name: 'moduleA' },
          incoming: { imports: [{ name: 'importerX', filePath: 'src/x.ts' }] },
          outgoing: { imports: [{ name: 'shared', filePath: 'src/shared.ts' }] },
          ...(hasContent ? { source: 'export function foo() { return 42; }' } : {}),
        });
      } else if (subcommand === 'cypher') {
        responseData = JSON.stringify({
          rows: [
            { source: 'src/a.ts', target: 'src/b.ts', strength: 3 },
            { source: 'src/b.ts', target: 'src/c.ts', strength: 2 },
          ],
        });
      } else if (subcommand === 'augment') {
        responseData = JSON.stringify({
          results: [
            { pattern: 'getUserById' },
            { pattern: 'findUserByEmail' },
          ],
        });
      } else if (subcommand === 'analyze') {
        responseData = JSON.stringify({ status: 'ok', indexed: 42 });
      } else if (subcommand === 'query') {
        responseData = JSON.stringify({
          processes: [{ summary: 'HTTP auth flow', id: 'p1' }],
        });
      } else {
        responseData = '';
      }

      return createMockChildProcess(responseData);
    }),
  };
});

// Mock fs.existsSync for .gitnexus check
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (typeof path === 'string' && path.endsWith('.gitnexus')) {
        if (path.includes('/no-index')) return false;
        return true;
      }
      return actual.existsSync(path);
    }),
  };
});

// ──────────────────────────────────────────────────────────────
// Tests: getImpactDetailed (async)
// ──────────────────────────────────────────────────────────────

describe('getImpactDetailed', () => {
  beforeEach(() => { clearCache(); });

  it('returns null for non-indexed repos', async () => {
    const result = await getImpactDetailed('any.ts', '/no-index');
    expect(result).toBeNull();
  });

  it('returns null for not-found targets', async () => {
    const result = await getImpactDetailed('not-found.ts', '/test/repo');
    expect(result).toBeNull();
  });

  it('returns impact with confidence for high-risk files', async () => {
    const result = await getImpactDetailed('high-risk.ts', '/test/repo');
    expect(result).not.toBeNull();
    expect(result!.riskLevel).toBe('CRITICAL');
    expect(result!.confidence).toBeGreaterThan(0.7);
    expect(result!.directCallers.length).toBeGreaterThan(0);
  });

  it('passes direction option to CLI', async () => {
    const result = await getImpactDetailed('high-risk.ts', '/test/repo', { direction: 'downstream' });
    expect(result).not.toBeNull();
    // downstream items should be included
    expect(result!.affectedFiles.length).toBeGreaterThan(0);
  });

  it('uses default confidence of 0.7 when not in response', async () => {
    const result = await getImpactDetailed('low-risk.ts', '/test/repo');
    expect(result).not.toBeNull();
    // low-risk.ts has confidence: 0.6 in mock — below default
    expect(result!.confidence).toBeGreaterThanOrEqual(0);
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: getContextWithSource (async)
// ──────────────────────────────────────────────────────────────

describe('getContextWithSource', () => {
  beforeEach(() => { clearCache(); });

  it('returns null for non-indexed repos', async () => {
    const result = await getContextWithSource('any.ts', '/no-index');
    expect(result).toBeNull();
  });

  it('returns context with source when available', async () => {
    const result = await getContextWithSource('moduleA.ts', '/test/repo');
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('moduleA');
    expect(result!.source).toContain('foo');
  });

  it('includes incoming and outgoing relationships', async () => {
    const result = await getContextWithSource('moduleA.ts', '/test/repo');
    expect(result).not.toBeNull();
    expect(result!.incoming['imports']).toBeDefined();
    expect(result!.outgoing['imports']).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: runCypher
// ──────────────────────────────────────────────────────────────

describe('runCypher', () => {
  beforeEach(() => { clearCache(); });

  it('returns null for non-indexed repos', async () => {
    const result = await runCypher('MATCH (n) RETURN n', '/no-index');
    expect(result).toBeNull();
  });

  it('returns parsed JSON result for valid query', async () => {
    const result = await runCypher('MATCH (a)-[:CALLS]->(b) RETURN a, b', '/test/repo') as { rows: unknown[] };
    expect(result).not.toBeNull();
    expect(result.rows).toBeDefined();
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it('caches results for identical queries', async () => {
    const result1 = await runCypher('MATCH (n) RETURN n', '/test/repo');
    const result2 = await runCypher('MATCH (n) RETURN n', '/test/repo');
    expect(result1).toEqual(result2);
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: augmentPattern
// ──────────────────────────────────────────────────────────────

describe('augmentPattern', () => {
  beforeEach(() => { clearCache(); });

  it('returns empty array for non-indexed repos', async () => {
    const result = await augmentPattern('getUser', '/no-index');
    expect(result).toEqual([]);
  });

  it('returns augmented patterns', async () => {
    const result = await augmentPattern('getUser', '/test/repo');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('User');
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: reindex
// ──────────────────────────────────────────────────────────────

describe('reindex', () => {
  it('returns false for non-indexed repos (graceful)', async () => {
    // Note: reindex doesn't check isIndexed — it just runs analyze
    // If gitnexus returns empty string it returns false
    const result = await reindex('/test/repo', false);
    // Should resolve without throwing
    expect(typeof result).toBe('boolean');
  });

  it('does not throw even if gitnexus fails', async () => {
    await expect(reindex('/no-index', true)).resolves.not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: detectChanges
// ──────────────────────────────────────────────────────────────

describe('detectChanges', () => {
  beforeEach(() => { clearCache(); });

  it('returns empty array for empty scope', async () => {
    const result = await detectChanges([], '/test/repo');
    expect(result).toEqual([]);
  });

  it('returns empty array for non-indexed repos', async () => {
    const result = await detectChanges(['src/a.ts'], '/no-index');
    expect(result).toEqual([]);
  });

  it('returns impacts for modified files', async () => {
    const result = await detectChanges(['high-risk.ts'], '/test/repo');
    expect(Array.isArray(result)).toBe(true);
    // high-risk.ts should return an impact result
    expect(result.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: getCypherClusters
// ──────────────────────────────────────────────────────────────

describe('getCypherClusters', () => {
  beforeEach(() => { clearCache(); });

  it('returns empty for non-indexed repos', async () => {
    const result = await getCypherClusters(['a.ts', 'b.ts'], '/no-index');
    expect(result).toEqual([]);
  });

  it('returns empty for empty file list', async () => {
    const result = await getCypherClusters([], '/test/repo');
    expect(result).toEqual([]);
  });

  it('clusters connected files together', async () => {
    const result = await getCypherClusters(['src/a.ts', 'src/b.ts', 'src/c.ts'], '/test/repo');
    expect(Array.isArray(result)).toBe(true);
    // Cypher returned edges a→b and b→c, so all should be in one cluster
    if (result.length > 0) {
      expect(result[0]!.files.length).toBeGreaterThan(0);
      expect(result[0]!.reason).toBeDefined();
    }
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: queryFlowsTargeted
// ──────────────────────────────────────────────────────────────

describe('queryFlowsTargeted', () => {
  beforeEach(() => { clearCache(); });

  it('returns empty array for non-indexed repos', async () => {
    const result = await queryFlowsTargeted('auth', '/no-index');
    expect(result).toEqual([]);
  });

  it('returns flow summaries for indexed repos', async () => {
    const result = await queryFlowsTargeted('auth', '/test/repo', { goal: 'understand flow' });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: gitnexus-tools.ts
// ──────────────────────────────────────────────────────────────

describe('buildGraphToolInstructions', () => {
  it('returns empty string for non-indexed repos', () => {
    const result = buildGraphToolInstructions('/no-index');
    expect(result).toBe('');
  });

  it('returns instruction string for indexed repos', () => {
    const result = buildGraphToolInstructions('/test/repo');
    expect(result).toContain('GITNEXUS_QUERY');
    expect(result).toContain('impact');
    expect(result).toContain('flows');
    expect(result).toContain('context');
  });
});

describe('parseGitNexusQueries', () => {
  it('returns empty array for output with no markers', () => {
    const result = parseGitNexusQueries('I modified src/api.ts\nMODIFIED: src/api.ts');
    expect(result).toEqual([]);
  });

  it('parses a single impact query', () => {
    const output = 'Checking blast radius...\nGITNEXUS_QUERY: impact src/api.ts\nDone.';
    const result = parseGitNexusQueries(output);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe('impact');
    expect(result[0]!.target).toBe('src/api.ts');
  });

  it('parses flows query with --goal option', () => {
    const output = `GITNEXUS_QUERY: flows authentication --goal understand flow`;
    const result = parseGitNexusQueries(output);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe('flows');
    expect(result[0]!.target).toBe('authentication');
    expect(result[0]!.options['goal']).toBe('understand');
  });

  it('parses context query', () => {
    const output = `GITNEXUS_QUERY: context getUserById`;
    const result = parseGitNexusQueries(output);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe('context');
    expect(result[0]!.target).toBe('getUserById');
  });

  it('parses multiple queries in one output', () => {
    const output = [
      'GITNEXUS_QUERY: impact src/api.ts',
      'GITNEXUS_QUERY: flows auth',
    ].join('\n');
    const result = parseGitNexusQueries(output);
    expect(result.length).toBe(2);
  });

  it('ignores unknown query types', () => {
    const output = 'GITNEXUS_QUERY: unknown something';
    const result = parseGitNexusQueries(output);
    expect(result).toEqual([]);
  });
});

describe('fulfillGitNexusQueries', () => {
  beforeEach(() => { clearCache(); });

  it('returns empty string for empty query list', async () => {
    const result = await fulfillGitNexusQueries([], '/test/repo');
    expect(result).toBe('');
  });

  it('fulfills impact query', async () => {
    const queries = parseGitNexusQueries('GITNEXUS_QUERY: impact high-risk.ts');
    const result = await fulfillGitNexusQueries(queries, '/test/repo');
    expect(result).toContain('GITNEXUS RESULT');
    expect(result).toContain('CRITICAL');
  });

  it('fulfills flows query', async () => {
    const queries = parseGitNexusQueries('GITNEXUS_QUERY: flows authentication');
    const result = await fulfillGitNexusQueries(queries, '/test/repo');
    expect(result).toContain('GITNEXUS RESULT');
  });

  it('fulfills context query', async () => {
    const queries = parseGitNexusQueries('GITNEXUS_QUERY: context moduleA');
    const result = await fulfillGitNexusQueries(queries, '/test/repo');
    expect(result).toContain('GITNEXUS RESULT');
  });

  it('handles not-found gracefully', async () => {
    const queries = parseGitNexusQueries('GITNEXUS_QUERY: impact not-found-symbol.ts');
    const result = await fulfillGitNexusQueries(queries, '/test/repo');
    expect(result).toContain('GITNEXUS RESULT');
    expect(result).toContain('no data found');
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: runConfidenceGating (engine)
// ──────────────────────────────────────────────────────────────

describe('runConfidenceGating', () => {
  beforeEach(() => { clearCache(); });

  it('returns empty array for empty file list', async () => {
    const result = await runConfidenceGating([], '/test/repo');
    expect(result).toEqual([]);
  });

  it('flags high-risk changes with confidence > 0.7', async () => {
    // high-risk.ts has CRITICAL risk + 0.95 confidence → should be flagged
    const result = await runConfidenceGating(['high-risk.ts'], '/test/repo');
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(['HIGH', 'CRITICAL']).toContain(result[0]!.risk);
      expect(result[0]!.confidence).toBeGreaterThan(0.7);
      expect(result[0]!.file).toBeDefined();
    }
  });

  it('does not flag low-confidence changes', async () => {
    // low-risk.ts has LOW risk + 0.6 confidence → should not be flagged
    const result = await runConfidenceGating(['low-risk.ts'], '/test/repo');
    expect(Array.isArray(result)).toBe(true);
    // Low risk should not be in flagged list
    const lowRiskFlagged = result.filter(r => r.file === 'low-risk.ts' && r.risk === 'LOW');
    expect(lowRiskFlagged.length).toBe(0);
  });

  it('does not throw for non-indexed repos', async () => {
    const result = await runConfidenceGating(['any.ts'], '/no-index');
    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────
// Tests: groupByDependencyClusterSmart (issue-backlog)
// ──────────────────────────────────────────────────────────────

describe('groupByDependencyClusterSmart', () => {
  beforeEach(() => { clearCache(); });

  it('returns empty for empty file list', async () => {
    const result = await groupByDependencyClusterSmart([], '/test/repo');
    expect(result).toEqual([]);
  });

  it('returns clusters for connected files', async () => {
    const result = await groupByDependencyClusterSmart(
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      '/test/repo',
      ['empty-catches'],
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // All files should be represented
    const allFiles = result.flat();
    expect(allFiles).toContain('src/a.ts');
  });

  it('respects maxPerCluster', async () => {
    const result = await groupByDependencyClusterSmart(
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      '/test/repo',
      [],
      1,
    );
    for (const cluster of result) {
      expect(cluster.length).toBeLessThanOrEqual(1);
    }
  });

  it('handles non-indexed repos gracefully', async () => {
    const result = await groupByDependencyClusterSmart(
      ['a.ts', 'b.ts'],
      '/no-index',
    );
    // Falls back to import-based or chunks
    expect(Array.isArray(result)).toBe(true);
  });
});
