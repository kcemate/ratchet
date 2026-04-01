export type { Provider, ProviderOptions, ProviderType, ProviderConfig } from './base.js';
export { OpenRouterProvider } from './openrouter.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { LocalMLXProvider, LOCAL_MLX_DEFAULT_PORT } from './local.js';
export { SIProvider } from './si.js';
export { OllamaCloudProvider } from './ollama-cloud.js';
export { routeTask } from './router.js';
export type { TaskType } from './router.js';

import type { Provider, ProviderConfig } from './base.js';
import { OpenRouterProvider } from './openrouter.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { LocalMLXProvider, LOCAL_MLX_DEFAULT_PORT } from './local.js';
import { SIProvider } from './si.js';
import { OllamaCloudProvider } from './ollama-cloud.js';

/**
 * Create a provider from an explicit config object.
 */
export function createProvider(config: ProviderConfig): Provider {
  switch (config.provider) {
    case 'si':
      return new SIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config.apiKey ?? '', config.model);
    case 'openai':
      return new OpenAIProvider(config.apiKey ?? '', config.model);
    case 'openrouter':
      return new OpenRouterProvider(config.apiKey ?? '', config.model);
    case 'ollama-cloud':
      return new OllamaCloudProvider(config);
    case 'local': {
      const port = config.baseUrl
        ? parseInt(new URL(config.baseUrl).port, 10) || LOCAL_MLX_DEFAULT_PORT
        : LOCAL_MLX_DEFAULT_PORT;
      return new LocalMLXProvider(port, config.model);
    }
  }
}

/**
 * Auto-detect which provider to use.
 *
 * Resolution order:
 *   1. Explicit config.provider (if passed)
 *   2. RATCHET_PROVIDER env var
 *   3. SI (RATCHET_SI_KEY)
 *   4. Anthropic (ANTHROPIC_API_KEY)
 *   5. OpenAI (OPENAI_API_KEY)
 *   6. OpenRouter (OPENROUTER_API_KEY)
 *   7. Local (RATCHET_LOCAL_URL or localhost:11434)
 *
 * @param config  Optional explicit provider config.
 * @param modelOverride  Optional model string that overrides config/env model selection.
 *   Useful when creating a dedicated scan provider with a different model than the fix provider.
 */
export function detectProvider(config?: ProviderConfig, modelOverride?: string): Provider {
  const model = modelOverride ?? process.env['RATCHET_MODEL'];

  // 1. Explicit config
  if (config?.provider) return createProvider({ ...config, model: modelOverride ?? config.model });

  // 2. RATCHET_PROVIDER env var
  const envProvider = process.env['RATCHET_PROVIDER'];
  if (envProvider) {
    return createProvider({
      provider: envProvider as ProviderConfig['provider'],
      apiKey:
        process.env['RATCHET_SI_KEY'] ??
        process.env['ANTHROPIC_API_KEY'] ??
        process.env['OPENAI_API_KEY'] ??
        process.env['OPENROUTER_API_KEY'],
      model,
    });
  }

  // 3. SI
  const siKey = process.env['RATCHET_SI_KEY'];
  if (siKey) return new SIProvider({ provider: 'si', apiKey: siKey, model });

  // 3.5. Ollama Cloud (Kimi K2, GLM-5, etc.)
  const ollamaCloudKey = process.env['OLLAMA_CLOUD_API_KEY'];
  if (ollamaCloudKey) return new OllamaCloudProvider({ provider: 'ollama-cloud', apiKey: ollamaCloudKey, model });

  // 4. Anthropic
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicKey) return new AnthropicProvider(anthropicKey, model);

  // 5. OpenAI
  const openaiKey = process.env['OPENAI_API_KEY'];
  if (openaiKey) return new OpenAIProvider(openaiKey, model);

  // 6. OpenRouter
  const openrouterKey = process.env['OPENROUTER_API_KEY'];
  if (openrouterKey) return new OpenRouterProvider(openrouterKey, model);

  // 7. Local
  const localUrl = process.env['RATCHET_LOCAL_URL'] ?? 'http://localhost:11434';
  const port = parseInt(new URL(localUrl).port, 10) || 11434;
  return new LocalMLXProvider(port, model);
}

/** Return the per-million-token pricing for a provider. */
export function getProviderPricing(provider: Provider): { inputPerMToken: number; outputPerMToken: number } {
  // Back-calculate from estimateCost using 1M tokens each
  const inputCostFor1M = provider.estimateCost(1_000_000, 0);
  const outputCostFor1M = provider.estimateCost(0, 1_000_000);
  return { inputPerMToken: inputCostFor1M, outputPerMToken: outputCostFor1M };
}
