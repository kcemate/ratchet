# How Ratchet Works

> A ratchet wrench only turns one way. Each click advances the socket — it can never slip back.

---

## The Metaphor

A ratchet wrench is a tool that converts back-and-forth motion into one-way rotation. The key mechanism is the **pawl** — a small lever that locks against a gear's teeth on the return stroke. The gear can only advance, never retreat.

Ratchet applies this same principle to code improvement:

- Each **click** is one full improve cycle
- The **pawl** is the test suite — if tests fail, the change is reverted
- The codebase can only ever get better

After N clicks you have N commits, all green, all logged. No regressions. No manual review of individual AI suggestions. Just a branch of proven improvements.

---

## The Click Loop

A single click goes through five phases:

```
┌─────────────────────────────────────────────────────────────┐
│                        ONE CLICK                            │
│                                                             │
│  1. ANALYZE   Read target code, identify improvement areas  │
│       ↓                                                     │
│  2. PROPOSE   Pick ONE focused change to make               │
│       ↓                                                     │
│  3. BUILD     Agent implements the change                   │
│       ↓                                                     │
│  4. TEST      Run full test suite                           │
│       ↓                                                     │
│  5a. COMMIT   Tests passed → lock it in (the ratchet turns) │
│  5b. REVERT   Tests failed → restore prior state (the Pawl) │
└─────────────────────────────────────────────────────────────┘
```

The agent never touches tests. It can only modify the target path. If the change breaks anything — even something seemingly unrelated — it gets rolled back.

---

## Phase Details

### 1. Analyze

The agent reads the target path and identifies potential improvements. It returns a list of 3–5 specific opportunities based on the target description.

Example analysis output:
```
1. getUserById() has no null check — returns undefined silently on missing user
2. Error logging is inconsistent — some routes use console.error, others throw
3. The middleware chain swallows async errors without forwarding to error handler
```

---

### 2. Propose

From the analysis, the agent selects ONE improvement and describes it concretely: which file, what change, why.

This single-improvement constraint is deliberate. Small, focused changes:
- Are easier to test
- Are easier to review
- Produce cleaner git history
- Fail less often (simpler changes = fewer side effects)

---

### 3. Build

The agent implements the proposed change. This is where actual file modifications happen.

The agent writes `MODIFIED: <filepath>` lines to stdout for each file it touches — Ratchet uses this to track what changed.

---

### 4. Test

Ratchet runs your configured `test_command`. The full test suite, not just tests related to the change.

This is intentional. A change that breaks an unrelated test is still a breaking change. The pawl catches it.

Test timeout: 2 minutes. If tests hang, the click is rolled back.

---

### 5. Commit or Revert (The Pawl)

**If tests pass:**
- `git add -A && git commit -m "<improvement summary>"`
- The click is permanently recorded
- The codebase has advanced one notch

**If tests fail:**
- `git stash pop` restores the pre-click state
- The failed attempt is logged (with analysis and proposal)
- The next click starts fresh from the stable state

This means a failed click is not wasted — the log shows what was tried, and the engine tries a different improvement on the next click.

---

## State and Logging

### Branch

Each `ratchet torque` run creates a branch:

```
ratchet/error-handling-1710432000000
```

You work on main while Ratchet works on its branch. When done, `ratchet tighten --pr` opens a PR.

### Log

Every click is logged to `docs/<target>-ratchet.md`:

```markdown
## Click 3 ✅

**Analysis:** getUserById() has no null check...

**Proposal:** Add early return when user is undefined...

**Files:** src/api/users.ts

**Commit:** 7bc1d44
```

This log is the audit trail. Commit it alongside the code — it explains the "why" behind each change.

### State

`.ratchet-state.json` persists the last run state for `ratchet status` and `ratchet tighten`. It's gitignored — it's local bookkeeping, not part of the project history.

---

## The Concurrency Lock

Only one `ratchet torque` run can execute at a time on a given repository. A lock file (`.ratchet-lock`) is created at run start and removed at end.

If a run is interrupted abnormally (e.g., machine crash), the lock file may remain. Delete it manually:

```bash
rm .ratchet-lock
```

---

## Architecture

```
CLI (Commander.js)
  │
  ├── ratchet init      → config.ts (detect + write .ratchet.yml)
  │
  ├── ratchet torque    → engine.ts (run loop)
  │                          │
  │                          └── click.ts (single click)
  │                               ├── agents/shell.ts  (analyze, propose, build)
  │                               ├── runner.ts        (run tests)
  │                               └── git.ts           (commit or revert)
  │
  ├── ratchet status    → reads .ratchet-state.json
  ├── ratchet log       → reads docs/<target>-ratchet.md
  └── ratchet tighten   → git.ts (create PR), logger.ts (finalize log)
```

### Key Components

**`engine.ts`** — orchestrates the click loop. Calls `executeClick()` N times, handles signals (Ctrl+C, SIGTERM), and writes the final state file.

**`click.ts`** — executes one click. Calls the agent, runs tests, commits or reverts. Returns a `Click` object with the full result.

**`agents/shell.ts`** — the `ShellAgent` implementation. Runs an AI coding agent via shell subprocess. Handles timeouts, empty output, and command-not-found errors.

**`config.ts`** — parses and validates `.ratchet.yml`. Converts snake_case YAML fields to camelCase, validates field values, and filters incomplete targets.

**`git.ts`** — wraps git operations. Tracks whether a stash entry was created to prevent popping a non-existent stash (a subtle safety detail).

**`runner.ts`** — runs the test command in a subprocess with a 2-minute timeout and 10 MB output buffer.

**`logger.ts`** — writes the markdown log incrementally during the run, so `docs/<target>-ratchet.md` is always up-to-date even if the run is interrupted.

**`lock.ts`** — prevents parallel `ratchet torque` runs on the same repository.

---

## The Agent Interface

The agent is the only part that makes decisions. Everything else (git, tests, logging) is deterministic infrastructure. The interface is intentionally minimal:

```typescript
interface Agent {
  analyze(context: string): Promise<string>;
  propose(analysis: string, target: Target): Promise<string>;
  build(proposal: string, cwd: string): Promise<BuildResult>;
}
```

This separation means you can swap the AI backend without touching the click loop. The `shell` agent runs any coding agent that accepts a `--print` flag. The interface is open for custom implementations.

---

## Failure Modes

**"No clicks landed"** — The agent's proposals all broke tests. Try a more specific `description` in your target, or check that your test command is correct.

**"Agent timed out"** — The agent took longer than 5 minutes. This can happen with large files or complex prompts. Try targeting a smaller `path`.

**"Command not found"** — The agent binary isn't on your PATH. Install the AI coding agent and ensure it's accessible in your shell.

**"Not a git repository"** — Ratchet requires git. Initialize with `git init && git add -A && git commit -m "init"`.

See [docs/troubleshooting.md](troubleshooting.md) for more detail on diagnosing issues.
