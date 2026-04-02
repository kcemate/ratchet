# Ratchet

[![npm version](https://img.shields.io/npm/v/ratchet-run)](https://npmjs.com/package/ratchet-run) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/node/v/ratchet-run)](https://nodejs.org) [![tests](https://img.shields.io/badge/tests-3%2C277%20passing-brightgreen)](https://github.com/kcemate/ratchet)

> **Security scanner for AI-generated code.** AI coding tools ship fast but introduce security gaps, empty catches, unvalidated inputs, and missing error handling. Ratchet scans, scores, and auto-fixes what AI gets wrong — only changes that pass tests get committed.

```
$ ratchet scan

  🔒 Security Score: 42/100

  Security         ██████████             10/15   ← 12 critical issues
  Testing          ████████████████████   0/25    ← zero test files
  Error Handling   ████████████████       15/20
  Type Safety      ████████████████████   9/15
  Performance      ██████                 3/10    ← 106 console.logs
  Code Quality     ████████               5/15    ← 11K duplicated lines
```

We ran this on [Claude Code's source](https://ratchetcli.com/audit/claude-code/) — Anthropic's own AI coding tool scored 42/100. If the team building AI coding assistants ships 20,483 issues, your codebase probably has some too.

---

## Why Ratchet?

AI coding tools (Cursor, Copilot, Claude Code) generate code 10x faster — but they also generate:

- **Empty catch blocks** that silently swallow errors
- **Hardcoded secrets** in config files
- **Missing input validation** on API endpoints
- **No auth middleware** on sensitive routes
- **Console.log calls** left in production code

Ratchet catches all of this automatically, scores it objectively, and fixes what it can — without breaking your build.

---

## Install

```bash
npm install -g ratchet-run
```

Requires Node.js >= 18 and git.

---

## Quick Start

```bash
# Scan your codebase for security issues
ratchet scan

# See exactly which files and lines cost you points
ratchet scan --explain-deductions

# Auto-fix the highest-impact issues (Pro)
ratchet improve --clicks 7

# Generate an interactive dependency map
ratchet map
```

---

## What It Scans

Ratchet scores your codebase 0-100 across six categories, with security front and center:

| Category | What It Catches |
|----------|----------------|
| 🔒 **Security** | Hardcoded secrets, missing auth, unvalidated inputs, rate limiting gaps |
| 🧪 **Testing** | Coverage gaps, missing edge case tests, weak assertions |
| 📝 **Type Safety** | `any` types, missing strict config, type escape hatches |
| ⚠️ **Error Handling** | Empty catches, missing try/catch, no structured logging |
| ⚡ **Performance** | await-in-loop, console.log in production, import bloat |
| 📖 **Code Quality** | Duplicated code, long functions, dead code, TODOs |

### Deep Scan (Pro)

Add `--deep` to enable LLM-powered semantic analysis that finds issues regex can't:

- SQL injection through multi-hop data flow
- Auth bypass paths
- N+1 query patterns hidden in ORM abstractions
- Dead code that appears reachable to static analysis

---

## How It Works

A ratchet wrench only turns one way. So does Ratchet:

1. **Scan** — Score your codebase across all 6 categories
2. **Fix** — AI identifies the highest-impact issue and writes a fix
3. **Test** — Runs your full test suite before committing
4. **Commit** — Only improvements that pass tests get kept
5. **Repeat** — Each "click" moves the score up. Failed fixes are silently reverted.

```
$ ratchet improve --clicks 7

  ✓ Click 1 — removed hardcoded API key     [a3f9b21] — Score: 68 → 72 (+4)
  ✗ Click 2 — tests failed · rolled back
  ✓ Click 3 — added input validation        [7bc1d44] — Score: 72 → 76 (+4)
  ✓ Click 4 — replaced empty catch          [2e8f053] — Score: 76 → 79 (+3)
  ✗ Click 5 — tests failed · rolled back
  ✓ Click 6 — structured error logging      [9da3c17] — Score: 79 → 81 (+2)
  ✓ Click 7 — added rate limiting           [f81b44a] — Score: 81 → 82 (+1)

  Done. 5 landed · 2 rolled back · Score: 68 → 82/100 (+14)
```

---

## Commands

| Command | Description |
|---------|-------------|
| `ratchet scan` | Score your codebase (free) |
| `ratchet scan --deep` | LLM-powered deep security analysis (Pro) |
| `ratchet scan --explain-deductions` | See exact files/lines costing points |
| `ratchet improve --clicks N` | Auto-fix N issues (Pro) |
| `ratchet map` | Interactive dependency graph |
| `ratchet report` | Generate PDF/HTML report |
| `ratchet init` | Initialize config |

---

## Privacy & Security

- **Local-first**: All scanning runs on your machine. Your code never leaves your filesystem.
- **BYOK**: Bring your own API key for AI features. Ratchet never sees or stores your credentials.
- **Open source core**: MIT licensed. Audit the source at [github.com/kcemate/ratchet](https://github.com/kcemate/ratchet).
- **3,277 tests**: We run Ratchet on Ratchet. We eat our own dogfood.

---

## Pricing

| | Free | Pro ($19/mo) |
|---|---|---|
| `ratchet scan` | ✅ | ✅ |
| AST autofix | ✅ (deterministic) | ✅ |
| AI-powered fixes | — | ✅ |
| Deep scan | — | ✅ |
| `ratchet improve` | — | ✅ |
| GitHub Action | ✅ (scan only) | ✅ (scan + fix) |

[Get started →](https://ratchetcli.com)

---

## Links

- **Website**: [ratchetcli.com](https://ratchetcli.com)
- **Claude Code Audit**: [ratchetcli.com/audit/claude-code](https://ratchetcli.com/audit/claude-code/)
- **npm**: [ratchet-run](https://www.npmjs.com/package/ratchet-run)
- **GitHub**: [kcemate/ratchet](https://github.com/kcemate/ratchet)
- **License**: MIT
