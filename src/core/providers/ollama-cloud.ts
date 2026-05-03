import type { Provider, ProviderOptions, ProviderConfig } from "./base.js";
import { fetchOpenAICompatible } from "./base.js";

const OLLAMA_CLOUD_BASE = "https://ollama.com/v1";
const OLLAMA_LOCAL_BASE = "http://localhost:11434/v1";

/**
 * Ollama Cloud provider — routes to cloud-hosted models (Kimi K2, GLM-5, etc.)
 * via OpenAI-compatible API at ollama.com/v1.
 *
 * Falls back to local Ollama server (localhost:11434) when no API key is provided,
 * which is the common setup for users with Ollama Cloud models pulled locally.
 */
export class OllamaCloudProvider implements Provider {
  readonly name = "OllamaCloud";
  readonly tier = "pro" as const;

  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly useLocal: boolean;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? process.env["OLLAMA_CLOUD_API_KEY"];
    this.model = config.model ?? "mistral-large-3:675b";

    // If no API key and base URL is not explicitly set, fall back to local Ollama server
    if (!this.apiKey && !config.baseUrl) {
      this.baseUrl = OLLAMA_LOCAL_BASE;
      this.useLocal = true;
    } else {
      this.baseUrl = config.baseUrl ?? OLLAMA_CLOUD_BASE;
      this.useLocal = false;
    }
  }

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    const model = options?.model ?? this.model;
    const headers: Record<string, string> = this.useLocal
      ? {} // Local Ollama doesn't need auth
      : { Authorization: `Bearer ${this.apiKey}` };

    return fetchOpenAICompatible(
      `${this.baseUrl}/chat/completions`,
      headers,
      model,
      prompt,
      `OllamaCloud/${model}`,
      options
    );
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    // Ollama Cloud flat-rate subscription — marginal cost is ~$0
    // Local Ollama costs nothing
    return this.useLocal ? 0 : (inputTokens * 0.5 + outputTokens * 1.5) / 1_000_000;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }
}
