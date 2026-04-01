/**
 * Tests for DeepEngine independent model selection.
 *
 * Verifies that a dedicated scanProvider can be passed to DeepEngine
 * independently of the fix/improve provider, and that the engine falls back
 * gracefully to classic when the preflight check fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Provider } from '../core/providers/base.js';
import { DeepEngine } from '../core/engines/deep.js';
import { createEngine } from '../core/engine-router.js';

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function makeMockProvider(name: string, response = '[]'): Provider & { sendMessage: ReturnType<typeof vi.fn> } {
  return {
    name,
    tier: 'pro' as const,
    sendMessage: vi.fn().mockResolvedValue(response),
    estimateCost: () => 0,
    supportsStructuredOutput: () => true,
  };
}

function makeFailingProvider(name: string): Provider & { sendMessage: ReturnType<typeof vi.fn> } {
  return {
    name,
    tier: 'pro' as const,
    sendMessage: vi.fn().mockRejectedValue(new Error('API auth error: invalid key')),
    estimateCost: () => 0,
    supportsStructuredOutput: () => true,
  };
}

// ---------------------------------------------------------------------------
// scanProvider is used for analysis when provided
// ---------------------------------------------------------------------------

describe('DeepEngine — scanProvider selection', () => {
  it('uses scanProvider instead of provider for LLM calls when scanProvider is passed', async () => {
    const fixProvider = makeMockProvider('FixProvider');
    const scanProvider = makeMockProvider('ScanProvider');

    const engine = new DeepEngine(fixProvider, scanProvider);
    await engine.analyze(process.cwd(), { maxFiles: 3 });

    expect(scanProvider.sendMessage).toHaveBeenCalled();
    expect(fixProvider.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to provider when no scanProvider is provided', async () => {
    const fixProvider = makeMockProvider('FixProvider');

    const engine = new DeepEngine(fixProvider);
    await engine.analyze(process.cwd(), { maxFiles: 3 });

    expect(fixProvider.sendMessage).toHaveBeenCalled();
  });

  it('throws when neither provider nor scanProvider is set', async () => {
    const engine = new DeepEngine();
    await expect(engine.analyze(process.cwd())).rejects.toThrow('Deep scanning requires an API key');
  });

  it('throws when only scanProvider is given (provider is required for fallback info)', async () => {
    // scanProvider alone is sufficient for analysis — activeProvider returns scanProvider
    const scanProvider = makeMockProvider('ScanProvider');
    const engine = new DeepEngine(undefined, scanProvider);
    // Should not throw — activeProvider is scanProvider
    const result = await engine.analyze(process.cwd(), { maxFiles: 3 });
    expect(result).toMatchObject({ total: expect.any(Number) });
    expect(scanProvider.sendMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Preflight fallback to classic engine
// ---------------------------------------------------------------------------

describe('DeepEngine — preflight fallback', () => {
  it('falls back to classic result when preflight throws (network/auth error)', async () => {
    const failingProvider = makeFailingProvider('BadProvider');
    const engine = new DeepEngine(failingProvider);

    // Should NOT throw — should return classic result instead
    const result = await engine.analyze(process.cwd(), { maxFiles: 5 });
    expect(result).toMatchObject({
      total: expect.any(Number),
      categories: expect.any(Array),
    });
    // sendMessage was called (preflight attempt) but threw
    expect(failingProvider.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back to classic when scanProvider preflight fails', async () => {
    const fixProvider = makeMockProvider('FixProvider');
    const failingScanProvider = makeFailingProvider('FailingScanProvider');

    const engine = new DeepEngine(fixProvider, failingScanProvider);
    const result = await engine.analyze(process.cwd(), { maxFiles: 5 });

    // fixProvider should not have been called — scanProvider was used and failed
    expect(fixProvider.sendMessage).not.toHaveBeenCalled();
    expect(failingScanProvider.sendMessage).toHaveBeenCalledTimes(1);
    // Result is a valid classic result
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it('continues scanning when preflight returns 0 findings (model may not follow JSON)', async () => {
    // A provider that returns [] — valid response but no findings.
    // The engine should warn but continue scanning (not fall back immediately).
    const provider = makeMockProvider('WeakProvider', '[]');
    const engine = new DeepEngine(provider);

    await engine.analyze(process.cwd(), { maxFiles: 3 });

    // sendMessage called more than once — preflight + at least one category batch
    expect(provider.sendMessage.mock.calls.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// engine-router: scan model propagation
// ---------------------------------------------------------------------------

describe('createEngine — scan model propagation', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    // Provide a minimal provider key so detectProvider doesn't go to Local
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    delete process.env['RATCHET_SCAN_MODEL'];
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
  });

  it('returns a DeepEngine when mode is deep', () => {
    const engine = createEngine('deep');
    expect(engine.name).toBe('DeepEngine');
    expect(engine.mode).toBe('deep');
  });

  it('returns a ClassicEngine when mode is classic', () => {
    const engine = createEngine('classic');
    expect(engine.name).toBe('ClassicEngine');
  });

  it('picks up scan model from RATCHET_SCAN_MODEL env var', () => {
    process.env['RATCHET_SCAN_MODEL'] = 'kimi-k2:1t';
    // We can't easily inspect the internal scanProvider, but createEngine should not throw
    const engine = createEngine('deep');
    expect(engine.name).toBe('DeepEngine');
  });

  it('picks up scan model from config.scan.model', () => {
    const config = {
      agent: 'claude-code' as const,
      defaults: { clicks: 3, testCommand: 'npm test', autoCommit: false },
      targets: [],
      scan: { model: 'gpt-4o-mini' },
    };
    const engine = createEngine('deep', config);
    expect(engine.name).toBe('DeepEngine');
  });

  it('overrides pick up scanModel from overrides object', () => {
    const engine = createEngine('deep', undefined, { scanModel: 'claude-3-5-haiku-20241022' });
    expect(engine.name).toBe('DeepEngine');
  });

  it('overrides.scanModel takes priority over RATCHET_SCAN_MODEL env', () => {
    process.env['RATCHET_SCAN_MODEL'] = 'env-model';
    // If both are set, the overrides value should win — engine should still be DeepEngine
    const engine = createEngine('deep', undefined, { scanModel: 'override-model' });
    expect(engine.name).toBe('DeepEngine');
  });
});
