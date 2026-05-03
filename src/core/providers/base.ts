export interface ProviderOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  systemPrompt?: string;
}

export interface Provider {
  readonly name: string;
  readonly tier: "free" | "pro" | "enterprise";
  sendMessage(prompt: string, options?: ProviderOptions): Promise<string>;
  estimateCost(inputTokens: number, outputTokens: number): number;
  supportsStructuredOutput(): boolean;
}

export interface ProviderConfig {
  provider: "anthropic" | "openai" | "openrouter" | "local" | "si" | "ollama-cloud";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  tier?: "free" | "pro" | "enterprise";
}

export type ProviderType = "openrouter" | "anthropic" | "openai";

interface ChatCompletionData {
  choices: Array<{ message: { content: string; reasoning?: string; reasoning_content?: string } }>;
}

/** Shared fetch logic for OpenAI-compatible chat completion APIs. */
export async function fetchOpenAICompatible(
  url: string,
  headers: Record<string, string>,
  model: string,
  prompt: string,
  providerName: string,
  options?: Pick<ProviderOptions, "systemPrompt" | "jsonMode" | "temperature" | "maxTokens">
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options?.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = { model, messages };
  if (options?.jsonMode) body["response_format"] = { type: "json_object" };
  if (options?.temperature !== undefined) body["temperature"] = options.temperature;
  if (options?.maxTokens !== undefined) body["max_tokens"] = options.maxTokens;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${providerName} API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as ChatCompletionData;
  const msg = data.choices?.[0]?.message;
  // Some models (e.g. GLM-5) put output in reasoning/reasoning_content with empty content
  const content = msg?.content || msg?.reasoning_content || msg?.reasoning || "";
  if (!content) throw new Error(`${providerName} returned empty response`);
  return content;
}
