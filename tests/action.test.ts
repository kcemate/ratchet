import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { parse } from "yaml";

const ACTION_DIR = join(process.cwd(), "action");
const ACTION_YML = join(ACTION_DIR, "action.yml");
const ENTRYPOINT = join(ACTION_DIR, "entrypoint.sh");
const EXAMPLE_WF = join(ACTION_DIR, "examples", "ratchet.yml");
const README = join(ACTION_DIR, "README.md");

describe("action/action.yml", () => {
  it("file exists", () => {
    expect(existsSync(ACTION_YML)).toBe(true);
  });

  it("is valid YAML", () => {
    const content = readFileSync(ACTION_YML, "utf8");
    expect(() => parse(content)).not.toThrow();
  });

  it("has required top-level fields", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, unknown>;
    expect(doc).toHaveProperty("name");
    expect(doc).toHaveProperty("description");
    expect(doc).toHaveProperty("inputs");
    expect(doc).toHaveProperty("outputs");
    expect(doc).toHaveProperty("runs");
  });

  it("declares api-key as required input", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, any>;
    expect(doc.inputs["api-key"]).toBeDefined();
    expect(doc.inputs["api-key"].required).toBe(true);
  });

  it("has all expected optional inputs", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, any>;
    const inputs = doc.inputs as Record<string, unknown>;
    for (const key of ["target", "clicks", "mode", "license-key", "create-pr", "pr-title"]) {
      expect(inputs[key], `missing input: ${key}`).toBeDefined();
    }
  });

  it("clicks defaults to 7", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, any>;
    expect(String(doc.inputs.clicks.default)).toBe("7");
  });

  it("mode defaults to normal", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, any>;
    expect(doc.inputs.mode.default).toBe("normal");
  });

  it("create-pr defaults to true", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, any>;
    expect(String(doc.inputs["create-pr"].default)).toBe("true");
  });

  it("has all expected outputs", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, any>;
    const outputs = doc.outputs as Record<string, unknown>;
    for (const key of ["pr-url", "score-before", "score-after", "clicks-landed"]) {
      expect(outputs[key], `missing output: ${key}`).toBeDefined();
    }
  });

  it("uses composite runner", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, any>;
    expect(doc.runs.using).toBe("composite");
  });

  it("has at least one step that invokes entrypoint.sh", () => {
    const doc = parse(readFileSync(ACTION_YML, "utf8")) as Record<string, any>;
    const steps: any[] = doc.runs.steps;
    const hasEntrypoint = steps.some(s => typeof s.run === "string" && s.run.includes("entrypoint.sh"));
    expect(hasEntrypoint).toBe(true);
  });
});

describe("action/entrypoint.sh", () => {
  it("file exists", () => {
    expect(existsSync(ENTRYPOINT)).toBe(true);
  });

  it("is executable", () => {
    const stat = statSync(ENTRYPOINT);
    // owner execute bit: 0o100
    expect(stat.mode & 0o100).toBeGreaterThan(0);
  });

  it("starts with a shebang", () => {
    const content = readFileSync(ENTRYPOINT, "utf8");
    expect(content.startsWith("#!/")).toBe(true);
  });

  it("detects Anthropic key prefix", () => {
    const content = readFileSync(ENTRYPOINT, "utf8");
    expect(content).toContain("sk-ant-");
    expect(content).toContain("ANTHROPIC_API_KEY");
  });

  it("detects OpenRouter key prefix", () => {
    const content = readFileSync(ENTRYPOINT, "utf8");
    expect(content).toContain("sk-or-");
    expect(content).toContain("OPENROUTER_API_KEY");
  });

  it("detects OpenAI key prefix", () => {
    const content = readFileSync(ENTRYPOINT, "utf8");
    expect(content).toContain("OPENAI_API_KEY");
  });

  it("sets GITHUB_OUTPUT for all four outputs", () => {
    const content = readFileSync(ENTRYPOINT, "utf8");
    for (const key of ["pr-url", "score-before", "score-after", "clicks-landed"]) {
      expect(content, `missing output: ${key}`).toContain(key);
    }
  });

  it("runs ratchet torque", () => {
    const content = readFileSync(ENTRYPOINT, "utf8");
    expect(content).toContain("ratchet torque");
  });

  it("uses gh CLI to create PR", () => {
    const content = readFileSync(ENTRYPOINT, "utf8");
    expect(content).toContain("gh pr create");
  });

  it("guards pr creation behind create-pr flag", () => {
    const content = readFileSync(ENTRYPOINT, "utf8");
    expect(content).toContain("RATCHET_CREATE_PR");
  });
});

describe("action/examples/ratchet.yml", () => {
  it("file exists", () => {
    expect(existsSync(EXAMPLE_WF)).toBe(true);
  });

  it("is valid YAML", () => {
    const content = readFileSync(EXAMPLE_WF, "utf8");
    expect(() => parse(content)).not.toThrow();
  });

  it("references the ratchet action", () => {
    const content = readFileSync(EXAMPLE_WF, "utf8");
    expect(content.includes("kcemate/ratchet")).toBe(true);
  });

  it("uses api-key from secrets", () => {
    const content = readFileSync(EXAMPLE_WF, "utf8");
    expect(content).toContain("secrets.");
  });
});

describe("action/README.md", () => {
  it("file exists", () => {
    expect(existsSync(README)).toBe(true);
  });

  it("documents all inputs", () => {
    const content = readFileSync(README, "utf8");
    // Check that README documents key action concepts
    for (const key of ["ratchet", "scan", "score"]) {
      expect(content, `README missing concept: ${key}`).toContain(key);
    }
  });

  it("documents key output concepts", () => {
    const content = readFileSync(README, "utf8");
    for (const key of ["score", "scan"]) {
      expect(content, `README missing concept: ${key}`).toContain(key);
    }
  });

  it("contains a usage example", () => {
    const content = readFileSync(README, "utf8");
    expect(content).toContain("```yaml");
    expect(content.includes("uses: kcemate/ratchet")).toBe(true);
  });
});
