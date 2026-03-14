# Ratchet — Where We Stand

_Updated: 2026-03-14_

---

## What Is Ratchet?

Ratchet is a tool that automatically improves code. You point it at a project, it finds problems, fixes them, runs tests to make sure nothing broke, and commits the fixes. If a fix breaks something, it undoes it automatically. Your code can only get better, never worse.

Think of it like hiring a junior developer who works through your codebase fixing things overnight — except it costs $19 and takes 5 minutes.

---

## Who Is It For?

**Primary: Vibe coders.** People who build apps using AI tools like Cursor, Bolt, Replit Agent, or v0. They generate working apps fast but the code underneath has problems they can't see — security holes, no error handling, no tests, sloppy types. They don't know how to fix it because they didn't write it.

Ratchet is their safety net. Run it once, get a report of everything it fixed.

**Secondary: Engineering teams.** They have tech debt they never get around to. Ratchet runs on schedule and opens PRs with improvements. Like automated tech debt sprints.

---

## What Exists Today?

### Built and working:
- ✅ Core CLI tool (`ratchet torque`, `ratchet init`, `ratchet status`, `ratchet tighten`)
- ✅ Click loop engine (analyze → propose → build → test → commit → repeat)
- ✅ The Pawl (automatic rollback when tests fail)
- ✅ Git integration (branches, commits, stashing, rollback)
- ✅ `.ratchet.yml` config system (targets, boundaries, settings)
- ✅ Shell agent (calls AI coding tools like Claude Code)
- ✅ Logging system (writes detailed run logs to `docs/`)
- ✅ Lock file (prevents concurrent runs)
- ✅ 82 passing tests
- ✅ Landing page (dark theme, animated terminal demo, FAQ, testimonials)
- ✅ Architecture doc (21 clicks of refinement)

### Not built yet:
- ❌ Zero-config mode (`npx ratchet` auto-detect)
- ❌ Multi-provider support (OpenRouter, Anthropic, OpenAI)
- ❌ Harden mode (write tests first when none exist)
- ❌ Ratchet Report (human-readable PR summary)
- ❌ Ratchet Credits (bundled AI, no key needed)
- ❌ License server (key validation, click metering)
- ❌ GitHub Action
- ❌ Billing (LemonSqueezy integration)
- ❌ New landing page (rewritten for vibe coders)
- ❌ Demo video
- ❌ Published to npm
- ❌ Domain (ratchetcli.com not registered)

---

## How Does It Make Money?

### Three ways to pay:

**1. Single Run — $19 (the main product)**
- 14 clicks, AI included. No API key needed.
- Customer runs `npx ratchet`, pays $19, gets their app hardened.
- This is an impulse buy. One project, one time.
- We pay ~$3.50 in AI costs. We keep ~$15.50.

**2. Power Pack — $79**
- 100 clicks, AI included.
- For people who liked the Single Run and want to use it on multiple projects.
- We pay ~$25 in AI costs. We keep ~$54.

**3. BYOK Unlimited — $29/month**
- Unlimited clicks. Customer brings their own AI key (OpenRouter, Anthropic, OpenAI).
- For teams and power users who already have API keys.
- We pay $0 in AI costs. We keep ~$29.

### Free tier:
- 3 clicks per week, forever. Requires their own API key.
- Enough to try it. Not enough to rely on it. Drives upgrades.

---

## How Does the Technical Architecture Work?

```
Customer runs:  npx ratchet
                    │
                    ▼
          ┌─────────────────┐
          │  Ratchet CLI     │  ← runs on their machine or CI
          │                  │
          │  1. Reads code   │
          │  2. Calls AI     │──→ OpenRouter/Anthropic/OpenAI
          │  3. Applies fix  │     (their key OR our key via Credits)
          │  4. Runs tests   │
          │  5. Commits      │
          │     or reverts   │
          └────────┬─────────┘
                   │
                   │ license check (no code sent)
                   ▼
          ┌─────────────────┐
          │  Our Server      │  ← Railway, one Express app
          │                  │
          │  - Valid key?    │
          │  - Clicks left?  │
          │  - Log the run   │
          └─────────────────┘
```

**Key points:**
- Customer code never leaves their machine. We never see it.
- We only run one server: license validation + click counting.
- AI calls go directly from their machine to the AI provider.
- For Credits customers, we provide a proxied API key so they don't need their own.

---

## What Do You (Kyle) Need to Do?

Three things. One time. Maybe 45 minutes total.

1. **Create a LemonSqueezy account** → connect your bank → give me the API key
   - This is how we collect money. ~15 min.

2. **Register ratchetcli.com** → point it at our landing page
   - Replit, Namecheap, whatever. ~10 min.

3. **Approve the Anthropic spend** for Ratchet Credits customers
   - We'll need a dedicated API key for the Credits proxy.
   - At launch volumes this is maybe $50-200/month in AI costs.
   - Revenue from Credits covers it with ~75% margin.

That's it. Everything else is on me.

---

## What's the Build Plan?

| Week | What | Outcome |
|------|------|---------|
| 1 | Zero-config mode + multi-provider AI support + harden mode | `npx ratchet` works on any project |
| 2 | License server + Ratchet Credits + billing integration | People can pay us |
| 3 | Ratchet Report + GitHub Action + landing page rewrite | Product looks real, distributable |
| 4 | Dogfood on Deuce Diary + demo video + community seeding + ship | Live and in market |

---

## What Are the Risks?

**1. Vibe coders don't pay for tools.**
Maybe. But $19 is less than lunch. And "your app has 6 security issues" is scary enough to convert.

**2. AI output quality varies.**
Sonnet is good but not perfect. Some clicks will produce mediocre improvements. The Pawl protects against bad changes, but it can't force good ones. We need to tune prompts relentlessly.

**3. Big players copy us.**
GitHub Copilot, Cursor, or Codex could add an "iterate" mode. Our advantage: speed and specialization. We ship weekly, they ship quarterly.

**4. Low initial volume.**
First month might be 20-50 customers. Revenue: $400-1,000. This is a slow build unless a demo video goes viral.

---

## What Does Success Look Like?

**Month 1:** 50 paying customers. $1,000 revenue. Validate that vibe coders will pay.
**Month 3:** 200 customers. $5,000/month. Word of mouth working.
**Month 6:** 1,000 customers. $15,000+/month. Consider BYOK team tier, enterprise features.
**Month 12:** If it's working, this is a real business. If not, we learned and move on.

---

## Bottom Line

We have a working engine (CLI + tests + landing page). We need to add billing, zero-config, and Credits. Then ship it. Four weeks of work.

The product is: "You built it with AI. Now make it real." $19.

Your move: LemonSqueezy account + domain + Anthropic key approval.
