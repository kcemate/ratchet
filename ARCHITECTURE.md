# Ratchet Architecture

> Every click ships code.

## Overview
Ratchet is a CLI tool that runs autonomous iterative improvement loops on codebases.
Point it at a target, it analyzes → proposes ONE change → builds → tests → commits → repeats.

## Stack
- **Language:** TypeScript
- **Runtime:** Node.js (>=18)
- **Package manager:** npm
- **Build:** tsup (fast, zero-config)
- **Testing:** Vitest
- **CLI framework:** Commander.js
- **Binary name:** `ratchet`

## Directory Structure
```
src/
  index.ts          — CLI entry point (commander)
  commands/
    init.ts         — `ratchet init` command
    torque.ts       — `ratchet torque` command (main run loop)
    status.ts       — `ratchet status` command
    log.ts          — `ratchet log` command
    tighten.ts      — `ratchet tighten` command (finalize + PR)
  core/
    engine.ts       — The click loop engine
    click.ts        — Single click execution (analyze → build → test → commit)
    config.ts       — .ratchet.yml parser
    git.ts          — Git operations (commit, branch, PR)
    runner.ts       — Test runner abstraction
    logger.ts       — Ratchet log writer (docs/<target>-ratchet.md)
    agents/
      base.ts       — Agent interface
      claude.ts     — Claude Code backend
      codex.ts      — Codex backend
      shell.ts      — Generic shell command backend
  types.ts          — Shared types
tests/
  engine.test.ts
  click.test.ts
  config.test.ts
  git.test.ts
  runner.test.ts
```

## Key Types
```typescript
interface RatchetConfig {
  agent: 'claude-code' | 'codex' | 'shell';
  model?: string;
  defaults: {
    clicks: number;
    testCommand: string;
    autoCommit: boolean;
  };
  targets: Target[];
  boundaries?: Boundary[];  // .ratchet.yml boundary rules
}

interface Target {
  name: string;
  path: string;
  description: string;
}

interface Boundary {
  path: string;
  rule: 'no-modify' | 'no-delete' | 'preserve-pattern';
  reason?: string;
}

interface Click {
  number: number;
  target: string;
  analysis: string;
  proposal: string;
  filesModified: string[];
  testsPassed: boolean;
  commitHash?: string;
  timestamp: Date;
}

interface RatchetRun {
  id: string;
  target: Target;
  clicks: Click[];
  startedAt: Date;
  finishedAt?: Date;
  status: 'running' | 'completed' | 'failed';
}
```

## CLI Commands

### `ratchet init [dir]`
- Creates `.ratchet.yml` with defaults
- Detects test command (npm test, pytest, etc.)
- Detects project language

### `ratchet torque --target <name> [--clicks <n>]`
- Main command — runs the click loop
- Creates a branch: `ratchet/<target>-<timestamp>`
- Executes N clicks sequentially
- Each click: analyze → propose → build → test → commit
- The Pawl: if tests fail, revert and try different improvement
- Logs to `docs/<target>-ratchet.md`

### `ratchet status`
- Shows current/last run progress
- Click count, pass/fail, time elapsed

### `ratchet log [--target <name>]`
- Displays the ratchet log for a target
- Shows all clicks with summaries

### `ratchet tighten [--pr]`
- Finalizes the run
- Optionally creates a PR with all changes + ratchet log as description

## Agent Backend Interface
```typescript
interface Agent {
  analyze(context: string): Promise<string>;  // returns analysis
  propose(analysis: string, target: Target): Promise<string>;  // returns proposal
  build(proposal: string, cwd: string): Promise<BuildResult>;  // executes the change
}
```

The agent abstraction allows swapping Claude Code, Codex, or any shell-based tool.
Default agent: `shell` (runs claude --print under the hood).

## The Pawl (Rollback Protection)
- Before each click: `git stash` current state
- After build: run tests
- If tests pass: commit
- If tests fail: `git stash pop` to restore, log the failed attempt, try next improvement
- Net effect: the codebase can only get better, never worse

## Config: .ratchet.yml
```yaml
agent: claude-code
model: claude-sonnet-4-6
defaults:
  clicks: 7
  test_command: npm test
  auto_commit: true
targets:
  - name: error-handling
    path: src/api/
    description: "Improve error handling across all API routes"
boundaries:
  - path: src/auth/
    rule: no-modify
    reason: "Auth architecture is intentional — Clerk dual-mode"
  - path: "**/*.test.ts"
    rule: preserve-pattern
    reason: "Test structure follows team convention"
```
