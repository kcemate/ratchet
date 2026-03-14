# Ratchet — Build Plan

_What needs to be built, in what order, with dependencies._

---

## What Exists (Done)

- ✅ CLI framework (commander, 5 commands: init, torque, status, log, tighten)
- ✅ Click loop engine (analyze → propose → build → test → commit)
- ✅ The Pawl (auto-rollback on test failure)
- ✅ Shell agent (calls AI coding tools)
- ✅ Git integration (branch, commit, stash, rollback, detached HEAD detection)
- ✅ `.ratchet.yml` config loader (targets, boundaries, defaults)
- ✅ Run state persistence (`.ratchet-state.json`)
- ✅ Lock file (prevents concurrent runs)
- ✅ Logger (writes run logs to `docs/`)
- ✅ 82 passing tests
- ✅ Landing page v1
- ✅ Architecture docs (24 clicks of refinement)
- ✅ Pricing model locked ($20/month, one tier)
- ✅ Competitive positioning (Production Readiness Score)

---

## What Needs to Be Built

### Week 1: Make `npx ratchet` Just Work

**1. Zero-config auto-detection**
- Detect project type from `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`
- Detect test command (or detect absence → flag for harden mode)
- Detect source paths from project structure
- No `.ratchet.yml` required for first run
- Dependency: none. Pure CLI work.

**2. Multi-provider AI support**
- Support `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- Auto-detect which key is set
- Provider-specific API clients (OpenRouter, Anthropic direct, OpenAI direct)
- Model selection per provider (recommend Sonnet via OpenRouter)
- First-run interactive prompt if no key found
- Store key in `~/.ratchet/config`
- Dependency: none. Parallel with #1.

**3. Harden mode**
- `ratchet torque --mode harden` or auto-enabled when no tests detected
- First 2-3 clicks write test coverage for target area
- Remaining clicks improve code against those tests
- Need to modify click.ts to support two-phase loops
- Dependency: #1 (needs test detection)

---

### Week 2: Make It a Business

**4. `npx ratchet scan` — Production Readiness Score**
- New command: scans project, scores 0-100 across 6 categories
- Categories: Testing, Error Handling, Types, Security, Performance, Readability
- AI-powered analysis (one call, ~$0.15 per scan)
- Outputs score + category breakdown to terminal
- Free. No license key needed. This is the acquisition funnel.
- Dependency: #2 (needs AI provider support)

**5. License server**
- Express app on Railway
- Endpoints: validate key, check click balance, record click, record scan
- LemonSqueezy webhook for purchase events
- Signed JWT tokens (CLI gets token at run start, valid for N clicks)
- Cached validation (works if server is briefly down)
- Dependency: Kyle sets up LemonSqueezy account

**6. CLI metering integration**
- CLI calls license server at run start
- Validates key, gets signed token with click balance
- Deducts per landed click (not rolled-back)
- Free scan: no key needed
- 3-click trial: one-time per GitHub account (OAuth or email)
- Pro: validates subscription status
- Overage: $1.25/click charged via LemonSqueezy
- Dependency: #5

**7. Ratchet Credits (bundled AI)**
- For Pro subscribers: AI calls route through our proxy key
- Separate Anthropic API key for Credits customers
- CLI detects Credits mode vs BYOK based on license type
- Dependency: #5, #6, Kyle approves Anthropic spend

---

### Week 3: Make It Look Real

**8. Ratchet Report**
- Generated after every `torque` run
- Human-readable markdown: what improved, what rolled back, before/after metrics
- Production Readiness Score before and after
- Shareable card image (PNG) for social media
- Included in PR body when used with GitHub Action
- Dependency: #4 (needs scoring system)

**9. GitHub Action**
- `giovanni-labs/ratchet-action@v1`
- Thin wrapper: installs CLI, runs `ratchet torque`, opens PR with results
- Inputs: target, clicks, mode, API key (secret), license key (secret)
- Outputs: PR URL, Ratchet Report, score
- Publish to GitHub Marketplace
- Dependency: #6 (needs metering), #8 (needs report)

**10. Landing page rewrite**
- Rewrite for vibe coders, not engineers
- Lead with Production Readiness Score
- "You built it with AI. Now make it real."
- Show the scan output, the before/after score
- Pricing section: Free (scan + BYOK) / Pro $20/month
- Demo video embed (placeholder until week 4)
- Dependency: #4 (needs scan concept finalized)

**11. Publish to npm**
- `npm publish` as `ratchet` (check name availability) or `@ratchet-run/cli`
- Verify `npx ratchet` works clean
- Dependency: #1, #2, #3, #6 all working

---

### Week 4: Ship It

**12. Dogfood on Deuce Diary**
- Run `npx ratchet scan` on Deuce Diary backend
- Run `ratchet torque` with 7 clicks
- Verify report quality, score accuracy, commit quality
- Fix any issues found
- Dependency: everything above

**13. Demo video**
- Screen recording: Bolt-generated app → `npx ratchet scan` → score 34/100 → `npx ratchet fix` → score 78/100
- 60 seconds. No voiceover needed (captions + terminal output).
- Dependency: #12 (need real results to record)

**14. Community launch**
- Post demo video to Twitter/X, Reddit (r/webdev, r/nextjs, r/ChatGPTCoding)
- Post in Cursor, Bolt, v0 Discord communities
- Submit to Hacker News (Show HN)
- Dependency: #13

---

## Dependencies on Kyle (3 items)

| Item | When Needed | Time Required |
|------|-------------|---------------|
| LemonSqueezy account + API key | Start of week 2 | ~15 min |
| Register ratchetcli.com | Start of week 3 | ~10 min |
| Approve Anthropic key for Credits | Start of week 2 | ~5 min |

---

## Risk Items

| Risk | Impact | Mitigation |
|------|--------|------------|
| npm name `ratchet` taken | Can't `npx ratchet` | Use `@ratchet-run/cli` or `ratchet-dev` |
| Production Readiness Score is unreliable | Bad first impression | Extensive testing on 10+ real projects before launch |
| Harden mode writes bad tests | Defeats the purpose | Quality gate: only commit tests that actually test behavior |
| LemonSqueezy webhook issues | Can't collect money | Build manual key generation fallback |
| Vibe coders don't know what npm is | Can't install | Add web-based scan option later (v2) |

---

## Out of Scope (Not Now)

- ❌ Web dashboard
- ❌ Team/enterprise tier
- ❌ Annual pricing
- ❌ GitLab/Bitbucket CI templates
- ❌ VS Code extension
- ❌ Slack/Discord notifications
- ❌ Custom model fine-tuning

These all come after we validate that people will pay $20/month.
