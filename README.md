# ⚙ Ratchet

**Every click ships code.**

Ratchet is an autonomous iterative code improvement CLI. Point it at a target — it analyzes your code, proposes one focused change, builds, tests, and commits. Then repeats. Only improvements that pass tests are kept. The codebase can only ever get better.

```
ratchet torque --target error-handling --clicks 7
```

```
⚙  Ratchet Torque

  Target : error-handling
  Path   : src/api/
  Agent  : shell
  Clicks : 7
  Tests  : npm test

  ✓ Click 1 [a3f9b21] — add null check to getUserById
  ✗ Click 2 [rolled back] — proposed change broke 3 tests
  ✓ Click 3 [7bc1d44] — extract error formatting helper
  ✓ Click 4 [2e8f053] — add missing async/await to middleware
  ✓ Click 5 [9da3c17] — remove duplicate error logger import
  ✗ Click 6 [rolled back] — type mismatch in response handler
  ✓ Click 7 [f81b44a] — normalize HTTP status codes in catch blocks

  ──────────────────────────────────────────────────

  Done. 5 landed · 2 rolled back · 4m 12s

  Log: docs/error-handling-ratchet.md
  Run ratchet tighten --pr to open a pull request.
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
npm install -g ratchet

# Or run without installing
npx ratchet init

# Step 1: Initialize Ratchet in your project
ratchet init

# Step 2: Run 7 improvement clicks on a target
ratchet torque --target error-handling

# Step 3: Check progress mid-run
ratchet status

# Step 4: Ship it — create a PR with all improvements
ratchet tighten --pr
```

**Prerequisites:** Node.js >=18, git, and an AI coding agent available on your PATH (e.g. `claude`).

---

## How It Works

For each click, Ratchet:

1. **Analyzes** the target path — reads the code, understands the current state
2. **Proposes** one focused improvement — small scope, single concern
3. **Builds** — the agent implements the change
4. **Tests** — runs your full test suite against the change
5. **Commits** if tests pass — or **reverts** if they fail (the Pawl)
6. Repeats

At the end you have a branch of N commits, all green, all logged.

---

## .ratchet.yml

```yaml
agent: default
model: claude-sonnet-4-6

defaults:
  clicks: 7
  test_command: npm test
  auto_commit: true

targets:
  - name: error-handling
    path: src/api/
    description: "Improve error handling across all API routes"

  - name: types
    path: src/types/
    description: "Strengthen TypeScript types and remove any casts"

  - name: performance
    path: src/db/
    description: "Optimize database queries and reduce N+1 patterns"
```

Run `ratchet init` to generate this file automatically with your project's detected settings.

### Configuration Fields

| Field | Description | Default |
|-------|-------------|---------|
| `agent` | AI backend: `default`, `shell` | `shell` |
| `model` | Model override (agent-specific) | — |
| `defaults.clicks` | Number of clicks per run | `7` |
| `defaults.test_command` | Command to run tests | `npm test` |
| `defaults.auto_commit` | Auto-commit passing clicks | `true` |
| `targets` | List of named targets | — |
| `boundaries` | Paths the agent must not touch | — |

See [docs/configuration.md](docs/configuration.md) for the full reference.

---

## Boundaries

Boundaries protect critical code from agent modification. Define them in `.ratchet.yml`:

```yaml
boundaries:
  - path: src/auth/
    rule: no-modify
    reason: "Auth architecture is intentional — Clerk dual-mode"

  - path: "**/*.test.ts"
    rule: preserve-pattern
    reason: "Test structure follows team convention"

  - path: migrations/
    rule: no-delete
    reason: "Migration files are append-only"
```

| Rule | Effect |
|------|--------|
| `no-modify` | Agent cannot change any file under this path |
| `no-delete` | Agent cannot delete files under this path |
| `preserve-pattern` | File structure and naming must be preserved |

---

## CLI Reference

### `ratchet init [dir]`

Initialize Ratchet in your project. Auto-detects project type and test command.

