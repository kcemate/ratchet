import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseConfig, loadConfig, findIncompleteTargets, getConfigWarnings, DEFAULT_CONFIG } from "../core/config.js";

// Mock the fs and yaml modules
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../core/detect.js", () => ({
  buildAutoConfig: vi.fn(() => ({ ...DEFAULT_CONFIG, _source: "auto-detected" })),
}));

vi.mock("../core/utils.js", () => ({
  toErrorMessage: vi.fn((err: unknown) => String(err)),
}));

import { readFileSync, existsSync } from "fs";

const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseConfig", () => {
  it("parses a minimal valid config", () => {
    const yaml = "agent: shell\n";
    const cfg = parseConfig(yaml);
    expect(cfg.agent).toBe("shell");
    expect(cfg.defaults.clicks).toBe(7);
  });

  it("parses agent claude-code", () => {
    const cfg = parseConfig("agent: claude-code\n");
    expect(cfg.agent).toBe("claude-code");
  });

  it("parses agent codex", () => {
    const cfg = parseConfig("agent: codex\n");
    expect(cfg.agent).toBe("codex");
  });

  it("falls back to shell for unknown agent", () => {
    const cfg = parseConfig("agent: unknown\n");
    expect(cfg.agent).toBe("shell");
  });

  it("falls back to shell when agent is omitted", () => {
    const cfg = parseConfig("");
    expect(cfg.agent).toBe("shell");
  });

  it("parses numeric model override", () => {
    const cfg = parseConfig("model: opus\nagent: shell\n");
    expect(cfg.model).toBe("opus");
  });

  describe("defaults.clicks", () => {
    it("accepts a valid click count", () => {
      const cfg = parseConfig("defaults:\n  clicks: 10\n");
      expect(cfg.defaults.clicks).toBe(10);
    });

    it("rejects clicks < 1", () => {
      const cfg = parseConfig("defaults:\n  clicks: 0\n");
      expect(cfg.defaults.clicks).toBe(7); // falls back to default
    });

    it("rejects negative clicks", () => {
      const cfg = parseConfig("defaults:\n  clicks: -5\n");
      expect(cfg.defaults.clicks).toBe(7);
    });

    it("rejects non-integer clicks", () => {
      const cfg = parseConfig("defaults:\n  clicks: 3.5\n");
      expect(cfg.defaults.clicks).toBe(7);
    });

    it("rejects string clicks", () => {
      const cfg = parseConfig('defaults:\n  clicks: "ten"\n');
      expect(cfg.defaults.clicks).toBe(7);
    });
  });

  describe("defaults.test_command", () => {
    it("uses test_command when provided", () => {
      const cfg = parseConfig("defaults:\n  test_command: pytest\n");
      expect(cfg.defaults.testCommand).toBe("pytest");
    });

    it("falls back to npm test when empty", () => {
      const cfg = parseConfig('defaults:\n  test_command: ""\n');
      expect(cfg.defaults.testCommand).toBe("npm test");
    });
  });

  describe("defaults.auto_commit", () => {
    it("accepts true", () => {
      const cfg = parseConfig("defaults:\n  auto_commit: true\n");
      expect(cfg.defaults.autoCommit).toBe(true);
    });

    it("accepts false", () => {
      const cfg = parseConfig("defaults:\n  auto_commit: false\n");
      expect(cfg.defaults.autoCommit).toBe(false);
    });

    it("defaults to true when omitted", () => {
      const cfg = parseConfig("");
      expect(cfg.defaults.autoCommit).toBe(true);
    });
  });

  describe("targets", () => {
    it("parses valid targets", () => {
      const yaml = `
targets:
  - name: api
    path: src/api/
    description: REST API layer
`;
      const cfg = parseConfig(yaml);
      expect(cfg.targets).toHaveLength(1);
      expect(cfg.targets[0]).toEqual({
        name: "api",
        path: "src/api/",
        description: "REST API layer",
      });
    });

    it("skips targets missing name", () => {
      const yaml = `
targets:
  - name: api
    path: src/api/
    description: REST API
  - path: src/broken/
    description: Missing name
`;
      const cfg = parseConfig(yaml);
      expect(cfg.targets).toHaveLength(1);
    });

    it("skips targets missing path", () => {
      const yaml = `
targets:
  - name: api
    description: REST API
`;
      const cfg = parseConfig(yaml);
      expect(cfg.targets).toHaveLength(0);
    });

    it("skips targets missing description", () => {
      const yaml = `
targets:
  - name: api
    path: src/api/
`;
      const cfg = parseConfig(yaml);
      expect(cfg.targets).toHaveLength(0);
    });

    it("skips fully empty target entries", () => {
      const yaml = `
targets:
  - {}
`;
      const cfg = parseConfig(yaml);
      expect(cfg.targets).toHaveLength(0);
    });
  });

  describe("boundaries", () => {
    it("parses valid boundaries", () => {
      const yaml = `
boundaries:
  - path: src/secrets/
    rule: no-modify
    reason: Contains credentials
`;
      const cfg = parseConfig(yaml);
      expect(cfg.boundaries).toHaveLength(1);
      expect(cfg.boundaries![0]).toEqual({
        path: "src/secrets/",
        rule: "no-modify",
        reason: "Contains credentials",
      });
    });

    it("parses no-delete rule", () => {
      const yaml = `boundaries:\n  - path: src/main/\n    rule: no-delete\n`;
      const cfg = parseConfig(yaml);
      expect(cfg.boundaries![0].rule).toBe("no-delete");
    });

    it("parses preserve-pattern rule", () => {
      const yaml = `boundaries:\n  - path: src/main/\n    rule: preserve-pattern\n`;
      const cfg = parseConfig(yaml);
      expect(cfg.boundaries![0].rule).toBe("preserve-pattern");
    });

    it("defaults invalid rule to no-modify", () => {
      const yaml = `boundaries:\n  - path: src/main/\n    rule: invalid-rule\n`;
      const cfg = parseConfig(yaml);
      expect(cfg.boundaries![0].rule).toBe("no-modify");
    });

    it("returns empty array (not undefined) when no valid boundaries", () => {
      const yaml = `boundaries:\n  - rule: no-modify\n`;
      const cfg = parseConfig(yaml);
      expect(cfg.boundaries).toEqual([]);
    });

    it("returns empty array when boundaries missing rule", () => {
      const yaml = `boundaries:\n  - path: src/main/\n`;
      const cfg = parseConfig(yaml);
      expect(cfg.boundaries).toEqual([]);
    });
  });

  describe("invalid YAML", () => {
    it("throws on unparseable YAML", () => {
      expect(() => parseConfig("  invalid: yaml: content:\n    - broken")).toThrow("invalid YAML");
    });
  });

  describe("non-object root", () => {
    it("returns default config for null", () => {
      const cfg = parseConfig("");
      expect(cfg.defaults.clicks).toBe(7);
    });
  });
});

