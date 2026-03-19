# Show HN: Ratchet – CLI that scores your codebase and autonomously fixes it

Hi HN, I built Ratchet because linters and static analysis tools just *report* problems. Ratchet scores your codebase, then fixes the issues it finds — one tested commit at a time.

## How it works

```
$ ratchet scan              # Score your project 0-100 across 8 dimensions
$ ratchet torque -c 7       # Run 7 AI-powered improvement clicks
$ ratchet torque --plan-first -c 7  # Plan first, then execute
```

Each "click" is one improvement cycle: analyze → propose a fix → implement → run your tests → commit if green, revert if red. **The ratchet only turns one way.** Your codebase can only get better.

## What it scores

Eight dimensions: security, testing, duplication, complexity, error handling, type safety, performance, code quality. Each rated 0–N points with concrete, fixable issues.

## Real results

We dogfooded Ratchet on a ~15K line TypeScript app (Express + React + Postgres):

- **Starting score:** 76/100
- **Current score:** 86/100 (after multiple torque runs)
- Pino structured logging migrated across 14 server files
- 6 overly-broad rate limiters narrowed to exact routes
- 2000-line routes.ts split into 13 domain modules
- Auth utilities DRY-refactored
- 891 tests passing throughout

Every commit was made by Ratchet. Every one passed the full test suite.

## Key features

- **Guard profiles** — Named presets (tight/refactor/broad/atomic) control how much the AI can change per click. Start tight, escalate when needed.
- **Smart escalation** — After 2+ consecutive guard rejections, Ratchet automatically bumps to the next profile. No manual babysitting.
- **Planning click** (`--plan-first`) — Read-only click 0 generates a structured plan before execution. The AI reads before it writes.
- **Architect mode** (`--architect`) — For cross-cutting refactors that span many files. Relaxed guards, bigger changes, same test-gate safety.
- **Cross-cutting detection** — Automatically classifies issues as single-file vs. cross-cutting and recommends the right mode.
- **Per-click category breakdown** — See exactly which scoring dimensions moved (or didn't) on each click. Flags wasted effort on maxed-out categories.
- **Vision** — Interactive dependency graph color-coded by quality score. Cyberpunk dark theme. Find your worst files in seconds.
- **Badge** — Score badge for your README.

## What it's NOT

- Not a linter. Ratchet makes changes, runs your tests, and commits.
- Not a one-shot "fix everything" tool. It's iterative — small, safe, tested increments.
- Not opinionated about your stack. Works with any project that has a test command (npm, pytest, go test, cargo, make, etc.).

## BYOK

Ratchet uses your AI provider API key. Claude, GPT, Codex, local models — bring whatever you want.

## Tech

TypeScript CLI. 852 tests. Modular engine architecture (normal/sweep/architect modes). Git-native — every change is a real commit you can inspect, cherry-pick, or revert.

Repo: https://github.com/giovanni-labs/ratchet

I'd love to hear:
1. Would you trust this on your codebase?
2. What scoring dimensions are we missing?
3. Is BYOK the right model, or would you prefer hosted?
