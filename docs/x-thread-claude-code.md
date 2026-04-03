# X/Twitter Thread: Claude Code Audit

---

## Tweet 1 (Hook)
We scanned Claude Code's leaked source with our own tool.

It scored 42/100.

Claude Code — the AI that writes code for a living — would fail our code quality bar.

Here's what we found 🧵

---

## Tweet 2 (The Numbers)
20,483 issues across the codebase.

- 0 test files
- 11,460 repeated lines
- 423 unhandled async operations
- 106 console.log statements left in
- 15 hardcoded secrets

This is production code shipping to millions of developers.

📸 *[Screenshot: Ratchet scan output showing the 42/100 score and issue breakdown]*

---

## Tweet 3 (Zero Tests)
The most shocking finding: **0 test files**.

None. Zero. Zilch.

The tool Anthropic uses to write and review your tests... has no tests itself.

We have 2,900+ tests. Ratchet scores itself 98/100.

---

## Tweet 4 (Repeated Code)
11,460 repeated lines is not copy-paste. That's architecture debt.

At that scale, a bug fix in one place silently misses 3 others.

This is exactly the kind of drift that makes codebases unmaintainable — and exactly what Ratchet flags before it compounds.

---

## Tweet 5 (Hardcoded Secrets)
15 hardcoded secrets in a developer tool used to access your repos and terminals.

Not theoretical. Actual strings that look like tokens, keys, or credentials baked into the source.

📸 *[Screenshot: Ratchet "secrets" finding category with count highlighted]*

---

## Tweet 6 (Unhandled Async)
423 unhandled async operations.

Every one of those is a silent failure waiting to happen. No catch, no fallback, no error surface.

When Claude Code times out or the API hiccups, you often won't know why. Now you do.

---

## Tweet 7 (Credit Where Due)
To be fair — there are genuinely clever patterns in here worth stealing:

1. `yoloClassifier` — fast risk-tiered routing
2. `permissionSync` — declarative permission reconciliation
3. `autoDream` — speculative pre-fetching for LLM context
4. Denial tracking circuit breaker
5. Token budget diminishing returns

---

## Tweet 8 (The Point)
This isn't a dunk on Anthropic.

It's proof that AI-generated and AI-assisted code needs automated quality gates just like human code does.

If the team *building* the AI coding tool skips tests and ships repeated code, your AI-generated PRs will too.

---

## Tweet 9 (Ratchet vs Claude Code)
| | Claude Code | Ratchet |
|---|---|---|
| Score | 42/100 | 98/100 |
| Tests | 0 | 2,900+ |
| Repeated lines | 11,460 | ~40 |
| Unhandled async | 423 | 0 |

We built Ratchet to catch what AI gets wrong.

Turns out it catches what AI *is*.

📸 *[Screenshot: Side-by-side scan results or the comparison table rendered]*

---

## Tweet 10 (CTA)
Curious what your codebase scores?

```
npm i -g ratchet-run && ratchet scan
```

Takes 30 seconds. No account needed.

ratchetcli.com

---

## Tweet 11 (Reply bait / closer)
We'll be publishing the full report with the raw scan output and all 5 patterns broken down.

Follow to catch it.

And if you're an Anthropic engineer — seriously, the `autoDream` pattern is brilliant. Ship the tests.

---

## Notes for posting

- Lead image: terminal screenshot of `ratchet scan` on claude-code repo showing 42/100
- Tweet 3 pairs well with a side-by-side showing Ratchet's test directory vs Claude Code's empty one
- Tweet 9 table may need to be posted as an image (Twitter table rendering is inconsistent)
- Schedule tweets 1-5 to post at 1-min intervals for thread cohesion
- Source repo referenced: github.com/instructkr/claude-code
