# Reddit Launch Posts

## r/programming

**Title:** I built a CLI that scores your codebase 0-100, then autonomously fixes the issues it finds

I got tired of linters that just complain. So I built Ratchet — it scans your code across 8 quality dimensions (security, testing, duplication, complexity, etc.), gives you a concrete score, then automatically fixes issues one commit at a time.

Each "click" is a full cycle: analyze → propose → implement → run tests → commit if green, revert if red. The ratchet only turns one way.

We dogfooded it on a 15K-line TypeScript app and went from 76 to 86/100. Every commit passed the full test suite.

Free scan, BYOK for improvements. 852 tests. Works with any stack that has a test command.

https://ratchetcli.com

---

## r/typescript

**Title:** Ratchet: CLI that auto-improves your TypeScript codebase — scored us from 76 to 86/100

Built this to scratch my own itch. Ratchet scans your codebase for real issues (type safety gaps, duplication, complexity, missing tests, security), scores it 0-100, then runs AI-powered fix cycles that each commit independently.

Each "click" runs your tests. Green → commit. Red → revert. No half-baked changes ever land.

Real results on our Express + React + Postgres app:
- Migrated 14 files from console.log to Pino
- Split 2000-line routes.ts into 13 domain modules
- Fixed overly-broad rate limiters
- 891 tests passing the whole time

`npm install -g @ratchet-run/cli && ratchet scan` — free, no API key needed for scan.

https://ratchetcli.com | GitHub: giovanni-labs/ratchet

---

## r/devtools

**Title:** Ratchet: like a ratchet wrench for your codebase — it only turns one way

Point it at your codebase → get a score out of 100 → let it fix things autonomously. Each improvement is tested and committed. If tests fail, the change is reverted. Your code can only get better.

Features I'm most proud of:
- Guard profiles (tight/refactor/broad) control how much the AI changes per cycle
- Smart escalation — auto-broadens scope when hitting limits
- Vision — interactive dependency graph colored by quality score
- Per-click cost tracking — know exactly what each improvement cost you

Free scans, BYOK model for improvements. 852 tests. TypeScript CLI.

https://ratchetcli.com
