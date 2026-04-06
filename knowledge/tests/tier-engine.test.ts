import { describe, it, expect } from 'vitest';
import {
  runTierEngine,
  planTierTargets,
  buildAtomicSweepPrompt,
  buildTierBatchPrompt,
  TierTarget,
  TierEngineOptions,
} from './core/tier-engine.js';
import { ScanResult } from './core/scanner.js';
import type { RatchetRun, Target, RatchetConfig, Click } from '../types.js';
import type { Agent } from './agents/base.js';
import type { LearningStore } from './learning.js';
import type { ClickPhase, EngineCallbacks } from './engine.js';
import { createInitialRun, requireNamedBranch } from './engine-utils.js';
import { analyzeScoreGaps } from './score-optimizer.js';

// Mock types and interfaces for testing
interface MockClick {
  number: number;
  testsPassed: boolean;
  rolledBack: boolean;
  commitHash?: string;
  scoreAfterClick?: number;
  filesModified: string[];
  proposal?: string;
  rollbackReason?: string;
}

class MockAgent {
  strategyContext?: string;
  repoContext?: string;
}

// Helper function to create mock scan result
function createMockScanResult(total: number, categories: any[] = []): ScanResult {
  return {
    total,
    categories,
    totalIssuesFound: total,
    maxScore: 100,
    files: [],
    issues: [],
    issuesByFile: new Map(),
    issuesBySubcategory: new Map(),
    issuesByCategory: new Map(),
    timestamp: new Date(),
    target: { name: 'test', path: '.' },
    projectName: 'test-project',
  };
}

// Helper function to create mock ratchet run
function createMockRun(clicks: MockClick[] = []): RatchetRun {
  return {
    id: 'test-run',
    target: { name: 'test', path: '.' },
    clicks: clicks.map(click => ({
      number: click.number,
      target: 'test',
      analysis: '',
      proposal: click.proposal || '',
      filesModified: click.filesModified,
      testsPassed: click.testsPassed,
      rolledBack: click.rolledBack,
      timestamp: new Date(),
      commitHash: click.commitHash,
      scoreAfterClick: click.scoreAfterClick,
      rollbackReason: click.rollbackReason,
    })),
    startedAt: new Date(),
    finishedAt: new Date(),
    status: 'completed',
    resumeState: undefined,
    falsePositivesFound: 0,
    skippedClicks: 0,
    earlyStopReason: undefined,
    timeoutReached: false,
    budgetReached: false,
    architectEscalated: false,
    sweepEscalated: false,
    reactAnalysis: undefined,
  };
}

