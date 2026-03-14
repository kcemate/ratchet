# Ratchet Pricing — Deep Dive

_Hard thinking on pricing. No decisions until the end._

---

## Step 1: What Does a Click Actually Cost Us?

Each click involves 2-3 AI calls (analyze, propose, build). Sonnet via OpenRouter:

| Scenario | Input Tokens | Output Tokens | Cost |
|----------|-------------|---------------|------|
| Simple file fix | 20K | 5K | ~$0.14 |
| Medium (full route handler) | 50K | 15K | ~$0.38 |
| Complex (multi-file refactor) | 80K | 25K | ~$0.62 |
| **Weighted average** | **50K** | **15K** | **~$0.40** |

**Conservative estimate: $0.40–0.50 per click in AI costs.**

A 14-click run costs us $5.60–7.00. A heavy user doing 50 clicks/month costs us $20–25.

This is the number everything else hinges on.

---

## Step 2: What Do Vibe Coders Already Pay For?

| Tool | Price | Model |
|------|-------|-------|
| Cursor Pro | $20/mo | Subscription |
| ChatGPT Plus | $20/mo | Subscription |
| Claude Pro | $20/mo | Subscription |
| v0 Pro | $20/mo | Subscription |
| GitHub Copilot | $10/mo | Subscription |
| Bolt Pro | $20/mo | Subscription |
| Vercel Pro | $20/mo | Subscription |

**$20/month is the established price point.** Vibe coders are trained to pay this. It's in the "don't cancel it" zone.

---

## Step 3: Why the 4-Tier Model Was Wrong

The previous pricing (Single Run $19 / Power Pack $79 / BYOK $29):

1. **Too many choices.** Paradox of choice. Vibe coder wants ONE button.
2. **Single Run kills LTV.** Customer pays $19 once, never returns. That's a lemonade stand.
3. **"Unlimited" is dangerous.** Attracts the heaviest users who cost the most.
4. **Power Pack is in no-man's land.** Too expensive for impulse, too cheap for teams.
5. **Two models (one-time + subscription) confuse the value prop.** Pick one.

---

## Step 4: Five Pricing Models Tested

### Model A: Pure Subscription ($20/month, 20 clicks)
- AI cost: 20 × $0.45 = $9. Margin: $11 (55%). **Too thin.**

### Model B: Usage-Based ($1.50/click)
- Good margins (70%). But "credits" feels like a mobile game. Revenue is lumpy. **Developers hate credits.**

### Model C: One-Time + Subscription Hybrid
- $29 one-time + $20/month. Two choices = confusion. Starter buyers never convert. **Messy.**

### Model D: Subscription with Lower Limit ($20/month, 15 clicks + $1 overage)
- Margin: 66%. Better. But 15 clicks feels stingy. **"I paid $20 and can only run it once?"**

### Model E: The Winner ↓

---

## Step 5: The Pricing Decision

```
┌──────────────────────────────────────────────┐
│                                              │
│   Free              │   Ratchet Pro          │
│   $0/forever        │   $20/month            │
│                     │                        │
│   ✓ Full CLI        │   ✓ Everything in Free │
│   ✓ Unlimited       │   ✓ 20 clicks/month   │
│     clicks          │     (AI included)      │
│   ✓ All agents      │   ✓ Rollover up to 40 │
│                     │   ✓ Harden mode        │
│   ✗ BYOK only       │   ✓ Ratchet Report     │
│   ✗ No harden mode  │   ✓ Shareable cards    │
│   ✗ No report       │                        │
│                     │   $1.25/extra click     │
│                     │                        │
└──────────────────────────────────────────────┘
```

**Two options. Free or $20/month. That's it.**

---

## Why This Works

**1. Free tier is genuinely useful.** Not a crippled demo. Full CLI, unlimited clicks, bring your own key. Engineers and experienced devs live here. They cost us $0. They drive adoption and word of mouth. They're the marketing budget.

**2. $20/month matches the market.** Every AI dev tool is $20. No price comparison anxiety. Vibe coders already pay this for Cursor, ChatGPT, etc.

**3. 20 clicks/month with rollover.** If they don't use all 20, they bank up to 40. Reduces churn — "I have 35 banked, shouldn't cancel." Also reduces our AI costs because banked clicks aren't consumed.

**4. Rollover caps at 40.** Prevents someone banking 200 clicks then doing a massive run that costs us $90.

**5. Overage at $1.25/click.** Not punitive. 5 extra clicks = $6.25. We make $0.80 each after AI costs.

**6. One paid tier.** No Starter/Pro/Team confusion. Simple enough for a tweet.

---

## Unit Economics

| User Type | Clicks Used | AI Cost | Revenue | Margin |
|-----------|-------------|---------|---------|--------|
| Light (8 of 20) | 8 | $3.60 | $20 | $16.40 (82%) |
| Average (12 of 20) | 12 | $5.40 | $20 | $14.60 (73%) |
| Heavy (all 20) | 20 | $9.00 | $20 | $11.00 (55%) |
| Power (20 + 10 overage) | 30 | $13.50 | $32.50 | $19.00 (58%) |
| Inactive (0 used) | 0 | $0 | $20 | $20.00 (100%) |

**Blended margin estimate: 65-75%.** That's a real business.

---

## Why NOT a One-Time Purchase?

I kept coming back to "vibe coders might only need it once." Here's why subscription still wins:

1. **Vibe coders keep building.** They don't ship one app and stop. They iterate, they start new projects.
2. **No compounding with one-time.** 100 customers × $29 = $2,900 then you need 100 NEW customers next month. Subscriptions compound.
3. **If someone truly only needs it once:** they pay $20, use 14 clicks, cancel. Effectively a $20 one-time purchase. Same outcome, but we captured them in the subscription flow.

---

## Why NOT Charge BYOK Users?

Free BYOK users cost us nothing. They drive adoption. They tell people. They write blog posts. Some convert to Pro for harden mode + Credits convenience.

Don't charge them. They're the distribution channel.

---

## Stress Tests

**"What if everyone stays on free?"**
They cost us $0. They spread the word. Some convert for harden mode and zero-friction AI. If nobody converts, the product failed, not the pricing.

**"What if AI costs spike?"**
We control the click limit (20/month). Worst case: reduce to 15 or raise to $25. Rollover cap prevents banked-click bombs.

**"What if a competitor offers it free?"**
Our free tier already has unlimited BYOK. Pro value = convenience + premium features. If that's not worth $20, the product failed.

**"Teams/enterprise?"**
Not now. Ship for individuals. If teams want it, they buy Pro seats. Enterprise comes when enterprise knocks.

**"Annual pricing?"**
Later. Launch monthly only. Add annual ($180/year, save $60) after 3+ months of retention data.

---

## The Answer

**$20/month. One tier. 20 clicks. AI included. Rollover to 40. Overage $1.25/click. Free tier is full BYOK.**

Simple enough for a tweet. Clear enough for a vibe coder. Margins of 65-75%.
