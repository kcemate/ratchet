import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRegistry, modelRegistry } from '../core/model-registry.js';
import type { TaskType, CapabilityTier } from '../core/model-registry.js';

// Reset the singleton before each test to avoid cross-test pollution
beforeEach(() => {
  modelRegistry.reset();
});

// ─── getModel ───────────────────────────────────────────────────────────────

describe('ModelRegistry.getModel', () => {
  it('returns Anthropic cheap model for scan by default', () => {
    expect(modelRegistry.getModel('scan')).toBe('claude-haiku-4-5-20251001');
  });

  it('returns Anthropic standard model for fix by default', () => {
    expect(modelRegistry.getModel('fix')).toBe('claude-sonnet-4-6');
  });

  it('returns Anthropic best model for architect by default', () => {
    expect(modelRegistry.getModel('architect')).toBe('claude-opus-4-6');
  });

  it('uses provider-specific model when providerName is given', () => {
    expect(modelRegistry.getModel('sweep', 'OpenAI')).toBe('gpt-4o-mini');
    expect(modelRegistry.getModel('analyze', 'OpenAI')).toBe('gpt-4o');
  });

  it('returns Anthropic fallback when provider is unknown', () => {
    expect(modelRegistry.getModel('fix', 'UnknownProvider')).toBe('claude-sonnet-4-6');
  });

  it('per-task override beats everything', () => {
    modelRegistry.setModel('scan', 'kimi-k2:1t');
    expect(modelRegistry.getModel('scan', 'Anthropic')).toBe('kimi-k2:1t');
    expect(modelRegistry.getModel('scan', 'OpenAI')).toBe('kimi-k2:1t');
  });

  it('tier override beats provider default when no provider specified', () => {
    modelRegistry.setDefault('cheap', 'my-cheap-model');
    // With provider specified, provider-specific model takes priority
    expect(modelRegistry.getModel('sweep', 'OpenAI')).toBe('gpt-4o-mini');
    // Without provider, tier override wins
    expect(modelRegistry.getModel('sweep')).toBe('my-cheap-model');
  });

  it('per-task override beats tier override', () => {
    modelRegistry.setDefault('cheap', 'tier-override');
    modelRegistry.setModel('scan', 'task-override');
    expect(modelRegistry.getModel('scan')).toBe('task-override');
    expect(modelRegistry.getModel('sweep')).toBe('tier-override');
  });
});

// ─── getModelForTier ────────────────────────────────────────────────────────

describe('ModelRegistry.getModelForTier', () => {
  it('returns Anthropic model for each tier by default', () => {
    expect(modelRegistry.getModelForTier('cheap')).toBe('claude-haiku-4-5-20251001');
    expect(modelRegistry.getModelForTier('standard')).toBe('claude-sonnet-4-6');
    expect(modelRegistry.getModelForTier('best')).toBe('claude-opus-4-6');
  });

  it('returns provider-specific model when given', () => {
    expect(modelRegistry.getModelForTier('cheap', 'OpenAI')).toBe('gpt-4o-mini');
    expect(modelRegistry.getModelForTier('standard', 'SI')).toBe('si-1');
  });

  it('respects tier override', () => {
    modelRegistry.setDefault('standard', 'my-standard');
    expect(modelRegistry.getModelForTier('standard')).toBe('my-standard');
  });
});

// ─── routeTask ──────────────────────────────────────────────────────────────

