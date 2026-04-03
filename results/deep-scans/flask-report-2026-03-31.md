# Flask Deep Scan Report — 2026-03-31

**Repo:** [pallets/flask](https://github.com/pallets/flask)
**Score:** 71.5/100 | **Issues:** 461

## Score Breakdown

| Category | Score | Notes |
|---|---|---|
| Testing | 17/25 | 41 test files, 171% ratio, but low assertion density |
| Security | 3/15 | No input validation, no auth/rate-limit/CORS |
| Type Safety | 7/15 | pyright configured, but 250 `Any` types |
| Error Handling | 19.5/20 | Solid — 45 try/catch, only 1 empty catch |
| Performance | 10/10 | Clean imports, no console.log, no await-in-loop |
| Code Quality | 15/15 | No long functions, no dead code, minor duplication |

## Top 5 Most Impactful Issues

1. **No input validation on routes (high)** — 5 route files accept arbitrary input without any validation layer. Flask's philosophy of "bring your own validation" means the framework itself is scored poorly here, but it's a real gap for production apps.

2. **Bare except clause in app.py:1601 (high)** — Catches `BaseException` implicitly including `SystemExit` and `KeyboardInterrupt`. This is the WSGI error boundary so it's somewhat intentional, but still a code smell.

3. **250 Any types across 19 files (medium)** — Heavy reliance on `t.Any` especially in typing.py, scaffold.py, and the JSON provider. Undermines the strict pyright config.

4. **No built-in security middleware (medium)** — No CORS, rate limiting, or auth. Expected for a microframework, but scores poorly in automated scans.

5. **202 repeated code lines (medium)** — Duplication between App and Blueprint scaffolding code. Some is inherent to the architecture.

## Architecture Observations

- **Mature, minimal codebase.** Flask is intentionally thin — ~24 source files. The low security score reflects its microframework philosophy, not negligence.
- **sansio split is clean.** The `sansio/` package properly separates I/O-free logic from WSGI concerns.
- **Error handling is excellent.** 19.5/20 is the highest we've seen across all scanned repos. Flask's error propagation model is well-designed.
- **Testing is extensive but assertion-light.** 171% file ratio is great, but the test quality score suggests many tests are more integration/smoke tests than deeply assertive unit tests.
- **Type safety is a work in progress.** pyright is configured (good), but the heavy Any usage suggests types were retrofitted rather than designed in.

## Comparison to Other Scanned Repos

| Repo | Score | Best Category | Worst Category |
|---|---|---|---|
| Flask | 71.5 | Error Handling (19.5/20) | Security (3/15) |
| Express | ~65 | Performance | Security |
| Fastify | ~78 | Testing | Type Safety |
| Hono | ~82 | Performance | Testing |
| Zod | ~85 | Type Safety | Testing |
| tRPC | ~76 | Type Safety | Error Handling |
| Drizzle-ORM | ~72 | Code Quality | Security |
| Effect-TS | ~80 | Type Safety | Code Quality |

Flask sits mid-pack. Its error handling is best-in-class among all scanned repos. The security score is expected for a microframework — same pattern as Express.

## Training Data

7 structured pairs extracted to `ratchet-datagen/data/deep-scan-pairs/flask-2026-03-31.jsonl`
