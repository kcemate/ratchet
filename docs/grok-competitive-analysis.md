# Grok's Competitive Analysis — Ratchet 🔍
_Generated 2026-03-15_

## Direct Competitors

| Competitor | Price | Notes |
|---|---|---|
| **CodeRabbit** | $24-30/dev/mo | 2M repos, 10k+ customers (NVIDIA). AI PR reviews + 1-click fixes + codebase graph. **Closest threat.** |
| **GitHub Copilot Agents** | $10-39/user/mo | Autofix + PR agents. Unbeatable distribution. |
| **Sweep AI** | $10-60/mo | Ticket-to-PR agent. Simpler but IDE-embedded. |
| **SonarQube/Snyk/Codacy** | $25-32+/dev/mo | Rule-based with limited AI fix. Enterprise-grade but not truly agentic. |

## Ratchet's Edge

- **Only tool with a quantitative 0-100 score + before/after PDF reports**
- Swarm mode (competing agents), adversarial QA, architect mode — nobody else does multi-agent competition
- `ratchet improve` = scan→fix→rescan→report in one flow. Competitors do pieces, not the full loop
- Cross-run learning, GitNexus dependency graphs, pre-commit validation

## Ratchet's Weaknesses

- No distribution yet (no GitHub App, no IDE plugin, no marketplace)
- Single AI backend (Claude) — expensive at scale
- No enterprise features (SSO, compliance, self-host)
- Score could feel subjective vs SonarQube's established metrics

## Positioning — Sweet Spot

Mid-market teams (10-200 devs), agencies, growth startups who want measurable quality improvement. Not enterprise (yet), not solo devs.

## Pricing

$49-79/repo/month. Free tier for public repos. Competitors charge per-seat; per-repo aligns better with Ratchet's value prop.

## GTM

1. Open-source CLI core, keep swarm/agents proprietary
2. Launch Product Hunt + HN + Reddit
3. "Score your repo free" web audits
4. GitHub App is critical — build it
5. Case studies: "62 → 89 in one weekend"

## Moat Verdict

**Defensible:** scoring system + multi-agent swarm + cross-run learning + CLI workflow
**Not defensible:** basic scanning, using Claude to fix code, dependency graphs

## Bottom Line

Strong conceptual differentiator, weak market position. Window is closing — need GitHub App, real logos, and proof that the score correlates with fewer bugs. Execute hard on GTM now.
