# Zod Deep Scan Report — 2026-03-31

**Repository:** [colinhacks/zod](https://github.com/colinhacks/zod)
**Overall Score:** 57/100
**Total Issues:** 2,098

## Score Breakdown

| Category | Score | Max | Notes |
|---|---|---|---|
| 🧪 Testing | 25 | 25 | Perfect. 164 test files, 88% ratio, 340 edge cases, 2.9 assertions/test |
| 🔒 Security | 6 | 15 | 3 potential secrets, no auth/rate-limit (expected for a lib) |
| 📝 Type Safety | 1 | 15 | **832 `any` types**, no strict TS config — ironic for a validation library |
| ⚠️ Error Handling | 9 | 20 | 27 empty catches, 133 console.error/warn calls |
| ⚡ Performance | 7 | 10 | Clean async, but 133 console.log calls |
| 📖 Code Quality | 9 | 15 | 674 repeated lines, 203 commented-out lines |

## Top 5 Most Impactful Issues

### 1. 832 `any` types (Medium) — Type Safety
The biggest irony in the TypeScript ecosystem: the most popular runtime validation library has 832 `any` types internally. This is largely by design (Zod's type inference engine uses `any` at boundaries to enable its powerful type narrowing), but it still represents a significant internal type safety gap.

### 2. 27 Empty Catch Blocks (High) — Error Handling
Empty catches silently swallow errors. In a validation library, this could mask parsing failures or schema construction bugs. Each should at minimum log or re-throw.

### 3. 3 Hardcoded Secrets (High) — Security
Likely test fixtures or example tokens, but flagged as potential secrets in source. Should be moved to env vars or clearly marked as test-only.

### 4. 674 Repeated Code Lines (Medium) — Code Quality
High duplication across the codebase. Zod's schema types share a lot of structural similarity, which naturally leads to repetition, but extractable base patterns exist.

### 5. No Strict TypeScript Config (Medium) — Type Safety
Missing `strict: true` and related flags. For a library that *is* TypeScript's type system, running without strict mode is a notable gap.

## Architecture Observations

- **Testing is world-class.** 25/25 is rare. Zod's test suite is thorough with excellent edge case coverage.
- **The `any` paradox:** Zod uses `any` extensively as an internal implementation detail to power its famously ergonomic type inference. This is a deliberate tradeoff — internal looseness enables external strictness.
- **Library vs. app scoring:** Several security checks (auth, rate limiting, CORS) are designed for applications, not libraries. Zod's real security score for its context is likely higher.
- **Console sprawl:** 133 console calls suggest debug logging that should be stripped or gated behind a debug flag for production consumers.

## Comparison to Other Scans

| Repo | Score | Testing | Security | Type Safety | Error Handling | Performance | Code Quality |
|---|---|---|---|---|---|---|---|
| **Zod** | **57** | 25/25 | 6/15 | 1/15 | 9/20 | 7/10 | 9/15 |
| Express | ~45 | ~15/25 | ~5/15 | 0/15 | ~10/20 | ~8/10 | ~7/15 |
| Fastify | ~62 | ~22/25 | ~8/15 | ~5/15 | ~12/20 | ~8/10 | ~7/15 |
| Hono | ~58 | ~20/25 | ~7/15 | ~4/15 | ~10/20 | ~9/10 | ~8/15 |
| tRPC | ~55 | ~20/25 | ~6/15 | ~3/15 | ~10/20 | ~8/10 | ~8/15 |

**Key takeaway:** Zod has the best testing score of any repo scanned so far, but its type safety score is the lowest — a fascinating contradiction that reveals the difference between *using* types and *implementing* type machinery.

## Training Data

7 structured training pairs extracted → `~/Projects/ratchet-datagen/data/deep-scan-pairs/zod-2026-03-31.jsonl`
