import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPlanFirst } from "../core/engine-plan.js";
import type { RatchetRun, Target, PlanResult } from "../types.js";
import type { ScanResult } from "../core/scanner";
import type { Agent } from "../core/agents/base.js";
import { mkdir, writeFile } from "fs/promises";

// Mock the file system operations
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("runPlanFirst", () => {
  let mockRun: RatchetRun;
  let mockTarget: Target;
  let mockAgent: any;
  let mockCallbacks: {
    onPlanStart?: () => Promise<void> | void;
    onPlanComplete?: (plan: PlanResult) => Promise<void> | void;
  };

  beforeEach(() => {
    mockRun = {
      id: "test-run-123",
      target: { name: "test-target", description: "Test project", path: "/test/path" },
      startedAt: new Date(),
      status: "running",
      clicks: [],
      planResult: undefined,
    } as any;

    mockTarget = {
      name: "test-target",
      description: "Test project",
      path: "/test/path",
    } as any;

    mockAgent = {
      analyze: vi.fn(async () => ""),
      propose: vi.fn(async () => ""),
      build: vi.fn(async () => ({ success: true, output: "" })) as any,
      runDirect: vi.fn().mockResolvedValue('{"steps": ["step1", "step2"], "strategy": "direct"}'),
    } as any;

    mockCallbacks = {
      onPlanStart: vi.fn(),
      onPlanComplete: vi.fn(),
    } as any;

    // Reset all mocks
    vi.clearAllMocks();
  });

  it("should call onPlanStart callback when provided", async () => {
    await runPlanFirst(mockRun, mockTarget, undefined, mockAgent, "/test", mockCallbacks);
    expect(mockCallbacks!.onPlanStart).toHaveBeenCalled();
  });

  it("should generate a plan when agent returns valid JSON", async () => {
    await runPlanFirst(mockRun, mockTarget, undefined, mockAgent, "/test", mockCallbacks);

    expect((mockAgent as any).runDirect).toHaveBeenCalled();
    expect(mockRun.planResult).toBeDefined();
    expect((mockRun.planResult as any)?.steps).toEqual(["step1", "step2"]);
    expect((mockRun.planResult as any)?.strategy).toBe("direct");
    expect(mockRun.planResult?.generatedAt).toBeInstanceOf(Date);
  });

  it("should save plan to filesystem when generated", async () => {
    await runPlanFirst(mockRun, mockTarget, undefined, mockAgent, "/test", mockCallbacks);

    expect(mkdir).toHaveBeenCalledWith("/test/.ratchet/plans", { recursive: true });
    expect(writeFile).toHaveBeenCalled();
  });

  it("should call onPlanComplete callback with plan result when plan is generated", async () => {
    await runPlanFirst(mockRun, mockTarget, undefined, mockAgent, "/test", mockCallbacks);

    expect(mockCallbacks!.onPlanComplete).toHaveBeenCalled();
    const calledWith = (mockCallbacks!.onPlanComplete as any)?.mock.calls[0][0];
    expect(calledWith).toBeDefined();
    expect(calledWith.steps).toEqual(["step1", "step2"]);
  });

  it("should handle agent output with markdown code fences", async () => {
    (mockAgent as any).runDirect = vi
      .fn()
      .mockResolvedValue('```json\n{"steps": ["step1", "step2"], "strategy": "direct"}\n```');

    await runPlanFirst(mockRun, mockTarget, undefined, mockAgent, "/test", mockCallbacks);

    expect(mockRun.planResult).toBeDefined();
    expect((mockRun.planResult as any)?.steps).toEqual(["step1", "step2"]);
  });

  it("should handle agent output without JSON gracefully", async () => {
    (mockAgent as any).runDirect = vi.fn().mockResolvedValue("No valid JSON here");

    await runPlanFirst(mockRun, mockTarget, undefined, mockAgent, "/test", mockCallbacks);

    expect(mockRun.planResult).toBeUndefined();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should handle agent errors gracefully (non-fatal)", async () => {
    (mockAgent as any).runDirect = vi.fn().mockRejectedValue(new Error("Agent failed"));

    await runPlanFirst(mockRun, mockTarget, undefined, mockAgent, "/test", mockCallbacks);

    expect(mockRun.planResult).toBeUndefined();
    expect(writeFile).not.toHaveBeenCalled();
    // Should not throw - plan generation is non-fatal
  });

  it("should handle agent without runDirect method", async () => {
    const agentWithoutDirect = {} as any;
    await runPlanFirst(mockRun, mockTarget, undefined, agentWithoutDirect, "/test", mockCallbacks);

    expect(mockRun.planResult).toBeUndefined();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should include scan summary in prompt when scan result is provided", async () => {
    const mockScan: ScanResult = {
      projectName: "test",
      issuesByType: [],
      total: 85,
      maxTotal: 100,
      totalIssuesFound: 15,
      categories: [],
    } as any;

    await runPlanFirst(mockRun, mockTarget, mockScan, mockAgent, "/test", mockCallbacks);

    // The scan summary should be included in the prompt passed to the agent
    const calledWith = (mockAgent as any).runDirect?.mock.calls[0];
    expect(calledWith).toBeDefined();
    expect(calledWith[0]).toContain("Score: 85/100, 15 issues found");
  });

  it("should use target path and description in prompt", async () => {
    await runPlanFirst(mockRun, mockTarget, undefined, mockAgent, "/test", mockCallbacks);

    const calledWith = (mockAgent as any).runDirect?.mock.calls[0];
    expect(calledWith).toBeDefined();
    expect(calledWith[0]).toContain("/test/path");
    expect(calledWith[0]).toContain("Test project");
  });
});