describe('ModelRegistry.routeTask', () => {
  const anthropic = { name: 'Anthropic' };
  const local = { name: 'Local' };
  const openai = { name: 'OpenAI' };
  const unknown = { name: 'Unknown' };

  it('returns { model } for known providers', () => {
    expect(modelRegistry.routeTask('sweep', anthropic)).toEqual({ model: 'claude-haiku-4-5-20251001' });
    expect(modelRegistry.routeTask('architect', anthropic)).toEqual({ model: 'claude-opus-4-6' });
    expect(modelRegistry.routeTask('fix', openai)).toEqual({ model: 'gpt-4o' });
  });

  it('returns {} for Local provider (no model override)', () => {
    expect(modelRegistry.routeTask('fix', local)).toEqual({});
  });

  it('returns {} for unknown provider', () => {
    expect(modelRegistry.routeTask('analyze', unknown)).toEqual({});
  });

  it('applies per-task override even for Local', () => {
    modelRegistry.setModel('fix', 'custom-model');
    expect(modelRegistry.routeTask('fix', local)).toEqual({ model: 'custom-model' });
  });

  it('applies tier override', () => {
    modelRegistry.setDefault('cheap', 'haiku-custom');
    expect(modelRegistry.routeTask('sweep', anthropic)).toEqual({ model: 'haiku-custom' });
  });
});

// ─── setModel (hot-swap) ─────────────────────────────────────────────────────

describe('ModelRegistry.setModel', () => {
  it('overrides a single task', () => {
    modelRegistry.setModel('scan', 'kimi-k2:1t');
    expect(modelRegistry.getModel('scan')).toBe('kimi-k2:1t');
    expect(modelRegistry.getModel('sweep')).toBe('claude-haiku-4-5-20251001'); // unaffected
  });

  it('can be called multiple times to update', () => {
    modelRegistry.setModel('architect', 'model-v1');
    modelRegistry.setModel('architect', 'model-v2');
    expect(modelRegistry.getModel('architect')).toBe('model-v2');
  });
});

// ─── registerModel ───────────────────────────────────────────────────────────

describe('ModelRegistry.registerModel', () => {
  it('registers a new provider and tier', () => {
    modelRegistry.registerModel({ provider: 'MyProvider', tier: 'standard', modelId: 'my-std-model' });
    expect(modelRegistry.getModel('fix', 'MyProvider')).toBe('my-std-model');
  });

  it('updates an existing provider tier', () => {
    modelRegistry.registerModel({ provider: 'OpenAI', tier: 'cheap', modelId: 'gpt-4o-nano' });
    expect(modelRegistry.getModel('scan', 'OpenAI')).toBe('gpt-4o-nano');
  });
});

// ─── listModels ──────────────────────────────────────────────────────────────

describe('ModelRegistry.listModels', () => {
  it('returns an entry for every TaskType', () => {
    const expected: TaskType[] = ['scan', 'fix', 'sweep', 'analyze', 'architect', 'report', 'deep-scan'];
    const result = modelRegistry.listModels('Anthropic');
    expect(result.map((r) => r.task).sort()).toEqual(expected.sort());
  });

  it('each entry has task, tier, and modelId', () => {
    const result = modelRegistry.listModels();
    for (const entry of result) {
      expect(entry.task).toBeTruthy();
      expect(entry.tier).toMatch(/^(cheap|standard|best)$/);
      expect(entry.modelId).toBeTruthy();
    }
  });

  it('architect maps to best tier', () => {
    const result = modelRegistry.listModels();
    const arch = result.find((r) => r.task === 'architect');
    expect(arch?.tier).toBe('best');
    expect(arch?.modelId).toBe('claude-opus-4-6');
  });
});

// ─── applyConfig ─────────────────────────────────────────────────────────────

