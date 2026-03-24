import type { Provider, ProviderOptions } from './base.js';

const DEFAULT_MODEL = '/Users/giovanni/Projects/ratchet/training-data/ratchet-fix-fused-v2';
export const LOCAL_MLX_DEFAULT_PORT = 8899;

export interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

export class LocalMLXProvider implements Provider {
  private readonly completionsUrl: string;
  private readonly modelsUrl: string;
  private readonly defaultModel: string;

  constructor(port: number = LOCAL_MLX_DEFAULT_PORT, model: string = DEFAULT_MODEL) {
    this.completionsUrl = `http://localhost:${port}/v1/chat/completions`;
    this.modelsUrl = `http://localhost:${port}/v1/models`;
    this.defaultModel = model;
  }

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    const response = await fetch(this.completionsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model ?? this.defaultModel,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Local MLX API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Local MLX model returned empty response');
    return content;
  }

  /** Check if the MLX server is reachable. Returns false on any error. */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(this.modelsUrl, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
