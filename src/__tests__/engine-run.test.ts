import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  initializeRun,
  processClickOutcome,
} from '../core/engine-run.js';
import type { RatchetRun, Target, RatchetConfig, Click } from '../types.js';

// Mock dependencies
vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
}));

vi.mock('../core/git.js', () => ({
  isDetachedHead: vi.fn().mockResolvedValue(false),
  createBranch: vi.fn().mockResolvedValue(undefined),
  branchName: vi.fn().mockReturnValue('ratchet/test-target'),
}));

vi.mock('../core/scan-cache.js', () => ({
  IncrementalScanner: vi.fn().mockImplementation(function() {
    this.incrementalScan = vi.fn().mockResolvedValue({
      total: 90,
      totalIssuesFound: 5,
      categories: [],
    });
  }),
}));

vi.mock('../core/test-isolation.js', () => ({
  captureBaseline: vi.fn().mockResolvedValue({ failedTests: [] }),
}));

vi.mock('../core/repo-probe.js', () => ({
  probeRepo: vi.fn().mockReturnValue({ language: 'typescript', size: 'medium' }),
}));

vi.mock('../core/familiarize.js', () => ({
  familiarize: vi.fn().mockResolvedValue({}),
  buildFamiliarizationContext: vi.fn().mockReturnValue('repo context'),
}));

vi.mock('../core/engine-guards.js', () => ({
  resolveGuards: vi.fn().mockReturnValue({ fileCount: 3, lineCount: 20 }),
  nextGuardProfile: vi.fn().mockReturnValue(null),
  isGuardRejection: vi.fn().mockReturnValue(false),
}));

vi.mock('../core/engine-utils.js', () => ({
  preflightTestCommand: vi.fn().mockResolvedValue(undefined),
  formatRollbackMessage: vi.fn().mockReturnValue('rollback message'),
}));

vi.mock('../core/score-optimizer.js', () => ({
  buildScoreOptimizedBacklog: vi.fn().mockReturnValue([]),
}));

describe('engine-run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeRun', () => {
    it('should create a run with basic properties', async () => {
      const target: Target = { name: 'test-target', path: '.', description: 'Test target' };
      const options = {
        target,
        config: { defaults: { testCommand: 'npm test', baselineTests: false } } as RatchetConfig,
        cwd: '/test',
        clicks: 5,
      };

      const result = await initializeRun(options);

      expect(result.run).toBeDefined();
      expect(result.run.id).toBe('test-uuid-1234');
      expect(result.run.target).toBe(target);
      expect(result.run.clicks).toHaveLength(0);
      expect(result.run.status).toBe('running');
      expect(result.run.startedAt).toBeInstanceOf(Date);
      expect(result.state).toBeDefined();
      expect(result.baselineFailures).toHaveLength(0);
    });

    it('should initialize state with default values', async () => {
      const target: Target = { name: 'test-target', path: '.', description: 'Test target' };
      const options = {
        target,
        config: { defaults: { testCommand: 'npm test', baselineTests: false } } as RatchetConfig,
        cwd: '/test',
        clicks: 5,
      };

      const result = await initializeRun(options);

      expect(result.state.consecutiveRollbacks).toBe(0);
      expect(result.state.totalLanded).toBe(0);
      expect(result.state.totalRolled).toBe(0);
      expect(result.state.escalated).toBe(false);
      expect(result.state.blacklistedSubcategories).toBeInstanceOf(Set);
      expect(result.state.subcategoryStats).toBeInstanceOf(Map);
    });

    it('should create ratchet branch by default', async () => {
      const createBranchSpy = vi.spyOn(await import('../core/git.js'), 'createBranch');

      const target: Target = { name: 'test-target', path: '.', description: 'Test target' };
      const options = {
        target,
        config: { defaults: { testCommand: 'npm test', baselineTests: false } } as RatchetConfig,
        cwd: '/test',
        clicks: 5,
      };

      await initializeRun(options);

      expect(createBranchSpy).toHaveBeenCalled();
      createBranchSpy.mockRestore();
    });
  });

  describe('processClickOutcome', () => {
    it('should update state for rolled back click', async () => {
      const click: Click = {
        number: 1,
        target: 'test-target',
        analysis: '',
        proposal: '',
        filesModified: [],
        testsPassed: false,
        timestamp: new Date(),
        rollbackReason: 'tests failed',
      };

      const state: any = {
        consecutiveRollbacks: 0,
        totalRolled: 0,
        totalLanded: 0,
        circuitBreaker: {
          consecutiveFailures: 0,
          currentStrategy: 'standard',
        },
      };

      const callbacks = {
        onEscalate: vi.fn(),
      };

      await processClickOutcome(1, click, true, '1.5', state, true, callbacks);

      expect(state.consecutiveRollbacks).toBe(1);
      expect(state.totalRolled).toBe(1);
      expect(state.circuitBreaker.consecutiveFailures).toBe(1);
    });

    it('should update state for landed click', async () => {
      const click: Click = {
        number: 1,
        target: 'test-target',
        analysis: '',
        proposal: '',
        filesModified: [],
        testsPassed: true,
        timestamp: new Date(),
        commitHash: 'abc123',
      };

      const state: any = {
        consecutiveRollbacks: 2,
        totalRolled: 1,
        totalLanded: 0,
        circuitBreaker: {
          consecutiveFailures: 2,
          currentStrategy: 'standard',
        },
      };

      const callbacks = {
        onEscalate: vi.fn(),
      };

      await processClickOutcome(1, click, false, '1.5', state, true, callbacks);

      expect(state.consecutiveRollbacks).toBe(0);
      expect(state.totalLanded).toBe(1);
      expect(state.circuitBreaker.consecutiveFailures).toBe(0);
    });
  });
});