# Pydantic Deep Scan Report — 2026-04-01

**Repo:** pydantic/pydantic (Python)
**Score:** 71/100 | **Issues:** 4,555

## Score Breakdown

| Category | Score | Max | Notes |
|---|---|---|---|
| 🧪 Testing | 19 | 25 | 408 test files (171% ratio), 804 edge cases, but low assertion density |
| 🔒 Security | 6 | 15 | 2 potential secrets, no auth/rate-limit/CORS (library, so expected) |
| 📝 Type Safety | 7 | 15 | pyright configured, but 1,878 `Any` types across 77 files |
| ⚠️ Error Handling | 20 | 20 | Perfect — 260 try/catch, no empty catches, structured logging |
| ⚡ Performance | 10 | 10 | Perfect — no await-in-loop, clean imports |
| 📖 Code Quality | 9 | 15 | Short functions, but excessive duplication (2,267 lines) and 105 TODOs |

## Top 5 Most Impactful Issues

1. **Any type density (1,878 hits, 77 files)** — Ironically, the validation library itself has massive `Any` usage. Most concentrated in `_internal/` modules like `_generate_schema.py`, `_decorators.py`, `_generics.py`, `_typing_extra.py`. This is partly by design (pydantic must handle arbitrary types) but Ratchet flags it correctly as a type safety risk.

2. **Code duplication (2,267 repeated lines)** — Significant duplication across test files and internal modules. Test files naturally repeat patterns, but the `_internal/` source modules also show structural repetition in schema generation and validator handling.

3. **Hardcoded secrets (2 findings, high severity)** — Likely false positives in test fixtures or example code, but worth flagging. Common pattern in validation libraries that include example configs.

4. **Missing auth/rate limiting (3 findings)** — False positive for a library. Pydantic is not a web framework — it has no routes, endpoints, or auth surface. This exposes a Ratchet calibration opportunity: libraries should be scored differently than apps.

5. **Low assertion density in tests** — 5,844 test cases but low assertion density suggests many tests rely on implicit validation (expecting no exception = pass) rather than explicit assertions. Common in validation libraries where the test is "does it parse without error."

## Architecture Observations

- **Mature, well-structured library** — Clean separation between public API (`pydantic/`) and internal implementation (`pydantic/_internal/`).
- **Heavy metaprogramming** — The `_generate_schema.py` file alone has 2,700+ lines of complex type introspection, which naturally requires extensive `Any` usage. This is a legitimate design choice, not negligence.
- **Excellent error handling** — Perfect 20/20. Every exception path is handled, logging is structured. This is what you'd expect from a project of this caliber.
- **Test suite is massive** — 408 test files, 171% ratio. The testing infrastructure is clearly a priority.
- **V1→V2 migration debt** — Files like `_decorators_v1.py` and `_migration.py` carry legacy compatibility code that inflates duplication and `Any` counts.

## Comparison Notes

- **vs. Express (72/100):** Nearly identical score. Both lose points on type safety for language-inherent reasons (JS `any` / Python `Any`).
- **vs. FastAPI (74/100):** FastAPI scores slightly higher, partly because it's a thinner layer with less internal metaprogramming.
- **vs. Django-Ninja (69/100):** Pydantic scores better, particularly in testing and error handling.
- **vs. Flask (68/100):** Pydantic's stronger testing and error handling give it a clear edge.

## Ratchet Calibration Insights

This scan reveals an important calibration need: **library vs. application scoring**. Pydantic loses 6 points on "auth/rate limiting" which is meaningless for a library. Similarly, the `Any` type penalty is harsh for a library whose core job is runtime type manipulation. A "library mode" for Ratchet could add 6-10 points to this score.

## Raw Data

- Scan output: `pydantic-2026-04-01.txt`
- Training pairs: `~/Projects/ratchet-datagen/data/deep-scan-pairs/pydantic-2026-04-01.jsonl`
