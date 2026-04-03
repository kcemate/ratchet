# Effect-TS Deep Scan Report — 2026-03-31

**Repository:** [Effect-TS/effect](https://github.com/Effect-TS/effect)
**Type:** TypeScript monorepo (31+ packages)
**Score:** 60/100

## Score Breakdown

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| 🧪 Testing | 19 | 25 | 694 test files (68% ratio), 564 edge cases, but low assertion density |
| 🔒 Security | 12 | 15 | 119 potential secrets flagged, good validation/auth otherwise |
| 📝 Type Safety | 3 | 15 | **Weakest area** — 5,697 `any` types, no strict TS flags |
| ⚠️ Error Handling | 12 | 20 | 56% async coverage, good (no empty catches), needs more structured logging |
| ⚡ Performance | 6 | 10 | Clean async patterns, import hygiene issues |
| 📖 Code Quality | 8 | 15 | Short functions ✓, but massive duplication (9,414 lines) |

## Top 5 Most Impactful Issues

1. **5,697 `any` types across 343 files** — Ironic for a library whose entire value proposition is type safety. Many of these are internal implementation details using `any` for performance/flexibility, but it's still a significant gap between the public API's type safety and internal code.

2. **9,414 repeated code lines** — Monorepo pattern amplifies this. Many packages share similar patterns (especially SQL adapters, platform packages). Could benefit from shared internal utilities or codegen.

3. **119 potential hardcoded secrets** — Likely test fixtures and example tokens rather than real secrets, but still flagged. Should use clearly-marked test constants.

4. **58 async functions without error handling** — For a library that provides the `Effect` type as a superior error-handling primitive, the internal tooling/scripts don't always use it.

5. **No strict TypeScript flags** — `tsconfig.base.json` doesn't enable `strict: true`. Given Effect is a type-safety library, this is a notable omission (likely intentional for internal flexibility).

## Architecture Observations

- **Massive monorepo**: 31+ packages covering effect core, platform adapters (Node, Bun, Browser), SQL adapters (Drizzle, Kysely, ClickHouse, etc.), RPC, CLI, AI, OpenTelemetry, and experimental features.
- **Test coverage is excellent** by ratio (68%, 7,106 test cases) — but assertion density is low, suggesting many tests may be smoke tests or type-level tests.
- **The `any` count is contextual**: Effect's internals use `any` extensively for type erasure in the runtime layer while maintaining full type safety at the API boundary. This is a deliberate architectural choice, not sloppiness.
- **Duplication is structural**: SQL adapter packages (sql-clickhouse, sql-d1, sql-drizzle, sql-kysely, sql-libsql) share nearly identical patterns — a code generator could reduce this significantly.
- **Clean async patterns**: Zero await-in-loop — expected for a library built around structured concurrency.

## Comparison to Other Scanned Repos

| Repo | Score | Notable |
|------|-------|---------|
| Express | — | Legacy codebase, different era |
| Fastify | — | Focused single-package |
| Hono | — | Lean, minimal |
| tRPC | — | TypeScript-first, smaller scope |
| Zod | — | Single-purpose validation |
| Drizzle-ORM | — | ORM, moderate complexity |
| **Effect-TS** | **60** | Largest monorepo scanned, `any` count inflated by intentional type erasure |

## Training Data

- **6 medium+ severity training pairs** written to `ratchet-datagen/data/deep-scan-pairs/effect-ts-2026-03-31.jsonl`
- Key categories: secrets, async error handling, duplication, any types, function complexity, strict config

## Verdict

Effect-TS scores 60/100 — reasonable for a massive monorepo with 31+ packages. The low type safety score is misleading: Effect uses `any` internally as a deliberate performance/flexibility trade-off while maintaining bulletproof public types. The real areas for improvement are duplication across SQL adapters and stricter internal coding standards for test assertion density.
