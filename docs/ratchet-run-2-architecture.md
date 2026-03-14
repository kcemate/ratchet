# ⚙ Ratchet Run 2 — Architecture v2 (clicks 15-21)

Second pass. Attacking from the vibe coder lens.

---

## Click 15: Analyze the onboarding for someone who doesn't know what a CLI is

A vibe coder built their app in Cursor or Bolt. They've maybe used `npm run dev`. Now we're asking them to:
1. Get an OpenRouter API key
2. Install a CLI tool
3. Create a `.ratchet.yml`
4. Run `ratchet torque --target src --mode harden`

That's 4 steps with 3 concepts they don't understand (API keys, YAML config, CLI flags). They'll bounce.

**Improvement:** Zero-config mode. Single command:

```
npx ratchet
```

No `.ratchet.yml` needed. No flags. Ratchet auto-detects:
- Project type (Next.js, Express, etc.) from `package.json`
- Test command (or lack of one → auto-enable harden mode)
- Source paths from project structure
- AI key from environment (`OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`)

First run prompts for the API key if missing, stores it in `~/.ratchet/config`. Interactive setup, one time.

`.ratchet.yml` becomes the power-user path, not the default path.

**Tests pass?** ✓ — Drops onboarding from 4 steps to 1. Vibe coders can use it.

---

## Click 16: Analyze the "bring your own API key" friction for vibe coders

Even with zero-config, we're asking a vibe coder to go to openrouter.ai, create an account, add a credit card, generate a key, paste it in. That's still too much for someone who just wants their app fixed.

Experienced devs have API keys lying around. Vibe coders don't.

**Improvement:** Ratchet offers a built-in key option:

```
$ npx ratchet

No API key found. How do you want to power Ratchet?

  1. Use your own key (OpenRouter, Anthropic, or OpenAI)
  2. Use Ratchet Credits — no API key needed ($1.50/click, AI included)

>
```

Option 2: we bundle AI cost into the click price. Customer buys a "Ratchet Credits" pack — clicks + AI tokens included. We eat the AI cost at ~$0.25/click, charge $1.50/click. Margin: $1.25/click.

BYOK users pay less per click ($0.65). Credit users pay more but have zero setup friction.

Two-lane pricing:
- **BYOK:** 50 clicks for $39 (AI not included)
- **Credits:** 50 clicks for $75 (AI included, just works)

**Tests pass?** ✓ — Removes the biggest friction for the primary audience. Power users still get the cheaper BYOK path.

---

## Click 17: Analyze what "results" look like to someone who doesn't read code

Engineers review a PR diff. Vibe coders don't. If Ratchet opens a PR with 7 commits, a vibe coder sees a wall of green/red lines and panics or blindly merges.

**Improvement:** Every Ratchet run generates a human-readable summary at the top of the PR:

```markdown
## 🔧 Ratchet Report

**7 clicks · 6 landed · 1 rolled back · 3m 42s**

### What improved:
- ✅ Added input validation to 4 API routes (prevents injection attacks)
- ✅ Replaced 12 `any` types with proper TypeScript types
- ✅ Added error handling to database calls (was crashing silently)
- ✅ Moved API key from hardcoded string to environment variable
- ✅ Added 8 unit tests (you had 0)
- ✅ Fixed 2 potential memory leaks in WebSocket handlers

### What was rolled back:
- ↩️ Tried to refactor auth middleware — broke login flow, reverted

### Before/After:
- Test coverage: 0% → 34%
- TypeScript strict errors: 47 → 12
- Security issues: 6 → 1
```

A vibe coder reads that and thinks "holy shit, my app had 6 security issues?" and merges immediately. They don't need to read the diff.

**Tests pass?** ✓ — Makes the output accessible to non-engineers. Also great for marketing screenshots.

---

## Click 18: Analyze whether prepaid click packs make sense for vibe coders

A vibe coder ships one app. Maybe two. They're not running Ratchet every week on 10 repos like an engineering team. They run it once on their project, maybe again after a big feature.

Selling them a 50-click pack is weird. They need 7-14 clicks total. The Starter pack at $39 gives them 50 clicks they'll never use.

**Improvement:** Simpler pricing. Three options:

| Plan | Clicks | Price | Per Click | AI Included |
|------|--------|-------|-----------|-------------|
| **Try** | 3/week | Free | $0 | BYOK only |
| **Single Run** | 14 clicks | $19 | $1.36 | Yes |
| **Power Pack** | 100 clicks | $79 | $0.79 | Yes |
| **BYOK Unlimited** | Unlimited | $29/month | — | No (your key) |

The "Single Run" is the product for vibe coders. $19 to harden your app. That's an impulse buy. One Ratchet run on one project. Done.

Power Pack for repeat users. BYOK Unlimited for teams/power users who bring their own AI.

**Tests pass?** ✓ — Pricing aligned to how each segment actually uses the product.

---

## Click 19: Analyze distribution — how do vibe coders find Ratchet?

Vibe coders aren't browsing npm or GitHub Marketplace. They're on:
- Twitter/X (watching AI coding demos)
- YouTube (following build-in-public creators)
- Reddit (r/webdev, r/nextjs, r/ChatGPTCoding)
- Discord (Cursor, Bolt, v0 communities)

**Improvement:** Distribution strategy for launch:

1. **Demo video:** Screen recording of a Bolt-generated app → `npx ratchet` → show the before/after report. 60 seconds. Post everywhere.
2. **"Ratchet Report" as shareable content:** After every run, Ratchet generates a sharable report image/card. "Ratchet found 6 security issues in my vibe-coded app." That's a tweet people share.
3. **Cursor/Bolt community seeding:** Post in their Discords. "I built X with Cursor. Ratchet found Y problems. Here's what it fixed."
4. **"Is your vibe code safe?" landing page:** Scare-then-solve. Show common issues in AI-generated code, offer Ratchet as the fix.

No paid ads. No cold outreach. Content + community.

**Tests pass?** ✓ — Concrete distribution plan for the primary audience.

---

## Click 20: Analyze the product name in context of vibe coders

"Ratchet" — the wrench metaphor. Every click tightens the socket. Engineers get it immediately.

Vibe coders? "Ratchet" means nothing to them. Or worse, it has negative slang connotations. The wrench metaphor assumes mechanical knowledge they don't have.

Does the name hurt us?

Actually… no. "Ratchet" is short, memorable, slightly aggressive, has a .com-able domain. The metaphor doesn't need to land for the product to land. Cursor doesn't mean anything either. Neither does Bolt. Brand > metaphor.

**Tests pass?** ✗ — **Rolled back.** No change needed. Name is fine.

---

## Click 21: Verify the full state after run 2

After 21 total clicks (14 landed, 3 rolled back):

| Change | Before (Run 1) | After (Run 2) |
|--------|----------------|----------------|
| Onboarding | `.ratchet.yml` + flags | `npx ratchet` zero-config |
| API key friction | BYOK required | BYOK or Ratchet Credits (AI included) |
| PR output | Raw commits + log | Human-readable Ratchet Report |
| Pricing | Click packs (50/200/1000) | Single Run $19, Power Pack $79, BYOK $29/mo |
| Distribution | npm + GitHub Marketplace | Demo videos + shareable reports + community |
| Name | Considered changing | Kept. Brand > metaphor. |

**Tests pass?** ✓

---

## Summary

Run 2: 6 landed · 1 rolled back · 7 clicks (15-21)
Total across both runs: 14 landed · 3 rolled back · 21 clicks
