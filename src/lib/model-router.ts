import type { RatchetConfig } from '../types.js';

export type TaskType = 'mechanical' | 'standard' | 'complex';

/** Default model names used when no config override is present. */
const DEFAULTS: Record<TaskType, string> = {
  mechanical: 'claude-haiku',
  standard:   'claude-sonnet',
  complex:    'claude-opus',
};

/**
 * Select the appropriate model for a given task type.
 *
 * Priority order:
 *   1. config.models.cheap / .default / .premium (explicit per-tier overrides)
 *   2. config.model (single global model, used as standard fallback)
 *   3. Built-in defaults: haiku / sonnet / opus
 */
export function selectModel(taskType: TaskType, config?: RatchetConfig): string {
  const tiers = config?.models;
  switch (taskType) {
    case 'mechanical':
      return tiers?.cheap ?? DEFAULTS.mechanical;
    case 'standard':
      return tiers?.default ?? config?.model ?? DEFAULTS.standard;
    case 'complex':
      return tiers?.premium ?? DEFAULTS.complex;
  }
}
