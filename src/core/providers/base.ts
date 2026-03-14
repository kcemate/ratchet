export interface ProviderOptions {
  model?: string;
  maxTokens?: number;
}

export interface Provider {
  /** Send a prompt and return the text response */
  sendMessage(prompt: string, options?: ProviderOptions): Promise<string>;
}

export type ProviderType = 'openrouter' | 'anthropic' | 'openai';
