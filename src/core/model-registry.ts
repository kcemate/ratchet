import type { ModelTiers } from '../types.js';

export type TaskType =
  | 'scan'
  | 'fix'
  | 'sweep'
  | 'analyze'
  | 'architect'
  | 'report'
  | 'deep-scan';

export type CapabilityTier = 'cheap' | 'standard' | 'best';

export interface ModelEntry {
  provider: string;
  modelId: string;
  contextWindow?: number;
  costPerMToken?: { input: number; output: number };
}

export interface RegisterConfig extends ModelEntry {
  tier: CapabilityTier;
}

const TASK_TIER: Record<TaskType, CapabilityTier> = {
  scan: 'cheap',
  sweep: 'cheap',
  report: 'cheap',
  analyze: 'standard',
  fix: 'standard',
  'deep-scan': 'standard',
  architect: 'best',
};

/** Default model IDs per provider per tier. undefined = use provider's own default (e.g. Local). */
const DEFAULT_PROVIDER_MODELS: Record<string, Record<CapabilityTier, string | undefined>> = {
  Anthropic: {
    cheap: 'claude-haiku-4-5-20251001',
    standard: 'claude-sonnet-4-6',
    best: 'claude-opus-4-6',
  },
  OpenAI: {
    cheap: 'gpt-4o-mini',
    standard: 'gpt-4o',
    best: 'gpt-4o',
  },
  OpenRouter: {
    cheap: 'anthropic/claude-haiku-4-5-20251001',
    standard: 'anthropic/claude-sonnet-4-6',
    best: 'anthropic/claude-opus-4-6',
  },
  Local: {
    cheap: undefined,
    standard: undefined,
    best: undefined,
  },
  OllamaCloud: {
    cheap: 'nemotron-3-super:cloud',
    standard: 'glm-5.1:cloud',
    best: 'glm-5.1:cloud',
  },
  SI: {
    cheap: 'si-1-mini',
    standard: 'si-1',
    best: 'si-1-pro',
  },
};

function copyProviderModels(
  src: typeof DEFAULT_PROVIDER_MODELS,
): typeof DEFAULT_PROVIDER_MODELS {
  const out: typeof DEFAULT_PROVIDER_MODELS = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = { ...v };
  }
  return out;
}

export class ModelRegistry {
  private taskOverrides = new Map<TaskType, string>();
  private tierOverrides = new Map<CapabilityTier, string>();
  private providerModels: Record<string, Record<CapabilityTier, string | undefined>>;

  constructor() {
    this.providerModels = copyProviderModels(DEFAULT_PROVIDER_MODELS);
  }

  /**
   * Get the model ID for a task type, given an optional provider name.
   *
   * Priority:
   *   1. Per-task override (setModel / YAML models.<task>)
   *   2. Tier override    (setDefault / YAML models.cheap|default|premium)
   *   3. Provider default from built-in table
   *   4. Anthropic fallback
   */
  getModel(task: TaskType, providerName?: string): string {
    const taskOverride = this.taskOverrides.get(task);
    if (taskOverride) return taskOverride;

    const tier = TASK_TIER[task];

    // When a specific provider is requested, check its defaults FIRST
    // to avoid applying an Anthropic model name to a non-Anthropic provider.
    if (providerName) {
      const model = this.providerModels[providerName]?.[tier];
      if (model) return model;
    }

    const tierOverride = this.tierOverrides.get(tier);
    if (tierOverride) return tierOverride;

    return this.providerModels['Anthropic']![tier] ?? 'claude-sonnet-4-6';
  }

  /**
   * Get the model ID for a capability tier directly.
   * Used by the legacy model-router bridge.
   *
   * Priority: tier override → provider default → Anthropic fallback
   */
  getModelForTier(tier: CapabilityTier, providerName?: string): string {
    const tierOverride = this.tierOverrides.get(tier);
    if (tierOverride) return tierOverride;

    if (providerName) {
      const model = this.providerModels[providerName]?.[tier];
      if (model) return model;
    }

    return this.providerModels['Anthropic']![tier] ?? 'claude-sonnet-4-6';
  }

