# Weekly Ratchet Report — Template

A weekly update format for the "What Ratchet Shipped This Week" series. Used to keep the community informed, demonstrate real progress, and build credibility through data.

---

## Format

```markdown
# What Ratchet Shipped This Week
**Week of [DATE]**

---

## 📊 The Numbers

| Metric | This Week | Total |
|--------|-----------|-------|
| Repos scanned | [N] | [N] |
| Changes applied | [N] | [N] |
| Tests added | [N] | [N] |
| Score delta (avg) | [+/-N] | — |
| Reverts (failed tests) | [N] | [N] |

---

## 🏆 Highlights

### [Project / Repo Name]
**Score: [X] → [Y]** ([+/-N] pts)
- [Specific thing Ratchet improved]
- [Another improvement]
- Test suite: [N] tests across [M] files

### [Another Project]
...

---

## 🔄 What Got Reverted

Sometimes Ratchet makes a call that doesn't pass the test suite. We log it and move on.

- **[Change type]:** [What it tried to do] → reverted (reason: [missing mock / edge case / etc.])

---

## 📐 Guard Profile Updates

- [Any new guard profile templates added]
- [Any profile changes based on real-world usage]

---

## 🐛 Fixes Shipped

- [Bug fix 1]
- [Bug fix 2]

---

## 📖 What We Learned

[One thing the team learned from this week's scans — a pattern spotted, a surprising result, a limit discovered.]

---

## ➡️ Next Week

- [Planned work item 1]
- [Planned work item 2]
- [Feature or integration on the roadmap]

---

*Run it yourself: `npx ratchet-run` → [ratchetcli.com](https://ratchetcli.com)*
```

---

## Example First Issue — Real Data

```markdown
# What Ratchet Shipped This Week
**Week of March 14, 2026**

---

## 📊 The Numbers

| Metric | This Week | Total |
|--------|-----------|-------|
| Repos scanned | 1 | 1 |
| Changes applied | 12 | 12 |
| Tests added | 47 | 47 |
| Score delta | +10 | — |
| Reverts (failed tests) | 0 | 0 |

---

## 🏆 Highlights

### DeuceDiary
**Score: 76 → 86** (+10 pts)

DeuceDiary is a production Node.js app running on Railway with a full test suite. We pointed Ratchet at it and let it iterate.

What it found and fixed:
- Missing error handling in async route handlers (12 files)
- Unmocked `Date.now()` calls causing time-dependent test flakiness
- Unhandled promise rejections in the auth middleware
- Missing `await` on async database calls in 3 service files
- Inconsistent error response format across controllers

Test suite: **1,280 tests across 65 files.** Every change Ratchet made passed the full suite. Zero reverts.

---

## 🔄 What Got Reverted

Nothing this week. The guard profile was well-tuned and the test suite caught any bad calls before they landed.

---

## 📐 Guard Profile Updates

- Added a "production-node" guard profile template based on the DeuceDiary session — caps changes at 3 files per iteration, requires all tests to pass, blocks CI/CD and config directories.

---

## 🐛 Fixes Shipped

- Fixed: Ratchet was not detecting `Date.now()` as a time dependency when called inside nested functions
- Fixed: PDF report was truncating file paths longer than 80 characters

---

## 📖 What We Learned

DeuceDiary plateau'd at 86. We could have pushed higher — there are still some structural issues Ratchet flagged but didn't touch because the risk/reward didn't justify the change size. **Diminishing returns are real.** Past 86 on this codebase, you're making surgical changes that touch business logic directly. That's a human's job.

The 86 is a good score.

---

## ➡️ Next Week

- Ship guard profile templates for Express and Fastify apps
- Test Ratchet on a TypeScript monorepo
- Write the DeuceDiary case study (full before/after breakdown)

---

*Run it yourself: `npx ratchet-run` → [ratchetcli.com](https://ratchetcli.com)*
```

---

## Distribution Checklist

**Every Monday — post the weekly report to:**

- [ ] **Twitter/X** — thread or single post with key metrics + highlight
- [ ] **GitHub Discussions** — if the repo has a Discussions tab, pin it there
- [ ] **ratchetcli.com blog** — as a standalone post (this template is the draft)
- [ ] **LinkedIn** — short-form version with 3 bullet highlights (if persona fits)
- [ ] **Hacker News** — "Show HN" if there's a significant feature or milestone

**If there's a major feature shipped:**

- [ ] **Product Hunt** — submit as a new product/update (Fridays work well)
- [ ] **dev.to** — cross-post the full report as an article

**Internal:**

- [ ] Save to `docs/weekly-reports/YYYY-MM-DD.md`
- [ ] Update `docs/CHANGELOG.md` with the week's changes
- [ ] Add any new guard profiles to `docs/guard-profiles/`

---

## Cadence Notes

- **Post on Mondays** when possible — end-of-week data, fresh start for readers
- **Keep the tone honest.** If something failed, say so. Credibility compounds.
- **Use real numbers.** No rounding up, no "up to X% improvement." Only what actually happened.
- **The DeuceDiary data is real.** 76→86, 1280 tests, 65 files. Use it as the anchor example until you have better data.
