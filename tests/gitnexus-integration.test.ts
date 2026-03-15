import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assessFileRisk,
  getDependencyClusters,
  clearCache,
  getImpact,
  getContext,
  queryFlows,
  isIndexed,
} from '../src/core/gitnexus.js';
import type { GitNexusImpact, GitNexusContext } from '../src/core/gitnexus.js';
import {
  enrichBacklogWithRisk,
  groupByDependencyCluster,
} from '../src/core/issue-backlog.js';
import type { IssueTask } from '../src/core/issue-backlog.js';
import { checkRiskGate } from '../src/core/click.js';

// ──────────────────────────────────────────────────────────────
// Mock the gitnexus CLI calls — we don't want real subprocess calls in tests
// ──────────────────────────────────────────────────────────────

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
              impact_summary: [
                { name: 'callerA', filePath: 'src/a.ts' },
                { name: 'callerB', filePath: 'src/b.ts' },
                { name: 'callerC', filePath: 'src/c.ts' },
                { name: 'callerD', filePath: 'src/d.ts' },
                { name: 'callerE', filePath: 'src/e.ts' },
                { name: 'callerF', filePath: 'src/f.ts' },
                { name: 'callerG', filePath: 'src/g.ts' },
                { name: 'callerH', filePath: 'src/h.ts' },
                { name: 'callerI', filePath: 'src/i.ts' },
                { name: 'callerJ', filePath: 'src/j.ts' },
                { name: 'callerK', filePath: 'src/k.ts' },
                { name: 'callerL', filePath: 'src/l.ts' },
              ],
              risk_level: 'CRITICAL',
            }),
            stderr: '',
            status: 0,
          };
        }

        if (target === 'low-risk.ts') {
          return {
            stdout: JSON.stringify({
              impact_summary: [
                { name: 'callerA', filePath: 'src/a.ts' },
              ],
              risk_level: 'LOW',
            }),
            stderr: '',
            status: 0,
          };
        }

        if (target === 'not-found.ts') {
          return {
            stdout: JSON.stringify({ error: 'not found' }),
            stderr: '',
            status: 0,
          };
        }

        // Default: medium risk
        return {
          stdout: JSON.stringify({
            impact_summary: [
              { name: 'callerA', filePath: 'src/a.ts' },
              { name: 'callerB', filePath: 'src/b.ts' },
              { name: 'callerC', filePath: 'src/c.ts' },
            ],
            risk_level: 'MEDIUM',
          }),
          stderr: '',
          status: 0,
        };
      }

      if (subcommand === 'context') {
        const target = args[1];

        if (target === 'moduleA.ts') {
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

        if (target === 'moduleB.ts') {
          return {
            stdout: JSON.stringify({
              symbol: { name: 'moduleB' },
              incoming: {},
              outgoing: { imports: [{ name: 'shared', filePath: 'src/shared.ts' }] },
            }),
            stderr: '',
            status: 0,
          };
        }

        if (target === 'moduleC.ts') {
          return {
            stdout: JSON.stringify({
              symbol: { name: 'moduleC' },
              incoming: {},
              outgoing: { imports: [{ name: 'other', filePath: 'src/other.ts' }] },
            }),
            stderr: '',
            status: 0,
          };
        }

        return {
          stdout: JSON.stringify({ status: 'not_found' }),
          stderr: '',
          status: 0,
        };
      }

      if (subcommand === 'query') {
        return {
          stdout: JSON.stringify({
            processes: [
              { summary: 'HTTP request handling flow', id: 'process-1' },
              { summary: 'Database migration pipeline', id: 'process-2' },
              { summary: 'Authentication middleware chain', id: 'process-3' },
            ],
          }),
          stderr: '',
          status: 0,
        };
      }

      return { stdout: '', stderr: '', status: 1 };
    }),
  };
});

