import type { RatchetConfig } from '../types.js';
import { modelRegistry } from '../core/model-registry.js';
import type { CapabilityTier } from '../core/model-registry.js';

export type TaskType = 'mechanical' | 'standard' | 'complex';

/** Original short-form defaults preserved for backward compatibility. */
const DEFAULTS: Record<TaskType, string> = {
  mechanical: 'claude-haiku',
  standard:   'claude-sonnet',
  complex:    'claude-opus',
};

const TIER_MAP: Record<TaskType, CapabilityTier> = {
  mechanical: 'cheap',
  standard: 'standard',
  complex: 'best',
};

/**
 * Select the appropriate model for a given task type.
 *
 * Priority order:
 *   1. config.models.cheap / .default / .premium (explicit per-tier overrides)
 *   2. config.model (single global model, used as standard fallback)
 *   3. ModelRegistry tier overrides (set via loadConfig or setDefault at runtime)
 *   4. Built-in defaults: haiku / sonnet / opus
 */
export function selectModel(taskType: TaskType, config?: RatchetConfig): string {
  const tiers = config?.models;
  const tier = TIER_MAP[taskType];

  // 1. Direct config overrides (backward compat for callers passing config directly)
  if (tier === 'cheap' && tiers?.cheap) return tiers.cheap;
  if (tier === 'standard' && tiers?.default) return tiers.default;
  if (tier === 'best' && tiers?.premium) return tiers.premium;
  if (tier === 'standard' && config?.model) return config.model;

  // 2. Registry tier override (populated from loadConfig)
  const registryOverride = modelRegistry.getTierOverride(tier);
  if (registryOverride) return registryOverride;

  // 3. Original short-form defaults (backward compat)
  return DEFAULTS[taskType];
}
