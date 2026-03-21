# I Let an AI Improve My Codebase for a Week. Here's Every Commit It Made.

*An honest engineering retrospective on what worked, what didn't, and what I'd do differently.*

---

## The Problem With Code Quality Tools

You know the feeling. You fire up a static analyzer, and it hands you 847 issues across 203 files. You sort by severity. You start at the top. You make it through eleven before your sprint planning meeting, and then the technical debt slides back into the backlog where it belongs, next to the refactor you promised yourself you'd do "after the rewrite."

The problem isn't that the issues aren't real. They're real. The problem is that there's no path from "here's a list of problems" to "here's a better codebase." You have to do the work yourself, between meetings, while features ship, while the codebase grows faster than you can pay down its debt.

I wanted to see if an AI tool could close that gap—not just find the problems, but fix them. Commit by commit. One click at a time.

The project: a 15,000-line TypeScript application spanning an Express backend, a React/Vite frontend, and a PostgreSQL layer. It started at a code quality score of **76 out of 100**. Not terrible, not great. The kind of score you'd get on a project that shipped fast and had the receipts to show it.

Here's what happened over a week of letting an AI make commits.

---

## What Ratchet Does Differently

Ratchet (from [ratchetcli.com](https://ratchetcli.com)) takes a different angle than a linter or a static analyzer. You point it at your codebase, it scans it, and it gives you a quality score. That's the free part—`npm install -g ratchet-run && ratchet scan` and you're off. But then it goes further: it suggests specific improvements, and if you approve them, it writes the code and commits it for you. The improvement tier is paid (Builder at $19/mo, Pro at $49/mo, both using your own API key via BYOK), but the scan is free and always will be.

The model is iterative. It doesn't dump 200 suggested refactors on you and leave. It picks one improvement, shows you the plan, applies it if you approve, runs your test suite, and reports the new score. It's conservative by design—every commit is verified before the next one starts. The idea is that you never end up with a broken build or a diff that's too large to review.

What surprised me, reading the documentation and then using it, is that it's not trying to be a senior engineer. It's more like a very diligent mid-level who never gets tired and never skips running the tests. It does the mechanical work. You do the judgment calls.

---

## The Experiment: Day by Day

### Day 1 — Baseline

```
$ ratchet scan

Ratchet Code Quality Scan
==========================
Scanning /Users/giovanni/projects/ratchet-test-repo...

Analyzing TypeScript files...
  ✓ Parsed 847 files
  ✓ Type checked (tsc --noEmit)
  ✓ Lint checked (eslint)

RESULTS
-------
Quality Score:    76 / 100
Issues found:     234
Critical:         12
Warnings:         89
Info:             133

Top categories:
  [console]     166 calls across 14 files
  [duplication] 891 duplicated lines
  [long-fn]     64 functions over 50 lines
  [naming]      23 inconsistent identifiers
```

The first thing I noticed: 166 `console.log` calls across the server codebase. That's not a crisis, but it's a smell. In production, you want structured logs, not strings printed to stdout with no context, no levels, no machine-readable format. Ratchet called it out, and it was right.

### Day 2 — First Click: Structured Logging

The first improvement Ratchet proposed was migrating those 166 `console.*` calls to Pino, the structured logger for Node.js. It targeted 14 server files, replaced every `console.log`, `console.error`, and `console.warn` with `pino.info()`, `pino.error()`, etc., and added a logger instance at module level.

I approved it. Tests ran. They passed.

```
$ ratchet improve

Proposed improvement #1: Structured logging migration
---------------------------------------------------
Changes:
  - Replace 166 console.* calls with pino.* across 14 files
  - Add logger.ts with configured pino instance
  - Update imports

Estimated score change: +4 points
Risk: Low

Approve? [y/N] y

Applying...
  ✓ 14 files modified
  ✓ Tests passing (891/891)
  ✓ Committed as 3d7f2a1

Score: 76 → 80/100
```

+4 points. Clean. No surprises. At this point I was cautiously optimistic.

### Day 3 — The Big Split

This was the one I was most nervous about. Ratchet proposed splitting a 2,000-line `routes.ts` file into 13 domain-specific modules: `admin`, `auth`, `battle`, `bingo`, `deuces`, `groups`, `helpers`, `king`, `notifications`, `passport`, `premium`, `public`, and `webhooks`.

That file was the definition of a god object. Every route lived there. It was hard to navigate, hard to test, and impossible to review. I had been meaning to split it for months.

Ratchet did it in one pass. It analyzed the route handlers, grouped them by apparent domain, extracted each group into its own module, and wired up the Express router in each new file. The total diff was large but mechanically sound.

```
$ ratchet improve

Proposed improvement #2: Route module decomposition
---------------------------------------------------
Changes:
  - Split routes.ts (2,047 lines) into 13 domain modules
  - admin.ts, auth.ts, battle.ts, bingo.ts, deuces.ts,
    groups.ts, helpers.ts, king.ts, notifications.ts,
    passport.ts, premium.ts, public.ts, webhooks.ts
  - Create index.ts barrel export

Estimated score change: +3 points
Risk: Medium

Approve? [y/N] y

Applying...
  ✓ 13 new files created, 1 file removed
  ✓ TypeScript compiles cleanly
  ✓ Tests passing (891/891)
  ✓ Committed as 8c1e9f4

Score: 80 → 83/100
```

+3 points. All 891 tests still green. I was starting to think this was easy.

### Day 4 — Narrowing the Rate Limiters

Ratchet flagged 6 rate limiters that were applied too broadly—`app.use()` catching all HTTP methods when they only needed to guard specific POST endpoints. This was a security and performance win: fewer middleware runs per request, tighter control over what gets rate-limited.

```
Proposed improvement #3: Narrow rate limiter scope
---------------------------------------------------
Changes:
  - 6 app.use() → app.post() scope reductions
  - Applies to: /api/auth/login, /api/auth/register,
    /api/battle/join, /api/bingo/call, /api/king/claim,
    /api/notifications/send

Risk: Low

Approve? [y/N] y

Applying...
  ✓ 6 files modified
  ✓ Tests passing (891/891)
  ✓ Committed as 5f2b8c3

Score: 83 → 84/100
```

+1 point. Small, but the kind of change that compounds—better security posture, fewer unnecessary middleware cycles on every request.

### Day 5 — Polish Passes

This day brought three smaller improvements, all sensible:

1. **Error handling.** Several route handlers were missing try/catch blocks, letting exceptions bubble up as unhandled 500s with no context. Ratchet added structured error handling.
2. **Duplicate validation logic.** The same Joi validation schemas were copy-pasted across multiple route files. Ratchet extracted them into a shared `validation/schemas.ts`.
3. **Auth utils DRY refactor.** JWT verification and token refresh logic was duplicated in three places. Pulled into `auth/utils.ts`.

```
Proposed improvements #4, #5, #6: (bundled)
  - Add error handling to 7 route handlers
  - Extract 12 duplicate validation schemas
  - Refactor auth utils (3 sites → 1 module)

Score: 84 → 85/100
```

+1 point. The bundling was my idea—I asked if it could batch the small ones. It obliged. Tests still at 891/891.

---

## What Surprised Me

**1. The guard system caught real problems.**

In one session, I approved five improvements in rapid succession. Three were fine. Two were not—one introduced an infinite recursion bug in a recursive utility function, and another removed a necessary null check that a downstream type assertion depended on. The guard system flagged both before they reached my test suite. I rolled back both changes with a single command. Two clicks, two rollbacks, zero broken builds. That was the moment I understood the value of the conservative, one-at-a-time approach.

**2. Every commit was worth reading.**

I was prepared for the AI to make mechanically correct but stylistically alienating changes. Instead, the code it wrote matched the existing style, respected the variable naming conventions, and didn't try to "improve" things that were fine. The Pino migration used the same log level semantics I'd have chosen. The route split kept the existing Express patterns. It was a force for consistency, not a stylistic wrecking ball.

**3. The score moved predictably.**

Starting at 76 and arriving at 85 felt almost linear—each improvement added roughly 1–4 points. There were no dramatic jumps, no magical refactors that fixed everything at once. That felt honest. Code quality is incremental, and the tool reflected that.

---

## What Didn't Work

**Parallel worker runs produced weak results.**

Ratchet supports parallel improvement runs—spinning up multiple workers to make changes simultaneously. I tried it on Day 6 with three workers. The changes they made were individually fine, but they conflicted with each other. Two workers modified the same auth middleware file. One removed an import that the other depended on. The test suite caught it, but it meant more rollbacks than a sequential run would have required. I went back to sequential after that.

**Score plateau at 85–86.**

By Day 7, the score was sitting at 86 and Ratchet was proposing improvements that felt marginal: renaming variables to match conventions, moving inline styles to CSS modules, that kind of thing. The remaining structural debt—727 duplicated lines and 64 functions over 50 lines—is the kind that requires architectural thinking, not mechanical fixes. Ratchet is good at the mechanical work. It's not going to restructure your data layer or convince your team to adopt a new patterns doc. The plateau isn't a failure of the tool; it's the ceiling of what a code-quality tool can reasonably do without a human in the loop.

**One run introduced an infinite recursion bug.**

Self-corrected in the same session, two clicks later, but I want to be honest about it: it happened. The guard system caught it before it hit main, but if I'd been running this on a branch without good test coverage, it would have shipped. The tool is not a substitute for code review.

---

## The Numbers

| Metric | Value |
|---|---|
| Starting score | 76 / 100 |
| Final score | 86 / 100 |
| Total improvements | 9 |
| Commits made | 9 |
| Tests passing (throughout) | 891 / 891 |
| `console.*` calls migrated to Pino | 166 (14 files) |
| Route modules created | 13 |
| Rate limiters narrowed | 6 |
| Rollbacks triggered by guard | 5 |
| Score plateau reached | 85–86 |

The numbers are real. The test suite never dropped below 891 passing. That's the part I'm most proud of.

---

## Try It Yourself

If you want to see what Ratchet would do with your codebase, the scan is free. Install it with:

```bash
npm install -g ratchet-run
ratchet scan
```

You'll get a quality score, an issue breakdown, and a list of proposed improvements. The improvements are paid—$19/month for Builder, $49/month for Pro, both using your own API key (BYOK model)—but the scan tells you enough to decide whether the rest is worth it.

For my 15K-line project, the $19/month plan covered everything I needed.

**ratchetcli.com**

---

*I'm not affiliated with Ratchet. I paid for the Pro plan out of pocket and wrote this because I wished something like this existed when I was staring at 847 issues and no clear path forward.*
