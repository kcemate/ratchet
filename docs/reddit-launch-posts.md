# Reddit Launch Posts

## r/programming

**Title:** I built a CLI that scores your codebase 0-100, then autonomously fixes the issues it finds

Every code quality tool I've used just reports problems. So I built one that actually fixes them.

Ratchet scans your code across 6 quality categories (Testing, Security, Type Safety, Error Handling, Performance, Code Quality), gives you a concrete score out of 100, then runs AI-powered fix cycles that each commit independently.

Each "click" = analyze → propose → implement → run tests → commit if green, revert if red.

The ratchet wrench only turns one way.

I dogfooded it on a 15K-line TypeScript app and went from 76 to 86/100. 891 tests passing the entire time. Real commits include: migrating 166 console.* calls to structured logging, splitting a 2000-line god file into 13 modules, narrowing 6 overly-broad rate limiters.

Being honest: it plateaus around 85-86. One run introduced an infinite recursion bug — but the same run fixed it 2 clicks later. 5 out of 7 clicks rolled back in another session. That's the guard system working.

Free: `ratchet scan` (unlimited, forever). Paid: `ratchet torque` for autonomous improvements (Builder $19/mo, Pro $49/mo). BYOK model.

1,280 tests. TypeScript. `npm install -g ratchet-run`

https://ratchetcli.com

---

## r/typescript

**Title:** Built a CLI that auto-improves your TypeScript codebase — took our project from 76 to 86/100

Scratched my own itch. Ratchet scans your codebase for real issues (type safety gaps, duplication, missing error handling, security), scores it 0-100, then runs AI-powered fix cycles that each commit independently.

Each "click" runs your full test suite. Green → commit. Red → revert. No half-baked changes.

Real results on our Express + React + Vite + PostgreSQL app:
- Migrated ~166 console.* calls to Pino structured logging across 14 files
- Split a 2000-line routes.ts into 13 domain modules
- DRY-ed auth utilities, unified error handling patterns
- 891 tests → 1,280 tests passing (Ratchet generates tests too)

Guard profiles control how aggressive each cycle is (tight = 3 files/40 lines max, broad = 10 files/120 lines). Smart escalation auto-broadens when the AI keeps hitting guard limits.

`npm install -g ratchet-run && ratchet scan` — free, no API key needed for scan.

https://ratchetcli.com

---

## r/ExperiencedDevs

**Title:** I built an automated code quality tool that only commits changes that pass your tests. Here's what 3 weeks of dogfooding taught me.

The pitch is simple: scan your codebase for concrete quality issues, score it 0-100, then let AI fix things one commit at a time. If tests fail, the change reverts.

What I learned running it on our production codebase (15K lines, Express + React + PostgreSQL):

**What worked:**
- Logging migrations and rate limiter fixes — mechanical changes AI is perfect for
- Splitting large files — the "architect mode" handles cross-file refactors well
- Test generation — it wrote solid edge case tests for modules it was improving

**What didn't:**
- Score plateaus at ~85-86. Structural issues (700+ duplicated lines, 64 functions >50 lines) need human decisions
- Parallel runs were disappointing — 5 workers produced weak, conflicting changes
- One run introduced an infinite recursion bug (self-corrected, but still)

**What surprised me:**
- The guard/revert system is more valuable than the improvements themselves. Knowing every change is tested changes how you think about automated refactoring.
- Diminishing returns hit faster than expected. The first 10 points are easy. The last 5 take 3x the effort.

Free scans: `npm install -g ratchet-run && ratchet scan`
Paid improvements: ratchetcli.com

1,280 tests. Would love to hear from anyone who tries it on their own codebase.
