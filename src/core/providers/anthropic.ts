import type { Provider, ProviderOptions } from './base.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface MessagesResponse {
  content: Array<{ type: string; text: string }>;
}

export class AnthropicProvider implements Provider {
  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = DEFAULT_MODEL,
  ) {}

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model ?? this.defaultModel,
        max_tokens: options?.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as MessagesResponse;
    const block = data.content?.find((b) => b.type === 'text');
    if (!block?.text) throw new Error('Anthropic returned empty response');
    return block.text;
  }
}
