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

## Summary

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
