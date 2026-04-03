# Drizzle-ORM Deep Scan Report — 2026-03-31

## Overall Score: 59/100

| Category | Score | Max | Grade |
|----------|-------|-----|-------|
| 🧪 Testing | 24.5 | 25 | A |
| 🔒 Security | 11 | 15 | B |
| 📝 Type Safety | 5 | 15 | F |
| ⚠️ Error Handling | 10.5 | 20 | D |
| ⚡ Performance | 1 | 10 | F |
| 📖 Code Quality | 7 | 15 | D |

## Top 5 Most Impactful Issues

### 1. Massive Code Duplication — 6,702 repeated lines (medium)
The monorepo has extreme duplication across dialect packages (drizzle-orm/src/pg-core, mysql-core, sqlite-core). Each dialect re-implements similar query builders with minor variations. This inflates maintenance burden and bug surface area.

### 2. 2,405 `any` Types (medium)
For a TypeScript-first ORM, this is surprisingly high. Many `any` types appear in query builder internals and type inference utilities. Likely deliberate in some cases (complex mapped types), but creates holes in the type system the library is built to enforce.

### 3. 247 Async Functions Without Error Handling (high)
34% async coverage is low for a database library where every operation can fail. Missing try/catch on DB calls means unhandled rejections propagate to consumers unpredictably.

### 4. 440 Source Files Without Tests (high)
Despite having 257 test files (37% ratio — decent), 440 source files have no corresponding tests. The testing that exists is high quality (2.5 assertions/test, 153 edge cases), but coverage gaps are wide.

### 5. 315 console.log Calls (medium)
Excessive for a library. These should be behind a debug flag or replaced with the existing logger utility (83 logger calls exist, but console outnumbers them 4:1).

## Architecture Observations

- **Monorepo structure is clean** — separate packages for ORM core, kit (migrations), seed, and schema validation adapters (zod, valibot, typebox, arktype). Good separation of concerns.
- **Testing is genuinely strong** — 24.5/25 is the highest testing score we've seen across all scans. Edge case coverage (153 cases) is excellent. They clearly prioritize correctness.
- **Type safety paradox** — A TypeScript ORM scoring 5/15 on type safety is ironic. The complexity of their type inference system (mapped types, conditional types) likely forces `any` escape hatches internally, even though the external API is type-safe.
- **Performance debt is real** — 146 await-in-loop patterns in a database library is concerning. Batch operations should use Promise.all or pipeline queries.
- **tsconfig parse error** — Ratchet couldn't fully parse their tsconfig (monorepo with project references), costing them 6 points on strict config.

## Comparison to Other Scanned Repos

| Repo | Score | Testing | Security | Type Safety | Error Handling | Performance | Quality |
|------|-------|---------|----------|-------------|----------------|-------------|---------|
| **drizzle-orm** | **59** | **24.5/25** | 11/15 | 5/15 | 10.5/20 | 1/10 | 7/15 |
| zod | 72 | 22/25 | 13/15 | 12/15 | 14/20 | 5/10 | 6/15 |
| hono | 68 | 21/25 | 12/15 | 10/15 | 12/20 | 4/10 | 9/15 |
| trpc | 61 | 20/25 | 11/15 | 8/15 | 11/20 | 3/10 | 8/15 |
| fastify | 65 | 23/25 | 12/15 | 9/15 | 12/20 | 3/10 | 6/15 |
| express | 45 | 18/25 | 8/15 | 3/15 | 8/20 | 2/10 | 6/15 |

**Key takeaway:** Drizzle has the best testing of any repo scanned so far, but pays heavily on type safety (internal `any` usage) and performance (await-in-loop). The monorepo duplication is the single biggest drag on the score.

## Training Data

25 structured training pairs extracted to `~/Projects/ratchet-datagen/data/deep-scan-pairs/drizzle-orm-2026-03-31.jsonl`

## Recommendations for Ratchet

1. **Monorepo detection** — Ratchet should detect monorepos and score duplication more leniently across packages (shared patterns ≠ copy-paste).
2. **tsconfig project references** — Fix the parser to handle TypeScript project references / composite builds.
3. **Library vs. app context** — console.log in a library is worse than in an app. Consider a "library mode" multiplier.
