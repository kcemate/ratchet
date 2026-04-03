# Hono Deep Scan Report — 2026-04-02

**Repo:** [honojs/hono](https://github.com/honojs/hono)
**Overall Score:** 60/100 | **Issues Found:** 1,281

## Score Breakdown

| Category | Score | Notes |
|---|---|---|
| 🧪 Testing | 25/25 | 133 test files, 59% ratio, 336 edge cases, 2.3 assertions/test |
| 🔒 Security | 8/15 | 1 hardcoded secret, validation on only 2 files, auth middleware present |
| 📝 Type Safety | 3/15 | No strict mode, 446 `any` types across 49 files |
| ⚠️ Error Handling | 6/20 | 63 try/catch (38% async coverage), 5 empty catches, no structured logging |
| ⚡ Performance | 5/10 | 1 await-in-loop, 46 console.logs, 30 import issues |
| 📖 Code Quality | 13/15 | Short functions mostly, some duplication (474 lines) |

## Top 5 Most Impactful Issues

1. **102 async functions without error handling** — The biggest gap. For a web framework, unhandled async errors can crash processes or leak connections. This is the #1 priority.

2. **446 `any` types + no strict mode** — Hono is a TypeScript-first framework known for excellent types in its public API, but internally there's significant `any` usage. Strict mode would catch dozens of latent bugs.

3. **45 route files without validation** — Surprising for a framework that ships a validator helper. Internal examples and adapters skip validation.

4. **474 lines of duplicated code** — Multi-runtime adapter code (Bun, Deno, Cloudflare Workers, Node) likely accounts for much of this. Could be DRYed with a shared adapter base.

5. **No structured logging** — 58 console.error/warn + 46 console.log. For a framework, this matters less (users bring their own logger), but internal tooling should use structured output.

## Architecture Observations

- **Testing is excellent.** 25/25 is rare — Hono has comprehensive test coverage with strong edge case depth. This is best-in-class among frameworks scanned.
- **Multi-runtime tax.** Supporting Bun, Deno, CF Workers, Node, and others creates duplication and adapter complexity. The 474 duplicated lines likely stem from this.
- **Public API types vs internal types.** Hono's public TypeScript API is famously precise (generics for routes, middleware chaining), but internally the codebase relies heavily on `any`. Classic "cobbler's children" pattern.
- **Lightweight by design.** Many "issues" (like no built-in structured logging) are intentional — Hono is a minimal framework. The score reflects production-app standards, not framework design intent.

## Comparison to Other Scanned Repos

| Repo | Score | Testing | Type Safety | Error Handling |
|---|---|---|---|---|
| **Hono** | **60** | **25/25** | 3/15 | 6/20 |
| Express | ~45 | ~15/25 | 1/15 | 4/20 |
| Fastify | ~65 | 22/25 | 8/15 | 10/20 |
| Zod | ~75 | 24/25 | 14/15 | 12/20 |
| Flask | ~50 | 18/25 | N/A | 8/20 |

Hono's testing score is the highest we've seen. Its weakness is type safety (ironic for a TS framework) and error handling coverage internally.

## Training Data

12 structured pairs extracted → `~/Projects/ratchet-datagen/data/deep-scan-pairs/hono-2026-04-02.jsonl`
