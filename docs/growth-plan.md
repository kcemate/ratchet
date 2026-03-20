# Ratchet Growth Plan — Double Users Weekly

_Created: 2026-03-20_

## Current State
- ratchetcli.com live, Stripe live, API live, GitHub private
- Users: 0 (pre-launch)
- NPM package: @ratchet-run/cli (not yet published)
- GitHub Action: built but not published

## Strategy: Product-Led Growth + Community Seeding

### Week 0 (NOW — Launch Sprint)

**Distribution (do today):**
1. [x] Make GitHub repo PUBLIC → free scan/vision drives awareness
2. [ ] Publish to NPM → `npm install -g @ratchet-run/cli`
3. [ ] Publish GitHub Action to Marketplace
4. [ ] Show HN post (draft ready at docs/show-hn-draft.md)
5. [ ] Post to r/programming, r/typescript, r/node, r/devtools
6. [ ] Tweet thread from giovanni-labs account
7. [ ] Dev.to / Hashnode launch article

**Viral Mechanics (build this week):**
- `ratchet scan` outputs a shareable score badge URL → people put in READMEs → free impressions
- Badge links back to ratchetcli.com
- Scan is FREE, unlimited → zero friction top of funnel
- Vision graph is FREE 1/week → shareable screenshots

**SEO/Content:**
- README is already strong
- Add OG meta tags to landing page
- Add "Scored by Ratchet" badge to DeuceDiary README as proof

### Week 1 — Community & Content
- Respond to every HN/Reddit comment within 1 hour
- Run ratchet on popular open-source repos, share before/after scores
- Cold DM 20 dev influencers on X/Twitter with personalized scan results of THEIR repos
- Write "I scored the top 10 npm packages" blog post

### Week 2 — Partnerships & Automation
- GitHub Action in CI = recurring usage → conversion
- Partner with 2-3 dev newsletters (TLDR, Bytes, Console.dev)
- Set up referral program (give a month, get a month)

### Ongoing Flywheel
Scan (free) → Badge in README → Impressions → More scans → Some convert to Pro

## Success Metrics
- Week 0: 50 scans, 10 GitHub stars
- Week 1: 200 scans, 50 stars, 5 paid
- Week 2: 500 scans, 150 stars, 15 paid
- Doubling: stars and scans as proxy for users

## Blockers to Resolve NOW
1. Repo is PRIVATE — must go public for any of this to work
2. NPM not published — `npm publish --access public`
3. No analytics — add simple scan counter to Worker API
4. No OG tags on landing page
