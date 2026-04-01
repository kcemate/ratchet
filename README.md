# Ratchet

[![npm version](https://img.shields.io/npm/v/ratchet-run)](https://npmjs.com/package/ratchet-run) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/node/v/ratchet-run)](https://nodejs.org)

> AI-powered CLI that scores your codebase and autonomously improves it. Each "click" is one full cycle: analyze → propose → build → test → commit. Only improvements that pass tests are kept. The score can only go up.

```
$ ratchet scan

  Production Readiness Score: 72/100

  Testing          ████████████████████   18/25
  Security         ██████████████         10/15
  Type Safety      ████████████████████   15/15
  Error Handling   ████████████████       12/20
  Performance      ████████████           7/10
  Code Quality     ██████████████         10/15
```

A ratchet wrench only turns one way. So does Ratchet — every change it makes is tested and committed. No rollback risk. No breaking builds. Just steady, one-direction improvement.

---

## Install

```bash
npm install -g ratchet-run
```

Requires Node.js >= 18 and git.

---

## Quick Start

```bash
# Initialize in your project
ratchet init

# Score your codebase
ratchet scan

# Let AI autonomously improve it
ratchet improve --target error-handling --clicks 7

# Check progress
ratchet report --status
```

---

## How It Works

Every click runs one full cycle:

1. **Analyze** — Read your code, identify the highest-impact issue
2. **Propose** — Plan a focused, single-concern fix
3. **Build** — Write the code change
4. **Test** — Run your test suite
5. **Commit** — Only committed if all tests pass. Otherwise, rolled back.

The Pawl is the anti-rollback mechanism: if tests fail, the change is reverted automatically. Your score can never go down.

---

## Scoring System

Ratchet scores your codebase 0–100 across six categories:

| Category | Max | What it measures |
|---|---|---|
| **Testing** | 25 | Coverage ratio, edge case depth, test quality |
| **Security** | 15 | Secrets & env vars, input validation, auth & rate limiting |
| **Type Safety** | 15 | Strict config, any type count, coverage |
| **Error Handling** | 20 | Empty catches, structured logging, async patterns |
| **Performance** | 10 | Console cleanup, import hygiene |
| **Code Quality** | 15 | Function length, line length, dead code, duplication |

Use `ratchet scan --explain` to see why each subcategory scored the way it did and how to fix it.

---

## Features

### Guard Profiles

Control how aggressive Ratchet is with `--guards`:

| Profile | Files | Lines | Use case |
|---|---|---|---|
| `tight` | 3 | 40 | Conservative, low-risk fixes |
| `refactor` | 5 | 80 | Rename, extract, restructure |
| `broad` | 10 | 120 | Cross-file improvements |
| `atomic` | 1 | 20 | One concept per commit |

Smart guard escalation: if Ratchet gets stuck (2+ consecutive rollbacks), it auto-escalates from tight → refactor → broad.

### Scope Locking

Lock Ratchet to specific files with `--scope`:

```bash
ratchet improve --scope diff           # Only uncommitted changes
ratchet improve --scope branch         # Only files changed vs main
ratchet improve --scope staged         # Only staged files
ratchet improve --scope "src/**/*.ts"  # Glob pattern
ratchet improve --scope file:src/api/routes.ts,src/api/auth.ts
```

### Planning Mode

```bash
ratchet improve --plan-first
```

Read-only click 0 generates a structured plan before making changes.

### Interactive Dependency Graph

```bash
ratchet map
```

Generates a self-contained HTML with a Cytoscape.js graph. Nodes colored by score, sized by blast radius. Filterable, searchable, dark cyberpunk theme.

---

## Commands

| Command | Description | Tier |
|---|---|---|
| `scan [dir]` | Score the codebase (0-100) | Free |
| `init [dir]` | Initialize .ratchet.yml | Free |
| `report` | Status, logs, badges, and reports | Free |
| `map` | Interactive dependency graph | Free |
| `auth` | Login / logout license key | Free |
| `improve` | Autonomous click loop (scan → fix → commit) | Builder+ |
| `ship` | Finalize run, create PR | Free |

---

## CI/CD Integration

```yaml
# .github/workflows/ratchet.yml
name: Ratchet Quality Gate

on:
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g ratchet-run
      - run: ratchet scan --fail-on 80
      - run: ratchet scan --fail-on-category Security=12 --fail-on-category Testing=20
      - run: ratchet scan --output-json > ratchet-scan.json
      - uses: actions/upload-artifact@v4
        with:
          name: ratchet-scan
          path: ratchet-scan.json
```

`--fail-on <score>` exits with code 1 if the total score is below the threshold. `--fail-on-category` does the same per category.

---

## Configuration

```yaml
# .ratchet.yml
agent: claude-code
model: claude-sonnet-4-6

defaults:
  clicks: 7
  test_command: npm test
  auto_commit: true

targets:
  - name: error-handling
    path: src/api/
    description: "Fix error handling in the API layer"

boundaries:
  - path: src/auth/
    rule: no-modify
    reason: "Auth logic is security-sensitive"
  - path: "**/*.test.ts"
    rule: preserve-pattern
    reason: "Test structure follows team convention"
  - path: migrations/
    rule: no-delete
    reason: "Migration files are append-only"
```

---

## .ratchetignore

Create a `.ratchetignore` file in your project root to exclude paths from `ratchet scan` and `ratchet improve`.

**Format:** one path per line; `#` starts a comment; trailing `/` on directories is optional.

```
# Ignore generated and vendor code
generated/
vendor/

# Ignore a specific file
src/legacy/old-api.ts

# Ignore a subdirectory
packages/internal-tools/
```

**Default exclusions** (always ignored, no `.ratchetignore` needed):
- `node_modules/`
- `dist/`
- `.git/`

---

## Pricing

| Plan | Price | Cycles | Includes |
|---|---|---|---|
| **Free** | $0 | — | scan, report, map, auth |
| **Builder** | $9/mo or $86/yr | 30 | + improve |
| **Pro** | $19/mo or $182/yr | 150 | + improve (unlimited) |
| **Team** | $49/mo or $470/yr | 500 | Priority support |
| **Enterprise** | Custom | Unlimited | SSO, SLA, custom profiles |

---

## Links

- **Website:** [ratchetcli.com](https://ratchetcli.com)
- **NPM:** [npmjs.com/package/ratchet-run](https://npmjs.com/package/ratchet-run)

---

## License

MIT
