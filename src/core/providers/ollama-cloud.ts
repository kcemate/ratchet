import type { Provider, ProviderOptions, ProviderConfig } from './base.js';
import { fetchOpenAICompatible } from './base.js';

const OLLAMA_CLOUD_BASE = 'https://ollama.com/v1';

/**
 * Ollama Cloud provider — routes to cloud-hosted models (Kimi K2, GLM-5, etc.)
 * via OpenAI-compatible API at ollama.com/v1.
 */
export class OllamaCloudProvider implements Provider {
  readonly name = 'OllamaCloud';
  readonly tier = 'pro' as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? process.env['OLLAMA_CLOUD_API_KEY'] ?? '';
    this.model = config.model ?? 'mistral-large-3:675b';
    this.baseUrl = config.baseUrl ?? OLLAMA_CLOUD_BASE;
    if (!this.apiKey) {
      throw new Error('OllamaCloud requires an API key. Set OLLAMA_CLOUD_API_KEY or pass apiKey in config.');
    }
  }

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    const model = options?.model ?? this.model;
    return fetchOpenAICompatible(
      `${this.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      model,
      prompt,
      `OllamaCloud/${model}`,
      options,
    );
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    // Ollama Cloud flat-rate subscription — marginal cost is ~$0
    // Return nominal cost for budget tracking purposes
    return (inputTokens * 0.50 + outputTokens * 1.50) / 1_000_000;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }
}
