# Ratchet Resilience Features Spec v2

_Author: Giovanni | Date: 2026-03-20_
_Reviewed by: Grok 4.2 (7.5/10) — feedback incorporated_
_Status: Approved for build_

---

## Problem Statement

A 7-click architect run on DeuceDiary produced:
- 3/7 clicks rolled back (43% waste)
- 1 timeout (600s burned, zero value)
- 2 test failures from unrelated tests (rate limiter tests broke on unrelated refactors)
- Total wall time: ~55 minutes for 2 landed clicks worth of value
- Score: 86 → 86 (no movement despite structural improvements)

Root cause (per Grok review): the agent is too often generating oversized, high-risk clicks that should have been split or rejected at proposal time. The features below address both the symptoms and the root cause.

---

## Feature 1: Targeted Test Isolation (Priority 1)

_Grok rating: 9/10 — "highest ROI by far"_

### Problem
Clicks rolled back because unrelated tests failed. Client-side toast refactors killed by server-side rate limiter tests.

### Solution

**A. Progressive validation gates (fail fast)**
```
Step 1: Lint check (eslint/tsc) on changed files only → fail = instant rollback
Step 2: Type check (tsc --noEmit) → fail = instant rollback  
Step 3: Related tests only (vitest --related <changed-files>) → fail = rollback
Step 4: Full test suite → classify failures as related or unrelated
```

Each step is a gate. Fail early = save time. No point running 868 tests if the code doesn't even compile.

**B. Unrelated failure tolerance**
If Step 4 full suite fails but ALL failing tests are in files NOT related to the change:
- LAND the commit anyway
- Flag: `⚠ Landed with unrelated test failures (api-premium.test.ts)`
- Log which tests failed for transparency

If ANY failure IS in a related file → rollback.

**C. Baseline flaky detection**
Before torque starts, run full test suite once:
- Record pre-existing failures
- These are exempt from rollback decisions throughout the run
- `[ratchet] Baseline: 866/868 passing (2 pre-existing failures)`

