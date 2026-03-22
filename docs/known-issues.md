# Ratchet — Known Issues & Workarounds

## Scoring

### `test(` regex false positives
**Issue:** The test case counter uses `/\b(?:it|test)\s*[.(]/g` which matches `test` in variable names, strings, and comments — not just Vitest/Jest `test()` blocks. This inflates the test case count and lowers your assertions-per-test ratio.

**Impact:** You may have 2.0+ real assertions per test but ratchet reports 1.8-1.9.

**Workaround:** Rename variables like `const test = ...` to `const spec = ...` or `const tc = ...`. Avoid `test` as a standalone word in non-test-block contexts.

**Fix status:** Tracked for improvement — regex should match `it(` and `test(` only at statement level, not inside strings/comments.

### Auth & rate limiting false positive for CLIs/libraries
**Issue:** Projects without HTTP servers (CLIs, libraries, build tools) get penalized under Auth & rate limiting (max 4/6 instead of 6/6) because there's no auth middleware or rate limiter to detect.

**Workaround:** None currently. Ceiling is 13/15 for Security on non-server projects.

**Fix status:** Planned — project type detection to skip inapplicable subcategories.

### Broad rate limiter detection
**Issue:** `app.use("/api/path", limiter)` is flagged as overly broad because it covers all HTTP methods. This is correct behavior but catches legitimate patterns where you genuinely want to limit all methods on a path.

**Workaround:** Switch to method-specific: `app.post("/api/path", limiter)`, `app.get("/api/path", limiter)`.

## Torque Engine

### Click planner optimizes for issue count, not score impact
**Issue:** The click planner selects fixes based on raw issue count. A maxed-out category with 150 issues will attract clicks over a category with 30 issues and 6 points of headroom. This causes torque runs to waste clicks on zero-impact work.

**Impact:** Score plateaus at 85-90 despite multiple torque runs.

**Workaround:** Use `--focus` flag to manually direct clicks to the right category. Check `ratchet scan` subcategory breakdown to identify headroom before running torque.

**Fix status:** Tracked (tk_71wx) — priority formula will change to `potentialScoreGain × fixProbability`, skipping maxed categories.

### PDF generation crash on some runs
**Issue:** `TypeError: Cannot read properties of undefined (reading 'catch')` at end of torque/improve runs. PDF fails but code changes are preserved.

**Workaround:** Run `ratchet report` separately after the torque run completes.

### --model flag doesn't exist
**Issue:** Model selection is done via `.ratchet.yml`, not a CLI flag. `--model` is not recognized.

**Workaround:** Set model in `.ratchet.yml`:
```yaml
model: claude-sonnet-4-6
```

## General

### Stale binary after source changes
**Issue:** After modifying ratchet source, `npm link` uses the old build. Changes don't take effect.

**Workaround:** Always run `ratchet build` or `npm run build && npm link` after source changes. Ratchet now shows a stale-check warning when the binary is outdated.
