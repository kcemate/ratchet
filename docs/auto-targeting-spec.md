# Auto-Targeting & Smart Features Spec

## Feature 1: `--focus <category>` (category-level targeting)

Current `--focus` takes specializations (security, performance, etc.) which are vague.
New: accept actual score categories to force torque to target them.

**Valid values:** testing, security, type-safety, error-handling, performance, code-quality

**Behavior:** When `--focus testing` is passed:
1. Score optimizer filters gaps to only the Testing category
2. Agent prompt is narrowed: "Create test files for untested modules" instead of generic improvement
3. Guards auto-elevate to `refactor` (testing changes are inherently cross-cutting)
4. Prevalidation adjusts: new test files are expected, not flagged as "too many files"

**Implementation:**
- `torque.ts`: Add `--focus-category <category>` option (keep existing `--focus` for specializations)
- `score-optimizer.ts`: Add `filterGapsByCategory(gaps, category)` function
- `engine.ts`: When focus-category is set, override prompt to be category-specific
- `engine-guards.ts`: Auto-elevate guards when focus-category is 'testing'

## Feature 2: Auto-Strategy (post-run recommendation)

After every torque run, analyze the final score and recommend the optimal next command.

**Output (appended to run summary):**
```
💡 Next best move:
   Testing (13/25) has 12 recoverable points across 22 untested files
   → ratchet torque --focus-category testing --mode architect -n 5
   Run it? (copy command above)
```

**Implementation:**
- `torque.ts`: After run completes, call `generateNextMoveRecommendation(finalScan)`
- `score-optimizer.ts`: Add `generateNextMoveRecommendation(scan)` that:
  1. Gets all tier gaps sorted by ROI
  2. Picks the highest-ROI gap
  3. Determines if it needs architect mode (cross-cutting check)
  4. Generates the exact CLI command
  5. Returns formatted recommendation string

## Feature 3: Watch Mode Detection

Detect when test command launches an interactive/watch mode and fail fast with a helpful message.

**Detection signals:**
- Test process doesn't exit within 30 seconds AND produces output matching: "press h to show help", "watching for file changes", "SIGTERM" patterns
- Test command is exactly "vitest" or "jest" without "--run" flag

**Implementation:**
- `click.ts` or `test-isolation.ts`: Before running tests, check if command matches known watch-mode patterns
- Warn: "⚠ Test command 'vitest' may launch in watch mode. Add '--run' flag? Auto-fixing to 'vitest --run'"
- Auto-fix: append `--run` for known frameworks (vitest, jest)
- Add `test_command_validated` flag to `.ratchet-state.json` so we only warn once

## Feature 4: Guard Auto-Elevation for Architect Mode

When `--mode architect` is explicitly passed, guards should be `refactor` not `tight`.

**Current bug:** Architect mode uses tight guards (40 lines / 3 files), which blocks legitimate architect changes.

**Fix:**
- `engine-guards.ts`: When mode === 'architect', default to refactor guards (280 lines / 12 files)
- Still respect explicit `--guards` flag if user passes it
