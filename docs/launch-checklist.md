# Ratchet Launch Checklist

## Ready to Go ✅

### Launch Content (all in ~/Projects/ratchet/docs/)
- [x] `show-hn-final.md` — Show HN post, real data, honest about failures
- [x] `reddit-launch-posts.md` — 3 posts: r/programming, r/typescript, r/ExperiencedDevs
- [x] `twitter-launch-thread.md` — 7-tweet thread with hook, results, anti-features, CTA
- [x] `anti-feature-post.md` — "What Ratchet Won't Do" thread + blog (pending MiniMax)
- [x] `score-my-repo-template.md` — Templates for public repo scanning campaign (pending MiniMax)
- [x] `weekly-ratchet-report-template.md` — Weekly update format (pending MiniMax)
- [x] `devto-blog-post.md` — Full Dev.to retrospective (pending MiniMax)
- [x] `oss-scan-results.md` — 20 popular OSS repo scores (pending scan sweep)

### Product
- [x] ratchetcli.com — Landing page live
- [x] ratchetcli.com/sandbox — Interactive demo live
- [x] ratchetcli.com/docs — Documentation site live
- [x] ratchet-run@1.0.8 on NPM
- [x] Stripe payments live (Builder/Pro/Team, monthly/annual)
- [x] License validation working end-to-end
- [x] 1,280 tests passing
- [x] GitHub Action ready (action.yml + action/run.sh)

### Example Repo (staged at /tmp/ratchet-example/)
- [x] Deliberately messy Express API
- [x] .ratchet.yml config
- [x] GitHub Actions workflow
- [x] README with badge + instructions
- [ ] **Needs:** Push to giovanni-labs/ratchet-example (need GitHub API access or Kyle to run: `cd /tmp/ratchet-example && git remote add origin git@github.com:giovanni-labs/ratchet-example.git && git push -u origin main`)

---

## Launch Sequence (Kyle just hits post)

### Day 1 — Launch Day
1. Post Show HN (copy from `show-hn-final.md`)
2. Wait 30 min, post to r/programming (from `reddit-launch-posts.md`)
3. Post Twitter thread (from `twitter-launch-thread.md`)
4. Monitor all 3 for 2 hours — reply to every comment

### Day 2 — Amplify
1. Post to r/typescript
2. Post "Score My Repo" offer on Twitter
3. Start cold DM outreach (10 DMs)

### Day 3-5 — Content
1. Publish Dev.to blog post
2. Post "What Ratchet Won't Do" thread on Twitter
3. Post to r/ExperiencedDevs
4. Continue cold outreach (10 DMs/day)

### Week 2 — Compound
1. Push example repo, submit to GitHub topics
2. Publish OSS score dataset
3. Send 2nd wave of cold outreach
4. First Weekly Ratchet Report

---

## Metrics to Track

| Date | Channel | Visitors | npm installs | Signups | Paying | Notes |
|------|---------|----------|-------------|---------|--------|-------|
| | | | | | | |

Check NPM downloads: `npm info ratchet-run`
Check Stripe: dashboard.stripe.com
Check Cloudflare analytics: ratchetcli.com analytics
