# ⚙ Ratchet

**Every click ships code.**

Ratchet is an autonomous iterative code improvement CLI. Point it at a target — it analyzes your code, proposes one focused change, builds, tests, and commits. Then repeats. Only improvements that pass tests are kept. The codebase can only ever get better.

```
ratchet torque --target error-handling --clicks 7
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
# Install
npm install -g ratchet

# Initialize Ratchet in your project
ratchet init

# Run 7 improvement clicks on a target
ratchet torque --target error-handling

# Check progress
ratchet status

# Create a PR with all improvements
ratchet tighten --pr
```

Or run without installing:

```bash
npx ratchet init
npx ratchet torque --target error-handling
```

---

## How It Works

```
ratchet torque --target error-handling --clicks 7
```

For each click, Ratchet:

1. **Analyzes** the target path — reads the code, understands context
2. **Proposes** one focused improvement — small scope, one concern
3. **Builds** — the agent implements the change
4. **Tests** — runs your test suite against the change
5. **Commits** (if tests pass) — or **reverts** (if tests fail — the Pawl)
6. Repeats

At the end, you have a branch of N commits, all green, all logged.

```
  ✓ Click 1 [a3f9b21] — add null check to getUserById
  ✗ Click 2 [rolled back] — proposed change broke 3 tests
  ✓ Click 3 [7bc1d44] — extract error formatting helper
  ✓ Click 4 [2e8f053] — add missing async/await to middleware
  ...
```

---

## .ratchet.yml

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

  - name: types
    path: src/types/
    description: "Strengthen TypeScript types and remove any casts"
```

### Fields

| Field | Description | Default |
|-------|-------------|---------|
| `agent` | AI backend: `claude-code`, `codex`, `shell` | `shell` |
| `model` | Model override (agent-specific) | — |
| `defaults.clicks` | Number of clicks per run | `7` |
| `defaults.test_command` | Command to run tests | `npm test` |
| `defaults.auto_commit` | Auto-commit passing clicks | `true` |
| `targets` | List of named targets | — |
| `boundaries` | Paths the agent must not touch | — |

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

### Boundary Rules

| Rule | Effect |
|------|--------|
| `no-modify` | Agent cannot change any file under this path |
| `no-delete` | Agent cannot delete files under this path |
| `preserve-pattern` | File structure/naming must be preserved |

Boundaries are the enterprise feature. Use them to protect auth, migrations, shared contracts, or anything architectural.

---

## CLI Reference

### `ratchet init [dir]`

Initialize Ratchet in your project. Auto-detects project type and test command.

```
Options:
  --force   Overwrite existing .ratchet.yml
```

**Supports:** `npm`, `yarn`, `pnpm`, `pytest`, `go test`, `cargo test`, `make test`

---

### `ratchet torque`

Run the click loop. This is the main command.

```
Options:
  -t, --target <name>    Target from .ratchet.yml (required)
  -n, --clicks <number>  Number of clicks (default: from config)
  --dry-run              Preview mode — no commits
  --verbose              Show per-click file details
  --no-branch            Skip creating a ratchet branch
```

Creates a branch: `ratchet/<target>-<timestamp>`

Writes a live log to: `docs/<target>-ratchet.md`

---

### `ratchet status`

Show the current or last run.

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
  --raw                 Print raw markdown
```

The log lives at `docs/<target>-ratchet.md` — commit it alongside your code changes.

---

### `ratchet tighten`

Finalize a run and optionally open a PR.

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
| `shell` | Runs `claude --print` under the hood (default) |
| `claude-code` | Claude Code native integration |
| `codex` | OpenAI Codex via API |

The agent abstraction is open — add your own by implementing the `Agent` interface.

---

## Why Not X?

### vs. GitHub Copilot / Cursor

Copilot and Cursor require a human in the loop. Ratchet is fully autonomous — you define the target and constraints, then walk away. Come back to a branch of tested commits.

### vs. Devin / SWE-bench agents

Devin is a general-purpose software engineer agent. Ratchet is a **focused iteration tool**. It doesn't architect features or reason about requirements. It applies one tight improvement per click, with a mechanical guarantee that every commit is green.

### vs. `git bisect` / automated refactoring

Those find or fix specific known bugs. Ratchet explores the improvement space — it surfaces things you didn't know to look for.

### The core insight

Most codebases don't need a rewrite — they need 50 small improvements. Ratchet applies those 50 improvements, one tested commit at a time, while you do other things.

---

## Directory Structure

```
.ratchet.yml              — configuration
.ratchet-state.json       — last run state (gitignored)
docs/
  error-handling-ratchet.md   — living run log (commit this)
  types-ratchet.md
```

Add `.ratchet-state.json` to `.gitignore`. Commit the `docs/*-ratchet.md` logs — they're the receipts for what the agent did.

---

## Contributing

```bash
git clone https://github.com/ratchet-run/ratchet
cd ratchet
npm install
npm test
```

Architecture overview in `ARCHITECTURE.md`.

PRs welcome. The codebase eats its own dog food — Ratchet uses Ratchet to improve itself.

---

## License

ISC

---

*Built with [Claude Code](https://claude.ai/code). Every click ships code.*
