# Ratchet Badge v2 — Product Spec

_Drafted: 2026-03-22 | Authors: Giovanni (CEO), Grok (COO), Kimi (R&D)_

---

## Vision

The badge is not a feature — it's the viral loop. Every badge in a README is a billboard. Every color change is a retention event. Every badge view is a potential signup. Own the distribution, monetize the insights.

---

## Current State (v1)

- Static SVG or shields.io URL showing overall score (e.g. `ratchet | 98/100`)
- 3 styles: flat, flat-square, for-the-badge
- Color scale: 90+ brightgreen, 75-89 green, 60-74 yellow, 40-59 orange, <40 red
- GitHub Action posts PR comment with score + badge
- `ratchet badge --save` writes `.ratchet/badge.svg`

### Problems
- Single overall score hides strengths and weaknesses
- No trending/delta — no improvement signal
- No hosted service — relies on shields.io or stale local SVG
- No gamification — scan once, forget forever
- No analytics — zero visibility into who installs or views badges
- PR comment links to wrong repo (`samloux/ratchet`)

---

## Badge v2 — Feature Set

### 1. Hosted Badge Service

**Endpoint:** `https://ratchetcli.com/badge/{owner}/{repo}`

Returns a live SVG badge with the latest scan score. No shields.io dependency. No stale SVGs committed to repos.

| Route | Returns |
|---|---|
| `/badge/{owner}/{repo}` | Overall score badge |
| `/badge/{owner}/{repo}/testing` | Testing category badge |
| `/badge/{owner}/{repo}/security` | Security category badge |
| `/badge/{owner}/{repo}/error-handling` | Error Handling category badge |
| `/badge/{owner}/{repo}/type-safety` | Type Safety category badge |
| `/badge/{owner}/{repo}/performance` | Performance category badge |
| `/badge/{owner}/{repo}/code-quality` | Code Quality category badge |
| `/badge/{owner}/{repo}/trend` | Score delta badge (+/- vs last scan) |

**Query params:**
- `?style=flat|flat-square|for-the-badge` (default: flat)
- `?label=custom+label` (override left text)
- `?branch=main` (pin to branch, default: default branch)

**Cache:** 1-hour CDN TTL. Badges update after each CI scan pushes results.

**Implementation:** Cloudflare Worker on ratchetcli.com. Reads from a lightweight KV store populated by the GitHub Action or `ratchet scan --push`.

### 2. Per-Category Badges

6 individual category badges in addition to the master badge. Same color scale applied per-category based on percentage of max:
- Testing: scored out of 25 → percentage mapped to color scale
- Security: scored out of 15 → etc.

**README example:**
```markdown
![Ratchet Score](https://ratchetcli.com/badge/myorg/myrepo)
![Testing](https://ratchetcli.com/badge/myorg/myrepo/testing)
![Security](https://ratchetcli.com/badge/myorg/myrepo/security)
```

Devs choose which categories to showcase. Let them flex their strengths.

### 3. Score Delta / Trend Badge

Shows improvement or regression vs previous scan:

- `ratchet | 92/100 (+4)` — green arrow/text for improvement
- `ratchet | 78/100 (-2)` — red arrow/text for regression
- `ratchet | 85/100 (=)` — neutral for no change

The delta badge is the FOMO machine. "+4 this week" signals active improvement and makes stale repos look bad by comparison.

**Data source:** GitHub Action stores previous score in `ratchet-scan.json` committed to repo, or hosted service tracks history.

### 4. Milestone Badges (Gamification Tier)

Special achievement badges that reward sustained quality:

| Tier | Requirement | Badge |
|---|---|---|
| 🥉 Bronze | Score 60+ | `ratchet | bronze` |
| 🥈 Silver | Score 75+ | `ratchet | silver` |
| 🥇 Gold | Score 90+ | `ratchet | gold` |
| 💎 Platinum | Score 90+ for 30 consecutive days | `ratchet | platinum` |
| 👑 Ratchet Verified | Score 95+ for 90 days | `ratchet verified` |

Platinum and Verified require the hosted service (needs historical data). These are status symbols — devs will chase them.

**Verified badge:** Special SVG with checkmark icon. Listed on ratchetcli.com/verified leaderboard. This is the "blue checkmark" of code quality.

### 5. Leaderboard Badges

Competitive positioning badges:

- `ratchet | top 5% of TypeScript repos`
- `ratchet | #12 in React ecosystem`

Requires aggregate data from the hosted service. Only activates once we have 1,000+ repos submitting scores.

**Phase:** Post-launch. Revisit at 1K repos.

### 6. Score Drop Notifications

