# Ratchet Repo Split Plan

## Goal
Split the monorepo into two repos:
- **`ratchet`** (PUBLIC) — Free open-source CLI
- **`ratchet-pro`** (PRIVATE) — Paid features, infrastructure, marketing

## Current State
- 473 commits, all in one private repo at `kcemate/ratchet`
- npm package: `ratchet-run` (published to npm)
- All paid/free code mixed together

---

## PUBLIC: `ratchet` (open source)

### Source Code (from src/)
**Commands (FREE):**
- `src/commands/scan.ts`
- `src/commands/badge.ts`
- `src/commands/build.ts`
- `src/commands/graph.ts`
- `src/commands/init.ts`
- `src/commands/log.ts`
- `src/commands/push.ts`
- `src/commands/report.ts`
- `src/commands/status.ts`
- `src/commands/stop.ts`
- `src/commands/vision.ts`
- `src/commands/quick-fix.ts` (free quick fixes)

**Core (ALL except license.ts):**
- `src/core/` — entire directory MINUS `license.ts`, `credentials.ts`, `push-api.ts`, `telemetry.ts`
- The scanner engine, scoring, git integration, agents, providers, transforms — all open

**Lib:**
- `src/lib/` — all files

**Types:**
- `src/types.ts`

**Entry point:**
- `src/index.ts` — modified to remove paid command registrations (torque, improve, login)
  - Add dynamic loader: if `ratchet-pro` is installed, load its commands

**Tests:**
- `src/__tests__/` — all tests for free commands
- `tests/` — all tests for free features

### Config/Meta
- `package.json` — remove scripts referencing paid infra
- `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`
- `action/` — free GitHub Action (scan only)
- `action.yml`
- `.github/` workflows
- `LICENSE` — needs to be created (MIT recommended for max adoption)

### NOT included in public
- NO `stripe-config.json`
- NO `api/` directory
- NO `worker/` directory
- NO `site/` directory
- NO `training-data/` directory
- NO `guerrilla-stockpile/` directory
- NO `launch/` directory
- NO `results/` directory
- NO `scripts/stripe-setup.ts`
- NO `scripts/f1-*` (F1 engine scripts)
- NO `src/core/license.ts`
- NO `src/core/credentials.ts`
- NO `src/core/push-api.ts`
- NO `src/core/telemetry.ts`
- NO `src/commands/torque.ts`
- NO `src/commands/improve.ts`
- NO `src/commands/login.ts`
- NO `src/commands/ship.ts`
- NO `src/commands/strategy.ts`
- NO `src/commands/swarm.ts`
- NO `src/commands/tighten.ts`
- NO `augment_training.py`
- NO `analyze-dup.mjs`

---

## PRIVATE: `ratchet-pro`

### Contains
- `src/commands/torque.ts` (the improve engine)
- `src/commands/improve.ts` (improve alias)
- `src/commands/login.ts` (auth)
- `src/commands/ship.ts` (CI/CD)
- `src/commands/strategy.ts`
- `src/commands/swarm.ts`
- `src/commands/tighten.ts`
- `src/core/license.ts`
- `src/core/credentials.ts`
- `src/core/push-api.ts`
- `src/core/telemetry.ts`
- `stripe-config.json`
- `api/` — Cloudflare Worker (license validation, Stripe webhooks)
- `worker/` — Badge service worker
- `site/` — ratchetcli.com marketing site
- `training-data/` — fine-tuning data
- `guerrilla-stockpile/` — competitive intel
- `launch/` — Product Hunt assets
- `results/` — scan results/case studies
- `scripts/` — paid infra scripts (stripe-setup, f1-worker, etc.)
- `augment_training.py`
- `analyze-dup.mjs`

### Structure
```
ratchet-pro/
├── package.json        # name: "ratchet-pro", peerDependency on ratchet-run
├── src/
│   ├── index.ts        # Plugin entry: exports commands to register
│   ├── commands/       # torque, improve, login, ship, strategy, swarm, tighten
│   └── core/           # license, credentials, push-api, telemetry
├── api/                # Cloudflare Worker
├── worker/             # Badge service
├── site/               # ratchetcli.com
├── training-data/
├── guerrilla-stockpile/
├── launch/
├── results/
├── scripts/
└── stripe-config.json
```

### Plugin Architecture
`ratchet` (public) will have a plugin hook in `index.ts`:
```ts
// Try to load ratchet-pro plugin
try {
  const pro = await import('ratchet-pro');
  if (pro.registerCommands) {
    pro.registerCommands(program);
  }
} catch {
  // ratchet-pro not installed — free tier only
}
```

`ratchet-pro` exports:
```ts
export function registerCommands(program: Command) {
  program.addCommand(torqueCommand());
  program.addCommand(improveCommand());
  // ... etc
}
```

---

## Migration Steps

### Phase 1: Create ratchet-pro repo
1. Create `kcemate/ratchet-pro` (private) on GitHub
2. Copy paid files into ratchet-pro structure
3. Set up package.json with peerDependency on `ratchet-run`
4. Update imports to reference `ratchet-run` for shared types/core
5. Add plugin entry point

### Phase 2: Clean ratchet repo
1. Remove all paid/private files from ratchet repo
2. Add plugin hook to index.ts
3. Add MIT LICENSE
4. Update README for open source
5. Create .gitignore that excludes paid artifacts
6. Update package.json
7. Update .npmignore

### Phase 3: Verify
1. `npm run build` in ratchet — should succeed
2. `npm test` in ratchet — free tests should pass
3. `npm run build` in ratchet-pro — should succeed
4. Install both locally: `npm link ratchet-run && npm link ratchet-pro`
5. `ratchet scan` — works (free)
6. `ratchet improve` — works (paid, loaded via plugin)
7. `ratchet scan` without ratchet-pro installed — works, no paid commands visible

### Phase 4: Make public
1. Verify NO secrets in git history (stripe keys, API keys, etc.)
2. Since history contains paid code, we need a FRESH public repo with clean history
3. Push clean main branch to public `kcemate/ratchet`
4. Keep current repo as `kcemate/ratchet-pro` (rename)

---

## Critical: Git History
The current git history (473 commits) contains ALL code including paid features.
**We CANNOT just make the current repo public.**

Options:
1. **Fresh start (recommended):** New public repo with squashed initial commit. Clean.
2. **BFG filter:** Rewrite history to remove paid files. Risky, may miss things.
3. **git filter-repo:** Same as BFG but more precise. Still risky.

Recommendation: Fresh start. The public repo gets a clean initial commit with just the free code. History lives in ratchet-pro (private).

---

## Dependencies Between Repos

ratchet-pro imports FROM ratchet-run (the npm package):
- `import type { ScanResult } from 'ratchet-run'`
- `import { runScan } from 'ratchet-run'`
- `import { runEngine, runSweepEngine } from 'ratchet-run/core/engine'`
- etc.

This means ratchet-run's package.json needs `exports` configured to expose:
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./core/*": "./dist/core/*.js",
    "./commands/*": "./dist/commands/*.js",
    "./lib/*": "./dist/lib/*.js",
    "./types": "./dist/types.js"
  }
}
```
