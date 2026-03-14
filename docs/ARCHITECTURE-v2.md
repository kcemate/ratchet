# Ratchet v2 Architecture — Post-Ratchet Refinement

_Produced by running the Ratchet methodology on our own product proposal. 2 runs, 21 clicks, 16 landed, 3 rolled back._

## Product Summary

Ratchet is a metered CLI tool that runs autonomous code improvement loops. Customer provides their own AI key and compute. We provide the intelligence layer and charge per result.

**One sentence:** Point it at your codebase, get a PR with tested improvements, pay $1 per landed commit.

**For vibe coders:** "You built it with AI. Now make it real." — `npx ratchet`, no config, $20/month.

**Core differentiator:** Production Readiness Score. Not security scanning (Anthropic owns that). We score and improve overall production readiness — types, error handling, tests, performance, readability, and security as one of six categories.

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

### 3. Zero-config default, YAML for power users
- `npx ratchet` auto-detects project type, test command, source paths
- No `.ratchet.yml` required for first run
- First run prompts for API key if missing, stores in `~/.ratchet/config`
- `.ratchet.yml` is the power-user customization path

### 4. Two-lane AI: BYOK or Credits
- BYOK: customer uses their own OpenRouter/Anthropic/OpenAI key (cheaper per click)
- Ratchet Credits: AI included in click price, zero API key setup (higher per click)
- First-run prompt offers both options

### 5. Pay per result
- Rolled-back clicks are free — you only pay for value delivered
- License key validated via signed token at run start (cached, survives server downtime)

### 6. CLI-first, GitHub Action as wrapper
- `npx ratchet torque` works anywhere — local, any CI, any platform
- `giovanni-labs/ratchet-action@v1` is a thin GitHub Action wrapper
- GitLab CI / other platforms get templates later with zero core changes
- Not locked into GitHub ecosystem

### 7. Multi-provider AI support
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

## Target Customers

### Primary: Vibe Coders
People who build apps with AI (Cursor, Bolt, v0, Replit Agent) but don't deeply read or understand the generated code. They ship fast but the code is full of `any` types, no error handling, no input validation, hardcoded secrets, SQL injection risks. **They don't know what they don't know.**

Ratchet is their safety net. They point it at their AI-generated app, it hardens everything — adds tests, fixes security holes, improves error handling, tightens types. They get a PR that makes their app production-ready without needing to understand the changes themselves.

**The pitch:** "You built it with AI. Now make it real."

Harden mode is the killer feature for this audience — they definitely don't have tests.

### Secondary: Team Leads / Eng Managers
Teams with 5+ contributors and CI already set up. They don't want to sit with Claude Code for 2 hours — they want to trigger a run, review a PR, merge. Systematic codebase improvement on autopilot.

**The pitch:** "Automated tech debt sprints that run while your team ships features."

### Why Vibe Coders Are Better Customers
- Larger and growing market (millions, not thousands)
- Higher willingness to pay — they can't do this manually at any price
- Lower support burden — they don't nitpick the AI's code style
- Stronger word of mouth — "look what Ratchet did to my app" is shareable
- Harden mode is a must-have, not a nice-to-have

---

## Revenue Model

### Pricing

| Plan | Clicks | Price | Per Click | AI Included |
|------|--------|-------|-----------|-------------|
| **Try** | 3/week | Free | $0 | BYOK only |
| **Single Run** | 14 clicks | $19 | $1.36 | ✅ Yes |
| **Power Pack** | 100 clicks | $79 | $0.79 | ✅ Yes |
| **BYOK Unlimited** | Unlimited | $29/month | — | ❌ Your key |

- **Single Run** = the impulse buy for vibe coders. $19 to harden one project.
- **Power Pack** = repeat users, multiple projects.
- **BYOK Unlimited** = teams/power users who bring their own AI key.
- Rolled-back clicks are always free.

### Unit Economics

**Credits path (Single Run / Power Pack):**
- Revenue per click: $0.79–1.36
- AI cost per click: ~$0.25 (Sonnet via OpenRouter on our key)
- Server cost per click: ~$0.01
- **Margin: ~67–81%**

**BYOK path:**
- Revenue: $29/month flat
- AI cost: $0 (their key)
- **Margin: ~99%**

