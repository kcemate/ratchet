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

## Revenue Model

### Unit Economics
- Revenue per landed click: $1.00
- Our cost per click: ~$0.01 (license server API call)
- Margin: ~99%

### Customer's Total Cost Per Click
- Ratchet fee: $1.00
- AI cost (their key): ~$0.15–0.30 (Sonnet via OpenRouter)
- **Total: ~$1.25 per landed improvement**
- Comparable human cost: $50+ (30 min engineer time minimum)

### Projections (Conservative)
| Customers | Avg clicks/month | Monthly Revenue |
|-----------|-----------------|-----------------|
| 50 | 30 | $1,500 |
| 200 | 40 | $8,000 |
| 1,000 | 50 | $50,000 |

---

## What Kyle Does (Once)
1. LemonSqueezy account — create, connect bank, paste API key
2. Register domain: ratchetcli.com
3. Approve Anthropic spend for our own dogfooding/testing

## What Giovanni Builds
1. License server (Express + LemonSqueezy API, Railway)
2. CLI updates: metered mode, multi-provider support, license integration
3. GitHub Action: `giovanni-labs/ratchet-action@v1`
4. GitHub Marketplace listing
5. Landing page refresh with new pricing/architecture
6. Docs update

## Timeline
- Week 1: License server + CLI metering integration
- Week 2: Multi-provider support + GitHub Action
- Week 3: Marketplace listing + landing page + docs
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

_6 landed · 1 rolled back_