  /**
   * Route a task to ProviderOptions (model override) for a given provider.
   * Returns `{ model }` when a specific model applies, `{}` when the provider
   * should use its own default (e.g. Local, OllamaCloud without a task override).
   */
  routeTask(task: TaskType, provider: { name: string }): { model?: string } {
    const taskOverride = this.taskOverrides.get(task);
    if (taskOverride) return { model: taskOverride };

    const tier = TASK_TIER[task];

    const tierOverride = this.tierOverrides.get(tier);
    if (tierOverride) return { model: tierOverride };

    const providerTiers = this.providerModels[provider.name];
    if (!providerTiers) return {};
    const model = providerTiers[tier];
    return model ? { model } : {};
  }

  /** Hot-swap: set a per-task model override at runtime. */
  setModel(task: TaskType, modelId: string): void {
    this.taskOverrides.set(task, modelId);
  }

  /** Set the default model for a capability tier. */
  setDefault(tier: CapabilityTier, modelId: string): void {
    this.tierOverrides.set(tier, modelId);
  }

  /**
   * Return the explicit tier override if one has been set, undefined otherwise.
   * Used by model-router to distinguish "registry has an override" from "use built-in default".
   */
  getTierOverride(tier: CapabilityTier): string | undefined {
    return this.tierOverrides.get(tier);
  }

  /** Register or update the model ID for a provider+tier combination. */
  registerModel(config: RegisterConfig): void {
    if (!this.providerModels[config.provider]) {
      this.providerModels[config.provider] = { cheap: undefined, standard: undefined, best: undefined };
    }
    this.providerModels[config.provider]![config.tier] = config.modelId;
  }

  /**
   * List all task→model mappings for a given provider.
   * Useful for inspection and debugging.
   */
  listModels(providerName = 'Anthropic'): Array<{ task: TaskType; tier: CapabilityTier; modelId: string }> {
    return (Object.keys(TASK_TIER) as TaskType[]).map((task) => ({
      task,
      tier: TASK_TIER[task],
      modelId: this.getModel(task, providerName),
    }));
  }

  /**
   * Populate registry from .ratchet.yml config.
   *
   * Backward compat:
   *   models.cheap    → tier override for 'cheap'
   *   models.default  → tier override for 'standard'
   *   models.premium  → tier override for 'best'
   *   model           → tier override for 'standard' (single global model)
   *
   * New per-task overrides:
   *   models.scan / models.fix / models.sweep / models.analyze /
   *   models.architect / models.report / models.deep-scan
   */
  applyConfig(models?: ModelTiers, globalModel?: string): void {
    if (!models && !globalModel) return;

    if (models) {
      if (models.cheap) this.setDefault('cheap', models.cheap);
      if (models.default) this.setDefault('standard', models.default);
      if (models.premium) this.setDefault('best', models.premium);

      const taskKeys: TaskType[] = ['scan', 'fix', 'sweep', 'analyze', 'architect', 'report', 'deep-scan'];
      for (const task of taskKeys) {
        const val = (models as Record<string, string | undefined>)[task];
        if (val) this.setModel(task, val);
      }
    }

    // Single global `model:` key → standard tier fallback (only if not already set by models.default)
    if (globalModel && !models?.default) {
      this.setDefault('standard', globalModel);
    }
  }

  /** Reset all overrides and restore built-in defaults. Useful for testing. */
  reset(): void {
    this.taskOverrides.clear();
    this.tierOverrides.clear();
    this.providerModels = copyProviderModels(DEFAULT_PROVIDER_MODELS);
  }
}

/** Singleton registry — import and use this throughout the codebase. */
export const modelRegistry = new ModelRegistry();
