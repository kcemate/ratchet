# Ratchet — Competitive Positioning

_Updated 2026-03-14 after Anthropic's Claude Code Security launch._

---

## The Threat

Anthropic launched Claude Code Security — AI-powered security scanning with suggested patches. Enterprise/Team tier, free for open-source. Found 500 real vulnerabilities in production code. Multi-stage verification. Security dashboard.

This directly overlaps with our "free scan finds security issues" pitch.

**We cannot lead with security. Anthropic wins that fight.**

---

## Where We're Actually Different

| | Claude Code Security | Ratchet |
|---|---|---|
| **What it does** | Scans for security vulnerabilities, suggests patches for human review | Autonomous improvement loop — finds issues, fixes them, tests, commits |
| **Scope** | Security only | Everything: types, error handling, tests, performance, readability, security |
| **Human in loop** | Required. Analyst reviews every finding. | Optional. The Pawl (test suite) is the reviewer. |
| **Output** | Dashboard of findings + suggested patches | Committed code. A PR with tested improvements. |
| **Customer** | Enterprise security teams | Vibe coders, solo devs, small teams |
| **Distribution** | Sales-led, enterprise/team tier | PLG, `npx ratchet` |
| **Price** | Enterprise pricing (Claude Team/Enterprise) | $20/month |

**The core difference: they scan and recommend. We scan, fix, test, and commit.**

Their output is a report that needs a human. Our output is a PR that's already green.

---

## Positioning Shift

### Before (wrong):
"Ratchet scans your code and finds security issues."
→ Directly competing with Anthropic. We lose.

### After (right):
"Ratchet makes your AI-generated code production-ready."
→ Broader scope. Different customer. Different outcome.

---

## What Ratchet Improves (New Messaging)

Security is ONE category. Not the headline.

1. **Code quality** — replace `any` types, add proper TypeScript, clean up dead code
2. **Error handling** — add try/catch, proper error messages, graceful failures
3. **Testing** — write tests where none exist (harden mode)
4. **Input validation** — sanitize user input, prevent injection
5. **Performance** — remove N+1 queries, lazy load, reduce bundle size
6. **Security** — yes, but as one of six categories, not the lead
7. **Readability** — consistent naming, extract functions, add comments where logic is complex

---

## Updated Pitches

### For vibe coders:
**Before:** "Your app has 6 security issues."
**After:** "Your app has 14 things that would break in production. Ratchet fixed 12 of them."

### For the landing page:
**Before:** "You built it with AI. Now make it real."
**After:** Same. This still works. It's about production-readiness, not security.

### For the Ratchet Report:
**Before:** Led with security findings.
**After:** Lead with a "Production Readiness Score" — e.g., "Your app scores 34/100. After Ratchet: 78/100."

Categories in the report:
- 🔒 Security: 2 issues found, 2 fixed
- 🧪 Testing: 0 tests → 8 tests added
- ⚠️ Error Handling: 5 issues found, 4 fixed
- 📝 Types: 12 `any` types replaced
- ⚡ Performance: 1 N+1 query fixed
- 📖 Readability: 3 functions extracted

This is way more compelling than a security-only report anyway. Vibe coders don't think in terms of "security vulnerabilities." They think "will this break?"

---

## The Production Readiness Score

This could be our thing. Not a security score (Anthropic owns that). A **production readiness score.**

`npx ratchet scan` → outputs:

```
🔧 Ratchet Scan — Production Readiness

  Your app: my-nextjs-app
  Score: 34/100

  🧪 Testing        0/20   No tests found
  ⚠️  Error Handling  8/20   5 unhandled exceptions
  📝 Types          12/20   12 'any' types, 3 missing return types
  🔒 Security       6/20    2 hardcoded secrets, 1 SQL injection risk
  ⚡ Performance     8/20    1 N+1 query, no lazy loading

  Run 'npx ratchet fix' to improve your score.
  3 free fixes included. No credit card needed.
```

**This is our moat.** Anthropic tells you about security. We tell you if your app is ready for users. Bigger scope, friendlier framing, same audience.

---

## Competitive Landscape (Updated)

| Competitor | What They Do | Why We're Different |
|---|---|---|
| Claude Code Security | Security scanning + patches | We do ALL code quality, not just security. Autonomous, not review-based. |
| GitHub Copilot | Autocomplete, inline suggestions | One-shot suggestions. We do sustained iterative improvement. |
| Cursor | AI code editor | Human-driven. You're still in the loop every change. |
| Devin / Codex | Task-based AI agents | Single tasks. We do iterative passes with rollback safety. |
| SonarQube / ESLint | Static analysis | Rule-based pattern matching. We reason about code contextually. |
| CodeClimate | Code quality metrics | Measures quality. Doesn't fix it. |

**Our unique position: the only tool that autonomously improves overall production readiness with a test-verified safety net.**

---

## Action Items

1. Update landing page — lead with "Production Readiness Score" not security
2. Ratchet Report redesign — score-based, multi-category
3. `npx ratchet scan` command — free, generates score, drives conversion
4. Remove any security-first messaging from docs and marketing
5. Position security as one of six improvement categories
