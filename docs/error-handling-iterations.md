# Error Handling Iterations

> 7-click sprint hardening error handling across Ratchet's core engine, CLI, and agents.
> Agent: Riley · Date: 2026-03-13 · Branch: main

---

## Click 1 — Detached HEAD detection

**Gap:** `currentBranch()` returns the string `"HEAD"` when git is in detached HEAD state (e.g. after `git checkout <hash>`). The engine would silently create a ratchet branch from this state with no warning to the user, making it easy to lose track of changes.

**Fix:** Added `isDetachedHead(cwd)` to `src/core/git.ts`. The engine now calls this before creating a branch and throws a clear, actionable error:

```
Git repository is in detached HEAD state.
  Ratchet requires a named branch to track changes safely.
  Fix: git checkout -b my-branch
```

**Files:** `src/core/git.ts`, `src/core/engine.ts`, `tests/git.test.ts`
**Commit:** `fix: detect detached HEAD state before starting engine loop`

---

## Click 2 — Stash-nothing-to-stash guard

**Gap:** `git.stash()` was called at the start of every click. If the working tree was already clean, git exits 0 but outputs "No local changes to save" — no stash entry is created. When rollback later called `stashPop()`, it would pop the *previous* unrelated stash, silently destroying the user's saved work.

**Fix:** `stash()` now returns `boolean` — `true` if a stash entry was created, `false` if the tree was clean. `click.ts` tracks `stashCreated` and only calls `stashPop()` when it's true. When no stash was created, rollback uses `git.revert()` instead.

**Files:** `src/core/git.ts`, `src/core/click.ts`
**Commit:** `fix: guard against stash-pop when working tree was already clean`

---

## Click 3 — YAML parse error hardening

**Gap:** `parseConfig()` called the yaml `parse()` function without a try-catch. Malformed YAML (unclosed brackets, tab-indented keys) caused an unhandled throw that surfaced as a raw yaml library error with no Ratchet context or remediation hint.

**Fix:** Wrapped `parse(raw)` in a try-catch inside `parseConfig()`. Errors are re-thrown with a user-friendly message including the yaml detail and a `ratchet init --force` recovery hint:

```
.ratchet.yml contains invalid YAML and could not be parsed.
  Detail: <yaml library message>
  Fix the syntax error and try again, or run: ratchet init --force
```

**Files:** `src/core/config.ts`, `tests/config.test.ts`
**Commit:** `fix: surface user-friendly error for malformed .ratchet.yml YAML`

---

## Click 4 — Agent timeout user-friendly message

**Gap:** When `execFileAsync` timed out, Node.js threw with `err.signal = 'SIGTERM'` and a generic `child_process: SIGTERM` message. The shell agent re-threw this raw error with no indication of what timed out, what the timeout was, or how to fix it.

**Fix:** Added detection for `error.killed || error.signal === 'SIGTERM'` in `ShellAgent.runPromptInDir()`. Also added `ENOENT` detection at the agent layer (binary not found). Both throw user-readable errors with the command name, duration, and remediation steps.

**Files:** `src/core/agents/shell.ts`, `tests/agents.test.ts`
**Commit:** `fix: surface friendly timeout and ENOENT errors from shell agent`

---

## Click 5 — Test binary ENOENT detection in runner

**Gap:** If the test command binary didn't exist (typo in `test_command`, missing tool), `runTests()` returned `{ passed: false, error: "spawn npm ENOENT" }`. The click silently rolled back. The user saw "rolled back" with no indication that the test runner was never invoked at all.

**Fix:** Added `ENOENT` detection in `runTests()`. Returns a clear error including the binary name and a pointer to `.ratchet.yml`:

```
Test command not found: `pytets`
  Make sure `pytets` is installed and available in your PATH.
  Check the test_command setting in .ratchet.yml
```

**Files:** `src/core/runner.ts`, `tests/runner.test.ts`
**Commit:** `fix: emit actionable error when test command binary is not found`

---

## Click 6 — SIGTERM graceful shutdown

**Gap:** `torque.ts` handled `SIGINT` (Ctrl+C) with a spinner teardown and friendly message, but not `SIGTERM`. When the process was killed via `kill <pid>` (CI timeout, Docker stop, systemd unit stop), it exited immediately with no output, leaving the spinner running and the user with no context about what happened.

