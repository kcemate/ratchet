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
