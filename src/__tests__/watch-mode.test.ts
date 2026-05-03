import { describe, it, expect } from "vitest";
import { validateTestCommand } from "../core/test-isolation.js";

describe("validateTestCommand", () => {
  it("appends --run to bare vitest command", () => {
    const { command, warnings } = validateTestCommand("vitest");
    expect(command).toBe("vitest --run");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("--run");
  });

  it("leaves vitest --run unchanged", () => {
    const { command, warnings } = validateTestCommand("vitest --run");
    expect(command).toBe("vitest --run");
    expect(warnings).toHaveLength(0);
  });

  it("appends --run to npx vitest", () => {
    const { command, warnings } = validateTestCommand("npx vitest");
    expect(command).toBe("npx vitest --run");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("--run");
  });

  it("leaves jest unchanged (no watch flag)", () => {
    const { command, warnings } = validateTestCommand("jest");
    expect(command).toBe("jest");
    expect(warnings).toHaveLength(0);
  });

  it("warns when jest --watch is detected", () => {
    const { command, warnings } = validateTestCommand("jest --watch");
    expect(command).toBe("jest --watch");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("--watch");
  });

  it("leaves npm test unchanged", () => {
    const { command, warnings } = validateTestCommand("npm test");
    expect(command).toBe("npm test");
    expect(warnings).toHaveLength(0);
  });

  it("leaves vitest run (sub-command form) unchanged", () => {
    const { command, warnings } = validateTestCommand("vitest run");
    expect(command).toBe("vitest run");
    expect(warnings).toHaveLength(0);
  });

  it("appends --run to vitest with other flags but no --run", () => {
    const { command, warnings } = validateTestCommand("vitest --reporter=verbose");
    expect(command).toBe("vitest --reporter=verbose --run");
    expect(warnings).toHaveLength(1);
  });
});