describe('ModelRegistry.applyConfig', () => {
  it('applies tier overrides from models.cheap/default/premium', () => {
    modelRegistry.applyConfig({ cheap: 'haiku-custom', default: 'sonnet-custom', premium: 'opus-custom' });
    expect(modelRegistry.getModel('scan')).toBe('haiku-custom');
    expect(modelRegistry.getModel('fix')).toBe('sonnet-custom');
    expect(modelRegistry.getModel('architect')).toBe('opus-custom');
  });

  it('applies per-task overrides', () => {
    modelRegistry.applyConfig({ fix: 'my-fix-model', architect: 'my-arch-model' });
    expect(modelRegistry.getModel('fix')).toBe('my-fix-model');
    expect(modelRegistry.getModel('architect')).toBe('my-arch-model');
    expect(modelRegistry.getModel('scan')).toBe('claude-haiku-4-5-20251001'); // unaffected
  });

  it('per-task override beats tier override from same applyConfig call', () => {
    modelRegistry.applyConfig({ cheap: 'tier-cheap', scan: 'task-scan' });
    expect(modelRegistry.getModel('scan')).toBe('task-scan');
    expect(modelRegistry.getModel('sweep')).toBe('tier-cheap');
  });

  it('globalModel sets standard tier when models.default is absent', () => {
    modelRegistry.applyConfig(undefined, 'global-sonnet');
    expect(modelRegistry.getModel('fix')).toBe('global-sonnet');
    expect(modelRegistry.getModel('architect')).toBe('claude-opus-4-6'); // unaffected
  });

  it('globalModel does NOT override models.default when both are set', () => {
    modelRegistry.applyConfig({ default: 'explicit-default' }, 'global-sonnet');
    expect(modelRegistry.getModel('fix')).toBe('explicit-default');
  });

  it('is a no-op when called with no arguments', () => {
    modelRegistry.applyConfig(undefined, undefined);
    expect(modelRegistry.getModel('scan')).toBe('claude-haiku-4-5-20251001');
  });

  it('handles deep-scan task key', () => {
    modelRegistry.applyConfig({ 'deep-scan': 'deep-model' });
    expect(modelRegistry.getModel('deep-scan')).toBe('deep-model');
  });
});

// ─── reset ───────────────────────────────────────────────────────────────────

describe('ModelRegistry.reset', () => {
  it('clears all overrides and restores built-in defaults', () => {
    modelRegistry.setModel('scan', 'override');
    modelRegistry.setDefault('cheap', 'tier-override');
    modelRegistry.reset();
    expect(modelRegistry.getModel('scan')).toBe('claude-haiku-4-5-20251001');
    expect(modelRegistry.getModelForTier('cheap')).toBe('claude-haiku-4-5-20251001');
  });
});

// ─── independent instance ────────────────────────────────────────────────────

describe('new ModelRegistry()', () => {
  it('creates an independent instance separate from the singleton', () => {
    const registry = new ModelRegistry();
    registry.setModel('scan', 'independent-model');
    expect(registry.getModel('scan')).toBe('independent-model');
    expect(modelRegistry.getModel('scan')).toBe('claude-haiku-4-5-20251001');
  });
});

// ─── provider table — SI and OpenRouter ──────────────────────────────────────

describe('SI and OpenRouter provider defaults', () => {
  it('SI has correct tier models', () => {
    expect(modelRegistry.getModel('scan', 'SI')).toBe('si-1-mini');
    expect(modelRegistry.getModel('fix', 'SI')).toBe('si-1');
    expect(modelRegistry.getModel('architect', 'SI')).toBe('si-1-pro');
  });

  it('OpenRouter has correct tier models', () => {
    expect(modelRegistry.getModel('sweep', 'OpenRouter')).toBe('anthropic/claude-haiku-4-5-20251001');
    expect(modelRegistry.getModel('analyze', 'OpenRouter')).toBe('anthropic/claude-sonnet-4-6');
    expect(modelRegistry.getModel('architect', 'OpenRouter')).toBe('anthropic/claude-opus-4-6');
  });
});

// ─── BYOK: user provides own key + model ─────────────────────────────────────

describe('BYOK — user-provided model via setModel', () => {
  it('a custom model set for a task works for any provider', () => {
    modelRegistry.setModel('fix', 'my-byok-model');
    expect(modelRegistry.getModel('fix', 'Anthropic')).toBe('my-byok-model');
    expect(modelRegistry.getModel('fix', 'OpenAI')).toBe('my-byok-model');
    expect(modelRegistry.getModel('fix', 'Local')).toBe('my-byok-model');
  });
});
