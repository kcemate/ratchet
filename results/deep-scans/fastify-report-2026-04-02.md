# Fastify Deep Scan Report — 2026-04-02

## Score: 73/100

| Category | Score | Max |
|---|---|---|
| 🧪 Testing | 25 | 25 |
| 🔒 Security | 8 | 15 |
| 📝 Type Safety | 0 | 15 |
| ⚠️ Error Handling | 20 | 20 |
| ⚡ Performance | 10 | 10 |
| 📖 Code Quality | 10 | 15 |

## Top 5 Most Impactful Issues

### 1. No TypeScript (0/15 type safety)
Fastify's core is plain JavaScript. Type definitions ship separately as `.d.ts` files but the source gets zero type-safety benefit at dev time. This is the single biggest scoring gap.

### 2. Missing Security Defaults (8/15 security)
No built-in rate limiting, CORS, or auth middleware. Fastify's plugin model pushes all security to userland (`@fastify/rate-limit`, `@fastify/cors`, `@fastify/helmet`). Framework itself has zero security controls.

### 3. reply.js Complexity (1030 lines, 20+ functions)
The reply module handles serialization, streaming, trailers, hooks, and error handling — all in one file. Contains nested callbacks and complex control flow.

### 4. config-validator.js Size (1266 lines)
Massive inline JSON schema definitions with repetitive patterns. Ripe for extraction into schema builders.

### 5. hooks.js Duplication (429 lines)
13 hook types with near-identical registration/execution patterns. A generic hook factory could cut this by 60%.

## Architecture Observations

- **Plugin-first design**: Fastify intentionally keeps core minimal and pushes functionality to plugins. This is both a strength (modularity) and a weakness (no security defaults).
- **Closure-heavy patterns**: `buildRouting()` in route.js uses deeply nested closures sharing mutable state rather than classes. Makes the code harder to follow and test in isolation.
- **Exceptional testing**: 221 test files, 442% test-to-source ratio, 4.4 assertions per test. Perfect 25/25. This is best-in-class.
- **Excellent error handling**: Perfect 20/20. Structured logging with pino, no empty catches, comprehensive try/catch coverage.
- **Clean performance patterns**: No await-in-loop, no console.log in source, clean imports. Perfect 10/10.

## Comparison to Other Scanned Repos

| Repo | Score | Testing | Security | Types | Errors | Perf | Quality |
|---|---|---|---|---|---|---|---|
| **fastify** | **73** | 25/25 | 8/15 | 0/15 | 20/20 | 10/10 | 10/15 |
| express | TBD (scanned today) | - | - | - | - | - | - |
| zod | prev scan | - | - | - | - | - | - |
| flask | prev scan | - | - | - | - | - | - |

Fastify's 73 is solid for a JS-only framework. The testing and error handling scores are elite. TypeScript migration would immediately add 10-15 points.

## Training Data Generated
8 structured pairs written to `ratchet-datagen/data/deep-scan-pairs/fastify-2026-04-02.jsonl`
