# CLI Polish Iterations

## Click 1 — Exit codes

**Improvement:** `ratchet torque` now exits with a semantic code:
- `0` — all clicks landed (full success)
- `1` — partial success (some clicks rolled back)
- `2` — all clicks failed (nothing landed)

**Files changed:** `src/commands/torque.ts`
**Commit:** bb8d5d9


## Click 2 — Dirty worktree shows filenames

**Improvement:** The dirty worktree warning now lists the actual filenames (up to 3, then `+N more`) so users know exactly which files are uncommitted before a run starts.

Before: `⚠  Dirty worktree: 3 uncommitted files.`
After:  `⚠  Dirty worktree: 3 uncommitted files (src/foo.ts, src/bar.ts, README.md).`

**Files changed:** `src/commands/torque.ts`
**Commit:** 2f37a7f


## Click 3 — Config validation warnings

**Improvement:** `getConfigWarnings()` added to `config.ts`. Invalid values for `agent`, `defaults.clicks`, and boundary `rule` that previously fell back silently now emit a named warning before the run starts.

Example: `⚠  Invalid agent "gpt4" — expected one of: claude-code, codex, shell. Falling back to "shell".`

**Files changed:** `src/core/config.ts`, `src/commands/torque.ts`
**Commit:** 136731e


## Click 4 — Examples in --help

**Improvement:** All four main commands (`torque`, `init`, `tighten`, `log`) now include a usage examples section at the bottom of their `--help` output via `addHelpText('after', ...)`.

**Files changed:** `src/commands/torque.ts`, `src/commands/init.ts`, `src/commands/tighten.ts`, `src/commands/log.ts`
**Commit:** 7a44d61


## Click 5 — Per-click summary table

**Improvement:** After all clicks complete, a compact per-click result table is printed before the final summary line. Each row shows the click number, pass/rolled-back status, commit hash, and up to 2 modified files.

```
  ✓ Click 1  passed [abc1234] — src/foo.ts, src/bar.ts
  ✗ Click 2  rolled back
  ✓ Click 3  passed [def5678] — src/baz.ts +1
```

**Files changed:** `src/commands/torque.ts`
**Commit:** b5545a5


## Click 6 — Status shows current branch

**Improvement:** `ratchet status` now displays the current git branch alongside the Run ID, so you can immediately tell if you're on a ratchet branch or main.

```
  Run ID  : abc-123
  Branch  : ratchet/src-2024-01-15T10:00:00
  Target  : src (src/)
```

**Files changed:** `src/commands/status.ts`
**Commit:** 0a94127


## Click 7 — Spinner phase updates

**Improvement:** The spinner now shows the current phase as the click progresses, instead of being stuck on "analyzing…" for the full duration.

```
⠹  Click 1/7 — analyzing…
⠸  Click 1/7 — proposing…
⠼  Click 1/7 — building…
⠴  Click 1/7 — testing…
⠦  Click 1/7 — committing…
✔  Click 1 — ✓ passed [abc1234]
```

**Files changed:** `src/core/engine.ts`, `src/core/click.ts`, `src/commands/torque.ts`
**Commit:** 06a2094

