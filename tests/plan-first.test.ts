import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { runEngine } from '../src/core/engine.js';
import type { Agent } from '../src/core/agents/base.js';
import type { BuildResult, RatchetConfig, Target } from '../src/types.js';

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@ratchet.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Ratchet Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
}

function makeConfig(): RatchetConfig {
  return {
    agent: 'shell',
    defaults: { clicks: 1, testCommand: 'node --version', autoCommit: false },
    targets: [],
  };
}

function makeTarget(): Target {
  return { name: 'test-target', path: 'src/', description: 'Test target' };
}

const VALID_PLAN_JSON = JSON.stringify({
  filesToTouch: ['src/foo.ts', 'src/bar.ts'],
  extractionTargets: [{ name: 'utils', files: ['src/foo.ts'], pattern: 'duplicated helper' }],
  dependencyOrder: ['src/foo.ts', 'src/bar.ts'],
  estimatedClicks: 2,
});

function makeAgentWithPlan(planJson = VALID_PLAN_JSON): Agent & { runDirect: ReturnType<typeof vi.fn> } {
  return {
    analyze: vi.fn().mockResolvedValue('analysis'),
    propose: vi.fn().mockResolvedValue('proposal'),
    build: vi.fn().mockResolvedValue({ success: true, output: 'ok', filesModified: [] } satisfies BuildResult),
    runDirect: vi.fn().mockResolvedValue(planJson),
  };
}

describe('plan-first (click 0)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-plan-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('calls runDirect with plan prompt when planFirst=true', async () => {
    const agent = makeAgentWithPlan();
    await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: true,
    });
    expect(agent.runDirect).toHaveBeenCalledOnce();
    const [prompt, cwd] = agent.runDirect.mock.calls[0] as [string, string];
    expect(prompt).toContain('Output ONLY valid JSON');
    expect(prompt).toContain('filesToTouch');
    expect(cwd).toBe(dir);
  });

  it('does NOT call runDirect when planFirst=false', async () => {
    const agent = makeAgentWithPlan();
    await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: false,
    });
    expect(agent.runDirect).not.toHaveBeenCalled();
  });

  it('stores planResult on run when plan JSON is valid', async () => {
    const agent = makeAgentWithPlan();
    const run = await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: true,
    });
    expect(run.planResult).toBeDefined();
    expect(run.planResult!.filesToTouch).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(run.planResult!.estimatedClicks).toBe(2);
    expect(run.planResult!.generatedAt).toBeInstanceOf(Date);
  });

  it('saves plan to .ratchet/plans/<timestamp>-<target>.json', async () => {
    const agent = makeAgentWithPlan();
    await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: true,
    });
    const plansDir = join(dir, '.ratchet', 'plans');
    expect(existsSync(plansDir)).toBe(true);
    const files = require('fs').readdirSync(plansDir) as string[];
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d+-test-target\.json$/);
    const content = JSON.parse(readFileSync(join(plansDir, files[0]), 'utf-8')) as { filesToTouch: string[] };
    expect(content.filesToTouch).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('passes plan context to execution clicks via agent context', async () => {
    const agent = makeAgentWithPlan();
    await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: true,
    });
    // analyze() is called for execution clicks — verify plan context is in the context arg
    expect(agent.analyze).toHaveBeenCalled();
    const analyzeContext = (agent.analyze as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(analyzeContext).toContain('## Execution Plan');
    expect(analyzeContext).toContain('filesToTouch');
  });

  it('fires onPlanStart and onPlanComplete callbacks', async () => {
    const agent = makeAgentWithPlan();
    const onPlanStart = vi.fn();
    const onPlanComplete = vi.fn();
    await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: true,
      callbacks: { onPlanStart, onPlanComplete },
    });
    expect(onPlanStart).toHaveBeenCalledOnce();
    expect(onPlanComplete).toHaveBeenCalledOnce();
    const plan = onPlanComplete.mock.calls[0][0];
    expect(plan.filesToTouch).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('continues without plan if runDirect returns no JSON', async () => {
    const agent = makeAgentWithPlan('no json here');
    const run = await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: true,
    });
    expect(run.planResult).toBeUndefined();
    // Execution clicks still ran
    expect(run.clicks.length).toBe(1);
  });

  it('continues without plan if runDirect throws', async () => {
    const agent = makeAgentWithPlan();
    (agent.runDirect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('agent error'));
    const run = await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: true,
    });
    expect(run.planResult).toBeUndefined();
    expect(run.clicks.length).toBe(1);
  });

  it('does not store planResult when planFirst=false', async () => {
    const agent = makeAgentWithPlan();
    const run = await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: false,
    });
    expect(run.planResult).toBeUndefined();
  });

  it('plan context is NOT in analyze context when planFirst=false', async () => {
    const agent = makeAgentWithPlan();
    await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: false,
    });
    expect(agent.analyze).toHaveBeenCalled();
    const analyzeContext = (agent.analyze as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(analyzeContext).not.toContain('## Execution Plan');
  });

  it('extracts JSON from plan output wrapped in markdown code fence', async () => {
    const wrappedJson = `Here is the plan:\n\`\`\`json\n${VALID_PLAN_JSON}\n\`\`\`\n`;
    const agent = makeAgentWithPlan(wrappedJson);
    const run = await runEngine({
      target: makeTarget(),
      clicks: 1,
      config: makeConfig(),
      cwd: dir,
      agent,
      createBranch: false,
      planFirst: true,
    });
    expect(run.planResult).toBeDefined();
    expect(run.planResult!.estimatedClicks).toBe(2);
  });
});
