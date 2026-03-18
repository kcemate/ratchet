export type HardenPhase = 'harden:tests' | 'improve';

export interface SwarmConfig {
  enabled: boolean;
  /** Number of competing agents per swarm click (default: 3) */
  agentCount: number;
  /** Which specializations to use (default: security, quality, errors) */
  specializations: string[];
  /** Run agents in parallel (default: true) */
  parallel: boolean;
  /** Temp directory for git worktrees (default: /tmp/ratchet-swarm) */
  worktreeDir: string;
}

export interface ClickGuards {
  /** Max lines changed per click — reject before testing if exceeded (default: 40) */
  maxLinesChanged: number;
  /** Max files changed per click — reject before testing if exceeded (default: 3) */
  maxFilesChanged: number;
}

export interface RatchetConfig {
  agent: 'claude-code' | 'codex' | 'shell';
  model?: string;
  defaults: {
    clicks: number;
    testCommand: string;
    autoCommit: boolean;
    hardenMode?: boolean;
  };
  targets: Target[];
  boundaries?: Boundary[];
  swarm?: SwarmConfig;
  /** Click scope guards — reject over-aggressive changes before running tests */
  guards?: ClickGuards;
  /** Set to 'auto-detected' when config was generated from project detection, not a .ratchet.yml */
  _source?: 'file' | 'auto-detected';
  /** True when no test command was found during auto-detection; harden mode should be enabled */
  _noTestCommand?: boolean;
}

export interface Target {
  name: string;
  path: string;
  description: string;
}

export interface Boundary {
  path: string;
  rule: 'no-modify' | 'no-delete' | 'preserve-pattern';
  reason?: string;
}

export interface Click {
  number: number;
  target: string;
  analysis: string;
  proposal: string;
  filesModified: string[];
  testsPassed: boolean;
  commitHash?: string;
  timestamp: Date;
  scoreAfterClick?: number;  // total score after this click
  issuesFixedCount?: number; // how many issues this click resolved
  riskScore?: number; // 0–1 blast radius risk from GitNexus (0=isolated, 1=high-impact)
  swarmSpecialization?: string; // which swarm agent won (e.g. 'security', 'quality')
  rollbackReason?: string; // short summary of why this click was rolled back
  adversarialResult?: {
    challenged: boolean;
    passed: boolean;
    reasoning: string;
  };
}

export interface RatchetRun {
  id: string;
  target: Target;
  clicks: Click[];
  startedAt: Date;
  finishedAt?: Date;
  status: 'running' | 'completed' | 'failed';
  earlyStopReason?: string; // set when the engine stopped early (e.g. architect-only issues remain)
}

export interface BuildResult {
  success: boolean;
  output: string;
  filesModified: string[];
  error?: string;
}

export interface TestResult {
  passed: boolean;
  output: string;
  duration: number;
  error?: string;
}

export interface RunnerOptions {
  command: string;
  cwd: string;
  timeout?: number;
}

export interface GitStatus {
  branch: string;
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface EngineOptions {
  target: string;
  clicks: number;
  config: RatchetConfig;
  cwd: string;
  dryRun?: boolean;
}

export interface SwarmAgentResult {
  agentName: string;
  specialization: string;
  outcome: {
    click: Click;
    rolled_back: boolean;
  };
  scoreDelta: number;
  worktreePath: string;
}

export interface SwarmResult {
  /** The winning outcome (highest score delta), or null if all agents failed */
  winner: {
    click: Click;
    rolled_back: boolean;
  } | null;
  /** Results from all agents */
  allResults: SwarmAgentResult[];
  /** Whether the swarm timed out */
  timedOut: boolean;
}
