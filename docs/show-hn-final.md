# Show HN: Ratchet – CLI that scores your codebase 0-100 and autonomously fixes it

Hi HN, I built Ratchet because linters and static analysis tools just *report* problems. Ratchet scores your codebase, then fixes the issues it finds — one tested commit at a time.

**How it works:**

```
$ npm install -g @ratchet-run/cli
$ ratchet scan                    # Score 0-100 across 8 dimensions (free)
$ ratchet torque -c 7             # Run 7 AI improvement cycles
```

Each "click" is one full cycle: analyze → propose fix → implement → run your tests → commit if green, revert if red. The ratchet only turns one way — your codebase can only get better.

**What it scores:** Security, testing, duplication, complexity, error handling, type safety, performance, code quality. Concrete, fixable issues — not abstract warnings.

**Real results:** We dogfooded it on a 15K-line TypeScript app:
- 76/100 → 86/100 over multiple runs
- Migrated logging to Pino across 14 files
- Split a 2000-line routes file into 13 modules
- 891 tests passing throughout — every commit was made and verified by Ratchet

**What makes it different:**
- **Guard profiles** control change scope (tight → broad). Smart escalation auto-bumps when the AI is hitting limits.
- **Planning mode** (`--plan-first`) does a read-only analysis before touching code.
- **Architect mode** for cross-cutting refactors spanning many files.
- **Per-click economics** — see cost, time, and score delta for each cycle. Know when you're wasting money.
- **Vision** — interactive dependency graph color-coded by quality score. Find your worst files in seconds.

**It's NOT:**
- A linter. It makes changes, tests them, commits.
- A one-shot "fix everything" tool. Iterative, safe, tested increments.
- Opinionated about your stack. Works with npm, pytest, go test, cargo, make — anything with a test command.

**BYOK:** Uses your AI API key (Claude, GPT, local models). Free tier: unlimited scans. Paid tiers unlock automated improvement (torque/improve).

852 tests. TypeScript. Git-native — every change is a real commit.

https://ratchetcli.com | https://github.com/giovanni-labs/ratchet

Would love feedback:
1. Would you trust this on your codebase?
2. What scoring dimensions are we missing?
3. Scan free + BYOK paid — does this pricing model make sense?