describe("loadConfig", () => {
  it("returns auto-detected config when .ratchet.yml does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const cfg = loadConfig("/some/path");
    expect(cfg._source).toBe("auto-detected");
  });

  it("reads .ratchet.yml from cwd when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("agent: shell\ndefaults:\n  clicks: 5\n");
    const cfg = loadConfig("/my/project");
    expect(mockReadFileSync).toHaveBeenCalledWith("/my/project/.ratchet.yml", "utf8");
    expect(cfg.defaults.clicks).toBe(5);
    expect(cfg._source).toBe("file");
  });
});

describe("findIncompleteTargets", () => {
  it("returns empty array for config with no incomplete targets", () => {
    const yaml = `
targets:
  - name: api
    path: src/api/
    description: REST API
`;
    const warnings = findIncompleteTargets(yaml);
    expect(warnings).toHaveLength(0);
  });

  it("returns warnings for targets missing name", () => {
    const yaml = `
targets:
  - name: api
    path: src/api/
    description: REST API
  - path: src/broken/
    description: Missing name
`;
    const warnings = findIncompleteTargets(yaml);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("name");
  });

  it("returns warnings for fully unnamed targets", () => {
    const yaml = `
targets:
  - path: src/broken/
    description: Missing name
`;
    const warnings = findIncompleteTargets(yaml);
    expect(warnings[0]).toContain("(unnamed)");
  });

  it("skips fully empty target entries", () => {
    const yaml = `targets:\n  - {}\n`;
    const warnings = findIncompleteTargets(yaml);
    expect(warnings).toHaveLength(0);
  });

  it("returns empty array for non-YAML input", () => {
    expect(findIncompleteTargets("not: [yaml")).toHaveLength(0);
    expect(findIncompleteTargets("")).toHaveLength(0);
  });

  it("reports multiple missing fields", () => {
    const yaml = `targets:\n  - path: src/api/\n`;
    const warnings = findIncompleteTargets(yaml);
    expect(warnings[0]).toContain("name");
    expect(warnings[0]).toContain("description");
  });
});

describe("getConfigWarnings", () => {
  it("returns empty array for valid config", () => {
    const yaml = "agent: shell\ndefaults:\n  clicks: 5\n";
    expect(getConfigWarnings(yaml)).toHaveLength(0);
  });

  it("warns on invalid agent", () => {
    const warnings = getConfigWarnings("agent: unknown-agent\n");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Invalid agent");
    expect(warnings[0]).toContain("Falling back");
  });

  it("warns on invalid clicks", () => {
    const warnings = getConfigWarnings("defaults:\n  clicks: 0\n");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Invalid defaults.clicks");
  });

  it("warns on non-integer clicks", () => {
    const warnings = getConfigWarnings("defaults:\n  clicks: 5.5\n");
    expect(warnings).toHaveLength(1);
  });

  it("warns on invalid boundary rule", () => {
    const warnings = getConfigWarnings("boundaries:\n  - path: src/main/\n    rule: invalid-rule\n");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Invalid boundary rule");
    expect(warnings[0].toLowerCase()).toContain('falling back to "no-modify"');
  });

  it("returns empty for parse errors (handled elsewhere)", () => {
    expect(getConfigWarnings("not: [yaml")).toHaveLength(0);
  });

  it("returns empty for non-object root", () => {
    expect(getConfigWarnings("")).toHaveLength(0);
  });

  it("warns for multiple issues combined", () => {
    const warnings = getConfigWarnings("agent: unknown\ndefaults:\n  clicks: -1\n");
    expect(warnings).toHaveLength(2);
  });
});
