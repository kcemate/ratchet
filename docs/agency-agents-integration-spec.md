# Agency Agents Integration Spec
**Date:** 2026-03-18 | **Author:** Giovanni | **Status:** DRAFT

---

## Overview

[msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents/) is an open-source library of ~50 specialized AI agent personas with defined personalities, workflows, deliverables, and success metrics. We integrate them at two levels:

1. **Internal Ops** — power our own dev and marketing workflows (Giovanni's org)
2. **Ratchet Product** — ship as a feature ("Swarm Mode") for paying customers

---

## PART 1: Internal Ops Integration

### 1A. Engineering Agents → OpenClaw Sub-Agents

Wire these personas as system prompts when spawning Claude Code agents via `sessions_spawn` or `claude --print`.

| Agent | Use Case | When to Trigger |
|-------|----------|----------------|
| **Code Reviewer** 👁️ | PR reviews, post-ratchet quality gates | After every `ratchet torque` run, spawn reviewer on the diff |
| **Security Engineer** 🔒 | Security audits, vuln assessment | When ratchet scan shows security < 5/7 |
| **Database Optimizer** 🗄️ | Query tuning, schema review | Before any DD migration, after schema changes |
| **DevOps Automator** 🚀 | CI/CD pipeline, Railway deploys | When setting up new services or debugging deploys |
| **Software Architect** 🏛️ | Architecture decisions, DDD | Before major refactors (e.g., routes.ts split was exactly this) |

**Implementation:**
```
# Example: spawn a Code Reviewer agent on latest ratchet diff
claude --model claude-sonnet-4-6 --permission-mode bypassPermissions --print \
  --system-prompt "$(cat ~/.openclaw/agents/code-reviewer.md)" \
  "Review the last 3 commits on ~/Projects/DeuceDiary. Use 🔴/🟡/💭 priority markers."
```

**Setup:**
1. `git clone https://github.com/msitarzewski/agency-agents.git /tmp/agency-agents`
2. Cherry-pick relevant .md files → `~/.openclaw/agents/`
3. Create a lookup map in `~/.openclaw/agents/manifest.json`:
   ```json
   {
     "code-reviewer": { "file": "code-reviewer.md", "trigger": "post-ratchet" },
     "security-engineer": { "file": "security-engineer.md", "trigger": "security-score < 5" },
     "db-optimizer": { "file": "db-optimizer.md", "trigger": "manual" },
     "devops": { "file": "devops-automator.md", "trigger": "manual" },
     "architect": { "file": "software-architect.md", "trigger": "manual" }
   }
   ```

### 1B. Marketing Agents → Product Launch Swarm

These run as isolated sub-agents for DD and Ratchet go-to-market:

| Agent | Product | Deliverables |
|-------|---------|-------------|
| **Growth Hacker** 🚀 | Both | Viral loop design, referral programs, funnel optimization |
| **Content Creator** ✍️ | Both | Blog posts, landing copy, social content, video scripts |
| **Reddit Community Builder** 💬 | Ratchet | r/programming, r/webdev, r/devtools presence. Authentic value-first |
| **SEO Specialist** 🔍 | Both | ratchetcli.com + deucediary.com technical SEO, keyword strategy |
| **AI Citation Strategist** 🔮 | Ratchet | Get Ratchet cited when devs ask ChatGPT/Claude "best code quality tools" |
| **App Store Optimizer** 📱 | DD | When DD mobile hits App Store — title, keywords, screenshots |

**Marketing Swarm Workflow:**
```
Phase 1 — Research (parallel):
  ├── Growth Hacker → audit competitors, map funnel, design viral loop
  ├── SEO Specialist → keyword research, technical audit of landing pages
  ├── AI Citation Strategist → audit "code quality CLI" queries across ChatGPT/Claude/Gemini
  └── Reddit Builder → map relevant subreddits, analyze top posts

Phase 2 — Content (sequential, informed by Phase 1):
  ├── Content Creator → blog posts, landing page copy, social media calendar
  ├── Growth Hacker → referral program spec, onboarding flow optimization
  └── Reddit Builder → first 10 value-add posts/comments (drafted, human-reviewed)

Phase 3 — Execute (human-approved):
  ├── SEO fixes deployed to ratchetcli.com / deucediary.com
  ├── Content published (blog, social, Reddit)
  ├── AI Citation fixes → structured data, FAQ schema, comparison pages
  └── Growth experiments launched (A/B tests, referral beta)
```

---

## PART 2: Ratchet Product — "Swarm Mode"

### Concept

Today: `ratchet torque` spawns ONE generic agent that iterates.
Tomorrow: `ratchet swarm` spawns MULTIPLE specialized agents in parallel, each with a domain-specific persona.

### Command Design

```bash
# Analyze codebase and deploy the right specialists
ratchet swarm --target ~/Projects/MyApp --clicks 20

# Or pick specific specialists
ratchet swarm --agents security,performance,testing --clicks 15

# Solo specialist mode
ratchet torque --agent security --clicks 7
```

### How It Works

```
ratchet scan (score: 72/100)
    │
    ├── Security: 3/7 → spawn Security Engineer agent (5 clicks)
    ├── Testing: 2/8 → spawn Test Coverage agent (5 clicks)  
    ├── Duplication: 0/3 → spawn Refactor Architect agent (5 clicks)
    └── Performance: 4/6 → spawn Performance Engineer agent (5 clicks)
    │
    ├── Each agent works in its own git worktree (parallel, no conflicts)
    ├── Each agent uses its specialized persona as system prompt
    ├── Each agent commits to its own branch
    │
    └── Coordinator merges branches, resolves conflicts, runs tests
        │
        └── ratchet scan (score: 84/100) → PDF report with per-agent breakdown
```

### Agent Roster for Ratchet Swarm

| Agent ID | Based On | Ratchet Scoring Dimension | Trigger |
|----------|----------|--------------------------|---------|
| `security` | Security Engineer | Auth & Rate Limiting (0-7) | Score < 5 |
| `testing` | (custom) | Test Coverage (0-8) | Score < 5 |
| `refactor` | Software Architect | Duplication (0-3), Function Length (0-4) | Dup 0-1 or FnLen < 3 |
| `logging` | (custom) | Structured Logging (0-7) | Score < 5 |
| `performance` | Backend Architect | Line Length (0-4), general perf | Score < 3 |
| `reviewer` | Code Reviewer | Post-swarm quality gate | Always (final pass) |

### Architecture

```
src/
  commands/
    swarm.ts          # CLI entry: ratchet swarm [options]
  core/
    swarm/
      coordinator.ts  # Orchestrates agents, manages worktrees, merges
      roster.ts       # Agent persona registry + trigger logic
      worktree.ts     # Git worktree create/cleanup per agent
      merger.ts       # Branch merge + conflict resolution
    agents/
      personas/       # .md files (adapted from agency-agents)
        security.md
        testing.md
        refactor.md
        logging.md
        performance.md
        reviewer.md
```

### Pricing Alignment

| Tier | Swarm Access |
|------|-------------|
| Free | No (scan + vision only) |
| Builder ($9) | No (torque single-agent only) |
| Pro ($29) | Yes — up to 3 parallel agents per swarm |
| Team ($149) | Yes — up to 6 parallel agents, custom personas |
| Enterprise | Unlimited agents, bring-your-own personas |

Swarm clicks count against cycle budget: a 4-agent swarm with 5 clicks each = 20 cycles.

---

## PART 3: Marketing Playbook — DD & Ratchet Launch

### Ratchet Marketing Strategy

**Target audience:** Senior devs, tech leads, engineering managers at 10-200 person companies.

**Channel plan (mapped to agency-agents):**

| Channel | Agent | Strategy | Content |
|---------|-------|----------|---------|
| **Reddit** | Reddit Community Builder | Value-first in r/programming, r/webdev, r/devtools, r/ExperiencedDevs | "I built a tool that scores your codebase" posts, comment helpful advice with scan examples |
| **Twitter/X** | Content Creator | Dev tool audience, build-in-public, share vision graphs | Before/after score screenshots, "this file has blast radius 35" type hooks |
| **Blog/SEO** | SEO Specialist + Content Creator | ratchetcli.com/blog — target "code quality tools", "reduce tech debt", "automated code review" | Comparison posts, "we ran ratchet on 100 open source repos" data pieces |
| **AI Engines** | AI Citation Strategist | Get cited for "best code quality CLI", "automated tech debt reduction" | Structured FAQ pages, schema markup, comparison tables, authoritative docs |
| **HN** | Growth Hacker | Show HN launch, emphasize the vision graph (visual = upvotes) | "Show HN: Ratchet – CLI that scores and autonomously improves your codebase" |
| **YouTube** | Content Creator | Terminal demo videos, "I let AI fix my codebase for 7 hours" | Screen recordings of torque runs, before/after score reveals |

**Launch sequence:**
1. **Week -2:** SEO fixes, blog content, structured data
2. **Week -1:** Reddit soft-launch (value posts, not promotion), Twitter build-in-public
3. **Day 0:** HN Show HN + ProductHunt + Twitter thread + Reddit announcement
4. **Week +1:** Follow-up blog ("what we learned from 500 scans"), YouTube demo
5. **Week +2:** AI citation audit, adjust based on early data

### DeuceDiary Marketing Strategy

**Target audience:** Friend groups 18-35, humor-driven, social app users.

| Channel | Agent | Strategy |
|---------|-------|----------|
| **TikTok** | Content Creator | Toilet humor content, "my friend group has a poop leaderboard" reaction videos |
| **Instagram** | Content Creator | Meme-format posts, squad screenshots, "Battle Shits" clips |
| **Reddit** | Reddit Community Builder | r/funny, r/apps, r/AppIdeas — "we actually built the poop tracking app" |
| **App Store** | App Store Optimizer | ASO keywords: "poop tracker", "bathroom log", "friend group app" |
| **Word of mouth** | Growth Hacker | Invite flow is the viral loop — squads invite friends, growth is organic |

**Key viral mechanics already built:**
- Squad invites (free, unlimited)
- Battle Shits (competitive → shareable)
- Deuce King 👑 (bragging rights)
- Vision graph of the codebase itself as dev credibility content

---

## PART 4: Implementation Plan

### Phase 1 — Internal Ops (This Week)
- [ ] Clone agency-agents, cherry-pick 5 engineering + 5 marketing personas
- [ ] Adapt to OpenClaw format in `~/.openclaw/agents/`
- [ ] Test Code Reviewer on latest DD ratchet diff
- [ ] Test Security Engineer on DD security scan
- [ ] Run Growth Hacker on Ratchet competitive landscape

### Phase 2 — Ratchet Swarm MVP (Next Week)
- [ ] Build `src/commands/swarm.ts` + coordinator
- [ ] Implement worktree-per-agent isolation
- [ ] Wire 3 personas: security, testing, refactor
- [ ] Merge + conflict resolution logic
- [ ] PDF report with per-agent breakdown
- [ ] Ship as `ratchet swarm` behind Pro+ tier

### Phase 3 — Marketing Execution (Week After)
- [ ] SEO audit of ratchetcli.com + deucediary.com
- [ ] AI citation baseline audit across ChatGPT/Claude/Gemini/Perplexity
- [ ] First 5 Reddit value-posts (drafted, Kyle reviews before posting)
- [ ] Blog: "We ran Ratchet on 50 open source repos — here's what we found"
- [ ] HN Show HN draft

---

_This spec lives at `~/Projects/ratchet/docs/agency-agents-integration-spec.md`. Update as we execute._
