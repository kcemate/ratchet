# Ratchet Full Command Suite Run — honojs/hono

**Date:** 2026-04-06 17:16 ET
**Target:** [honojs/hono](https://github.com/honojs/hono) (TypeScript web framework)
**Ratchet version:** 1.2.0
**Result:** All 7 commands executed successfully

## Score: 61/100 (Bronze) — 1,185 issues found

| Category | Score | Notes |
|---|---|---|
| 🧪 Testing | 25/25 | 133 test files, 67% ratio, 2.3 assertions/test |
| 🔒 Security | 8/15 | 1 potential secret, partial validation, partial auth |
| 📝 Type Safety | 3/15 | TS without strict flags, 436 `any` types |
| ⚠️ Error Handling | 6/20 | 38% async coverage, 5 empty catches, no structured logger |
| ⚡ Performance | 6/10 | 11 console.log, 30 import issues, 1 await-in-loop |
| 📖 Code Quality | 13/15 | 91 long lines, 440 duplicated lines |

## Commands Executed

| # | Command | Status | Notes |
|---|---|---|---|
| 1 | `ratchet auth` | ✅ | Help printed (no subcmd) |
| 2 | `ratchet init --force` | ✅ | Detected Node lib + vitest, wrote `.ratchet.yml` + `.ratchetignore` |
| 3 | `ratchet scan` | ✅ | 1185 issues, score 61/100, recommended `torque --plan-first --guards refactor` |
| 4 | `ratchet report` | ✅ | Generated `docs/src-ratchet-report.md` + `.pdf` (after improve run) |
| 4a | `ratchet report --badge` | ✅ | Yellow shields.io badge URL produced |
| 5 | `ratchet map` | ✅ | 198 nodes, 489 edges → `ratchet-map.html` |
| 6 | `ratchet ship` | ✅ | All 4 formats (comment, json, check, badge) produced clean output |
| 6a | `ratchet ship --fail-under 80` | ✅ | Exit 1 (correct, score < threshold) |
| 6b | `ratchet ship --fail-under 50` | ✅ | Exit 0 (correct, score ≥ threshold) |
| 7 | `ratchet improve --target src --clicks 1 --local` | ⚠️ | Click rolled back in 6.8s — build failed (Hono needs deps installed). **Expected behavior, not a Ratchet bug.** Rollback was clean. |

## Top Issues Surfaced (sample for training data)

1. **[HIGH]** 95 async functions without error handling — `runtime-tests/lambda/mock.ts` and 45 others
2. **[HIGH]** 36 route files without input validation
3. **[HIGH]** 5 empty catch blocks — `src/adapter/bun/serve-static.ts:22`, `src/middleware/timing/timing.ts:33`, etc.
4. **[HIGH]** 1 hardcoded secret detected
5. **[MED]** 440 repeated code lines (high duplication)
6. **[MED]** 436 `any` types across 42 files
7. **[MED]** 34 functions >50 lines or high complexity

## Cross-Cutting (architect mode required)

- Coverage (95 hits / 46 files)
- Empty catches (5 / 5)
- Any types (436 / 42)
- Function length (34 / 13)
- Line length (91 / 38)
- Console cleanup (11 / 5)

## Reachable

- **Current:** 61/100
- **Reachable by torque:** ~80/100 (+19 from 5 fixable categories)
- **Ceiling:** 88/100 (4 categories need architect mode)

## Engine Behavior Notes

- ✅ `init` correctly detected vitest + npm + Node library
- ✅ `scan` produced detailed category breakdown + cross-cutting analysis
- ✅ `ship` exit codes work correctly with `--fail-under`
- ✅ `report` generates both MD and PDF in one call (no `--pdf` flag needed)
- ✅ `improve` rollback was clean (working tree restored to HEAD)
- ⚠️ `improve --local` clicks fail fast on repos without `node_modules` — could surface a clearer error ("install deps first")

## Artifacts Saved

- `01-auth.log` through `07-improve.log` — full command outputs
- `src-ratchet-report.md` (1.9K) — markdown report
- `src-ratchet-report.pdf` (266K) — PDF report
- `1aaeced0-2b12-4582-8d0d-163480809db6.json` (160K) — full run state