**Fix:** Added a `sigtermHandler` alongside the existing `sigintHandler`. Both are registered with `process.once()` and cleaned up in the `finally` block. SIGTERM exits with code 143 (128 + 15, the conventional SIGTERM exit code).

**Files:** `src/commands/torque.ts`
**Commit:** `fix: handle SIGTERM gracefully with user-friendly message and correct exit code`

---

## Click 7 — Empty test command guard

**Gap:** If `test_command` in `.ratchet.yml` was empty or whitespace-only, `parseCommand('')` returned `[]`. Destructuring `const [bin, ...args] = []` gave `bin = undefined`. `execFileAsync(undefined, ...)` threw a cryptic `TypeError: Path must be a string` — no Ratchet context, no remediation hint.

**Fix:** Added an early-return guard in `runTests()`: if `parseCommand(command)` returns zero parts, immediately return a `{ passed: false }` result with an actionable message pointing to `.ratchet.yml`. Duration is reported as 0 (no command was run).

```
Test command is empty or invalid: ""
  Set a valid test_command in .ratchet.yml (e.g. test_command: npm test)
```

**Files:** `src/core/runner.ts`, `tests/runner.test.ts`
**Commit:** `fix: guard against empty test command crashing with cryptic TypeError`

---

## Summary (Sprint 1)

| # | Area | Gap | Fix |
|---|------|-----|-----|
| 1 | Git operations | Detached HEAD silently allowed | `isDetachedHead()` check in engine |
| 2 | Git operations | Stash pop on clean tree destroyed user stash | `stash()` returns boolean; skip pop when false |
| 3 | Config parsing | Malformed YAML gave raw library error | Try-catch in `parseConfig()` with friendly message |
| 4 | Agent timeout | Timeout gave opaque `SIGTERM` error | Detect `killed`/`SIGTERM` and surface friendly message |
| 5 | File system | Missing test binary gave cryptic ENOENT | Detect `ENOENT` in `runTests()`, name the missing binary |
| 6 | Graceful shutdown | SIGTERM not handled at all | Add `sigtermHandler` alongside `sigintHandler` |
| 7 | Config validation | Empty test command crashed with TypeError | Early-return guard before `parseCommand` result is used |

**Tests:** 169 → 179 (+10 tests, all green)

---

# Error Handling Iterations — Sprint 2

> 7-click sprint extending error hardening across agent output, git operations, concurrency, and config validation.
> Agent: Riley · Date: 2026-03-13 · Branch: main

---

## Click 1 — Empty proposal guard

**Gap:** `agent.propose()` can return an empty or whitespace-only string (AI rate-limited, returned nothing, timed out silently). An empty proposal was passed directly to `agent.build()`, giving the AI no useful context — it might invent random changes, or return `success: true` with zero file modifications.

**Fix:** In `executeClick()`, after receiving the proposal, check `proposal.trim()` before calling `build()`. If blank, throw immediately with a clear message and roll back. The build phase is never invoked.

```
Agent returned an empty proposal — nothing to implement.
  The agent may be rate-limited, misconfigured, or unresponsive.
  Check that the agent command works from the command line.
```

**Files:** `src/core/click.ts`, `tests/click.test.ts`
**Commit:** `fix: reject empty proposal before build to prevent garbage AI output`

---

## Click 2 — `git.commit()` "nothing to commit" hardening

**Gap:** If the agent's `build()` returns `success: true` but makes no actual file changes, `git add -A` stages nothing and `git commit` exits with code 1: "nothing to commit, working tree clean". This raw git error bubbled through click.ts's catch block as a generic failure, triggering rollback with no explanation — the user couldn't tell whether tests failed or the AI simply changed nothing.

**Fix:** In `git.commit()`, catch the git error and detect the "nothing to commit" / "nothing added to commit" text. Re-throw with a specific, actionable message:

```
Nothing to commit — the agent reported success but made no file changes.
  The agent may have returned a no-op or the proposal was too vague to act on.
```

**Files:** `src/core/git.ts`, `tests/git.test.ts`
**Commit:** `fix: surface friendly error when agent builds nothing to commit`

---

## Click 3 — Concurrent ratchet runs lockfile

**Gap:** No protection against two concurrent `ratchet torque` processes running on the same repository. Both would try to create branches, stash, commit, and write state simultaneously — a guaranteed git history corruption scenario.

