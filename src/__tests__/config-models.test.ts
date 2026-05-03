import { describe, it, expect } from "vitest";
import { parseConfig, getConfigWarnings } from "../core/config.js";

// ── Backward compatibility ───────────────────────────────────────────────────

describe("backward compatibility", () => {
  it("parses old-format model string", () => {
    const config = parseConfig("model: claude-sonnet-4-6");
    expect(config.model).toBe("claude-sonnet-4-6");
  });

  it("parses old-format models.cheap/default/premium", () => {
    const yaml = `
models:
  cheap: claude-haiku-4-5
  default: claude-sonnet-4-6
  premium: claude-opus-4-6
`;
    const config = parseConfig(yaml);
    expect(config.models?.cheap).toBe("claude-haiku-4-5");
    expect(config.models?.default).toBe("claude-sonnet-4-6");
    expect(config.models?.premium).toBe("claude-opus-4-6");
  });

  it("returns no providers when section is absent", () => {
    const config = parseConfig("agent: shell");
    expect(config.providers).toBeUndefined();
  });
});

// ── Per-task model mapping ───────────────────────────────────────────────────

describe("per-task model mapping", () => {
  it("parses all per-task model keys", () => {
    const yaml = `
models:
  scan: kimi-k2:1t
  fix: claude-sonnet-4-6
  architect: claude-opus-4-6
  sweep: claude-haiku-4-5
  report: claude-haiku-4-5
`;
    const config = parseConfig(yaml);
    expect(config.models?.scan).toBe("kimi-k2:1t");
    expect(config.models?.fix).toBe("claude-sonnet-4-6");
    expect(config.models?.architect).toBe("claude-opus-4-6");
    expect(config.models?.sweep).toBe("claude-haiku-4-5");
    expect(config.models?.report).toBe("claude-haiku-4-5");
  });

  it("mixes legacy tier keys with new per-task keys", () => {
    const yaml = `
models:
  cheap: claude-haiku-4-5
  default: claude-sonnet-4-6
  sweep: kimi-k2:1t
`;
    const config = parseConfig(yaml);
    expect(config.models?.cheap).toBe("claude-haiku-4-5");
    expect(config.models?.default).toBe("claude-sonnet-4-6");
    expect(config.models?.sweep).toBe("kimi-k2:1t");
  });
});

// ── Provider config parsing ──────────────────────────────────────────────────

describe("provider config parsing", () => {
  it("parses a full provider entry", () => {
    const yaml = `
providers:
  ollama-cloud:
    api_key_env: OLLAMA_CLOUD_API_KEY
    base_url: https://ollama.com/v1
    models: [kimi-k2:1t, glm-5]
`;
    const config = parseConfig(yaml);
    const p = config.providers?.["ollama-cloud"];
    expect(p).toBeDefined();
    expect(p?.api_key_env).toBe("OLLAMA_CLOUD_API_KEY");
    expect(p?.base_url).toBe("https://ollama.com/v1");
    expect(p?.models).toEqual(["kimi-k2:1t", "glm-5"]);
  });

  it("parses multiple providers", () => {
    const yaml = `
providers:
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
    models: [claude-sonnet-4-6, claude-opus-4-6]
  ollama-cloud:
    api_key_env: OLLAMA_CLOUD_API_KEY
    base_url: https://ollama.com/v1
    models: [kimi-k2:1t]
`;
    const config = parseConfig(yaml);
    expect(Object.keys(config.providers ?? {})).toHaveLength(2);
    expect(config.providers?.["anthropic"]?.api_key_env).toBe("ANTHROPIC_API_KEY");
    expect(config.providers?.["ollama-cloud"]?.api_key_env).toBe("OLLAMA_CLOUD_API_KEY");
  });

  it("provider without base_url omits the field", () => {
    const yaml = `
providers:
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
`;
    const config = parseConfig(yaml);
    expect(config.providers?.["anthropic"]?.base_url).toBeUndefined();
  });

  it("provider without models omits the field", () => {
    const yaml = `
providers:
  custom:
    api_key_env: CUSTOM_API_KEY
    base_url: https://api.example.com/v1
`;
    const config = parseConfig(yaml);
    expect(config.providers?.["custom"]?.models).toBeUndefined();
  });

  it("throws when api_key_env is missing from a provider", () => {
    const yaml = `
providers:
  bad-provider:
    base_url: https://api.example.com/v1
    models: [some-model]
`;
    expect(() => parseConfig(yaml)).toThrow(/api_key_env/);
    expect(() => parseConfig(yaml)).toThrow(/bad-provider/);
  });
});

// ── Validation warnings ──────────────────────────────────────────────────────

describe("validation warnings", () => {
  it("warns when model string is not in any provider models list", () => {
    const yaml = `
model: unknown-model
providers:
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
    models: [claude-sonnet-4-6]
`;
    const warnings = getConfigWarnings(yaml);
    expect(warnings.some(w => w.includes("unknown-model") && w.includes("model"))).toBe(true);
  });

  it("warns when a per-task model is not in any provider models list", () => {
    const yaml = `
models:
  scan: not-a-real-model
providers:
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
    models: [claude-sonnet-4-6]
`;
    const warnings = getConfigWarnings(yaml);
    expect(warnings.some(w => w.includes("not-a-real-model") && w.includes("models.scan"))).toBe(true);
  });

  it("does not warn on unknown models when no providers are defined", () => {
    const yaml = `
model: anything-goes
models:
  sweep: whatever
`;
    const warnings = getConfigWarnings(yaml);
    const modelWarnings = warnings.filter(w => w.includes("Unknown model"));
    expect(modelWarnings).toHaveLength(0);
  });

  it("does not warn on models that appear in provider list", () => {
    const yaml = `
models:
  sweep: kimi-k2:1t
providers:
  ollama-cloud:
    api_key_env: OLLAMA_CLOUD_API_KEY
    models: [kimi-k2:1t]
`;
    const warnings = getConfigWarnings(yaml);
    const modelWarnings = warnings.filter(w => w.includes("Unknown model"));
    expect(modelWarnings).toHaveLength(0);
  });

  it("still warns on invalid agent alongside model warnings", () => {
    const yaml = `
agent: bad-agent
model: unknown-model
providers:
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
    models: [claude-sonnet-4-6]
`;
    const warnings = getConfigWarnings(yaml);
    expect(warnings.some(w => w.includes("bad-agent"))).toBe(true);
    expect(warnings.some(w => w.includes("unknown-model"))).toBe(true);
  });

  it("returns no warnings for a fully valid config", () => {
    const yaml = `
model: claude-sonnet-4-6
models:
  sweep: claude-haiku-4-5
providers:
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
    models: [claude-sonnet-4-6, claude-haiku-4-5]
`;
    const warnings = getConfigWarnings(yaml);
    expect(warnings).toHaveLength(0);
  });
});
