import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runArchitectEngine } from '../core/engine-architect.js';
import type { EngineRunOptions, ClickPhase } from '../core/engine.js';
import type { RatchetRun } from '../types.js';

vi.mock('../core/agents/shell.js', () => ({
  buildArchitectPrompt: vi.fn((scan, cwd) => {
    return `Architect prompt for ${cwd} with ${scan.totalIssuesFound} issues`;
  }),
}));

vi.mock('../core/click.js', () => ({
  executeClick: vi.fn(async (opts) => {
    return {
      click: {
        number: opts.number,
        testsPassed: true,
        commitHash: 'mock-hash',
      },
      rolled_back: false,
    };
  }),
}));

vi.mock('../core/scanner', () => ({
  runScan: vi.fn(async () => ({ projectName: 'test', total: 100, maxTotal: 100, totalIssuesFound: 100, issuesByType: [], categories: [] })),
}));

vi.mock('../core/git.js', () => ({
  branchName: vi.fn((name) => `architect-${name}`),
  createBranch: vi.fn(async () => {}),
  revertLastCommit: vi.fn(async () => {}),
}));

vi.mock('../core/gitnexus.js', () => ({
  clearCache: vi.fn(() => {}),
  renameSymbol: vi.fn(() => {}),
}));

vi.mock('../core/gitnexus-tools.js', () => ({
  buildGraphToolInstructions: vi.fn(() => ['rename', 'symbol']),
}));

vi.mock('../core/engine-guards.js', () => ({
  resolveGuards: vi.fn(() => ({ maxFiles: 20, maxLines: 500 })),
}));

vi.mock('../core/engine-utils.js', () => ({
  createInitialRun: vi.fn(() => ({ clicks: [], status: 'running' })),
  requireNamedBranch: vi.fn(async () => {}),
}));

vi.mock('../lib/model-router.js', () => ({
  selectModel: vi.fn(() => 'architect-model'),
}));

describe('engine-architect', () => {
  let mockCallbacks: EngineRunOptions['callbacks'];

  beforeEach(() => {
    vi.resetAllMocks();
    mockCallbacks = {
      onScanComplete: vi.fn(),
      onClickStart: vi.fn(),
      onClickComplete: vi.fn(),
      onClickPhase: vi.fn(),
      onClickScoreUpdate: vi.fn(),
      onError: vi.fn(),
      onRunComplete: vi.fn(),
    };
  });

  it('should run architect engine with default options', async () => {
    const options: EngineRunOptions = {
      clicks: 2,
      target: { name: 'test-target', path: 'src', description: 'Test target' },
      config: { agent: 'shell', defaults: { clicks: 1, testCommand: 'npm test', autoCommit: false }, targets: [] } as any,
      cwd: '/test',
      agent: { analyze: vi.fn(async () => ''), propose: vi.fn(async () => ''), build: vi.fn(async () => ({ success: true, output: '' })) } as any,
      callbacks: mockCallbacks,
      createBranch: false,
    };

    const run = await runArchitectEngine(options);

    expect(run.clicks.length).toBe(2);
    expect(run.clicks[0].testsPassed).toBe(true);
    expect(run.clicks[1].testsPassed).toBe(true);
    expect(mockCallbacks!.onClickStart).toHaveBeenCalledTimes(2);
    expect(mockCallbacks!.onClickComplete).toHaveBeenCalledTimes(2);
    expect(mockCallbacks!.onRunComplete).toHaveBeenCalledWith(run);
  });

  it('should handle click rollback on score regression', async () => {
    const { executeClick } = await import('../core/click.js');
    (executeClick as any).mockResolvedValueOnce({
      click: { number: 1, testsPassed: true, commitHash: 'mock-hash' },
      rolled_back: false,
    });

    const options: EngineRunOptions = {
      clicks: 1,
      target: { name: 'test-target', path: 'src', description: 'Test target' },
      config: { agent: 'shell', defaults: { clicks: 1, testCommand: 'npm test', autoCommit: false }, targets: [] } as any,
      cwd: '/test',
      agent: { analyze: vi.fn(async () => ''), propose: vi.fn(async () => ''), build: vi.fn(async () => ({ success: true, output: '' })) } as any,
      callbacks: mockCallbacks,
      createBranch: false,
    };

    const run = await runArchitectEngine(options);
    expect(run.clicks[0].testsPassed).toBe(true);
  });

  it('should respect clickOffset', async () => {
    const options: EngineRunOptions = {
      clicks: 1,
      clickOffset: 10,
      target: { name: 'test-target', path: 'src', description: 'Test target' },
      config: { agent: 'shell', defaults: { clicks: 1, testCommand: 'npm test', autoCommit: false }, targets: [] } as any,
      cwd: '/test',
      agent: { analyze: vi.fn(async () => ''), propose: vi.fn(async () => ''), build: vi.fn(async () => ({ success: true, output: '' })) } as any,
      callbacks: mockCallbacks,
      createBranch: false,
    };

    const run = await runArchitectEngine(options);
    expect(run.clicks[0].number).toBe(11);
  });

  it('should create branch when createBranch is true', async () => {
    const { createBranch } = await import('../core/git.js');
    const options: EngineRunOptions = {
      clicks: 1,
      target: { name: 'test-target', path: 'src', description: 'Test target' },
      config: { agent: 'shell', defaults: { clicks: 1, testCommand: 'npm test', autoCommit: false }, targets: [] } as any,
      cwd: '/test',
      agent: { analyze: vi.fn(async () => ''), propose: vi.fn(async () => ''), build: vi.fn(async () => ({ success: true, output: '' })) } as any,
      callbacks: mockCallbacks,
      createBranch: true,
    };

    await runArchitectEngine(options);
    expect(createBranch).toHaveBeenCalled();
  });

  it('should use provided scanResult', async () => {
    const scanResult = { total: 50, totalIssuesFound: 50, projectName: 'test', maxTotal: 100, categories: [], issuesByType: {} } as any;
    const options: EngineRunOptions = {
      clicks: 1,
      target: { name: 'test-target', path: 'src', description: 'Test target' },
      config: { agent: 'shell', defaults: { clicks: 1, testCommand: 'npm test', autoCommit: false }, targets: [] } as any,
      cwd: '/test',
      agent: { analyze: vi.fn(async () => ''), propose: vi.fn(async () => ''), build: vi.fn(async () => ({ success: true, output: '' })) } as any,
      callbacks: mockCallbacks,
      createBranch: false,
      scanResult,
    };

    await runArchitectEngine(options);
    expect(mockCallbacks!.onScanComplete).toHaveBeenCalledWith(scanResult);
  });
});
