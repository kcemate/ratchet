import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { modelRegistry } from '../../src/core/model-registry.js';

beforeEach(() => {
  modelRegistry.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Agent routing via modelRegistry + detectProvider ────────────────────────

describe('agent routing — torque createFixAgent logic', () => {
  it('uses ShellAgent when provider is Anthropic (default)', async () => {
    // Default registry has fix → claude-sonnet-4-6 (Anthropic)
    const { detectProvider } = await import('../../src/core/providers/index.js');
    const { ShellAgent } = await import('../../src/core/agents/shell.js');
    const { APIAgent } = await import('../../src/core/agents/api.js');

    const fixModel = modelRegistry.getModel('fix');
    // Simulate env with only ANTHROPIC_API_KEY
    const origEnv = { ...process.env };
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    delete process.env['RATCHET_SI_KEY'];
    delete process.env['OLLAMA_CLOUD_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['RATCHET_PROVIDER'];

    const provider = detectProvider(undefined, fixModel);
    const agent = provider.name === 'Anthropic'
      ? new ShellAgent({ model: fixModel, cwd: '/tmp' })
      : new APIAgent({ provider });

    Object.assign(process.env, origEnv);

    expect(agent).toBeInstanceOf(ShellAgent);
  });

  it('uses APIAgent when provider is non-Anthropic (e.g. OpenAI)', async () => {
    const { detectProvider } = await import('../../src/core/providers/index.js');
    const { ShellAgent } = await import('../../src/core/agents/shell.js');
    const { APIAgent } = await import('../../src/core/agents/api.js');

    // Set a non-Anthropic fix model override
    modelRegistry.setModel('fix', 'gpt-4o');

    const origEnv = { ...process.env };
    delete process.env['RATCHET_SI_KEY'];
    delete process.env['OLLAMA_CLOUD_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['RATCHET_PROVIDER'];
    process.env['OPENAI_API_KEY'] = 'sk-test';

    const fixModel = modelRegistry.getModel('fix');
    const provider = detectProvider(undefined, fixModel);
    const agent = provider.name === 'Anthropic'
      ? new ShellAgent({ model: fixModel, cwd: '/tmp' })
      : new APIAgent({ provider });

    Object.assign(process.env, origEnv);

    expect(agent).toBeInstanceOf(APIAgent);
  });

  it('respects per-task model override from registry', () => {
    modelRegistry.setModel('fix', 'qwen3:14b');
    expect(modelRegistry.getModel('fix')).toBe('qwen3:14b');
  });

  it('falls back to Anthropic sonnet with no env overrides', () => {
    // Default registry, no setModel called
    expect(modelRegistry.getModel('fix')).toBe('claude-sonnet-4-6');
  });
});

// ─── APIAgent issue-driven click support ─────────────────────────────────────

describe('APIAgent issue-driven clicks', () => {
  it('has strategyContext and gitnexusCwd properties', async () => {
    const { APIAgent } = await import('../../src/core/agents/api.js');
    const fakeProvider = {
      name: 'OpenAI',
      tier: 'pro' as const,
      sendMessage: vi.fn().mockResolvedValue('MODIFIED: src/foo.ts'),
      estimateCost: vi.fn().mockReturnValue(0),
      supportsStructuredOutput: vi.fn().mockReturnValue(false),
    };
    const agent = new APIAgent({ provider: fakeProvider });
    // Properties exist
    expect('strategyContext' in agent).toBe(true);
    expect('gitnexusCwd' in agent).toBe(true);
    // Default values
    expect(agent.strategyContext).toBeUndefined();
    expect(agent.gitnexusCwd).toBeUndefined();
    // Can be set
    agent.strategyContext = 'ctx';
    agent.gitnexusCwd = '/repo';
    expect(agent.strategyContext).toBe('ctx');
    expect(agent.gitnexusCwd).toBe('/repo');
  });

  it('passes proposal directly in build() for issue-driven clicks', async () => {
    const { APIAgent } = await import('../../src/core/agents/api.js');
    const sentPrompts: string[] = [];
    const fakeProvider = {
      name: 'OpenAI',
      tier: 'pro' as const,
      sendMessage: vi.fn().mockImplementation(async (prompt: string) => {
        sentPrompts.push(prompt);
        return 'MODIFIED: src/foo.ts';
      }),
      estimateCost: vi.fn().mockReturnValue(0),
      supportsStructuredOutput: vi.fn().mockReturnValue(false),
    };

    const agent = new APIAgent({ provider: fakeProvider });

    // Simulate the analyze/propose/build pipeline with issues
    const issues = [{ id: 'I1', description: 'Fix null check', category: 'safety', severity: 'high' as const, locations: [] }];
    const fakeTarget = { name: 'test', path: '.', description: 'test target' };

    // analyze with issues sets _issueDrivenClick and returns the plan prompt
    const analysis = await agent.analyze('context', undefined, issues);
    expect(typeof analysis).toBe('string');
    expect(analysis.length).toBeGreaterThan(0);

    // propose with issues returns analysis as-is (no LLM call)
    const callsBefore = sentPrompts.length;
    const proposal = await agent.propose(analysis, fakeTarget, undefined, issues);
    expect(proposal).toBe(analysis); // passthrough
    expect(sentPrompts.length).toBe(callsBefore); // no new sendMessage call

    // build sends proposal directly (not wrapped in buildBuildPrompt)
    const result = await agent.build(proposal, '/tmp');
    expect(result.success).toBe(true);
    expect(result.filesModified).toContain('src/foo.ts');
    // The last sent prompt should contain the proposal (now wrapped with API build instructions)
    expect(sentPrompts[sentPrompts.length - 1]).toContain(proposal);
  });

  it('wraps proposal in build() for non-issue clicks', async () => {
    const { APIAgent } = await import('../../src/core/agents/api.js');
    const sentPrompts: string[] = [];
    const fakeProvider = {
      name: 'OpenAI',
      tier: 'pro' as const,
      sendMessage: vi.fn().mockImplementation(async (prompt: string) => {
        sentPrompts.push(prompt);
        return 'MODIFIED: src/bar.ts';
      }),
      estimateCost: vi.fn().mockReturnValue(0),
      supportsStructuredOutput: vi.fn().mockReturnValue(false),
    };

    const agent = new APIAgent({ provider: fakeProvider });
    const fakeTarget = { name: 'test', path: '.', description: 'test target' };

    // Normal pipeline (no issues)
    await agent.analyze('context');
    const analysis = sentPrompts[0];
    expect(analysis).toBeTruthy();

    await agent.propose(analysis, fakeTarget);
    const result = await agent.build('my-proposal', '/tmp');
    expect(result.success).toBe(true);
    // The prompt sent to build should wrap proposal in buildBuildPrompt instructions
    const buildPrompt = sentPrompts[sentPrompts.length - 1];
    expect(buildPrompt).toContain('my-proposal');
    expect(buildPrompt).toContain('Make ONLY the described change');
  });
});