**Fix:** New `src/core/lock.ts` module with `acquireLock()` / `releaseLock()`. At start of `torque`, writes `.ratchet.lock` with the current PID. If a lock file exists: check if the owning PID is still alive (via `process.kill(pid, 0)`); if alive, throw; if dead (stale lock), clean it up and proceed. `releaseLock()` is called in the finally block.

```
Another ratchet process (PID 12345) is already running in this directory.
  Concurrent ratchet runs on the same repo can corrupt git history.
  Wait for it to finish, or remove the lock: rm .ratchet.lock
```

**Files:** `src/core/lock.ts` (new), `src/commands/torque.ts`, `tests/lock.test.ts` (new)
**Commit:** `fix: prevent concurrent ratchet runs with a PID lockfile`

---

## Click 4 — Corrupted state file detection

**Gap:** `loadRunState()` wrapped both `readFile()` and `JSON.parse()` in one catch block — if the file was missing it returned `null`, and if it was corrupted (truncated write, disk error during a previous run) it also returned `null`. The user would see "No runs found" instead of a warning about the corrupted file.

**Fix:** Split into two try-catch blocks: the first catches ENOENT (file missing → return `null`); the second catches JSON parse errors and throws a specific error with a recovery command:

```
.ratchet-state.json exists but could not be parsed — the file may be corrupted.
  Delete it to reset: rm .ratchet-state.json
```

**Files:** `src/commands/status.ts`, `tests/commands/status.test.ts`
**Commit:** `fix: distinguish corrupted state file from missing state file`

---

## Click 5 — Config `clicks` validation

**Gap:** `defaults.clicks: 0`, `clicks: -3`, or `clicks: 0.5` in `.ratchet.yml` produced a silent empty run. The engine's `for (let i = 1; i <= 0; i++)` loop never executes and the run completes "successfully" with zero clicks and zero output. No warning is issued.

**Fix:** In `parseConfig()`, validate that the configured `clicks` value is a positive integer (`Number.isInteger(v) && v >= 1`). Invalid values (zero, negative, float) fall back silently to the default (7).

**Files:** `src/core/config.ts`, `tests/config.test.ts`
**Commit:** `fix: reject non-positive or fractional clicks in config, fall back to default`

---

## Click 6 — `git.revert()` using `reset --hard HEAD`

**Gap:** `git checkout -- .` only reverts unstaged changes to tracked files. If the agent ran `git add` as part of its build process (staged new files), a rollback using `checkout -- .` would leave those staged changes in the index. The working tree would look clean but the index would be dirty — subsequent clicks would inherit the previous click's partial changes.

**Fix:** Replace `git checkout -- .` with `git reset --hard HEAD`. This atomically clears both staged and unstaged changes in one operation. Combined with the existing `git clean -fd`, it provides a complete reset to the last committed state.

**Files:** `src/core/git.ts`, `tests/git-extended.test.ts`
**Commit:** `fix: use git reset --hard to clear staged changes during rollback`

---

## Click 7 — Whitespace `testCommand` normalization in config

**Gap:** `test_command: "  npm test  "` (with extra spaces) worked by accident because `parseCommand` splits on spaces. But `test_command: "   "` (whitespace-only) slipped through the non-empty string check, reaching `runTests()` which then showed a confusing error message with raw whitespace in the command display.

**Fix:** In `parseConfig()`, trim the parsed `test_command` string. If it's empty after trimming, fall back to the default test command. This catches both whitespace-only values and values absent from the config.

**Files:** `src/core/config.ts`, `tests/config.test.ts`
**Commit:** `fix: trim testCommand whitespace in config and fall back to default if blank`

---

## Summary (Sprint 2)

| # | Area | Gap | Fix |
|---|------|-----|-----|
| 1 | Agent output | Empty proposal passed to build | Validate `proposal.trim()` non-empty before build |
| 2 | Git operations | "nothing to commit" gave raw git error | Detect in `git.commit()`, throw friendly message |
| 3 | Concurrency | No protection against parallel ratchet runs | PID lockfile in `src/core/lock.ts` |
| 4 | State file | Corrupted JSON indistinguishable from missing | Two-phase read: missing → null, corrupt → throw |
| 5 | Config validation | `clicks: 0` / negative / float silently empty run | Validate positive integer, fall back to default |
| 6 | Git operations | `checkout -- .` left staged changes after rollback | Use `reset --hard HEAD` instead |
| 7 | Config validation | Whitespace `testCommand` slipped through | Trim at parse time, fall back to default if blank |

**Tests:** 179 → 194 (+15 tests, all green)
