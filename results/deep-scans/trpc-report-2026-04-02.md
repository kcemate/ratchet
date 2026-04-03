# tRPC Deep Scan Report — 2026-04-02

**Repo:** [trpc/trpc](https://github.com/trpc/trpc)
**Score:** 58/100 | **Issues:** 1,599

## Score Breakdown

| Category | Score | Notes |
|---|---|---|
| 🧪 Testing | 25/25 | Excellent — 351 test files, 134% ratio, 2.4 assertions/test |
| 🔒 Security | 6/15 | 8 hardcoded secrets, no auth/rate-limit/CORS detected |
| 📝 Type Safety | 3/15 | No strict TS flags, 412 `any` types |
| ⚠️ Error Handling | 9/20 | 32% async coverage, 109 unhandled async fns |
| ⚡ Performance | 7/10 | Clean async patterns, some console.log & import issues |
| 📖 Code Quality | 8/15 | Good function length avg (22 lines), but 836 duplicated lines |

## Top 5 Most Impactful Issues

1. **109 async functions without error handling (HIGH)** — Across 52 files. This is the single biggest risk for production consumers. Unhandled rejections in a framework lib propagate to users.

2. **8 hardcoded secrets (HIGH)** — Likely test/example tokens, but still a bad pattern for a framework that teaches by example.

3. **412 `any` types across 74 files (MEDIUM)** — Ironic for a type-safety-focused framework. Many are in internal plumbing, but erode the type guarantees tRPC promises.

4. **836 duplicated code lines (MEDIUM)** — Monorepo sprawl. Shared patterns across packages aren't extracted into common utilities.

5. **Missing strict TypeScript config (MEDIUM)** — A type-safe RPC framework should dogfood strict mode.

## Architecture Observations

- **Monorepo structure is solid** — pnpm workspaces + turbo + lerna. Well-organized packages.
- **Testing is world-class** — 25/25 is rare. 351 test files with good assertion density and edge case coverage.
- **Security posture is weak** — Expected for a library (auth/rate-limit are consumer concerns), but the hardcoded secrets and lack of examples are missed opportunities.
- **Type safety gap** — The 412 `any` types are surprising for a project whose core value prop is end-to-end type safety. Most are in internal implementation, not public API, but still.
- **Error handling is the Achilles heel** — 109 unguarded async functions in a framework that sits in the request path. Consumers inherit this risk.

## Comparison Notes

- **vs Express (58/100 same day):** Identical score. Express has worse testing but better error handling patterns. tRPC wins on testing, loses on type safety (ironic).
- **vs Fastify (scanned same day):** Fastify likely scores higher on security and error handling due to its built-in validation and error framework.
- **vs DeuceDiary:** Our app scores in a similar range but for different reasons — we have fewer `any` types and better error handling, but less test coverage.

## Training Data

7 structured pairs extracted to `ratchet-datagen/data/deep-scan-pairs/trpc-2026-04-02.jsonl`

---
*Scanned by Ratchet on 2026-04-02 at 03:01 ET*
