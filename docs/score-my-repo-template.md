# Score My Repo — Twitter Campaign Template

**Campaign concept:** Offer to publicly scan GitHub repos live on Twitter using Ratchet. Show the score, top issues, and one actionable fix. Drive awareness + credibility through live demonstrations.

---

## Core Offer Tweet

> 🏎️ Reply with your GitHub repo URL and I'll scan it live with Ratchet right here.
> 
> I'll post the full score breakdown, top issues, and the one-line fix that would move the needle most.
> 
> Rules: public repos only, must have a package.json + test command.
> 
> Let's see what your code is made of.

---

## Scan Results Template

Copy-paste this structure when posting results. Replace the bracketed parts with actual data.

---

**📊 SCAN: [owner/repo]**
Scanned with [ratchetcli.com](https://ratchetcli.com) — BYOK, your code never leaves your machine.

**Score: [X]/100**
↑ [Δ] from baseline (no test suite = starts at 50)

**Test suite:** [N] tests in [M] files
**Coverage:** [if available]

**🔴 Top issues:**
1. [Issue — e.g., "Missing error handling in auth middleware"]
2. [Issue — e.g., "Unmocked time dependencies in 12 tests"]
3. [Issue — e.g., "Sync fs call in async handler"]

**✅ One-line fix:**
[Specific, actionable command or change that would have the biggest impact]

**📁 Guard profile used:** [default / custom]

**→ [ratchetcli.com](https://ratchetcli.com) | `npx ratchet-run`**

---

## Example Results Post

> **📊 SCAN: acme/webapp**
> Scanned with [ratchetcli.com](https://ratchetcli.com) — BYOK, your code never leaves your machine.
> 
> **Score: 71/100**
> Test suite: 234 tests in 18 files
> 
> **🔴 Top issues:**
> 1. No error boundaries around async route handlers
> 2. 8 tests using `setTimeout` for timing instead of fake timers
> 3. Auth middleware not checking token expiry
> 
> **✅ One-line fix:** Wrap your route handlers in a try/catch and return a 500 — this alone fixes the silent failures.
> 
> **→ [ratchetcli.com](https://ratchetcli.com) | `npx ratchet-run`**

---

## 5 Offer Tweet Variations

Use these on different days/campaigns. Vary the hook while keeping the core offer.

---

**Variation 1 — The challenge:**
> Your repo has a score. It might be 62. It might be 78. Let's find out.
> 
> Reply with your GitHub URL. I'll scan it live with Ratchet and post the full breakdown — score, top issues, highest-leverage fix.
> 
> Public repos only. Needs a package.json and test command.
> 
> What's your number?

---

**Variation 2 — The specificity:**
> 1,280 tests. 65 files. Score went from 76 → 86 on DeuceDiary.
> 
> What would your score be? Reply with your repo and I'll scan it live.
> 
> Public repos with package.json + test command. I'll post results publicly.

---

**Variation 3 — The contrarian:**
> Hot take: most AI refactor tools are dangerous on real codebases.
> 
> Ratchet is different. It only keeps changes that pass your test suite. Everything else gets reverted.
> 
> Want to see it work on your repo? Reply with your GitHub URL.
> 
> Public repos with test commands only.

---

**Variation 4 — The data angle:**
> We scan a repo, it shows us what's actually breaking your test suite. Usually it's the same 3 patterns repeated across files.
> 
> Reply with your repo URL. I'll run a live scan and post the breakdown — what's failing, why, and the one change that fixes the most at once.
> 
> BYOK. Your code never leaves your machine.
> 
> `npx ratchet-run`

---

**Variation 5 — The week-end push:**
> Friday afternoon repo audit time.
> 
> Drop your GitHub URL. I'll scan it with Ratchet and post the score live. Top issues, one-line fix, full transparency.
> 
> Public repos only. Needs package.json + test command.
> 
> Let's see what you shipped this week.

---

## Campaign Rules

- **Scope:** Public GitHub repos only
- **Requirements:** Must have `package.json` AND a test command (`npm test`, `jest`, `vitest`, etc.)
- **Output:** All scan results posted publicly (quote tweet the reply or post a thread)
- **No scanning:** Private repos, repos without test commands, or repos with active rate limiting
- **Disclaimer:** Scans are read-only. Ratchet doesn't write unless you run a full guard session.
- **Frequency:** Max 3 repos per day to avoid spam detection

---

## Distribution Channels

- **Primary:** Twitter/X reply threads
- **Cross-post:** Share results in relevant communities (Node/DevOps/Test engineering timelines)
- **Backup:** If a repo is too large/complex for live tweet, offer to DM the full PDF report instead

---

## Tips for Good Scans

1. Pick repos with interesting problems (not just "needs imports sorted")
2. Highlight non-obvious issues — those generate the most engagement
3. Keep the "one-line fix" genuinely one line
4. Acknowledge when a repo is already in good shape — credibility > always finding problems
5. Tag the repo owner if they have a known Twitter handle