**D. Post-land validation (Grok suggestion)**
After landing a commit with unrelated failures, queue a background validation:
- Run full suite on the landed state
- If it reveals the change actually broke something through an indirect path → warn in output (don't auto-revert, but surface it)

**E. Config**
```yaml
defaults:
  testIsolation: true
  testRelatedCmd: "npx vitest --related"
  allowUnrelatedFailures: true
  baselineTests: true
  progressiveGates: true       # lint → typecheck → related → full
  lintCmd: "npx tsc --noEmit"  # fast type check gate
```

CLI: `--no-test-isolation`

### Files to modify
- New: `src/core/test-isolation.ts` — gate runner, failure classification, baseline capture
- `src/core/click.ts` — replace single test call with progressive gate pipeline
- `src/core/engine.ts` — baseline test pass before click loop
- `src/types.ts` — config fields

---

## Feature 2: Scope Control + Timeout Management (Priority 2)

_Combined per Grok recommendation — "timeout management without scope control is just delaying the inevitable"_

### Problem
The agent proposes 10-20 file diffs in architect mode. These either timeout (600s wasted) or break unrelated tests. The guards catch this AFTER the agent builds — too late. The waste already happened.

### Solution

**A. Pre-apply scope guard (NEW — Grok's top suggestion)**
After the agent generates a diff but BEFORE applying it:
- Count files changed and lines changed
- If exceeds scope budget → reject and re-prompt:
  `"Your proposed change touches 14 files and 420 lines. The scope budget for this click is 8 files / 250 lines. Split this into a smaller, focused change targeting only the highest-priority files."`
- Max 1 re-prompt per click. If second attempt still exceeds → apply the smaller subset or rollback.

Scope budgets by mode:
```
normal:    3 files / 40 lines
refactor:  8 files / 250 lines  
architect: 12 files / 350 lines (Grok sweet spot from prior review)
broad:     20 files / 500 lines
atomic:    no limit
```

**B. Adaptive timeout**
```yaml
defaults:
  timeout: 600
  architectTimeout: 900
  sweepTimeout: 1200
```
CLI: `--timeout <seconds>`

**C. Timeout prediction**
Before each click, log estimated scope vs budget:
- `[ratchet] Estimated scope: ~8 files, ~200 lines (budget: 900s) — proceeding`
- If estimated scope > 80% of timeout → warn

**D. Failure categorization + learning loop (Grok suggestion)**
Classify every rollback:
```typescript
type RollbackReason = 
  | 'test-related'        // tests related to changed files failed
  | 'test-unrelated'      // only unrelated tests failed (now recoverable with F1)
  | 'timeout'             // agent didn't finish in time
  | 'scope-exceeded'      // diff too large (now caught pre-apply)
  | 'score-regression'    // score went down
  | 'lint-error'          // didn't pass lint/typecheck gate
  | 'guard-rejected';     // existing guard system

// Persisted per-run for learning
interface RollbackRecord {
  clickIndex: number;
  reason: RollbackReason;
  filesAttempted: number;
  linesAttempted: number;
  wallTimeMs: number;
}
```

Feed rollback patterns into future click prompts:
- `"Previous click was rolled back for scope-exceeded (14 files). Keep this change under 8 files."`

### Files to modify
- `src/core/click.ts` — pre-apply scope check, re-prompt logic, timeout selection
- `src/core/engine.ts` — rollback classification, history injection into prompts
- `src/core/agents/shell.ts` — timeout flag, re-prompt support
- `src/types.ts` — RollbackReason, RollbackRecord, scope budget config

---

## Feature 3: Click Economics & ROI Reporting (Priority 3)

_Grok: "start with markdown + terminal tables, recommendation engine > pretty PDFs"_

### Solution

**A. Per-click cost tracking**
```typescript
interface ClickEconomics {
  clickIndex: number;
  wallTimeMs: number;
  agentTimeMs: number;
  testTimeMs: number;
  estimatedCost: number;       // USD estimate
  outcome: 'landed' | 'rolled-back' | 'timeout' | 'scope-rejected' | 'guard-rejected';
  rollbackReason?: RollbackReason;
  issuesFixed: number;
  scoreDelta: number;
}
```

**B. Terminal summary (v1 — no PDF)**
```
📊 Run Economics
  Wall time:     54m 32s
  Effective:     17m 10s (31.5% efficiency)
  Wasted:        37m 22s
  
  Landed:        4/7 clicks (57%)
  Rolled back:   2/7 (test-unrelated: 2)
  Timed out:     1/7
  
  Score:         86 → 87 (+1)
  Issues fixed:  4
  
💡 Recommendations:
  → 2 rollbacks were from unrelated tests — enable --test-isolation to save ~18min
  → 1 timeout on architect click — consider --timeout 900
  → Score delta low — consider --architect --guards refactor for bigger changes
```

**C. Per-click score delta (Grok suggestion)**
Run a quick `ratchet scan` after each click (not just end of run) to show incremental progress:
- `✔ Click 3 — ✓ passed [342a408] — Score: 86 → 86 (±0) — 3 issues fixed`
- Already partially implemented — enhance with category-level deltas

**D. JSON export**
`--json` flag outputs full economics data for CI/CD integration and dashboards.

### Files to modify
- `src/types.ts` — ClickEconomics
- `src/core/click.ts` — timing capture
- `src/core/engine.ts` — summary aggregation + recommendation engine
- `src/commands/torque.ts` — terminal output

---

## Implementation Plan

Three parallel agents:

| Agent | Feature | Target | Est. Time |
|-------|---------|--------|-----------|
| 1 | Test Isolation | src/core/test-isolation.ts (new) + click.ts + engine.ts | 4-5h |
| 2 | Scope Control + Timeout | click.ts + engine.ts + shell.ts | 3-4h |
| 3 | Click Economics | click.ts + engine.ts + torque.ts | 2-3h |

All three can run in parallel worktrees since they touch different logical areas (test runner vs scope/timeout vs reporting).

---

_Spec v2 — Grok feedback incorporated. Ready for build._
