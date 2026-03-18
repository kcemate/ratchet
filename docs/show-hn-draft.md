# Show HN: Ratchet – CLI that scores your codebase and then fixes it

Hi HN, I built Ratchet because I was tired of linters and static analysis tools that just *report* problems. Ratchet scores your codebase across 8 dimensions (security, testing, duplication, complexity, error handling, type safety, performance, code quality) and then autonomously fixes the issues it finds.

**How it works:**

1. `ratchet scan` — scores your project 0-100 with actionable issue breakdown
2. `ratchet torque` — runs an AI-powered improvement loop: analyze → propose one fix → implement → run tests → commit (or revert). Repeat N times. Only changes that pass your test suite ship.
3. `ratchet badge` — generates a score badge for your README
4. `ratchet vision` — interactive dependency graph color-coded by quality score

The key design decision: **every change must pass your existing tests or it gets reverted.** No YOLO commits. The ratchet only turns one way.

Other commands: `ratchet improve` (scan→fix→rescan→PDF report), `ratchet tighten` (finalize a run into a PR with before/after score card), `ratchet debate` (spawn AI architects to debate a design decision), `ratchet simulate` (AI personas navigate your product and report friction).

Built with TypeScript. Works on any project with a test command (npm, pytest, go test, cargo, make). BYOK — uses your own AI provider API key.

Repo: https://github.com/giovanni-labs/ratchet
Landing page: https://ratchetcli.com

I'd love feedback on the scoring methodology and whether the autonomous fix loop feels trustworthy enough to run on your codebase.
