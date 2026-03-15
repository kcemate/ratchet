# Ratchet Swarm Mode — Technical Specification

**Author:** Giovanni (AI Architect)
**Date:** 2026-03-14
**Status:** Draft — awaiting Kyle's review

---

## Vision

Ratchet today: 1 agent, 1 click, linear. Most clicks roll back because a single agent makes overly aggressive changes.

Ratchet Swarm: N agents per click, competing in parallel. Best change wins. Survival of the fittest applied to code improvement.

Inspired by MiroFish's swarm intelligence methodology — but applied to deterministic code quality instead of prediction.

---

## Architecture

### Core Concept: Competitive Clicks

```
┌─────────────────────────────────────────────┐
│                SWARM CLICK                  │
│                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Agent A  │ │ Agent B  │ │ Agent C  │      │
│  │ Security │ │ Perf    │ │ Quality │       │
│  │ focused  │ │ focused │ │ focused │       │
│  └────┬─────┘ └────┬────┘ └────┬────┘       │
│       │             │           │            │
│       ▼             ▼           ▼            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Patch A  │ │ Patch B  │ │ Patch C  │      │
│  └────┬─────┘ └────┬────┘ └────┬────┘       │
│       │             │           │            │
│       ▼             ▼           ▼            │
│  ┌─────────────────────────────────────┐    │
│  │         TEST ALL THREE              │    │
│  │   A: ✓ pass  B: ✗ fail  C: ✓ pass  │    │
│  └─────────────────────────────────────┘    │
│       │                         │            │
│       ▼                         ▼            │
│  ┌─────────────────────────────────────┐    │
│  │         SCORE COMPARISON            │    │
│  │   A: 59→61 (+2)  C: 59→60 (+1)     │    │
│  │   Winner: Agent A                   │    │
│  └─────────────────────────────────────┘    │
│       │                                      │
│       ▼                                      │
│  ┌──────────┐                               │
│  │ COMMIT A │                               │
│  └──────────┘                               │
└─────────────────────────────────────────────┘
```

### How It Works

1. **Fork**: Create N git worktrees (one per agent) from the same HEAD
2. **Compete**: Each agent runs its click in parallel (different specialization prompts)
3. **Test**: Run test suite in each worktree
4. **Score**: Run `ratchet scan` on each passing worktree
5. **Select**: Pick the change with the highest score delta
6. **Merge**: Apply the winning patch to main, commit, clean up worktrees
7. **Repeat**: Next swarm click starts from the new HEAD

### Agent Specializations

Each agent gets a different system prompt focus:

| Agent | Focus | Prompt Emphasis |
|-------|-------|-----------------|
| `security` | Auth, input validation, injection, secrets | "Fix security vulnerabilities first" |
| `performance` | Async patterns, N+1 queries, caching | "Optimize for performance and efficiency" |
| `quality` | Duplication, function length, readability | "Reduce complexity and improve readability" |
| `errors` | Empty catches, error propagation, logging | "Improve error handling and observability" |
| `types` | Any types, strict null checks, Zod schemas | "Strengthen type safety" |

Default swarm size: 3 agents (security, quality, errors)
Max swarm size: 5 (all specializations)

---

## CLI Interface

```bash
# Basic swarm mode — 3 agents compete per click
ratchet torque --target groups --swarm

# Custom swarm size
ratchet torque --target groups --swarm --agents 5

# Pick specializations
ratchet torque --target groups --swarm --focus security,performance,types

# Combine with existing flags
ratchet torque --target groups --swarm --clicks 3 --agents 3
```

### New Config in .ratchet.yml

```yaml
swarm:
  enabled: false          # opt-in
  agents: 3               # default swarm size
  focus:                   # default specializations
    - security
    - quality
    - errors
  selection: best-score   # "best-score" | "most-files" | "first-pass"
  parallel: true          # run agents in parallel (false = sequential)
  worktree_dir: /tmp/ratchet-swarm  # temp worktree location
```

---

## Modes (Future)

Swarm is Mode 1. The architecture supports future modes using the same multi-agent infra:

### Mode 1: Swarm Clicks (this spec)
Multiple agents compete on the same issue. Best wins.

### Mode 2: Adversarial QA
After a click lands, spawn a "red team" agent that tries to write a failing test for the new code. If the red team succeeds → the change was fragile, roll back. If it fails to break it → the change is solid.

```bash
ratchet torque --target groups --adversarial
```

### Mode 3: User Simulation (future — not code changes)
Spawn N agents as different user personas. Each "uses" the app via API calls. Report which flows break, which are confusing, which features get ignored.

```bash
ratchet simulate --personas 20 --scenario onboarding
```

### Mode 4: Architecture Debate (future)
Spawn N agents with different architectural philosophies. Give them a design problem. They debate and produce a recommendation document.

```bash
ratchet debate --topic "auth: JWT vs session cookies" --agents 4
```

---

## Implementation Plan

### Phase 1: Core Swarm (this sprint)
- [ ] `src/core/swarm.ts` — SwarmExecutor class
  - `forkWorktrees(n)` — create N git worktrees from HEAD
  - `runParallel(agents, worktrees)` — execute clicks in parallel
  - `selectWinner(results)` — compare scores, pick best
  - `mergeWinner(patch, mainCwd)` — apply winning diff to main
  - `cleanup(worktrees)` — remove temp worktrees
- [ ] `src/core/agents/specialized.ts` — agent specialization prompts
- [ ] Update `engine.ts` to support `swarm: true` mode
- [ ] Update `torque` command with `--swarm`, `--agents`, `--focus` flags
- [ ] Tests for swarm executor (mock agents, deterministic selection)

### Phase 2: Adversarial QA
- [ ] `src/core/adversarial.ts` — RedTeamAgent
- [ ] Post-click hook: spawn red team → try to break it → confirm or rollback
- [ ] `--adversarial` flag

### Phase 3: Simulation
- [ ] `src/core/simulate.ts` — PersonaAgent
- [ ] Persona templates (power user, casual, new user, accessibility)
- [ ] `ratchet simulate` subcommand

---

## Key Design Decisions

1. **Git worktrees, not branches**: Worktrees allow true parallel execution without branch switching. Each agent has its own working directory. Clean, fast, no conflicts.

2. **Score-based selection**: The winner is objective — highest score delta wins. No subjective "which change looks better."

3. **Fail-fast**: If all agents fail tests, the click is a no-op (same as today). The Pawl principle still holds — codebase only ever gets better.

4. **Cost awareness**: 3 agents = 3x the API cost per click. Default to 3, max 5. The `--swarm` flag is opt-in so single-agent mode remains the default for cost-sensitive runs.

5. **Same test suite**: All agents run against the same test command. No special treatment. If your change breaks tests, you lose.

---

## Cost Model

| Mode | Agents/Click | Est. Cost/Click | 10-Click Run |
|------|-------------|-----------------|--------------|
| Normal | 1 | ~$0.03 | ~$0.30 |
| Swarm-3 | 3 | ~$0.09 | ~$0.90 |
| Swarm-5 | 5 | ~$0.15 | ~$1.50 |
| Swarm-3 + Adversarial | 4 | ~$0.12 | ~$1.20 |

Still dirt cheap for meaningful code improvement.

---

## Success Metrics

- **Land rate**: Swarm should achieve >60% land rate (vs ~33% single-agent today)
- **Score delta**: Average +2 per swarm click (vs +0.5 single-agent)
- **Time**: <2 min per swarm click (parallel execution)
- **First milestone**: Score DD from 59 → 75 in a single swarm run

---

*"One agent is smart. A swarm is inevitable."*
