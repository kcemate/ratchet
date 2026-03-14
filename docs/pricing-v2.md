# Ratchet Pricing v2 — Fixing the Holes

_Continuation of pricing-deep-dive.md. Two problems to solve._

---

## Problem 1: Free Tier Doesn't Serve Our Primary Customer

Vibe coders don't have API keys. Our free tier requires BYOK. So the people most likely to pay can't try the product at all. The free tier only serves engineers — our secondary audience who are least likely to convert.

This is backwards.

### Options:

**A. Free trial with AI included (3 clicks, one time, no card)**

Customer runs `npx ratchet`. First time ever? Get 3 free clicks on us. AI included. See it work. Get a mini Ratchet Report.

- Cost to us: 3 × $0.45 = $1.35 per trial user
- If 10% convert to $20/month Pro, CAC = $13.50. That's fine.
- If 5% convert, CAC = $27. Still okay for $20/month recurring.
- If 2% convert, CAC = $67.50. Bad.

**Risk:** Abuse. Someone creates unlimited trial accounts. Need to gate it — email verification, or device fingerprint, or GitHub OAuth (one trial per GitHub account).

**B. Free tier with 1 AI-included click per month**

Not a trial. Permanent. Every month you get 1 free click with AI included. Enough to see Ratchet work on one file. Not enough to harden a project.

- Cost: $0.45/month per free user. 1,000 free users = $450/month.
- Predictable. Capped. No abuse vector.
- But... 1 click is barely a demo. Does it show enough value?

**C. "Playground" mode — free Ratchet Report without applying changes**

Ratchet analyzes your project and generates the Ratchet Report (what it WOULD fix) but doesn't actually make changes. Read-only. Free, AI included, unlimited.

- This is a diagnostic tool. "Your app has 12 issues. Pay to fix them."
- Cost: ~$0.15 per scan (analysis only, no build/test cycle).
- Brilliant for conversion. Scary report = impulse upgrade.
- But: feels bait-and-switch? "It found 12 problems but won't fix them unless I pay?"

**D. Combine A and C**

Free: Unlimited read-only scans (Ratchet Report). See what's wrong.
Trial: 3 free clicks to actually fix things. One time.
Pro: $20/month for 20 clicks/month.

Funnel: Scan → see problems → free trial fixes 3 → want more → subscribe.

This is the SaaS playbook. Diagnostic is free. Fix is paid. Medical analogy: the checkup is free, the treatment costs money.

### Decision: Option D.

The scan/report is cheap ($0.15), drives conversion through fear ("6 security issues found"), and the 3-click trial lets them experience the fix. Then $20/month for ongoing improvement.

---

## Problem 2: Margins

At $20/month with 20 clicks, heavy users cost us $9 in AI. That's 55% margin on our worst customers.

### What's actually normal?

| Company | Gross Margin | Notes |
|---------|-------------|-------|
| Traditional SaaS | 80-90% | No AI costs |
| GitHub Copilot | ~50-60% | Microsoft subsidizes for market share |
| Cursor | ~55-65% | Heavy AI costs, raised $60M to cover it |
| ChatGPT Plus | ~40-50% | OpenAI runs at a loss |
| Jasper AI | ~60-70% | AI content generation |
| Midjourney | ~70-80% | Image gen is cheaper than text |

**AI companies run 50-70% margins.** Our 65-75% blended is actually on the high end. The 55% on heavy users is normal.

The key insight: **not every user maxes out.** SaaS pricing always depends on average usage being below the limit. Gym memberships sell because most people don't go. Same principle.

But I still want a better floor. Let's model three price points:

### $20/month — 20 clicks

| Usage | AI Cost | Revenue | Margin |
|-------|---------|---------|--------|
| 5 clicks (light) | $2.25 | $20 | 89% |
| 12 clicks (avg) | $5.40 | $20 | 73% |
| 20 clicks (max) | $9.00 | $20 | 55% |
| **Blended** | **~$5.00** | **$20** | **75%** |

### $25/month — 20 clicks

| Usage | AI Cost | Revenue | Margin |
|-------|---------|---------|--------|
| 5 clicks (light) | $2.25 | $25 | 91% |
| 12 clicks (avg) | $5.40 | $25 | 78% |
| 20 clicks (max) | $9.00 | $25 | 64% |
| **Blended** | **~$5.00** | **$25** | **80%** |

