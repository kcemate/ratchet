import type { Target, BuildResult, HardenPhase } from "../../types.js";
import type { IssueTask } from "../issue-backlog.js";

export interface Agent {
  /** Analyze the target context and return an analysis string */
  analyze(context: string, hardenPhase?: HardenPhase, issues?: IssueTask[]): Promise<string>;

  /** Given an analysis, propose a single focused improvement */
  propose(analysis: string, target: Target, hardenPhase?: HardenPhase, issues?: IssueTask[]): Promise<string>;

  /** Execute the proposal (make code changes) and return build result */
  build(proposal: string, cwd: string): Promise<BuildResult>;
}

export interface AgentOptions {
  model?: string;
  cwd?: string;
  timeout?: number;
}

export type AgentType = "claude-code" | "codex" | "shell";

export function createAgentContext(target: Target, clickNumber: number, hardenPhase?: HardenPhase): string {
  const lines = [
    `Target: ${target.name}`,
    `Path: ${target.path}`,
    `Description: ${target.description}`,
    `Click: ${clickNumber}`,
  ];
  if (hardenPhase) {
    lines.push(`Mode: ${hardenPhase}`);
  }
  return lines.join("\n");
}
