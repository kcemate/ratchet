# FastAPI Deep Scan Report — 2026-04-01

**Repo:** https://github.com/fastapi/fastapi
**Score:** 68/100
**Total Issues:** 2,529

## Score Breakdown

| Category | Score | Max | Notes |
|---|---|---|---|
| Testing | 19 | 25 | 587 test files (118% ratio), but low assertion density |
| Security | 8 | 15 | 4 potential secrets, 213 routes without validation |
| Type Safety | 9 | 15 | 501 `Any` type usages across 24 files |
| Error Handling | 13 | 20 | 447 async functions without try/catch (9% coverage) |
| Performance | 10 | 10 | Perfect — clean async, no console.log, clean imports |
| Code Quality | 9 | 15 | 992 duplicated lines, 355 long lines, 15 TODOs |

## Top 5 Most Impactful Issues

1. **447 async functions without error handling** (High) — Massive across `docs_src/` and core. Most are example files, but the pattern propagates to real user code. FastAPI relies on middleware-level exception handling rather than per-handler try/catch.

2. **213 route files without input validation** (High) — Again largely in `docs_src/` examples. Many demo endpoints accept raw params without Pydantic/Zod-style validation, which is ironic given FastAPI's core value prop is automatic validation.

3. **992 duplicated code lines** (Medium) — Heavy repetition in `docs_src/` where py310/py39/py38 variants of examples exist. This is a documentation strategy choice, not a code quality issue per se.

4. **501 Any type usages** (Medium) — Concentrated in 24 files. Given FastAPI's Python typing story, this is notable. Many are in internal typing compatibility layers.

5. **4 hardcoded secrets** (High) — Likely example/test secrets but flagged nonetheless.

## Architecture Observations

- **docs_src/ dominates findings**: ~70% of issues come from documentation example files. The core `fastapi/` package is much cleaner. A `.ratchetignore` excluding `docs_src/` would likely push the score to ~80+.
- **Performance is flawless**: No await-in-loop anti-patterns, clean imports, no debug logging. The async architecture is solid.
- **Testing is strong but shallow**: 587 test files is impressive volume, but assertion density is low — many tests check "does it not crash" rather than specific behaviors.
- **Python typing quirks**: The 501 `Any` types are partly unavoidable in a framework that needs to be generic. Ratchet's TS-centric "Any type" heuristic may overcount here.

## Comparison to Prior Scans

| Repo | Score | Testing | Security | Type Safety | Error Handling | Performance | Code Quality |
|---|---|---|---|---|---|---|---|
| FastAPI | 68 | 19/25 | 8/15 | 9/15 | 13/20 | 10/10 | 9/15 |
| Express | * | * | * | * | * | * | * |
| Fastify | * | * | * | * | * | * | * |
| Hono | * | * | * | * | * | * | * |
| Zod | * | * | * | * | * | * | * |

*See individual reports for comparison data.*

FastAPI at 68 is in the middle of the pack — dragged down by docs_src noise. Core framework quality is higher than the score suggests.

## Training Data

- **101 structured training pairs** written to `ratchet-datagen/data/deep-scan-pairs/fastapi-2026-04-01.jsonl`
- Covers high and medium severity findings with file paths and categories
- Capped at 50 locations per issue type to avoid docs_src flooding
