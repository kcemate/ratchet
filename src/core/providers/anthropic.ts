import type { Provider, ProviderOptions } from "./base.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Sonnet pricing: $3 input / $15 output per million tokens
const INPUT_PRICE_PER_M = 3;
const OUTPUT_PRICE_PER_M = 15;

interface MessagesResponse {
  content: Array<{ type: string; text: string }>;
}

export class AnthropicProvider implements Provider {
  readonly name = "Anthropic";
  readonly tier = "pro" as const;

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = DEFAULT_MODEL
  ) {}

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 4096,
      messages: [{ role: "user", content: prompt }],
    };
    if (options?.systemPrompt) body["system"] = options.systemPrompt;
    if (options?.temperature !== undefined) body["temperature"] = options.temperature;

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as MessagesResponse;
    const block = data.content?.find(b => b.type === "text");
    if (!block?.text) throw new Error("Anthropic returned empty response");
    return block.text;
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens * INPUT_PRICE_PER_M + outputTokens * OUTPUT_PRICE_PER_M) / 1_000_000;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }
}
