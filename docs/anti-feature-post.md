# What Ratchet Won't Do

**Trust is built with boundaries, not promises.**

---

## The Twitter Thread

---

**1/** Most AI refactor tools have the same pitch: "We'll fix everything."

Ratchet says: no.

We built boundaries because we actually use this on production code.

Here's what we explicitly refuse to do 👇

---

**2/** Won't touch files outside your scope.

Define a guard profile. Ratchet stays inside it. Files you didn't include aren't touched, period. No scope creep, no "while I was in there" changes.

---

**3/** Won't skip your test suite.

You wrote those tests. They're not optional. Ratchet runs your full suite after every single change. If the tests don't pass, the change doesn't ship.

---

**4/** Won't commit code that fails tests.

This should be obvious. It isn't. Most tools will happily commit broken code if you let them. Ratchet reverts automatically. Failed tests = no commit.

---

**5/** Won't rewrite entire files.

We limit change size per iteration. Guard profiles cap how much can change in one click. You won't come back to find a 2,000-line file that "improved itself."

---

**6/** Won't hallucinate new dependencies.

No surprise packages in your package.json. No new imports that don't exist. Ratchet works with what you have.

---

**7/** Won't modify your CI/CD config.

Your pipeline is yours. Ratchet doesn't touch .github/, .gitlab-ci.yml, Jenkinsfile, or anything in it. We don't know your deploy process and we don't want to.

---

**8/** Won't access your codebase without you running a command.

No background indexing. No pre-scan on open. You run `ratchet-run`, it does exactly what you asked, then it stops. Your code stays on your machine.

---

**9/** Won't send your code anywhere.

BYOK — bring your own key. Your model. Your API. Your code never leaves your environment. We have no server to call home.

---

**10/** Won't promise a perfect score.

We plateau'd at 86/100 on DeuceDiary (1,280 tests, 65 files). Diminishing returns are real. Ratchet won't pretend otherwise or chase a number that doesn't matter.

---

**11/** Won't hide what it changed.

Full logs. Per-click breakdown. PDF reports. Every change is logged, revertable, and readable. No black boxes.

---

That's the list.

We could have marketed around what Ratchet *does* do. We chose to publish what it *won't* do instead.

Because for teams shipping real code, the boundaries are the feature.

→ [ratchetcli.com](https://ratchetcli.com)

---

## Blog Version

---

# What Ratchet Won't Do: Trust Through Boundaries

There's a genre of AI tool that promises to fix your entire codebase. Rewrite it. Transform it. Make it "modern."

We've watched engineers get excited about these tools. We've watched them come back to find their entire `utils/` folder rewritten, their test files commented out, their CI pipeline silently modified, their proprietary logic replaced with plausible-sounding stubs.

They're not malicious. The tools just don't have boundaries.

**Ratchet does.**

---

## The Problem With "It'll Figure It Out"

Most AI refactor tools operate on a philosophy of maximum change. The pitch is appealing: point it at your mess, let it work, come back to clean code.

The problem: your codebase isn't just code. It's business logic, edge cases, institutional knowledge, subtle bugs you're shipping around intentionally, and tests that document behavior your team spent years learning.

Maximum change tools don't know any of that. They optimize for what they can measure (line count, import style, function length). They don't know what matters.

The result is often a clean-looking codebase that no longer does what it did.

---

## What Ratchet Refuses To Do

### 1. Won't touch files outside your scope

Ratchet operates on a defined guard profile. Files outside that profile are invisible to it. You choose the scope. Ratchet stays in it.

### 2. Won't skip your test suite

Your test suite is the contract your code lives up to. Ratchet doesn't skip, stub, or shortcut it. Full suite, every time.

### 3. Won't commit code that fails tests

This is where most tools fail. Ratchet runs the tests *after* every change. If any fail, it reverts. No partial state, no "well the important tests pass."

### 4. Won't rewrite entire files

Change size is capped by guard profile settings. You won't find Ratchet rewriting a 2,000-line file in a single pass. Changes are incremental, reviewable, and scoped.

### 5. Won't hallucinate new dependencies

No phantom packages. No imports that don't resolve. Ratchet works with your existing dependency graph and doesn't expand it without your explicit instruction.

### 6. Won't modify your CI/CD config

Your deploy pipeline is none of our business. Ratchet doesn't read or write `.github/`, `.gitlab-ci.yml`, Jenkinsfiles, or any CI configuration. We don't know your env vars, your deploy order, or your rollback strategy. We don't want to.

### 7. Won't access your codebase without you running a command

No background processes. No indexing on file save. No pre-scanning. You run `npx ratchet-run`, it executes your task, and it stops. Your machine, your code, your control.

### 8. Won't send your code anywhere

BYOK. Bring your own model, your own API key. Your code never touches our servers. It runs locally, in your environment, under your control.

### 9. Won't promise a perfect score

On DeuceDiary — 1,280 tests across 65 files — Ratchet got the score from 76 to 86. We could have chased higher. We chose not to, because past 86 the changes become high-risk, low-reward. Diminishing returns aren't a failure. They're a signal.

### 10. Won't hide what it changed

Every change is logged. Full per-click audit trail. PDF reports ready for your next retrospective. Ratchet doesn't do hidden state.

---

## Why We Published This List

We could have marketed Ratchet on what it *does*. More features, more languages, more impressive before/after numbers.

We chose to publish what it won't do instead.

Because for teams working on production code — the kind where a bad deploy means pages going down, data getting weird, or users seeing errors — the boundaries are the point.

**Trust is built with constraints.**

The tools that tell you what they won't do are the ones worth trusting with your codebase.

→ **[ratchetcli.com](https://ratchetcli.com)** — `npx ratchet-run`
