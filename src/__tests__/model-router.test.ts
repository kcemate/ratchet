import { describe, it, expect } from "vitest";
import { selectModel } from "../../src/lib/model-router.js";
import type { RatchetConfig } from "../../src/types.js";

const BASE_CONFIG: RatchetConfig = {
  agent: "shell",
  defaults: { clicks: 7, testCommand: "npm test", autoCommit: true },
  targets: [],
};

describe("selectModel", () => {
  it("returns claude-haiku for mechanical with no config", () => {
    expect(selectModel("mechanical")).toBe("claude-haiku");
  });

  it("returns claude-sonnet for standard with no config", () => {
    expect(selectModel("standard")).toBe("claude-sonnet");
  });

  it("returns claude-opus for complex with no config", () => {
    expect(selectModel("complex")).toBe("claude-opus");
  });

  it("uses config.models.cheap for mechanical", () => {
    const config = { ...BASE_CONFIG, models: { cheap: "claude-haiku-4-5-20251001" } };
    expect(selectModel("mechanical", config)).toBe("claude-haiku-4-5-20251001");
  });

  it("uses config.models.default for standard", () => {
    const config = { ...BASE_CONFIG, models: { default: "claude-sonnet-4-6" } };
    expect(selectModel("standard", config)).toBe("claude-sonnet-4-6");
  });

  it("uses config.models.premium for complex", () => {
    const config = { ...BASE_CONFIG, models: { premium: "claude-opus-4-6" } };
    expect(selectModel("complex", config)).toBe("claude-opus-4-6");
  });

  it("falls back to config.model for standard when models.default absent", () => {
    const config = { ...BASE_CONFIG, model: "claude-sonnet-4-6" };
    expect(selectModel("standard", config)).toBe("claude-sonnet-4-6");
  });

  it("does NOT use config.model for mechanical (mechanical always uses haiku default)", () => {
    const config = { ...BASE_CONFIG, model: "claude-opus-4-6" };
    expect(selectModel("mechanical", config)).toBe("claude-haiku");
  });

  it("config.models overrides config.model for standard", () => {
    const config = {
      ...BASE_CONFIG,
      model: "claude-sonnet-4-5",
      models: { default: "claude-sonnet-4-6" },
    };
    expect(selectModel("standard", config)).toBe("claude-sonnet-4-6");
  });
});
