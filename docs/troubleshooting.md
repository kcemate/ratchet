# Ratchet Troubleshooting

Common issues and how to resolve them.

---

## Setup Issues

### "Not a git repository"

```
Not a git repository.
Ratchet requires git to track changes and roll back on failure.
```

**Fix:** Initialize git and make an initial commit before running Ratchet.

```bash
git init
git add -A
git commit -m "init"
ratchet torque --target my-target
```

---

### "Error loading .ratchet.yml"

```
Error loading .ratchet.yml: ...
Run ratchet init to create one.
```

**Fix:** Run `ratchet init` to create a config file, or check for YAML syntax errors in your existing `.ratchet.yml`.

Common YAML mistakes:
- Mixing tabs and spaces (YAML requires spaces only)
- Missing quotes around values with special characters (`:`, `#`, `*`)
- Incorrect indentation

Validate your YAML with an online checker or:

```bash
node -e "require('fs').readFileSync('.ratchet.yml', 'utf-8')" 2>&1
```

---

### "Target not found in .ratchet.yml"

```
Target "my-target" not found in .ratchet.yml.
Available: error-handling, types
```

**Fix:** Check the target name matches exactly (case-sensitive). List available targets:

```bash
cat .ratchet.yml
```

Or run with one of the listed available names:

```bash
ratchet torque --target error-handling
```

---

### "Invalid --clicks value"

```
Invalid --clicks value: 0
Must be a positive integer (e.g. --clicks 5).
```

**Fix:** Use a whole number ≥ 1:

```bash
ratchet torque --target my-target --clicks 7
```

---

## Agent Issues

### "Command not found" (agent binary missing)

```
Agent error: command not found — is the agent installed?
```

**Fix:** The AI coding agent isn't installed or isn't on your PATH. Install it and verify:

```bash
# Check if the agent is accessible
which claude

# If not found, install it per the agent's documentation
# Then verify:
claude --version
```

Make sure you're running Ratchet in the same shell where the agent is accessible.

---

### "Agent timed out"

```
Agent error: timed out after 5 minutes
```

**Fix:** The agent took too long to respond. This can happen with very large files or complex prompts.

Options:
- Target a smaller `path` in your config
- Split a large target into multiple smaller targets
- Check if the agent process is hanging (network issue, auth problem)

---

### "Agent returned empty output"

```
Agent error: returned empty output
```

**Fix:** The agent ran but produced no output. Check:
1. The agent is configured correctly (auth tokens, API keys)
2. The agent can see the files in your `path`
3. Run the agent manually to verify it works: `claude --print "hello"`

---

### No clicks landing — all rolled back

```
Done. 0 landed · 7 rolled back · 4m 12s
No clicks landed. Try adjusting your target description.
```

**Possible causes and fixes:**

1. **Test command is failing before any changes** — verify your test suite passes on the current branch before running Ratchet:
   ```bash
   npm test
   ```
   Ratchet needs a green baseline to detect regressions.

2. **Target description is too vague** — the agent makes changes the tests don't like. Try a more specific description:
   ```yaml
   # Too vague:
   description: "Fix the code"

   # Better:
   description: "Add null checks to getUserById and getProductById functions"
   ```

3. **Target path is wrong** — the agent can't find meaningful code to improve. Verify the path contains the files you intend:
   ```bash
   ls src/api/
   ```

4. **Agent proposing destructive changes** — add boundaries to protect critical paths:
   ```yaml
   boundaries:
     - path: src/auth/
       rule: no-modify
       reason: "Auth is working correctly — do not touch"
   ```

---

## Runtime Issues

### "Another ratchet process is already running"

```
Another ratchet process is already running in this directory.
```

**Fix:** Only one `ratchet torque` run can execute at a time. Wait for the other run to finish, or if no run is active (crashed process), remove the lock file:

```bash
rm .ratchet-lock
```

---

### Run interrupted mid-way (Ctrl+C)

If you interrupt a run with Ctrl+C, Ratchet exits gracefully. Any clicks that completed before the interrupt are already committed. The current in-progress click is rolled back automatically.

To see what completed:

```bash
ratchet status
ratchet log --target my-target
```

To resume (Ratchet doesn't have a resume command — just run again):

```bash
# Run the remaining clicks
ratchet torque --target my-target --clicks 4  # if 3 of 7 already landed
```

---

### Detached HEAD state

```
Cannot run in detached HEAD state.
```

**Fix:** Check out a branch before running:

```bash
git checkout main
# or
git checkout -b my-branch
```

---

### State file is corrupted

```
Error reading .ratchet-state.json: Unexpected token...
```

**Fix:** Delete the state file — it's regenerated on the next run:

```bash
rm .ratchet-state.json
```

The state file is local bookkeeping only. Deleting it does not affect your code or commits.

---

## Git Issues

### "Uncommitted changes" error

Ratchet stashes your working changes before each click and restores them afterward. If you have uncommitted changes when you start, they'll be stashed and returned at the end.

However, if a run is interrupted abnormally, you may need to restore your stash manually:

```bash
git stash list
git stash pop
```

---

### Branch already exists

If a previous run's branch was never merged or deleted, Ratchet will create a new branch with a different timestamp. Old branches can be cleaned up:

```bash
git branch | grep ratchet/
git branch -D ratchet/error-handling-1710432000000
```

---

### PR creation fails

```
gh: command not found
```

**Fix:** Install the GitHub CLI (`gh`) and authenticate:

```bash
brew install gh       # macOS
gh auth login
ratchet tighten --pr
```

---

## Log File Issues

### Log file missing

If `docs/<target>-ratchet.md` doesn't exist after a run:
- The run may have failed before logging started
- Check that the `docs/` directory is writable
- Run with `--verbose` to see more output

---

### Log file not updating during run

The log is written incrementally. If it's not updating:
- The agent may be slow (large files, complex prompt)
- Check disk space
- Check file permissions on the `docs/` directory

---

## Getting More Information

### Run with `--verbose`

```bash
ratchet torque --target my-target --verbose
```

Shows per-click timing, proposal preview, and modified files.

### Dry run mode

Test your configuration without making any changes:

```bash
ratchet torque --target my-target --dry-run
```

### Check the log

```bash
ratchet log --target my-target
# or
cat docs/my-target-ratchet.md
```

---

## Still stuck?

Open an issue at [github.com/ratchet-run/ratchet/issues](https://github.com/ratchet-run/ratchet/issues) with:
1. Your `.ratchet.yml` (remove any secrets)
2. The full error output
3. Output of `git status` and `node --version`
