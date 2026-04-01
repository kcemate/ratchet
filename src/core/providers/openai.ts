import type { Provider, ProviderOptions } from './base.js';
import { fetchOpenAICompatible } from './base.js';

const DEFAULT_MODEL = 'gpt-4.1';
const API_URL = 'https://api.openai.com/v1/chat/completions';

// GPT-4o pricing: $2.50 input / $10 output per million tokens
const INPUT_PRICE_PER_M = 2.5;
const OUTPUT_PRICE_PER_M = 10;

export interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

export class OpenAIProvider implements Provider {
  readonly name = 'OpenAI';
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
      'OpenAI',
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
