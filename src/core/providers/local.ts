import type { Provider, ProviderOptions } from "./base.js";
import { fetchOpenAICompatible } from "./base.js";

const DEFAULT_MODEL = process.env["RATCHET_MODEL"] ?? "qwen3:14b";
export const LOCAL_MLX_DEFAULT_PORT = parseInt(process.env["OLLAMA_PORT"] ?? "11434", 10);

export interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

export class LocalMLXProvider implements Provider {
  readonly name = "Local";
  readonly tier = "free" as const;

  private readonly completionsUrl: string;
  private readonly modelsUrl: string;
  private readonly defaultModel: string;

  constructor(port: number = LOCAL_MLX_DEFAULT_PORT, model: string = DEFAULT_MODEL) {
    this.completionsUrl = `http://localhost:${port}/v1/chat/completions`;
    this.modelsUrl = `http://localhost:${port}/v1/models`;
    this.defaultModel = model;
  }

  async sendMessage(prompt: string, options?: ProviderOptions): Promise<string> {
    return fetchOpenAICompatible(
      this.completionsUrl,
      {},
      options?.model ?? this.defaultModel,
      prompt,
      "Local MLX",
      options
    );
  }

  estimateCost(_inputTokens: number, _outputTokens: number): number {
    return 0;
  }

  supportsStructuredOutput(): boolean {
    return false;
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
