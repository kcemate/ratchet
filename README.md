# Ratchet

[![npm version](https://img.shields.io/npm/v/ratchet-run)](https://npmjs.com/package/ratchet-run) [![CI](https://github.com/kcemate/ratchet/actions/workflows/ci.yml/badge.svg)](https://github.com/kcemate/ratchet/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/node/v/ratchet-run)](https://nodejs.org)

> **Security scanner for AI-generated code.** Ratchet scans, scores, and auto-fixes what AI gets wrong — only changes that pass tests get committed.

**Self-audit score: 89/100** (May 2026 — [we run on ourselves](https://github.com/kcemate/ratchet/actions/workflows/ci.yml))

```
$ ratchet scan

  🔒 Security Score: 89/100

  🧪 Testing         ████████████████       23/25
  🔒 Security        ███████████████████    15/15
  📝 Type Safety      ███████████████████    15/15
  ⚠️  Error Handling  ████████████          16/20
  ⚡ Performance      ████████               8/10
  📖 Code Quality     ████████              12/15
```

---

## Quick Start

```bash
npm install -g ratchet-run
ratchet init        # Set up your project
ratchet scan        # Score your codebase
ratchet scan --explain-deductions   # See what cost you points
```

<details>
<summary>More commands</summary>

| Command                             | Description                              |
| ----------------------------------- | ---------------------------------------- |
| `ratchet scan`                      | Score your codebase (free)               |
| `ratchet scan --deep`               | LLM-powered deep security analysis (Pro) |
| `ratchet scan --explain-deductions` | See exact files/lines costing points     |
| `ratchet improve --clicks N`        | Auto-fix N issues (Pro)                  |
| `ratchet map`                       | Interactive dependency graph             |
| `ratchet report`                    | Generate PDF/HTML report                 |
| `ratchet init`                      | Initialize config                        |
| `ratchet status`                    | Check current run status                 |
| `ratchet log`                       | View run logs                            |

</details>

---

## What It Catches

| Category              | Weight | What It Finds                                                           |
| --------------------- | ------ | ----------------------------------------------------------------------- |
| 🔒 **Security**       | 15 pts | Hardcoded secrets, missing auth, unvalidated inputs, rate limiting gaps |
| 🧪 **Testing**        | 25 pts | Coverage gaps, missing edge cases, weak assertions                      |
| 📝 **Type Safety**    | 15 pts | `any` types, missing strict config, type escape hatches                 |
| ⚠️ **Error Handling** | 20 pts | Empty catches, missing try/catch, no structured logging                 |
| ⚡ **Performance**    | 10 pts | await-in-loop, console.log in production, import bloat                  |
| 📖 **Code Quality**   | 15 pts | Duplicated code, long functions, dead code, TODOs                       |

---

## How Auto-Fix Works

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

## Comparison

| Feature                       | Ratchet | Semgrep          | SonarQube | CodeQL     | Biome          |
| ----------------------------- | ------- | ---------------- | --------- | ---------- | -------------- |
| Local-first (no cloud upload) | ✅      | ✅               | ❌        | ❌         | ✅             |
| Auto-fix with test gate       | ✅      | ❌               | ❌        | ❌         | ✅ (lint only) |
| AI-powered semantic analysis  | ✅      | ❌               | ❌        | ❌         | ❌             |
| Zero-config first run         | ✅      | ❌               | ❌        | ❌         | ✅             |
| Open source core              | ✅      | ✅ (OSS edition) | ❌        | ❌         | ✅             |
| Self-audit score (dogfood)    | 89/100  | N/A              | N/A       | N/A        | N/A            |
| Node.js native                | ✅      | ❌ (Python)      | ❌ (Java) | ❌ (OCaml) | ✅             |

---

## Privacy & Security

- **Local-first**: All scanning runs on your machine. Your code never leaves your filesystem.
- **BYOK**: Bring your own API key for AI features. Ratchet never sees or stores your credentials.
- **Open source core**: MIT licensed. Audit the source at [github.com/kcemate/ratchet](https://github.com/kcemate/ratchet).
- **Self-auditing**: We run Ratchet on Ratchet. Current score: 89/100.

---

## Pricing

|                   | Free               | Pro             |
| ----------------- | ------------------ | --------------- |
| `ratchet scan`    | ✅                 | ✅              |
| AST autofix       | ✅ (deterministic) | ✅              |
| AI-powered fixes  | —                  | ✅              |
| Deep scan         | —                  | ✅              |
| `ratchet improve` | —                  | ✅              |
| GitHub Action     | ✅ (scan only)     | ✅ (scan + fix) |

See [ratchetcli.com](https://ratchetcli.com) for Pro pricing.

---

## Development

```bash
git clone https://github.com/kcemate/ratchet.git
cd ratchet
npm ci
npm run build
npm link
npm test
npm run lint
npm run typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branching strategy, commit style, and how to add new scanners.

---

## Links

- **npm**: [ratchet-run](https://www.npmjs.com/package/ratchet-run)
- **GitHub**: [kcemate/ratchet](https://github.com/kcemate/ratchet)
- **License**: MIT
