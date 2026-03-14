# Ratchet v2 Architecture — Post-Ratchet Refinement

_Produced by running the Ratchet methodology on our own product proposal. 6 landed, 1 rolled back._

## Product Summary

Ratchet is a metered CLI tool that runs autonomous code improvement loops. Customer provides their own AI key and compute. We provide the intelligence layer and charge per result.

**One sentence:** Point it at your codebase, get a PR with tested improvements, pay $1 per landed commit.

---

## Architecture

```
┌─────────────────────────────────────┐
│  Customer's Environment             │
│                                     │
│  ┌───────────┐    ┌──────────────┐  │
│  │ ratchet   │───▶│ AI Provider  │  │
│  │ CLI       │    │ (their key)  │  │
│  │           │───▶│              │  │
│  └─────┬─────┘    └──────────────┘  │
│        │                            │
│        │  license check + click     │
│        │  metering (per landed      │
│        │  click, no code sent)      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ GitHub    │  (or any CI, or      │
│  │ Actions   │   local terminal)    │
│  └───────────┘                      │
└─────────────┬───────────────────────┘
              │ HTTPS (license key +
              │ click count only)
              ▼
┌─────────────────────────────────────┐
│  Our Infrastructure                 │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ License Server (Railway)      │  │
│  │ - Key validation              │  │
│  │ - Click metering              │  │
│  │ - Usage analytics             │  │
│  │ - No customer code ever       │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ Landing Page (static)         │  │
│  │ - ratchetcli.com              │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

---

## Core Decisions

### 1. Customer owns compute and AI
- Ratchet runs on customer's machine, CI runner, or GitHub Action
- Customer provides their own API key (OpenRouter, Anthropic, or OpenAI)
- We never clone, store, or transmit customer source code
- Zero compute cost for us. Zero security liability.

### 2. Prompts ship in the CLI
- Prompt templates are bundled in the npm package
- No API proxy for AI calls
- We don't protect prompts as IP — the moat is execution quality, rollback reliability, boundary enforcement, and iteration speed
- Prompt improvements ship as CLI version bumps

### 3. Pay per result
- $1 per landed click (commit that passes tests)
- Rolled-back clicks are free — you only pay for value delivered
- First 20 clicks free (onboarding)
- License key validated via lightweight API call per click

### 4. CLI-first, GitHub Action as wrapper
- `npx ratchet torque` works anywhere — local, any CI, any platform
- `giovanni-labs/ratchet-action@v1` is a thin GitHub Action wrapper
- GitLab CI / other platforms get templates later with zero core changes
- Not locked into GitHub ecosystem

### 5. Multi-provider AI support
- `OPENROUTER_API_KEY` — recommended (model flexibility, fallbacks)
- `ANTHROPIC_API_KEY` — direct Anthropic access
- `OPENAI_API_KEY` — direct OpenAI access
- Auto-detect which key is set. Recommend best model per provider.
- Default recommendation: Claude Sonnet via OpenRouter

---

## What We Ship

| Component | Description | Hosting |
|-----------|-------------|---------|
| `ratchet` CLI | Core click loop, prompts, orchestration | npm |
| GitHub Action | Thin wrapper around CLI | GitHub Marketplace |
| License server | Key validation + click metering | Railway |
| Landing page | ratchetcli.com | Static (existing) |

## What We Don't Ship

| ~~Component~~ | Why killed |
|---------------|-----------|
| ~~AI proxy~~ | Customer uses their own key. We had zero margin proxying tokens. |
| ~~Prompt API~~ | Prompts bundle in CLI. Secrecy isn't a moat. |
| ~~Dashboard~~ | GitHub PRs are the interface. Nobody pays for dashboards. |
| ~~Managed compute~~ | Customer's runner. Our cost = $0. |

---

## Target Customer

**Team leads and engineering managers** with repos that have 5+ contributors and CI already set up. They don't want to sit with Claude Code for 2 hours — they want to trigger a run, review a PR, merge. The value isn't "AI writes code for you" — it's "systematic codebase improvement on autopilot."

Not competing with Claude Code/Cursor (individual tools). Competing with tech debt sprints (team cost).

---

## Revenue Model

### Pricing: Prepaid Click Packs
- **Free tier:** 3 clicks/week, forever. No signup required beyond license key.
- **Starter:** 50 clicks for $39 (~$0.78/click)
- **Pro:** 200 clicks for $129 (~$0.65/click)
- **Team:** 1,000 clicks for $499 (~$0.50/click)

Rolled-back clicks are always free — you only pay for landed improvements.

### Why Prepaid, Not Subscription
- No real-time billing dependency — CLI gets a signed token at run start, good for N clicks
- If our license server is briefly down, cached token keeps working
- Lower purchase friction than recurring subscription
- One-time purchase feels like buying a tool, not renting one

### Unit Economics
- Revenue per landed click: $0.50–0.78
- Our cost per click: ~$0.01 (license server API call)
- Margin: ~98%

### Customer's Total Cost Per Click
- Ratchet fee: ~$0.65 (Pro tier)
- AI cost (their key): ~$0.15–0.30 (Sonnet via OpenRouter)
- **Total: ~$0.90 per landed improvement**
- Comparable human cost: $50+ (30 min engineer time minimum)

### Projections (Conservative)
| Customers | Avg pack/quarter | Quarterly Revenue |
|-----------|-----------------|-------------------|
| 50 | Starter ($39) | $1,950 |
| 200 | Pro ($129) | $25,800 |
| 500 | Mix | $40,000+ |

---

## Harden Mode: No Test Suite? No Problem.

Many codebases have zero tests or weak coverage. Ratchet detects this and adapts.

`ratchet torque --target api --mode harden`

- First 2-3 clicks: write test coverage for the target area
- Remaining clicks: improve code against those tests
- Expands addressable market from "teams with good tests" to "any team"

---

## What Kyle Does (Once)
1. LemonSqueezy account — create, connect bank, paste API key
2. Register domain: ratchetcli.com
3. Approve Anthropic spend for our own dogfooding/testing

## What Giovanni Builds
1. License server (Express + LemonSqueezy API, Railway) — signed token auth, cached validation
2. CLI updates: metered mode, multi-provider support, license integration, harden mode
3. GitHub Action: `giovanni-labs/ratchet-action@v1`
4. GitHub Marketplace listing
5. Landing page refresh with new pricing/architecture
6. Docs update
7. `.ratchet.yml` community templates (Next.js, Express, Django, Rails)

## Timeline
- Week 1: License server + CLI metering integration + signed token caching
- Week 2: Multi-provider support + harden mode + GitHub Action
- Week 3: Marketplace listing + landing page + docs + templates
- Week 4: Dogfood on Deuce Diary, fix edges, ship

---

## Ratchet Run Log

This architecture was produced by running the Ratchet methodology on the original proposal.

| Click | Result | Change |
|-------|--------|--------|
| 1 | ✓ landed | Removed API proxy — code never leaves customer's environment |
| 2 | ✓ landed | Dropped prompt secrecy — ship prompts in CLI, compete on execution |
| 3 | ✗ rolled back | Open source everything + referral revenue — killed monetization |
| 4 | ✓ landed | Usage-based pricing: $1/landed click, pay only for results |
| 5 | ✓ landed | CLI-first architecture, GitHub Action as wrapper not platform |
| 6 | ✓ landed | Multi-provider support (OpenRouter, Anthropic, OpenAI) |
| 7 | ✓ landed | Verified final architecture — confirmed simplicity |
| 8 | ✓ landed | Prepaid click packs + signed token caching (no real-time server dependency) |
| 9 | ✓ landed | Reframed target customer: team leads/eng managers, not solo devs |
| 10 | ✓ landed | Persistent free tier: 3 clicks/week forever (PLG funnel) |
| 11 | ✓ landed | Harden mode: write tests first when coverage is low |
| 12 | ✗ rolled back | Competitive moat analysis — strategy concern, no architectural change |
| 13 | ✓ landed | Verified full picture post-refinement |

_10 landed · 2 rolled back · 13 total clicks_