### $20/month — 15 clicks

| Usage | AI Cost | Revenue | Margin |
|-------|---------|---------|--------|
| 5 clicks (light) | $2.25 | $20 | 89% |
| 10 clicks (avg) | $4.50 | $20 | 78% |
| 15 clicks (max) | $6.75 | $20 | 66% |
| **Blended** | **~$4.00** | **$20** | **80%** |

**Three ways to get 80% blended margin:**
1. Raise price to $25 (risk: breaks the $20 mental model)
2. Lower clicks to 15 (risk: feels stingy)
3. Keep $20/20 and accept 75% (risk: none, it's fine)

### Do we actually have a problem?

75% blended margin at $20/month. Let me check if that's actually bad:

- 1,000 subscribers × $20 = $20,000/month revenue
- AI costs: ~$5,000/month
- License server (Railway): ~$20/month
- LemonSqueezy fees (5%): ~$1,000/month
- **Net: ~$14,000/month on 1,000 customers**

That's $168,000/year with no employees, no office, no infrastructure beyond one Railway service.

**75% margins are fine. I was overthinking this.** The real risk isn't margins, it's getting to 1,000 customers.

### Margin Decision: Keep $20/month, 20 clicks. Don't optimize what isn't the bottleneck.

---

## Problem 3 (Bonus): AI Costs Will Drop

Sonnet costs $3/M input, $15/M output today. One year ago comparable models cost 3-5x more. The trend is clear:

- 2026: ~$0.45/click
- 2027: ~$0.20/click (probably)
- 2028: ~$0.10/click (possible)

Our margins improve automatically as AI gets cheaper. Pricing stays the same. This is a tailwind, not a headwind.

---

## Final Pricing Model v2

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Free                │   Ratchet Pro               │
│   $0/forever          │   $20/month                 │
│                       │                             │
│   ✓ Unlimited scans   │   ✓ Everything in Free     │
│     (Ratchet Report   │   ✓ 20 clicks/month        │
│     shows what's      │     (AI included)           │
│     wrong — free)     │   ✓ Rollover up to 40      │
│   ✓ Full CLI with     │   ✓ Harden mode            │
│     BYOK (unlimited   │   ✓ Full Ratchet Report    │
│     clicks, your key) │   ✓ Shareable cards         │
│   ✓ 3-click trial     │                             │
│     (AI included,     │   $1.25/extra click         │
│     one time)         │                             │
│                       │                             │
└─────────────────────────────────────────────────────┘
```

### The Funnel

```
Vibe coder hears about Ratchet
        │
        ▼
  npx ratchet (free scan)
  "Your app has 8 issues"
        │
        ▼
  "Try 3 free fixes"
  Sees it work. Gets hooked.
        │
        ▼
  Subscribes: $20/month
  20 clicks/month, AI included
        │
        ▼
  Keeps building, keeps ratcheting
  Rollover banks unused clicks
  Overage at $1.25 if they need more
```

### Why This Is Right

1. **Every customer type has a path in:**
   - Vibe coder (no key): Free scan → 3-click trial → Pro
   - Engineer (has key): BYOK unlimited → maybe Pro for convenience
   - Team lead: Pro immediately, multiple seats later

2. **Free scan is the acquisition engine.** Cheap for us ($0.15), scary for them ("6 security issues"). Fear converts.

3. **3-click trial removes all risk.** See it work before paying. No credit card.

4. **$20/month is the default.** Matches market. One tier. Simple.

5. **Margins: 75% blended.** Normal for AI companies. Improves as AI gets cheaper.

6. **Abuse prevention:** Free scan = unlimited (cheap). Trial clicks = one per GitHub account. Pro = credit card on file.

---

## Changes From v1

| What | v1 | v2 |
|------|----|----|
| Free tier | BYOK only (useless for vibe coders) | Free scan + 3-click trial (works for everyone) |
| Pricing tiers | 4 options (confusing) | 2 options (Free or $20/month) |
| Price point | $19 one-time / $29-79 packs | $20/month subscription |
| Margin concern | Worried about 55% floor | Accepted 75% blended (normal for AI) |
| Conversion funnel | Hope they install and pay | Scan → scare → trial → convert |
| One-time purchase | Available | Killed (doesn't compound) |
