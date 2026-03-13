export interface RatchetConfig {
  agent: 'claude-code' | 'codex' | 'shell';
  model?: string;
  defaults: {
    clicks: number;
    testCommand: string;
    autoCommit: boolean;
  };
  targets: Target[];
  boundaries?: Boundary[];
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
}

export interface RatchetRun {
  id: string;
  target: Target;
  clicks: Click[];
  startedAt: Date;
  finishedAt?: Date;
  status: 'running' | 'completed' | 'failed';
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
