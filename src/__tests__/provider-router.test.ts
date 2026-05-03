import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectProvider, createProvider, getProviderPricing } from "../../src/core/providers/index.js";
import { AnthropicProvider } from "../../src/core/providers/anthropic.js";
import { OpenAIProvider } from "../../src/core/providers/openai.js";
import { OpenRouterProvider } from "../../src/core/providers/openrouter.js";
import { LocalMLXProvider } from "../../src/core/providers/local.js";
import { SIProvider } from "../../src/core/providers/si.js";
import { routeTask } from "../../src/core/providers/router.js";
import type { ProviderConfig } from "../../src/core/providers/base.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) original[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CLEAN_ENV = {
  RATCHET_PROVIDER: undefined,
  RATCHET_SI_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  OPENAI_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
  RATCHET_LOCAL_URL: undefined,
  RATCHET_MODEL: undefined,
};

// ── detectProvider priority chain ─────────────────────────────────────────────

describe("detectProvider priority chain", () => {
  it("explicit config overrides everything", () => {
    withEnv({ ...CLEAN_ENV, ANTHROPIC_API_KEY: "sk-ant" }, () => {
      const provider = detectProvider({ provider: "openai", apiKey: "sk-oa" });
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });
  });

  it("RATCHET_PROVIDER env takes priority over key-based detection", () => {
    withEnv({ ...CLEAN_ENV, RATCHET_PROVIDER: "openai", OPENAI_API_KEY: "sk-oa" }, () => {
      const provider = detectProvider();
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });
  });

  it("SI key detected before Anthropic key", () => {
    withEnv({ ...CLEAN_ENV, RATCHET_SI_KEY: "si-key", ANTHROPIC_API_KEY: "sk-ant" }, () => {
      const provider = detectProvider();
      expect(provider).toBeInstanceOf(SIProvider);
    });
  });

  it("Anthropic key detected before OpenAI", () => {
    withEnv({ ...CLEAN_ENV, ANTHROPIC_API_KEY: "sk-ant", OPENAI_API_KEY: "sk-oa" }, () => {
      const provider = detectProvider();
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });
  });

  it("OpenAI key detected before OpenRouter", () => {
    withEnv({ ...CLEAN_ENV, OPENAI_API_KEY: "sk-oa", OPENROUTER_API_KEY: "sk-or" }, () => {
      const provider = detectProvider();
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });
  });

  it("OpenRouter key detected before Local fallback", () => {
    withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: "sk-or" }, () => {
      const provider = detectProvider();
      expect(provider).toBeInstanceOf(OpenRouterProvider);
    });
  });

  it("falls back to Local when no keys are set", () => {
    withEnv(CLEAN_ENV, () => {
      const provider = detectProvider();
      expect(provider).toBeInstanceOf(LocalMLXProvider);
    });
  });
});

// ── createProvider ────────────────────────────────────────────────────────────

describe("createProvider", () => {
  it("creates AnthropicProvider", () => {
    const p = createProvider({ provider: "anthropic", apiKey: "k" });
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.name).toBe("Anthropic");
  });

  it("creates OpenAIProvider", () => {
    const p = createProvider({ provider: "openai", apiKey: "k" });
    expect(p).toBeInstanceOf(OpenAIProvider);
    expect(p.name).toBe("OpenAI");
  });

  it("creates OpenRouterProvider", () => {
    const p = createProvider({ provider: "openrouter", apiKey: "k" });
    expect(p).toBeInstanceOf(OpenRouterProvider);
    expect(p.name).toBe("OpenRouter");
  });

  it("creates LocalMLXProvider", () => {
    const p = createProvider({ provider: "local" });
    expect(p).toBeInstanceOf(LocalMLXProvider);
    expect(p.name).toBe("Local");
  });

  it("creates SIProvider", () => {
    const p = createProvider({ provider: "si", apiKey: "si-key" });
    expect(p).toBeInstanceOf(SIProvider);
    expect(p.name).toBe("SI");
  });
});