// Mock fs.existsSync for .gitnexus check
// Paths containing '/no-index/' simulate repos without GitNexus index
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (typeof path === 'string' && path.endsWith('.gitnexus')) {
        // Simulate non-indexed repos for paths containing '/no-index'
        if (path.includes('/no-index')) return false;
        return true;
      }
      return actual.existsSync(path);
    }),
  };
});

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe('GitNexus caching', () => {
  beforeEach(() => {
    clearCache();
  });

  it('clearCache resets all caches without error', () => {
    expect(() => clearCache()).not.toThrow();
  });

  it('getImpact returns cached result on second call', () => {
    const first = getImpact('low-risk.ts', '/test/repo');
    const second = getImpact('low-risk.ts', '/test/repo');
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
  });

  it('queryFlows returns cached result on second call', () => {
    const first = queryFlows('auth', '/test/repo');
    const second = queryFlows('auth', '/test/repo');
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('getContext returns cached result on second call', () => {
    const first = getContext('moduleA.ts', '/test/repo');
    const second = getContext('moduleA.ts', '/test/repo');
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
  });

  it('clearCache makes next call return fresh data', () => {
    const first = getImpact('low-risk.ts', '/test/repo');
    clearCache();
    const second = getImpact('low-risk.ts', '/test/repo');
    // Both should be non-null and equal (same mock data)
    expect(first).toEqual(second);
  });
});

describe('assessFileRisk', () => {
  beforeEach(() => {
    clearCache();
  });

  it('returns 0 for files with no impact data', () => {
    const risk = assessFileRisk('not-found.ts', '/test/repo');
    expect(risk).toBe(0);
  });

  it('returns low risk for files with few dependents', () => {
    const risk = assessFileRisk('low-risk.ts', '/test/repo');
    expect(risk).toBeGreaterThan(0);
    expect(risk).toBeLessThan(0.5);
  });

  it('returns 1.0 (capped) for files with many dependents', () => {
    const risk = assessFileRisk('high-risk.ts', '/test/repo');
    expect(risk).toBe(1);
  });

  it('returns 0 when gitnexus is not indexed', () => {
    clearCache();
    const risk = assessFileRisk('any-file.ts', '/no-index');
    expect(risk).toBe(0);
  });
});

describe('getDependencyClusters', () => {
  beforeEach(() => {
    clearCache();
  });

  it('returns empty array for empty input', () => {
    expect(getDependencyClusters([], '/test/repo')).toEqual([]);
  });

  it('clusters files that share imports', () => {
    // moduleA.ts and moduleB.ts both import from src/shared.ts
    // moduleC.ts imports from src/other.ts (different cluster)
    const clusters = getDependencyClusters(
      ['moduleA.ts', 'moduleB.ts', 'moduleC.ts'],
      '/test/repo',
    );

    expect(clusters.length).toBe(2);
    // Find the cluster containing moduleA
    const clusterWithA = clusters.find(c => c.includes('moduleA.ts'));
    expect(clusterWithA).toContain('moduleB.ts');

    // moduleC should be in its own cluster
    const clusterWithC = clusters.find(c => c.includes('moduleC.ts'));
    expect(clusterWithC).not.toContain('moduleA.ts');
  });

  it('returns single cluster when all files share deps', () => {
    const clusters = getDependencyClusters(
      ['moduleA.ts', 'moduleB.ts'],
      '/test/repo',
    );
    expect(clusters.length).toBe(1);
    expect(clusters[0]).toContain('moduleA.ts');
    expect(clusters[0]).toContain('moduleB.ts');
  });

  it('falls back to single cluster when gitnexus is not indexed', () => {
    clearCache();
    const clusters = getDependencyClusters(['a.ts', 'b.ts'], '/no-index');
    expect(clusters).toEqual([['a.ts', 'b.ts']]);
  });
});

describe('enrichBacklogWithRisk', () => {
  beforeEach(() => {
    clearCache();
  });

  it('adds riskScore to tasks with sweepFiles', () => {
    const tasks: IssueTask[] = [
      {
        category: 'Error Handling',
        subcategory: 'Empty catches',
        description: 'empty catch blocks',
        count: 5,
        severity: 'high',
        priority: 10,
        sweepFiles: ['low-risk.ts'],
      },
    ];

    enrichBacklogWithRisk(tasks, '/test/repo');
    expect(tasks[0]!.riskScore).toBeDefined();
    expect(tasks[0]!.riskScore).toBeGreaterThanOrEqual(0);
  });

  it('does not add riskScore to tasks without sweepFiles', () => {
    const tasks: IssueTask[] = [
      {
        category: 'Error Handling',
        subcategory: 'Empty catches',
        description: 'empty catch blocks',
        count: 5,
        severity: 'high',
        priority: 10,
      },
    ];

    enrichBacklogWithRisk(tasks, '/test/repo');
    expect(tasks[0]!.riskScore).toBeUndefined();
  });

  it('boosts priority for test coverage tasks with high risk', () => {
    const tasks: IssueTask[] = [
      {
        category: 'Testing',
        subcategory: 'Test coverage',
        description: 'missing tests',
        count: 5,
        severity: 'high',
        priority: 10,
        sweepFiles: ['high-risk.ts'],
      },
    ];

    const originalPriority = tasks[0]!.priority;
    enrichBacklogWithRisk(tasks, '/test/repo');
    // Test coverage with high-risk files should get boosted priority
    expect(tasks[0]!.priority).toBeGreaterThan(originalPriority);
  });

  it('reduces priority for structural changes with high risk', () => {
    const tasks: IssueTask[] = [
      {
        category: 'Error Handling',
        subcategory: 'Empty catches',
        description: 'empty catch blocks',
        count: 5,
        severity: 'high',
        priority: 10,
        sweepFiles: ['high-risk.ts'],
      },
    ];

    const originalPriority = tasks[0]!.priority;
    enrichBacklogWithRisk(tasks, '/test/repo');
    // Structural changes on high-risk files should get reduced priority
    expect(tasks[0]!.priority).toBeLessThan(originalPriority);
  });

  it('re-sorts tasks after risk adjustment', () => {
    const tasks: IssueTask[] = [
      {
        category: 'Error Handling',
        subcategory: 'Empty catches',
        description: 'structural change',
        count: 5,
        severity: 'high',
        priority: 15,
        sweepFiles: ['high-risk.ts'],
      },
      {
        category: 'Testing',
        subcategory: 'Test coverage',
        description: 'add tests',
        count: 3,
        severity: 'medium',
        priority: 8,
        sweepFiles: ['high-risk.ts'],
      },
    ];

    enrichBacklogWithRisk(tasks, '/test/repo');
    // After risk adjustment, test coverage task (boosted) may outrank structural (reduced)
    for (let i = 0; i < tasks.length - 1; i++) {
      expect(tasks[i]!.priority).toBeGreaterThanOrEqual(tasks[i + 1]!.priority);
    }
  });
});

describe('groupByDependencyCluster', () => {
  beforeEach(() => {
    clearCache();
  });

  it('groups related files together', () => {
    const groups = groupByDependencyCluster(
      ['moduleA.ts', 'moduleB.ts', 'moduleC.ts'],
      '/test/repo',
    );
    // Should have 2 groups: {A, B} and {C}
    expect(groups.length).toBe(2);
  });

  it('respects maxPerCluster limit', () => {
    // With maxPerCluster=1, each file is its own batch
    const groups = groupByDependencyCluster(
      ['moduleA.ts', 'moduleB.ts'],
      '/test/repo',
      1,
    );
    // A and B are in same cluster but chunked into max 1
    expect(groups.length).toBe(2);
    expect(groups[0]!.length).toBe(1);
    expect(groups[1]!.length).toBe(1);
  });

  it('returns empty for empty input', () => {
    expect(groupByDependencyCluster([], '/test/repo')).toEqual([]);
  });
});

describe('checkRiskGate', () => {
  beforeEach(() => {
    clearCache();
  });

  it('returns requiresSwarm=true for high-risk files (>10 dependents)', () => {
    const result = checkRiskGate('high-risk.ts', '/test/repo');
    expect(result.requiresSwarm).toBe(true);
    expect(result.dependentCount).toBeGreaterThan(10);
    expect(result.riskScore).toBe(1);
  });

  it('returns requiresSwarm=false for low-risk files', () => {
    const result = checkRiskGate('low-risk.ts', '/test/repo');
    expect(result.requiresSwarm).toBe(false);
    expect(result.dependentCount).toBeLessThanOrEqual(10);
  });

  it('returns requiresSwarm=false when impact data is unavailable', () => {
    const result = checkRiskGate('not-found.ts', '/test/repo');
    expect(result.requiresSwarm).toBe(false);
    expect(result.riskScore).toBe(0);
    expect(result.dependentCount).toBe(0);
  });

  it('returns safe defaults when gitnexus is not indexed', () => {
    clearCache();
    const result = checkRiskGate('any-file.ts', '/no-index');
    expect(result.requiresSwarm).toBe(false);
    expect(result.riskScore).toBe(0);
  });
});

describe('queryFlows integration in prompts', () => {
  beforeEach(() => {
    clearCache();
  });

  it('queryFlows returns execution flow summaries', () => {
    const flows = queryFlows('authentication', '/test/repo');
    expect(flows.length).toBe(3);
    expect(flows[0]).toContain('HTTP request');
  });

  it('queryFlows returns empty array when not indexed', () => {
    clearCache();
    const flows = queryFlows('anything', '/no-index');
    expect(flows).toEqual([]);
  });

  it('queryFlows respects limit parameter', () => {
    const flows = queryFlows('auth', '/test/repo', 1);
    expect(flows.length).toBe(1);
  });
});
