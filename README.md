# Ratchet

**Every click ships code.**

Ratchet is an autonomous iterative code improvement CLI. Point it at a target — it analyzes your code, proposes one focused change, builds, tests, and commits. Then repeats. Only improvements that pass tests are kept. The codebase can only ever get better.

```
ratchet torque --target error-handling --clicks 7
```

```
  Target : error-handling
  Path   : src/api/
  Agent  : shell
  Clicks : 7
  Tests  : npm test

  Score: 62/100 (14 issues found)
     Targeting: Empty catches (5/6), any types (4/5), functions >50 lines (3/4)

  ✓ Click 1 — passed [a3f9b21] — Score: 62 → 65 (+3) — 2 issues fixed
  ✗ Click 2 — rolled back
  ✓ Click 3 — passed [7bc1d44] — Score: 65 → 68 (+3) — 1 issues fixed
  ✓ Click 4 — passed [2e8f053] — Score: 68 → 71 (+3)
  ✓ Click 5 — passed [9da3c17] — Score: 71 → 73 (+2) — 1 issues fixed
  ✗ Click 6 — rolled back
  ✓ Click 7 — passed [f81b44a] — Score: 73 → 76 (+3) — 2 issues fixed

  Done. 5 landed · 2 rolled back · 4m 12s
```

---

## What is Ratchet?

A ratchet wrench only turns one way. Each click advances the socket — it can never slip back.

Ratchet works the same way on your codebase:

- **Click** — one full improve cycle: analyze → propose → build → test → commit
- **Torque** — the command that applies force to the codebase
- **The Pawl** — the anti-rollback mechanism: if tests fail, the change is reverted automatically
- **Tighten** — finalize the run and open a pull request

The result: a branch of real, tested commits — each one a measurable improvement.

---

## Quick Start

```bash
# Install globally
npm install -g @ratchet-run/cli

# Step 1: Initialize Ratchet in your project
ratchet init

# Step 2: Run improvement clicks on a target
ratchet torque --target error-handling

# Step 3: Check progress
ratchet status

# Step 4: Ship it — create a PR with all improvements
ratchet tighten --pr
```

**Prerequisites:** Node.js >=18, git, and an AI coding agent available on your PATH.

### Zero-config mode

If no `.ratchet.yml` exists, Ratchet auto-detects your project type, test command, and source paths. Just run:

```bash
ratchet torque
```

---

## Scoring System

Ratchet scans your codebase and produces a **Production Readiness Score** out of 100 points across 6 categories:

| Category | Max Points | What it measures |
|----------|-----------|------------------|
| Code Quality | 24 | Function length, line length, dead code, duplication |
| Testing | 20 | Coverage ratio, edge case depth, test quality |
| Security | 16 | Secrets, input validation, auth & rate limiting |
| Error Handling | 14 | Try/catch coverage, empty catches, structured logging |
| Performance | 14 | Async patterns, console cleanup, import hygiene |
| Type Safety | 12 | Strict config, `any` type count |

Each click targets specific issues from the scan. After each successful click, Ratchet re-scans to measure progress and update the issue backlog.

```bash
# Run a standalone scan
ratchet scan
```

---

## Commands

### `ratchet init [dir]`

Initialize Ratchet in your project. Auto-detects project type and test command.

```
Options:
  --force   Overwrite existing .ratchet.yml
```

### `ratchet scan [dir]`

Scan the project and generate a Production Readiness Score (0–100).

```bash
ratchet scan
ratchet scan ./my-project
```

### `ratchet torque`

Run the click loop — the main command.

```
Options:
  -t, --target <name>     Target from .ratchet.yml (omit for auto-detection)
  -n, --clicks <number>   Number of clicks (default: from config)
  --dry-run               Preview mode — no commits made
  --verbose               Show per-click timing, proposals, and modified files
  --no-branch             Skip creating a ratchet branch
  --mode <mode>           "normal" (default) or "harden" (write tests first)
  --swarm                 Enable swarm mode (N agents compete per click)
  --agents <number>       Number of agents in swarm mode (1–5, default: 3)
  --focus <specs>         Comma-separated specializations (see Swarm Mode)
  --adversarial           Enable adversarial QA (red team tests each change)
```

Creates branch `ratchet/<target>-<timestamp>` and writes a live log to `docs/<target>-ratchet.md`.

### `ratchet status`

Show the current or last run progress.

### `ratchet log`

Display the Ratchet log for a target.

```
Options:
  -t, --target <name>   Target to show log for
  --raw                 Print raw markdown
```

### `ratchet tighten`

Finalize a run and optionally open a pull request.

```
Options:
  --pr      Create a GitHub pull request (requires gh CLI)
  --draft   Create as draft PR
```

### `ratchet report`

Generate a detailed report (Markdown + PDF) of the last run.

### `ratchet simulate`

Simulate user personas navigating your product to find UX friction.

