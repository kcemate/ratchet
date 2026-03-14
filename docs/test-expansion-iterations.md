# Ratchet Test Expansion — Sprint Log

**Goal:** 82 → 120+ tests across 7 clicks
**Result:** 82 → 163 tests (+81)

---

## Click 1 — Agent base + ShellAgent constructor
**File:** `tests/agents.test.ts` (+12 tests)
**Area:** `src/core/agents/base.ts` · `src/core/agents/shell.ts`
**Coverage added:**
- `createAgentContext` — all 4 fields, click number variation, newline formatting
- `ShellAgent` constructor with defaults and custom config
- `createShellAgent` factory function returns correct instance and satisfies Agent interface
**Result:** 82 → 94 tests ✅

---

## Click 2 — loadConfig + configFilePath + boundary/target filtering
**File:** `tests/config-extended.test.ts` (+14 tests)
**Area:** `src/core/config.ts`
**Coverage added:**
- `loadConfig` — returns defaults when no file exists, reads from disk, parses boundaries, handles empty yaml
- `configFilePath` — absolute path construction and `.ratchet.yml` suffix
- `parseConfig` edge cases — target filtering by missing name/path/description, boundary filtering, `no-delete` rule, `no-modify` fallback for invalid rules, model field preservation, non-object YAML
**Result:** 94 → 108 tests ✅

---

## Click 3 — Additional git operations
**File:** `tests/git-extended.test.ts` (+12 tests)
**Area:** `src/core/git.ts`
**Coverage added:**
- `getModifiedFiles` with actual file changes
- `addAll` — stages untracked and modified files
- `stash` / `stashPop` — stash makes tree clean, pop restores changes
- `revert` — discards tracked file changes and removes untracked files
- `checkoutBranch` — switches between branches
- `status` — staged files and dirty working tree detection
**Result:** 108 → 120 tests ✅

---

## Click 4 — runEngine callbacks + error handling + branch creation
**File:** `tests/engine-extended.test.ts` (+9 tests)
**Area:** `src/core/engine.ts`
**Coverage added:**
- `runEngine` runs N clicks and returns completed status
- `finishedAt` set after completion
- `onClickStart` called with correct click number and total
- `onClickComplete` called for each click
- `onRunComplete` called with final run object
- `onError` triggered when `executeClick` throws (non-git dir)
- Agent errors caught internally — all clicks still recorded
- `createBranch=true` creates ratchet/ branch
**Result:** 120 → 129 tests ✅

---

## Click 5 — detectTestCommand additional types + runner edge cases
**File:** `tests/runner-extended.test.ts` (+12 tests)
**Area:** `src/core/runner.ts`
**Coverage added:**
- `detectTestCommand` — pytest.ini, pyproject.toml, Cargo.toml, Makefile, package.json precedence
- `parseCommand` — double-quoted binary, spaces inside quotes, empty string, trailing whitespace
- `runTests` — stderr capture, error message type, custom timeout parameter
**Result:** 129 → 141 tests ✅

---

## Click 6 — Logger formatDuration + click section edge cases
**File:** `tests/logger-extended.test.ts` (+10 tests)
**Area:** `src/core/logger.ts`
**Coverage added:**
- `formatDuration` via `finalizeLog` — 500ms, 30s, 2m5s, 0ms (no finishedAt)
- Click section: commit hash truncated to 7 chars
- Empty analysis/proposal shows `*none*`
- Multiple modified files listed with backtick formatting
- Non-default target name in header
- `path` property differs per target name
**Result:** 141 → 151 tests ✅

---

## Click 7 — branchName edge cases + summarizeRun + executeClick paths
**File:** `tests/click-extended.test.ts` (+12 tests)
**Area:** `src/core/git.ts` · `src/core/engine.ts` · `src/core/click.ts`
**Coverage added:**
- `branchName` — lowercase, dot replacement, slash replacement, timestamp suffix
- `summarizeRun` — run ID, target name, exact duration, all-passed scenario
- `executeClick` — filesModified from build result, target name on click, click number propagation
**Result:** 151 → 163 tests ✅

---

## Final Summary

| Metric | Before | After |
|--------|--------|-------|
| Test files | 8 | 15 |
| Total tests | 82 | 163 |
| New tests added | — | +81 |
| Target | 120+ | ✅ Exceeded |

**New files created:**
- `tests/agents.test.ts`
- `tests/config-extended.test.ts`
- `tests/git-extended.test.ts`
- `tests/engine-extended.test.ts`
- `tests/runner-extended.test.ts`
- `tests/logger-extended.test.ts`
- `tests/click-extended.test.ts`