describe('Tier Engine', () => {
  describe('Prompt Builders', () => {
    it('should build atomic sweep prompt correctly', () => {
      const gap = {
        subcategory: 'console-logs',
        currentCount: 50,
        currentScore: 80,
        maxScore: 100,
        issuesToNextTier: 10,
        pointsAtNextTier: 5,
        fixInstruction: 'Remove all console.log statements',
        effortPerFix: 1,
        sweepable: true,
        files: ['src/file1.ts', 'src/file2.ts', 'src/file3.ts'],
      };

      const prompt = buildAtomicSweepPrompt(gap, gap.files);
      
      expect(prompt).toContain('You are a code improvement assistant executing an atomic codebase-wide fix.');
      expect(prompt).toContain('GOAL: Cross a scoring tier boundary.');
      expect(prompt).toContain('Subcategory: console-logs');
      expect(prompt).toContain('Current issue count: 50 (current score: 80/100)');
      expect(prompt).toContain('Target count: ≤39 (this gains +5 points)');
      expect(prompt).toContain('Must eliminate: at least 11 instances');
      expect(prompt).toContain('WHAT TO FIX:\n  Remove all console.log statements');
      expect(prompt).toContain('ALL AFFECTED FILES (fix EVERY instance in ALL of these — partial fixes do NOT cross tiers):');
      expect(prompt).toContain('  - src/file1.ts');
      expect(prompt).toContain('  - src/file2.ts');
      expect(prompt).toContain('  - src/file3.ts');
      expect(prompt).toContain('STRATEGY: This is a mechanical, repetitive fix. Go file by file.');
      expect(prompt).toContain('HARD CONSTRAINTS:');
      expect(prompt).toContain('- Fix ONLY this issue type — do NOT change any other code');
      expect(prompt).toContain('- Do NOT refactor, rename, or restructure');
      expect(prompt).toContain('- Do NOT touch any logic');
      expect(prompt).toContain('- All existing tests MUST pass');
      expect(prompt).toContain('After making changes, output each modified file:\nMODIFIED: <filepath>');
    });

    it('should build tier batch prompt correctly', () => {
      const gap = {
        subcategory: 'line-length',
        currentCount: 100,
        currentScore: 70,
        maxScore: 100,
        issuesToNextTier: 20,
        pointsAtNextTier: 8,
        fixInstruction: 'Reduce line length to ≤80 characters',
        effortPerFix: 2,
        sweepable: true,
        files: ['src/file1.ts', 'src/file2.ts', 'src/file3.ts'],
      };

      const batchFiles = ['src/file1.ts', 'src/file2.ts'];
      const prompt = buildTierBatchPrompt(gap, batchFiles);
      
      expect(prompt).toContain('You are a code improvement assistant. Fix ONE specific issue type across a batch of files.');
      expect(prompt).toContain('SCORING CONTEXT:');
      expect(prompt).toContain('Subcategory: line-length');
      expect(prompt).toContain('Current count across codebase: 100 (score: 70/100)');
      expect(prompt).toContain('Tier threshold: ≤79 instances = +8 points');
      expect(prompt).toContain('WHAT TO FIX:\n  Reduce line length to ≤80 characters');
      expect(prompt).toContain('FILES IN THIS BATCH:');
      expect(prompt).toContain('  - src/file1.ts');
      expect(prompt).toContain('  - src/file2.ts');
      expect(prompt).toContain('Fix every instance of this issue in each file above.');
      expect(prompt).toContain('HARD CONSTRAINTS:');
      expect(prompt).toContain('- Fix ONLY the described issue type');
      expect(prompt).toContain('- Do NOT refactor, rename, or restructure');
      expect(prompt).toContain('- Change at most 30 lines per file');
      expect(prompt).toContain('- All existing tests MUST pass');
      expect(prompt).toContain('After making changes, output each modified file:\nMODIFIED: <filepath>');
    });
  });

  describe('Tier Target Planning', () => {
    it('should plan tier targets correctly with atomic mode', () => {
      // Mock scan result with score gaps
      const scan = createMockScanResult(80, [
        {
          name: 'console-logs',
          score: 80,
          max: 100,
          subcategories: [],
        },
      ]);

      // Mock analyzeScoreGaps to return a sweepable gap with effort=1
      const originalAnalyzeScoreGaps = analyzeScoreGaps;
      (analyzeScoreGaps as any) = (scan: ScanResult) => [
        {
          subcategory: 'console-logs',
          currentCount: 50,
          currentScore: 80,
          maxScore: 100,
          issuesToNextTier: 10,
          pointsAtNextTier: 5,
          fixInstruction: 'Remove all console.log statements',
          effortPerFix: 1,
          sweepable: true,
          files: ['src/file1.ts', 'src/file2.ts', 'src/file3.ts', 'src/file4.ts', 'src/file5.ts'],
          pointsAvailable: 5,
        },
      ];

      const targets = planTierTargets(scan, 3);
      
      expect(targets).toHaveLength(1);
      expect(targets[0].gap.subcategory).toBe('console-logs');
      expect(targets[0].atomic).toBe(true);
      expect(targets[0].clickBudget).toBe(1);
      expect(targets[0].batches).toHaveLength(1);
      expect(targets[0].batches[0]).toHaveLength(5); // All files in one batch

      // Restore original function
      (analyzeScoreGaps as any) = originalAnalyzeScoreGaps;
    });

    it('should plan tier targets with standard batching', () => {
      const scan = createMockScanResult(70, [
        {
          name: 'line-length',
          score: 70,
          max: 100,
          subcategories: [],
        },
      ]);

      // Mock analyzeScoreGaps to return a non-sweepable gap with effort=2
      const originalAnalyzeScoreGaps = analyzeScoreGaps;
      (analyzeScoreGaps as any) = (scan: ScanResult) => [
        {
          subcategory: 'line-length',
          currentCount: 100,
          currentScore: 70,
          maxScore: 100,
          issuesToNextTier: 20,
          pointsAtNextTier: 8,
          fixInstruction: 'Reduce line length to ≤80 characters',
          effortPerFix: 2,
          sweepable: false,
          files: ['src/file1.ts', 'src/file2.ts', 'src/file3.ts', 'src/file4.ts', 'src/file5.ts', 'src/file6.ts', 'src/file7.ts'],
          pointsAvailable: 8,
        },
      ];

      const targets = planTierTargets(scan, 5);
      
      expect(targets).toHaveLength(1);
      expect(targets[0].gap.subcategory).toBe('line-length');
      expect(targets[0].atomic).toBe(false);
      expect(targets[0].clickBudget).toBe(2); // 2 batches of 3-4 files each
      expect(targets[0].batches).toHaveLength(2);
      expect(targets[0].batches[0]).toHaveLength(3); // First batch
      expect(targets[0].batches[1]).toHaveLength(2); // Second batch (remaining files)

      // Restore
      (analyzeScoreGaps as any) = originalAnalyzeScoreGaps;
    });

    it('should handle no available tier targets', () => {
      const scan = createMockScanResult(100);
      const targets = planTierTargets(scan, 3);
      expect(targets).toHaveLength(0);
    });

    it('should respect click budget', () => {
      const scan = createMockScanResult(80, [
        {
          name: 'console-logs',
          score: 80,
          max: 100,
          subcategories: [],
        },
      ]);

      // Mock analyzeScoreGaps to return multiple gaps
      const originalAnalyzeScoreGaps = analyzeScoreGaps;
      (analyzeScoreGaps as any) = (scan: ScanResult) => [
        {
          subcategory: 'console-logs',
          currentCount: 50,
          currentScore: 80,
          maxScore: 100,
          issuesToNextTier: 10,
          pointsAtNextTier: 5,
          fixInstruction: 'Remove all console.log statements',
          effortPerFix: 1,
          sweepable: true,
          files: ['src/file1.ts', 'src/file2.ts', 'src/file3.ts'],
          pointsAvailable: 5,
        },
        {
          subcategory: 'line-length',
          currentCount: 100,
          currentScore: 70,
          maxScore: 100,
          issuesToNextTier: 20,
          pointsAtNextTier: 8,
          fixInstruction: 'Reduce line length to ≤80 characters',
          effortPerFix: 2,
          sweepable: false,
          files: ['src/file4.ts', 'src/file5.ts', 'src/file6.ts', 'src/file7.ts', 'src/file8.ts', 'src/file9.ts', 'src/file10.ts'],
          pointsAvailable: 8,
        },
      ];

      const targets = planTierTargets(scan, 1); // Only 1 click available
      expect(targets).toHaveLength(1); // Only the first gap (atomic) is planned
      expect(targets[0].gap.subcategory).toBe('console-logs');

      // Restore
      (analyzeScoreGaps as any) = originalAnalyzeScoreGaps;
    });
  });

  describe('Tier Engine Execution', () => {
    it('should initialize and complete a tier engine run successfully', async () => {
      const originalRequireNamedBranch = requireNamedBranch;
      const originalCreateBranch = git.createBranch;
      const originalRunScan = runScan;
      const originalExecuteClick = execClick;

      // Mock dependencies
      (requireNamedBranch as any) = async () => {};
      (git.createBranch as any) = async () => {};
      (runScan as any) = async () => createMockScanResult(80);
      (execClick as any) = async () => ({
        click: {
          number: 1,
          target: 'test',
          analysis: '',
          proposal: '',
          filesModified: ['src/file1.ts'],
          testsPassed: true,
          rolledBack: false,
          timestamp: new Date(),
          commitHash: 'abc123',
          scoreAfterClick: 85,
          rollbackReason: undefined,
        },
        rolled_back: false,
      });

      const options: TierEngineOptions = {
        target: { name: 'test', path: '.' },
        clicks: 3,
        config: {} as any,
        cwd: '/tmp',
        agent: new MockAgent(),
        createBranch: true,
        adversarial: false,
        callbacks: {},
      };

      const run = await runTierEngine(options);

      expect(run).not.toBeNull();
      expect(run.status).toBe('completed');
      expect(run.clicks).toHaveLength(1);
      expect(run.clicks[0].testsPassed).toBe(true);
      expect(run.clicks[0].rolledBack).toBe(false);

      // Restore original functions
      (requireNamedBranch as any) = originalRequireNamedBranch;
      (git.createBranch as any) = originalCreateBranch;
      (runScan as any) = originalRunScan;
      (execClick as any) = originalExecuteClick;
    });

    it('should handle scope guard violations', async () => {
      const originalRequireNamedBranch = requireNamedBranch;
      const originalCreateBranch = git.createBranch;
      const originalRunScan = runScan;
      const originalExecuteClick = execClick;
      const originalValidateScope = validateScope;

      // Mock dependencies
      (requireNamedBranch as any) = async () => {};
      (git.createBranch as any) = async () => {};
      (runScan as any) = async () => createMockScanResult(80);
      
      // First click succeeds
      (execClick as any) = async () => ({
        click: {
          number: 1,
          target: 'test',
          analysis: '',
          proposal: '',
          filesModified: ['src/file1.ts'],
          testsPassed: true,
          rolledBack: false,
          timestamp: new Date(),
          commitHash: 'abc123',
          scoreAfterClick: 85,
          rollbackReason: undefined,
        },
        rolled_back: false,
      });

      // Second click violates scope
      (execClick as any) = async () => ({
        click: {
          number: 2,
          target: 'test',
          analysis: '',
          proposal: '',
          filesModified: ['outside-scope/file.ts'],
          testsPassed: true,
          rolledBack: false,
          timestamp: new Date(),
          commitHash: 'def456',
          scoreAfterClick: 90,
          rollbackReason: undefined,
        },
        rolled_back: false,
      });

      (validateScope as any) = () => ({ valid: false, scopeViolations: ['outside-scope/file.ts'] });

      const options: TierEngineOptions = {
        target: { name: 'test', path: '.' },
        clicks: 3,
        config: {} as any,
        cwd: '/tmp',
        agent: new MockAgent(),
        createBranch: true,
        adversarial: false,
        callbacks: {},
        scope: ['/tmp/src/'],
      };

      const run = await runTierEngine(options);

      expect(run).not.toBeNull();
      expect(run.status).toBe('completed');
      expect(run.clicks).toHaveLength(2);
      expect(run.clicks[0].testsPassed).toBe(true);
      expect(run.clicks[0].rolledBack).toBe(false);
      expect(run.clicks[1].testsPassed).toBe(false); // Second click should be rolled back due to scope violation
      expect(run.clicks[1].rolledBack).toBe(true);

      // Restore original functions
      (requireNamedBranch as any) = originalRequireNamedBranch;
      (git.createBranch as any) = originalCreateBranch;
      (runScan as any) = originalRunScan;
      (execClick as any) = originalExecuteClick;
      (validateScope as any) = originalValidateScope;
    });

    it('should handle scan failures gracefully', async () => {
      const originalRequireNamedBranch = requireNamedBranch;
      const originalCreateBranch = git.createBranch;
      const originalRunScan = runScan;

      // Mock dependencies
      (requireNamedBranch as any) = async () => {};
      (git.createBranch as any) = async () => {};
      (runScan as any) = async () => { throw new Error('Scan failed'); };

      const options: TierEngineOptions = {
        target: { name: 'test', path: '.' },
        clicks: 3,
        config: {} as any,
        cwd: '/tmp',
        agent: new MockAgent(),
        createBranch: true,
        callbacks: {},
      };

      const run = await runTierEngine(options);

      expect(run).not.toBeNull();
      expect(run.status).toBe('completed'); // Should complete even with scan failure (fallback to blind mode)
      expect(run.clicks).toHaveLength(0);

      // Restore original functions
      (requireNamedBranch as any) = originalRequireNamedBranch;
      (git.createBranch as any) = originalCreateBranch;
      (runScan as any) = originalRunScan;
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero available tier targets', async () => {
      const originalRequireNamedBranch = requireNamedBranch;
      const originalCreateBranch = git.createBranch;
      const originalRunScan = runScan;
      const originalAnalyzeScoreGaps = analyzeScoreGaps;

      // Mock dependencies
      (requireNamedBranch as any) = async () => {};
      (git.createBranch as any) = async () => {};
      (runScan as any) = async () => createMockScanResult(100); // Perfect score, no gaps
      (analyzeScoreGaps as any) = (scan: ScanResult) => [];

      const options: TierEngineOptions = {
        target: { name: 'test', path: '.' },
        clicks: 3,
        config: {} as any,
        cwd: '/tmp',
        agent: new MockAgent(),
        createBranch: true,
        callbacks: {},
      };

      const run = await runTierEngine(options);

      expect(run).not.toBeNull();
      expect(run.status).toBe('completed');
      expect(run.clicks).toHaveLength(0); // No clicks executed

      // Restore original functions
      (requireNamedBranch as any) = originalRequireNamedBranch;
      (git.createBranch as any) = originalCreateBranch;
      (runScan as any) = originalRunScan;
      (analyzeScoreGaps as any) = originalAnalyzeScoreGaps;
    });

    it('should handle partial file lists in atomic mode', async () => {
      const originalRequireNamedBranch = requireNamedBranch;
      const originalCreateBranch = git.createBranch;
      const originalRunScan = runScan;
      const originalAnalyzeScoreGaps = analyzeScoreGaps;

      // Mock dependencies
      (requireNamedBranch as any) = async () => {};
      (git.createBranch as any) = async () => {};
      (runScan as any) = async () => createMockScanResult(80);
      
      (analyzeScoreGaps as any) = (scan: ScanResult) => [
        {
          subcategory: 'console-logs',
          currentCount: 50,
          currentScore: 80,
          maxScore: 100,
          issuesToNextTier: 10,
          pointsAtNextTier: 5,
          fixInstruction: 'Remove all console.log statements',
          effortPerFix: 1,
          sweepable: true,
          files: ['src/file1.ts', 'src/file2.ts'], // Only 2 files, but atomic mode expects up to 40
          pointsAvailable: 5,
        },
      ];

      const options: TierEngineOptions = {
        target: { name: 'test', path: '.' },
        clicks: 3,
        config: {} as any,
        cwd: '/tmp',
        agent: new MockAgent(),
        createBranch: true,
        callbacks: {},
      };

      const run = await runTierEngine(options);

      expect(run).not.toBeNull();
      expect(run.status).toBe('completed');
      // Should still execute the atomic click even with only 2 files

      // Restore original functions
      (requireNamedBranch as any) = originalRequireNamedBranch;
      (git.createBranch as any) = originalCreateBranch;
      (runScan as any) = originalRunScan;
      (analyzeScoreGaps as any) = originalAnalyzeScoreGaps;
    });
  });
});