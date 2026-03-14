import type { Provider, ProviderOptions } from './base.js';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

export class OpenRouterProvider implements Provider {
  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = DEFAULT_MODEL,
  ) {}

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model ?? this.defaultModel,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter returned empty response');
    return content;
  }
}
