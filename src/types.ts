export type HardenPhase = 'harden:tests' | 'improve';

export type RollbackReason =
  | 'test-related'
  | 'test-unrelated'
  | 'timeout'
  | 'scope-exceeded'
  | 'score-regression'
  | 'lint-error'
  | 'guard-rejected';

export interface ClickEconomics {
  clickIndex: number;
  wallTimeMs: number;
  agentTimeMs: number;
  testTimeMs: number;
  /** USD estimate based on diff size and model pricing */
  estimatedCost: number;
  outcome: 'landed' | 'rolled-back' | 'timeout' | 'scope-rejected' | 'guard-rejected';
  rollbackReason?: RollbackReason;
  issuesFixed: number;
  scoreDelta: number;
}

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

export type GuardProfileName = 'tight' | 'refactor' | 'broad' | 'atomic';

/** Named guard profiles. null means no limits (test suite is the only gate). */
export const GUARD_PROFILES: Record<GuardProfileName, ClickGuards | null> = {
  tight:   { maxFilesChanged: 3,  maxLinesChanged: 40  },
  refactor: { maxFilesChanged: 12, maxLinesChanged: 280 },
  broad:   { maxFilesChanged: 20, maxLinesChanged: 500 },
  atomic:  null,
};

export interface TestGateResult {
  passed: boolean;
  gate: 'lint' | 'related' | 'full';
  output: string;
  durationMs: number;
  failedTests: string[];
  unrelatedFailures?: string[];
  landedWithWarning?: boolean;
  warningMessage?: string;
}

export interface RatchetConfig {
  agent: 'claude-code' | 'codex' | 'shell';
  model?: string;
  defaults: {
    clicks: number;
    testCommand: string;
    autoCommit: boolean;
    hardenMode?: boolean;
    /** Enable targeted test isolation (progressive gates + failure classification) */
    testIsolation?: boolean;
    /** Command for running only tests related to changed files (default: 'npx vitest --related') */
    testRelatedCmd?: string;
    /** Land commit even if unrelated tests fail (default: false) */
    allowUnrelatedFailures?: boolean;
    /** Run full test suite before click loop to record pre-existing failures (default: false) */
    baselineTests?: boolean;
    /** Run lint → related → full gates in sequence, failing fast (default: false) */
    progressiveGates?: boolean;
    /** Command for lint/typecheck gate (default: 'npx tsc --noEmit') */
    lintCmd?: string;
  };
  targets: Target[];
  boundaries?: Boundary[];
  swarm?: SwarmConfig;
  /** Click scope guards — named profile or explicit limits */
  guards?: GuardProfileName | ClickGuards;
  /** Set to 'auto-detected' when config was generated from project detection, not a .ratchet.yml */
  _source?: 'file' | 'auto-detected';
  /** True when no test command was found during auto-detection; harden mode should be enabled */
  _noTestCommand?: boolean;
}

export interface Target {
  name: string;
  path: string;
  description: string;
  /** Per-target guard override — named profile or explicit limits */
  guards?: GuardProfileName | ClickGuards;
}

export interface Boundary {
  path: string;
  rule: 'no-modify' | 'no-delete' | 'preserve-pattern';
  reason?: string;
}

export interface CategoryDelta {
  category: string;
  before: number;
  max: number;
  after: number;
  delta: number;
  issuesFixed: number;
  wastedEffort: boolean; // true when issuesFixed > 0 but delta === 0 (category already maxed)
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
  categoryDeltas?: CategoryDelta[]; // per-category score changes for this click
  adversarialResult?: {
    challenged: boolean;
    passed: boolean;
    reasoning: string;
  };
}

export interface PlanResult {
  filesToTouch: string[];
  extractionTargets: Array<{ name: string; files: string[]; pattern: string }>;
  dependencyOrder: string[];
  estimatedClicks: number;
  generatedAt: Date;
}

export interface RatchetRun {
  id: string;
  target: Target;
  clicks: Click[];
  startedAt: Date;
  finishedAt?: Date;
  status: 'running' | 'completed' | 'failed';
  earlyStopReason?: string; // set when the engine stopped early (e.g. architect-only issues remain)
  architectEscalated?: boolean; // set when the engine escalated to architect mode mid-run
  planResult?: PlanResult; // set when --plan-first generates a click 0 plan
  /** Resolved scope file paths (absolute). Present when --scope was specified. */
  scope?: string[];
  /** Raw --scope argument for display. */
  scopeArg?: string;
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
