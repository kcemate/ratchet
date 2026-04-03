# Express.js Deep Scan Report — 2026-04-02

**Repo:** [expressjs/express](https://github.com/expressjs/express)
**Overall Score:** 63/100
**Issues Found:** 34

## Score Breakdown

| Category | Score | Notes |
|---|---|---|
| 🧪 Testing | 21/25 | 91 test files, 1300% ratio, 164 edge cases. Weak on assertions (1.1/test) |
| 🔒 Security | 3/15 | No input validation, no auth/rate-limit/CORS. Only clean on secrets |
| 📝 Type Safety | 0/15 | JavaScript only — no TS, no JSDoc types |
| ⚠️ Error Handling | 14/20 | Good coverage (2 try/catch), no empty catches. Lacks structured logging |
| ⚡ Performance | 10/10 | Perfect — no await-in-loop, clean console, clean imports |
| 📖 Code Quality | 15/15 | Perfect — short functions, minimal duplication, no dead code |

## Top 5 Most Impactful Issues

1. **No input validation (HIGH × 4 files)** — Route handlers accept raw user input. This is Express's design philosophy (middleware-based), but Ratchet flags it correctly since production apps need validation.

2. **Zero type safety (MEDIUM)** — Pure JS codebase with no TypeScript migration path. Express 5 was supposed to address this but remains JS. Competitors (Hono, Fastify) ship TS-first.

3. **No built-in auth/rate-limit/CORS (MEDIUM × 3)** — Framework relies entirely on ecosystem middleware. Modern frameworks like Hono bundle security primitives.

4. **18 lines of code duplication (MEDIUM)** — Repeated patterns in router and middleware chains that could be extracted.

5. **No structured logging (LOW)** — Only 1 console.error/warn call, no winston/pino integration.

## Architecture Observations

- **Mature but showing age.** Express is the Node.js HTTP framework that started it all, but its architecture reflects 2010s patterns: callback-heavy, no built-in async/await, middleware-chain-based everything.
- **Testing is a strength.** 91 test files with 164 edge cases is excellent. The low assertion density (1.1/test) suggests many tests are integration/smoke tests rather than granular unit tests.
- **Performance is perfect.** Clean async patterns, no console pollution. The framework itself is lean.
- **Security by omission.** Express intentionally ships minimal — no batteries included for security. This is a valid architectural choice but means Ratchet correctly penalizes it for production readiness.

## Comparison to Other Scanned Repos

| Repo | Score | Best Category | Worst Category |
|---|---|---|---|
| Express | 63/100 | Performance (10/10), Code Quality (15/15) | Type Safety (0/15), Security (3/15) |
| Zod | ~85+ | Type Safety | — |
| Flask | ~55-65 | Testing | Type Safety, Security |
| FastAPI | ~70-80 | Type Safety | — |
| Pydantic | ~80+ | Type Safety | — |

Express scores mid-pack — strong fundamentals but penalized for JS-only and no built-in security. Exactly what you'd expect for a 14-year-old framework that prioritizes simplicity over batteries-included.

## Training Data Value

Generated **10 training pairs** covering:
- 4 high-severity input validation findings
- 3 medium-severity security control findings
- 1 medium-severity type safety finding
- 2 medium-severity code quality findings

These are valuable for teaching Ratchet how to assess framework-level codebases vs application codebases — Express intentionally delegates security/validation to userland, which is a valid architectural pattern but still a production readiness concern.