// ── SI provider ───────────────────────────────────────────────────────────────

describe("SIProvider", () => {
  it("has enterprise tier", () => {
    const p = new SIProvider({ provider: "si", apiKey: "si-key" });
    expect(p.tier).toBe("enterprise");
  });

  it("supports structured output", () => {
    const p = new SIProvider({ provider: "si" });
    expect(p.supportsStructuredOutput()).toBe(true);
  });

  it("estimates cost with placeholder rates", () => {
    const p = new SIProvider({ provider: "si" });
    // 1M input + 1M output → (10 + 30) = $40
    expect(p.estimateCost(1_000_000, 1_000_000)).toBeCloseTo(40);
  });
});

// ── estimateCost ──────────────────────────────────────────────────────────────

describe("estimateCost", () => {
  it("Anthropic: Sonnet pricing $3/$15 per M", () => {
    const p = new AnthropicProvider("k");
    expect(p.estimateCost(1_000_000, 0)).toBeCloseTo(3);
    expect(p.estimateCost(0, 1_000_000)).toBeCloseTo(15);
  });

  it("OpenAI: GPT-4o pricing $2.50/$10 per M", () => {
    const p = new OpenAIProvider("k");
    expect(p.estimateCost(1_000_000, 0)).toBeCloseTo(2.5);
    expect(p.estimateCost(0, 1_000_000)).toBeCloseTo(10);
  });

  it("OpenRouter: Sonnet pricing $3/$15 per M", () => {
    const p = new OpenRouterProvider("k");
    expect(p.estimateCost(1_000_000, 0)).toBeCloseTo(3);
    expect(p.estimateCost(0, 1_000_000)).toBeCloseTo(15);
  });

  it("Local: free (zero cost)", () => {
    const p = new LocalMLXProvider();
    expect(p.estimateCost(1_000_000, 1_000_000)).toBe(0);
  });
});

// ── getProviderPricing ────────────────────────────────────────────────────────

describe("getProviderPricing", () => {
  it("returns correct pricing for Anthropic", () => {
    const p = new AnthropicProvider("k");
    const pricing = getProviderPricing(p);
    expect(pricing.inputPerMToken).toBeCloseTo(3);
    expect(pricing.outputPerMToken).toBeCloseTo(15);
  });

  it("returns zero for Local", () => {
    const p = new LocalMLXProvider();
    const pricing = getProviderPricing(p);
    expect(pricing.inputPerMToken).toBe(0);
    expect(pricing.outputPerMToken).toBe(0);
  });
});

// ── smart model routing ───────────────────────────────────────────────────────

describe("routeTask", () => {
  const anthropic = new AnthropicProvider("k");
  const openai = new OpenAIProvider("k");
  const local = new LocalMLXProvider();

  it("sweep → cheap model (Haiku)", () => {
    const opts = routeTask("sweep", anthropic);
    expect(opts.model).toBe("claude-haiku-4-5-20251001");
  });

  it("report → cheap model", () => {
    const opts = routeTask("report", anthropic);
    expect(opts.model).toBe("claude-haiku-4-5-20251001");
  });

  it("analyze → standard model (Sonnet)", () => {
    const opts = routeTask("analyze", anthropic);
    expect(opts.model).toBe("claude-sonnet-4-6");
  });

  it("fix → standard model", () => {
    const opts = routeTask("fix", anthropic);
    expect(opts.model).toBe("claude-sonnet-4-6");
  });

  it("architect → best model (Opus)", () => {
    const opts = routeTask("architect", anthropic);
    expect(opts.model).toBe("claude-opus-4-6");
  });

  it("routes OpenAI tasks correctly", () => {
    expect(routeTask("sweep", openai).model).toBe("gpt-4o-mini");
    expect(routeTask("architect", openai).model).toBe("gpt-4o");
  });

  it("returns empty options for Local (no model override)", () => {
    const opts = routeTask("analyze", local);
    expect(opts.model).toBeUndefined();
  });
});