```
Options:
  -s, --scenario <name>    Scenario: onboarding, daily-use, premium-upgrade, or custom
  -p, --personas <number>  Number of persona agents (1–20, default: 5)
  -u, --url <url>          API base URL to test against
  -o, --output <path>      Save report as markdown file
  -m, --model <model>      Override LLM model
  --timeout <ms>           Timeout per persona call (default: 120000)
```

Built-in persona archetypes: power-user, casual, new-user, mobile, accessibility, api-developer.

```bash
ratchet simulate --scenario onboarding --personas 5 --output report.md
ratchet simulate --scenario daily-use --personas 10
```

---

## The Pawl (Rollback)

The Pawl is Ratchet's anti-regression mechanism. After each click:

1. Ratchet stashes your working tree state
2. The AI agent proposes and implements a change
3. Your full test suite runs against the change
4. **If tests pass** → commit the change, drop the stash
5. **If tests fail** → revert all changes, restore the stash

The codebase can only ever get better. Failed changes are silently discarded — no broken commits, no manual cleanup.

---

## Swarm Mode

Swarm mode runs multiple specialized AI agents **in parallel**, each in its own git worktree. The best result wins.

```bash
ratchet torque --target src --swarm --agents 3 --focus security,quality,errors
```

### How it works

1. Ratchet forks N git worktrees from HEAD
2. Each agent gets a specialization focus and runs independently
3. After all agents finish, Ratchet scores each result via `ratchet scan`
4. The agent with the highest score delta wins
5. The winning diff is applied to the main working directory
6. All worktrees are cleaned up

### Specializations

| Focus | What the agent prioritizes |
|-------|---------------------------|
| `security` | Auth flaws, injection, secrets, input validation |
| `performance` | Async patterns, N+1 queries, caching, memory leaks |
| `quality` | Code duplication, readability, complexity, dead code |
| `errors` | Empty catches, error propagation, logging, boundaries |
| `types` | `any` types, missing annotations, strict null checks |

Default specializations (when `--focus` is omitted): `security`, `quality`, `errors`.

---

## Adversarial QA

Adversarial mode adds a red team challenge after each successful click.

```bash
ratchet torque --target src --adversarial
```

### How it works

1. A click lands and passes tests
2. A red team agent analyzes the diff between original and new code
3. It writes a targeted regression test designed to catch subtle bugs
4. The test is appended to the existing test file and run
5. **If the regression test fails** → the change is reverted (the red team caught a bug)
6. **If the regression test passes** → the change is solid
7. The temporary test is always removed after the challenge

Combine with swarm mode for maximum rigor:

```bash
ratchet torque --target src --swarm --adversarial
```

---

## Harden Mode

When no test command is detected (or `--mode harden` is passed), Ratchet enters harden mode:

1. **Clicks 1–3**: Focus on writing tests for untested code
2. **Clicks 4+**: Switch to normal improvement mode, now protected by the new tests

```bash
ratchet torque --target src --mode harden
```

---

## Configuration (.ratchet.yml)

```yaml
agent: shell
model: claude-sonnet-4-6

defaults:
  clicks: 7
  test_command: npm test
  auto_commit: true
  harden_mode: false

targets:
  - name: error-handling
    path: src/api/
    description: "Improve error handling across all API routes"

  - name: types
    path: src/types/
    description: "Strengthen TypeScript types and remove any casts"

boundaries:
  - path: src/auth/
    rule: no-modify
    reason: "Auth architecture is intentional"

  - path: migrations/
    rule: no-delete
    reason: "Migration files are append-only"

swarm:
  enabled: false
  agent_count: 3
  specializations: [security, quality, errors]
  parallel: true
```

Run `ratchet init` to generate this file automatically.

### Configuration Fields

| Field | Description | Default |
|-------|-------------|---------|
| `agent` | AI backend: `shell`, `claude-code`, `codex` | `shell` |
| `model` | Model override (agent-specific) | — |
| `defaults.clicks` | Number of clicks per run | `7` |
| `defaults.test_command` | Command to run tests | `npm test` |
| `defaults.auto_commit` | Auto-commit passing clicks | `true` |
| `defaults.harden_mode` | Start in harden mode | `false` |
| `targets` | List of named targets | — |
| `boundaries` | Paths the agent must not touch | — |
| `swarm` | Swarm mode configuration | — |

### Boundary Rules

| Rule | Effect |
|------|--------|
| `no-modify` | Agent cannot change any file under this path |
| `no-delete` | Agent cannot delete files under this path |
| `preserve-pattern` | File structure and naming must be preserved |

---

## Project Layout

```
.ratchet.yml                     — configuration
.ratchet-state.json              — last run state (add to .gitignore)
docs/
  error-handling-ratchet.md      — living run log (commit this)
  error-handling-ratchet-report.md — run report with scores
```

Add `.ratchet-state.json` and `.ratchet.lock` to `.gitignore`. Commit the `docs/*-ratchet.md` logs — they're the receipts for what the agent did.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All clicks passed |
| `1` | Partial success (some clicks rolled back) |
| `2` | All clicks rolled back |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

```bash
git clone https://github.com/ratchet-run/ratchet
cd ratchet
npm install
npm test
```