When a CI scan detects a score decrease:
- GitHub Action creates an issue: "⚠️ Ratchet score dropped: 92 → 87"
- Optional webhook/email notification
- Badge auto-updates to show regression

This creates urgency. Nobody wants an orange badge that used to be green.

**Config in `.ratchet.yml`:**
```yaml
notifications:
  score-drop: true
  threshold: 5          # only notify if drop >= 5 points
  create-issue: true
  webhook: https://...  # optional
```

### 7. Auto-Onboarding PR

On first `ratchet init` or first GitHub Action run:
- Auto-create PR titled "Add Ratchet score badge to README"
- PR adds the hosted badge URL to top of README.md
- Include category badges if score > 60

This is the Codecov playbook. Reduces friction from "I scanned" to "everyone sees my score" to one click.

**Config:**
```yaml
badge:
  auto-pr: true         # default: true on first run
  categories: true      # include per-category badges
  style: flat           # badge style
```

### 8. One-Click Copy

`ratchet badge` CLI output includes a ready-to-paste snippet with the hosted URL:

```
📋 Copy to your README:

![Ratchet Score](https://ratchetcli.com/badge/myorg/myrepo)
![Testing](https://ratchetcli.com/badge/myorg/myrepo/testing)
![Security](https://ratchetcli.com/badge/myorg/myrepo/security)
```

Also add a "Copy badge" button on ratchetcli.com dashboard (future).

---

## Data Pipeline

```
ratchet scan --push  →  Cloudflare KV  →  /badge/{owner}/{repo}  →  SVG
     ↓                                           ↓
GitHub Action        →  ratchet-scan.json  →  PR comment + badge
     ↓
Score history DB     →  trend/milestone/leaderboard calculations
```

**`--push` flag:** New flag on `ratchet scan` that sends results to the hosted service. Requires `ratchet login` (free account). Without `--push`, badges fall back to shields.io/static SVG (v1 behavior).

**Privacy:** Only overall + category scores + repo metadata are sent. No source code, no file paths, no issue details. Opt-in only.

---

## Monetization Angles

| Feature | Free | Pro ($19/mo) | Team ($49/mo) |
|---|---|---|---|
| Overall badge | ✅ | ✅ | ✅ |
| Category badges | ✅ | ✅ | ✅ |
| Trend badge | ✅ | ✅ | ✅ |
| Score history (30 days) | ✅ | ✅ | ✅ |
| Milestone badges | — | ✅ | ✅ |
| Score drop notifications | — | ✅ | ✅ |
| Leaderboard position | — | ✅ | ✅ |
| Score history (unlimited) | — | ✅ | ✅ |
| "Verified" badge + listing | — | — | ✅ |
| Custom badge branding | — | — | ✅ |
| Badge analytics (views/clicks) | — | — | ✅ |
| Featured repo placement | — | — | $99/mo add-on |

---

## Implementation Phases

### Phase 1 — Foundation (Week 1-2)
- [ ] Hosted badge endpoint on Cloudflare Worker (ratchetcli.com/badge/*)
- [ ] Cloudflare KV store for score data
- [ ] `ratchet scan --push` flag + `ratchet login` flow
- [ ] Per-category badge SVG generation
- [ ] Update GitHub Action to use hosted badge URLs
- [ ] Auto-onboarding PR on first scan
- [ ] Fix PR comment link (samloux → giovanni-labs)

### Phase 2 — Engagement (Week 3-4)
- [ ] Score history tracking in KV/D1
- [ ] Trend/delta badge generation
- [ ] Score drop detection + GitHub issue creation
- [ ] Milestone badge calculations (bronze/silver/gold)
- [ ] Badge analytics (view counting via Worker)

### Phase 3 — Gamification (Month 2)
- [ ] Platinum badge (30-day sustained score)
- [ ] Verified badge (90-day sustained score)
- [ ] ratchetcli.com/verified leaderboard page
- [ ] Leaderboard badges (requires 1K+ repos)
- [ ] Badge analytics dashboard for Team tier

---

## Success Metrics

| Metric | Target (90 days) |
|---|---|
| Repos with badges | 500+ |
| Badge views/month | 50K+ |
| Conversion: badge view → install | 2%+ |
| Repos hitting Platinum | 50+ |
| Score drop → fix within 7 days | 60%+ |

---

## Decisions (Approved 2026-03-22)

1. **Leaderboard rankings:** Public by default. Opt-out available.
2. **Verified badge:** Standalone $29/mo plan. Don't gatekeep the viral mechanic.
3. **Auto-PR:** Default ON. Maximum badge adoption.
4. **Badge analytics:** Full referrer tracking. "Your badge got 2K views from HN" = retention email that writes itself.

---

_"The badge is the product. The CLI is the engine. The cloud is the moat."_ — Grok
