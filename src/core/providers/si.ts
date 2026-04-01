// SI Provider — future superintelligent AI integration
// This provider follows OpenAI-compatible API format.
// When SI launches, update baseUrl and model — everything else stays the same.

import type { Provider, ProviderOptions, ProviderConfig } from './base.js';
import { fetchOpenAICompatible } from './base.js';

const DEFAULT_MODEL = 'si-1';
const DEFAULT_BASE_URL = 'https://api.si-provider.com/v1';

// SI pricing (placeholder): $10 input / $30 output per million tokens
const INPUT_PRICE_PER_M = 10;
const OUTPUT_PRICE_PER_M = 30;

export class SIProvider implements Provider {
  readonly name = 'SI';
  readonly tier = 'enterprise' as const;

  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(private readonly config: ProviderConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultModel = config.model ?? DEFAULT_MODEL;
  }

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {};
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;

    return fetchOpenAICompatible(
      url,
      headers,
      options?.model ?? this.defaultModel,
      prompt,
      'SI',
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