### Customer's Total Cost Per Click
- Credits: ~$1.36/click (Single Run) or ~$0.79/click (Power Pack) — all-in
- BYOK: ~$0.25–0.40/click (just their AI cost) + $29/month
- Comparable human cost: $50+ (30 min engineer time minimum)

### Projections (Conservative)
| Customers | Plan Mix | Monthly Revenue |
|-----------|----------|-----------------|
| 100 | 70% Single Run, 30% Power Pack | ~$3,700 |
| 500 | 50% Single, 30% Power, 20% BYOK | ~$14,000 |
| 2,000 | Mix | ~$45,000+ |

---

## Harden Mode: No Test Suite? No Problem.

Many codebases have zero tests or weak coverage. Ratchet detects this and adapts.

`ratchet torque --target api --mode harden`

- First 2-3 clicks: write test coverage for the target area
- Remaining clicks: improve code against those tests
- Expands addressable market from "teams with good tests" to "any team"
- **Critical for vibe coders** — they never have tests

---

## Ratchet Report: Results for Non-Engineers

Every run generates a human-readable summary at the top of the PR:

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

Vibe coders don't read diffs. They read this and merge. Also great for marketing screenshots.

---

## Distribution Strategy

Vibe coders aren't on npm or GitHub Marketplace. They're on Twitter, YouTube, Reddit, Discord.

1. **Demo video:** Bolt-generated app → `npx ratchet` → show before/after report. 60 seconds.
2. **Shareable Ratchet Reports:** Post-run card image. "Ratchet found 6 security issues in my vibe-coded app." Tweetable.
3. **Community seeding:** Cursor, Bolt, v0 Discords. Real examples from real projects.
4. **"Is your vibe code safe?"** — scare-then-solve landing page.
5. No paid ads. Content + community only at launch.

---

## What Kyle Does (Once)
1. LemonSqueezy account — create, connect bank, paste API key
2. Register domain: ratchetcli.com
3. Approve Anthropic spend for our own dogfooding/testing

## What Giovanni Builds
1. Zero-config auto-detection (`npx ratchet` just works)
2. Ratchet Credits system (bundled AI, no key needed)
3. Ratchet Report generator (human-readable PR summary + shareable card)
4. License server (Express + LemonSqueezy API, Railway) — signed token auth, cached validation
5. CLI updates: metered mode, multi-provider support, license integration, harden mode
6. GitHub Action: `giovanni-labs/ratchet-action@v1`
7. Landing page rewrite for vibe coders ("You built it with AI. Now make it real.")
8. Demo video script + assets
9. `.ratchet.yml` community templates (Next.js, Express, Django, Rails)

## Timeline
- Week 1: Zero-config mode + multi-provider support + harden mode
- Week 2: License server + Ratchet Credits + metering
- Week 3: Ratchet Report + GitHub Action + landing page rewrite
- Week 4: Dogfood on Deuce Diary, demo video, community seeding, ship

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
| 14 | ✓ landed | Primary target = vibe coders, not engineers. "You built it with AI. Now make it real." |
| 15 | ✓ landed | Zero-config: `npx ratchet` auto-detects everything. No YAML needed. |
| 16 | ✓ landed | Two-lane AI: BYOK (cheap) or Ratchet Credits (AI included, zero friction) |
| 17 | ✓ landed | Ratchet Report: human-readable PR summary for people who don't read diffs |
| 18 | ✓ landed | Pricing: Single Run $19, Power Pack $79, BYOK Unlimited $29/mo |
| 19 | ✓ landed | Distribution: demo videos, shareable reports, community seeding |
| 20 | ✗ rolled back | Name change — "Ratchet" is fine. Brand > metaphor. |
| 21 | ✓ landed | Verified full state post-run 2 |
| 22 | ✓ landed | Free scan + 3-click trial for vibe coders (no BYOK needed) |
| 23 | ✓ landed | Pricing locked: $20/month, one tier, 20 clicks, rollover 40. Margins 75%. |
| 24 | ✓ landed | Competitive pivot: Production Readiness Score, not security. Anthropic owns security. |

_19 landed · 3 rolled back · 24 total clicks_
