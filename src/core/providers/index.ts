export type { Provider, ProviderOptions, ProviderType } from './base.js';
export { OpenRouterProvider } from './openrouter.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { LocalMLXProvider, LOCAL_MLX_DEFAULT_PORT } from './local.js';

import type { Provider } from './base.js';
import { OpenRouterProvider } from './openrouter.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

/**
 * Auto-detect which provider to use based on environment variables.
 * Priority: OpenRouter > Anthropic > OpenAI
 */
export function detectProvider(): Provider {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (openrouterKey) return new OpenRouterProvider(openrouterKey);
  if (anthropicKey) return new AnthropicProvider(anthropicKey);
  if (openaiKey) return new OpenAIProvider(openaiKey);

  throw new Error(
    'No AI provider API key found. Set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.',
  );
}
