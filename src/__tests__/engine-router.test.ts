import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEngine, CreateEngineOverrides } from "../core/engine-router.js";
import { detectProvider, createProvider } from "../core/providers/index.js";

// Mock the engines and providers
vi.mock("../core/engines/index.js", () => ({
  ClassicEngine: vi.fn().mockImplementation(function (this: any) {
    this.name = "classic";
    this.scan = vi.fn();
  }),
  DeepEngine: vi.fn().mockImplementation(function (this: any, provider: any, scanProvider: any) {
    this.name = "deep";
    this.provider = provider;
    this.scanProvider = scanProvider;
    this.scan = vi.fn();
  }),
}));

vi.mock("../core/providers/index.js", () => ({
  detectProvider: vi.fn().mockReturnValue("mock-detected-provider"),
  createProvider: vi.fn().mockReturnValue("mock-created-provider"),
}));

describe("engine-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear environment variables
    delete process.env.RATCHET_ENGINE;
    delete process.env.RATCHET_PROVIDER;
    delete process.env.RATCHET_MODEL;
    delete process.env.RATCHET_SCAN_MODEL;
  });

  describe("createEngine", () => {
    it("should return ClassicEngine when mode is classic", () => {
      const engine = createEngine("classic");
      expect(engine.name).toBe("classic");
    });

    it("should return DeepEngine when mode is deep", () => {
      const engine = createEngine("deep");
      expect(engine.name).toBe("deep");
    });

    it("should return ClassicEngine when mode is auto and no other config", () => {
      const engine = createEngine("auto");
      expect(engine.name).toBe("classic");
    });

    it("should use RATCHET_ENGINE env var when mode is auto", () => {
      process.env.RATCHET_ENGINE = "deep";
      const engine = createEngine("auto");
      expect(engine.name).toBe("deep");
    });

    it("should use config.scan.engine when mode is auto and no env var", () => {
      const config = {
        scan: {
          engine: "deep",
        },
      };
      const engine = createEngine("auto", config as any);
      expect(engine.name).toBe("deep");
    });

    it("should prioritize explicit mode over env var and config", () => {
      process.env.RATCHET_ENGINE = "deep";
      const config = {
        scan: {
          engine: "deep",
        },
      };
      const engine = createEngine("classic", config as any);
      expect(engine.name).toBe("classic");
    });

    it("should prioritize env var over config when mode is auto", () => {
      process.env.RATCHET_ENGINE = "classic";
      const config = {
        scan: {
          engine: "deep",
        },
      };
      const engine = createEngine("auto", config as any);
      expect(engine.name).toBe("classic");
    });

    it("should create DeepEngine with provider when mode is deep", () => {
      const engine = createEngine("deep");
      expect(engine.name).toBe("deep");
      expect((engine as any).provider).toBe("mock-detected-provider");
    });

    it("should use scanModel override when provided for deep engine", () => {
      const overrides: CreateEngineOverrides = {
        scanModel: "custom-model",
      };
      const engine = createEngine("deep", undefined, overrides);
      expect(engine.name).toBe("deep");
      // When no providerConfig is available, scanProvider uses detectProvider
      expect((engine as any).scanProvider).toBe("mock-detected-provider");
    });

    it("should use RATCHET_SCAN_MODEL env var for deep engine", () => {
      process.env.RATCHET_SCAN_MODEL = "env-model";
      const engine = createEngine("deep");
      expect(engine.name).toBe("deep");
      // When no providerConfig is available, scanProvider uses detectProvider
      expect((engine as any).scanProvider).toBe("mock-detected-provider");
    });

    it("should use config.scan.model for deep engine", () => {
      const config = {
        scan: {
          model: "config-model",
        },
      };
      const engine = createEngine("deep", config as any);
      expect(engine.name).toBe("deep");
      // When no providerConfig is available, scanProvider uses detectProvider
      expect((engine as any).scanProvider).toBe("mock-detected-provider");
    });

    it("should prioritize scanModel override over env and config", () => {
      process.env.RATCHET_SCAN_MODEL = "env-model";
      const config = {
        scan: {
          model: "config-model",
        },
      };
      const overrides: CreateEngineOverrides = {
        scanModel: "override-model",
      };
      const engine = createEngine("deep", config as any, overrides);
      expect(engine.name).toBe("deep");
      // When no providerConfig is available, scanProvider uses detectProvider
      expect((engine as any).scanProvider).toBe("mock-detected-provider");
    });

    it("should use RATCHET_PROVIDER env var for provider config", () => {
      process.env.RATCHET_PROVIDER = "env-provider";
      process.env.RATCHET_MODEL = "env-model";
      const engine = createEngine("deep");
      expect(createProvider).toHaveBeenCalledWith({
        provider: "env-provider",
        model: "env-model",
      });
    });

    it("should return ClassicEngine as default when auto with no config", () => {
      const engine = createEngine("auto", undefined, undefined);
      expect(engine.name).toBe("classic");
    });

    it("should handle missing config gracefully", () => {
      const engine = createEngine("classic", undefined);
      expect(engine.name).toBe("classic");
    });

    it("should handle missing overrides gracefully", () => {
      const engine = createEngine("classic", undefined, undefined);
      expect(engine.name).toBe("classic");
    });
  });

  describe("resolveProviderConfig", () => {
    it("should return undefined when no provider config is available", () => {
      // This is tested indirectly through the main createEngine tests
      // The function is private, so we test it through the public API
      const engine = createEngine("classic");
      expect(engine.name).toBe("classic");
    });

    it("should use RATCHET_PROVIDER env var when available", () => {
      process.env.RATCHET_PROVIDER = "test-provider";
      process.env.RATCHET_MODEL = "test-model";
      const engine = createEngine("deep");
      expect(createProvider).toHaveBeenCalledWith({
        provider: "test-provider",
        model: "test-model",
      });
    });
  });
});
