import type { Target, BuildResult } from '../../types.js';

export interface Agent {
  /** Analyze the target context and return an analysis string */
  analyze(context: string): Promise<string>;

  /** Given an analysis, propose a single focused improvement */
  propose(analysis: string, target: Target): Promise<string>;

  /** Execute the proposal (make code changes) and return build result */
  build(proposal: string, cwd: string): Promise<BuildResult>;
}

export interface AgentOptions {
  model?: string;
  cwd?: string;
  timeout?: number;
}

export type AgentType = 'claude-code' | 'codex' | 'shell';

export function createAgentContext(target: Target, clickNumber: number): string {
  return [
    `Target: ${target.name}`,
    `Path: ${target.path}`,
    `Description: ${target.description}`,
    `Click: ${clickNumber}`,
  ].join('\n');
}
