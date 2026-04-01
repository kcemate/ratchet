import type { Provider, ProviderOptions } from './base.js';
import { fetchOpenAICompatible } from './base.js';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// OpenRouter uses Sonnet pricing as default estimate: $3 input / $15 output per million tokens
const INPUT_PRICE_PER_M = 3;
const OUTPUT_PRICE_PER_M = 15;

export class OpenRouterProvider implements Provider {
  readonly name = 'OpenRouter';
  readonly tier = 'pro' as const;

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = DEFAULT_MODEL,
  ) {}

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    return fetchOpenAICompatible(
      API_URL,
      { Authorization: `Bearer ${this.apiKey}` },
      options?.model ?? this.defaultModel,
      prompt,
      'OpenRouter',
      options,
    );
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens * INPUT_PRICE_PER_M + outputTokens * OUTPUT_PRICE_PER_M) / 1_000_000;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }
}
