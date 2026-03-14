# CLI Polish Iterations

*Agent: Riley · Sprint: CLI UX & Error Handling · Date: 2026-03-13*

---

## Click 1 — Git repo check in `torque`

**Issue**: Running `ratchet torque` outside a git repo produced cryptic git errors deep in the engine.

**Fix**: Added an explicit `isRepo()` check at the top of the `torque` action. If the check fails, a clear message is printed explaining why git is required and how to initialize one.

**File**: `src/commands/torque.ts`
**Commit**: `fix(cli): check for git repo before running torque`

---

## Click 2 — Actionable "no targets" error

**Issue**: When `.ratchet.yml` had no targets, torque printed `Available: ` (empty string), which gave no guidance.

**Fix**: Two distinct error paths:
- No targets at all → show a YAML snippet showing how to add one.
- Wrong name → list available target names.

**File**: `src/commands/torque.ts`
**Commit**: `fix(cli): show actionable message when no targets defined in config`

---

## Click 3 — Graceful Ctrl+C during torque

**Issue**: Pressing Ctrl+C during a running spinner left the terminal in a broken state with no cleanup message.

**Fix**: Registered a `process.once('SIGINT', ...)` handler before `runEngine`. It stops the spinner cleanly, prints a friendly interrupted message, then exits with code 130. The handler is removed after the run completes.

**File**: `src/commands/torque.ts`
**Commit**: `fix(cli): gracefully handle Ctrl+C during torque run`

---

## Click 4 — `--clicks` validation error shows bad value

**Issue**: `--clicks foo` printed `--clicks must be a positive integer` but didn't echo back the invalid value, making it hard to debug in shell scripts.

**Fix**: Error message now shows the provided value and an example of valid usage: `Invalid --clicks value: "foo". Must be a positive integer (e.g. --clicks 5)`.

**File**: `src/commands/torque.ts`
**Commit**: `fix(cli): show provided value in --clicks validation error`

---

## Click 5 — Proposal preview in `--verbose`

**Issue**: `--verbose` mode only showed modified filenames after each click. Users couldn't see what the agent actually proposed without reading the log file.

**Fix**: Added a `proposal` preview line (truncated at 120 chars) above the files list in verbose output.

**File**: `src/commands/torque.ts`
**Commit**: `fix(cli): show proposal preview in --verbose output`

---

## Click 6 — Context-aware hints in `ratchet status`

**Issue**: `ratchet status` showed the same generic message regardless of whether the user had initialized Ratchet at all.

**Fix**: Check for `.ratchet.yml` when no run state is found. If neither exists, show a two-step getting-started guide (`ratchet init` → `ratchet torque`). If config exists but no run, show the simpler torque hint.

**File**: `src/commands/status.ts`
**Commit**: `fix(cli): context-aware hints in status when no runs or config found`

---

## Click 7 — Click count summary header in `ratchet log`

**Issue**: `ratchet log` dumped the raw markdown with no upfront summary, forcing the user to scroll to see how the run went.

**Fix**: Parse `## Click N — ✅/❌` headers from the markdown to compute pass/fail counts, then print a concise summary line (`3 clicks · 2 passed · 1 rolled back`) before rendering the log.

**File**: `src/commands/log.ts`
**Commit**: `fix(cli): show click pass/fail summary header in log output`

---

*All 7 clicks landed. 163/163 tests passing throughout.*

---

# CLI Polish Iterations — Sprint 2

*Agent: Riley · Sprint: CLI UX & Error Handling (round 2) · Date: 2026-03-13*

---

## Click 1 — Per-click elapsed time in `--verbose` output

**Issue**: `--verbose` mode showed proposal preview and modified files, but gave no sense of how long each click took. Users had no way to tell whether the agent was fast or slow per click.

**Fix**: Track `clickStartTime = Date.now()` in `onClickStart`. In `onClickComplete`, compute elapsed via `formatDuration` and print `time: 2.4s` as the first verbose line for each click.

**File**: `src/commands/torque.ts`
**Commit**: `feat(cli): show per-click elapsed time in --verbose output`

---

## Click 2 — Inline code rendering in `ratchet log`

**Issue**: The markdown renderer in `ratchet log` handled headings, blockquotes, and separators, but ignored `` `inline code` `` spans. Commands and file paths in log entries appeared unstyled.

**Fix**: Added `renderInlineCode(line)` helper that replaces `` `text` `` with `chalk.cyan(text)`. Applied to all rendered line types.

**File**: `src/commands/log.ts`
**Commit**: `feat(cli): render inline backtick code with color in ratchet log`

---

## Click 3 — Config validation warnings for incomplete targets

**Issue**: Targets missing `name`, `path`, or `description` were silently filtered out by `parseConfig`. Users got a confusing "no targets found" error later without knowing what went wrong.

**Fix**: Added `findIncompleteTargets(rawYml)` export to `config.ts` that scans raw YAML for targets with missing required fields. `torque` calls it after loading config and prints a `⚠` warning per incomplete target before continuing.

**Files**: `src/core/config.ts`, `src/commands/torque.ts`, `tests/config-extended.test.ts`
**Commit**: `feat(cli): warn about incomplete targets silently dropped from config`

---

## Click 4 — `ratchet tighten` shows current git branch

**Issue**: `ratchet tighten` listed commits but didn't tell the user which branch they were on, making it hard to connect the output to the git state.

**Fix**: Call `currentBranch(cwd)` (already exported from `git.ts`) and print `Branch  : ratchet/my-target-2026-03-13T23-25-00` before the clicks summary.

**File**: `src/commands/tighten.ts`
**Commit**: `feat(cli): show current git branch in ratchet tighten output`

---

## Click 5 — Torque final summary shows explicit rolled-back count

**Issue**: The final summary line said `3/7 clicks landed` — technically accurate but the 4 rolled-back clicks were only implied by subtraction.

**Fix**: When rollbacks occurred, the summary now reads `3 landed · 4 rolled back · 2m 45s`. When all clicks land, the simpler `7 landed · 1m 30s` form is used (no rolled-back term).

**File**: `src/commands/torque.ts`
**Commit**: `feat(cli): show explicit rolled-back count in torque final summary`

---

## Click 6 — `ratchet status` shows target description

**Issue**: `ratchet status` showed the target name and path but not its description. Users with multiple targets couldn't tell at a glance what the run was actually working on.

**Fix**: Added `Desc    : <description>` line in the status header, shown only when the description field is present.

**File**: `src/commands/status.ts`
**Commit**: `feat(cli): show target description in ratchet status output`

---

## Click 7 — `ratchet init` uses detected target name in next-step hint

**Issue**: The "Next steps" block after `ratchet init` showed `ratchet torque --target <name>` with a literal `<name>` placeholder. Users had to look inside `.ratchet.yml` to find the actual name.

**Fix**: Derive `detectedTargetName` from the same logic `buildConfig` uses, then interpolate it into the hint: `ratchet torque --target src`.

**File**: `src/commands/init.ts`
**Commit**: `feat(cli): use detected target name in ratchet init next-step hint`

---

*All 7 clicks landed. 169/169 tests passing throughout.*
