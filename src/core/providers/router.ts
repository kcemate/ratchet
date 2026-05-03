import type { Provider, ProviderOptions } from "./base.js";
import { modelRegistry } from "../model-registry.js";
export type { TaskType } from "../model-registry.js";

/**
 * Route a task type to the appropriate ProviderOptions (model override).
 *
 * Delegates to the global ModelRegistry, which is pre-populated from
 * .ratchet.yml at startup and supports hot-swap via modelRegistry.setModel().
 *
 * - scan/sweep/report  → cheap tier
 * - analyze/fix/deep-scan → standard tier
 * - architect          → best tier
 */
export function routeTask(taskType: import("../model-registry.js").TaskType, provider: Provider): ProviderOptions {
  return modelRegistry.routeTask(taskType, provider);
}