```
Options:
  --force   Overwrite existing .ratchet.yml
```

Supports: `npm`, `yarn`, `pnpm`, `pytest`, `go test`, `cargo test`, `make test`

---

### `ratchet torque`

Run the click loop. This is the main command.

```
Options:
  -t, --target <name>    Target from .ratchet.yml (required)
  -n, --clicks <number>  Number of clicks (default: from config)
  --dry-run              Preview mode — no commits made
  --verbose              Show per-click timing, proposal preview, and modified files
  --no-branch            Skip creating a ratchet branch
```

Creates branch: `ratchet/<target>-<timestamp>`
Writes live log to: `docs/<target>-ratchet.md`

---

### `ratchet status`

Show the current or last run progress.

```
⚙  Ratchet Status

  Run ID  : 7a3f9b21-...
  Target  : error-handling (src/api/)
  Status  : completed ✓
  Clicks  : 5 passed / 7 total
  Time    : 4m 12s

  Click history:
    ✓ Click 1 [a3f9b21]
    ✗ Click 2 [rolled back]
    ✓ Click 3 [7bc1d44]
    ...
```

---

### `ratchet log`

Display the Ratchet log for a target.

```
Options:
  -t, --target <name>   Target to show log for
  --raw                 Print raw markdown (no color)
```

The log lives at `docs/<target>-ratchet.md` — commit it alongside your code changes.

---

### `ratchet tighten`

Finalize a run and optionally open a pull request.

```
Options:
  --pr      Create a GitHub pull request (requires gh CLI)
  --draft   Create as draft PR
```

The PR description includes the full ratchet log — analysis, proposals, and commit hashes for every click.

---

## Agent Backends

| Agent | Description |
|-------|-------------|
| `shell` | Runs an AI coding agent via shell command (default) |
| `claude-code` | Claude Code native integration |
| `codex` | OpenAI Codex via API |

The agent abstraction is open — implement the `Agent` interface to add your own.

---

## Real-World Use Cases

**Harden error handling before a release**
```yaml
targets:
  - name: error-handling
    path: src/api/
    description: "Add try/catch, improve error messages, log failures consistently"
```

**Tighten TypeScript types on a legacy codebase**
```yaml
targets:
  - name: types
    path: src/
    description: "Replace 'any' types with proper types, add missing generics"
```

**Improve test coverage incrementally**
```yaml
targets:
  - name: test-coverage
    path: src/utils/
    description: "Add unit tests for untested utility functions"
```

**Reduce bundle size before shipping**
```yaml
targets:
  - name: bundle-size
    path: src/components/
    description: "Remove unused imports, lazy load heavy dependencies"
```

---

## Why Not X?

**vs. GitHub Copilot / Cursor** — Those require a human in the loop for every suggestion. Ratchet is fully autonomous: define the target and walk away. Come back to a branch of tested commits.

**vs. Devin / SWE-bench agents** — Devin is a general-purpose software engineer agent. Ratchet is a focused iteration tool. It doesn't architect features or reason about requirements — it applies one tight improvement per click with a mechanical guarantee that every commit is green.

**vs. automated refactoring tools** — Those find or fix specific known patterns. Ratchet explores the improvement space and surfaces things you didn't know to look for.

**The core insight:** Most codebases don't need a rewrite — they need 50 small improvements. Ratchet applies those 50 improvements, one tested commit at a time, while you do other things.

---

## Project Layout

```
.ratchet.yml                     — configuration
.ratchet-state.json              — last run state (add to .gitignore)
docs/
  error-handling-ratchet.md      — living run log (commit this)
  types-ratchet.md
```

Add `.ratchet-state.json` to `.gitignore`. Commit the `docs/*-ratchet.md` logs — they're the receipts for what the agent did.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

```bash
git clone https://github.com/ratchet-run/ratchet
cd ratchet
npm install
npm test
```

Ratchet uses Ratchet to improve itself. The `docs/` directory contains logs from real self-improvement runs.

---

## License

ISC
