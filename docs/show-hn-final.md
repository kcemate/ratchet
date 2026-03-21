# Show HN: Ratchet – CLI that scores your codebase 0-100, then fixes the issues it finds

Hi HN, I built Ratchet because every code quality tool I've used just _reports_ problems. Ratchet scores your codebase, then fixes the issues — one tested commit at a time.

**How it works:**

```
$ npm install -g ratchet-run
$ ratchet scan                    # Score 0-100 across 6 categories (free, forever)
$ ratchet torque --clicks 7       # Run 7 AI improvement cycles
```

Each "click" is one full cycle: analyze → propose fix → implement → run your tests → commit if green, revert if red. Like a ratchet wrench — it only turns one way. Your score can only go up.

**What it scores:** Testing, Security, Type Safety, Error Handling, Performance, Code Quality. Concrete, fixable issues — not abstract warnings.

**Real results:** I dogfooded it on a 15K-line TypeScript app (Express + React + PostgreSQL):
- 76/100 → 86/100 over multiple runs
- Migrated ~166 console.* calls to Pino structured logging across 14 files
- Split a 2000-line routes.ts into 13 domain modules
- Narrowed 6 overly-broad rate limiters
- 891 tests passing the entire time — every commit was verified by Ratchet

**What makes it different from linters:**
- It actually makes the changes, not just reports them
- **Guard profiles** control change scope per click (tight/refactor/broad/atomic)
- **Smart escalation** — auto-broadens when hitting guard limits
- **Plan-first mode** (`--plan-first`) for review before execution
- **Architect mode** for cross-cutting refactors spanning many files
- **Per-click economics** — see cost, time, and score delta for each cycle
- **Vision** — interactive dependency graph colored by quality score

**What it won't do:**
- Won't commit code that fails your tests (reverts immediately)
- Won't touch files outside your defined scope
- Won't skip your test suite — no shortcuts
- Won't send your code anywhere (BYOK — your AI API key, your model)

**Pricing:** `ratchet scan` is free forever — unlimited scans, no API key needed. Paid tiers (Builder $19/mo, Pro $49/mo, Team $99/mo) unlock the autonomous improvement engine (torque/improve). BYOK model.

**Being honest about limitations:**
- Score plateaus around 85-86 for large codebases — diminishing returns are real
- One run introduced an infinite recursion bug — the guard system caught it and Ratchet self-corrected 2 clicks later
- 5 out of 7 clicks rolled back in one session — that's the guard system working, not failing
- Structural issues like 700+ duplicated lines need human decisions, not automation

1,280 tests. TypeScript. Git-native. MIT license on the scan engine.

https://ratchetcli.com | `npm install -g ratchet-run`

Would love your feedback:
1. Would you trust this on your codebase?
2. What scoring categories are we missing?
3. Free scan + paid improvements — does this pricing make sense?
