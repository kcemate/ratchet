# Deep Scan Report: go-chi/chi

**Date:** 2026-04-02
**Repo:** https://github.com/go-chi/chi
**Language:** Go
**Lines of Code:** ~10,369
**Ratchet Score:** 71/100

---

## Score Breakdown

| Category | Score | Max | Notes |
|---|---|---|---|
| Testing | 18.5 | 25 | 40% file coverage, low edge case depth, good assertion density |
| Security | 4 | 15 | No input validation, no auth/CORS, rate limiting only |
| Type Safety | 13 | 15 | Go compiler helps; 15 `interface{}` usages remain |
| Error Handling | 10.5 | 20 | Only 9% async coverage, 1 empty catch, some ignored errors |
| Performance | 10 | 10 | Clean — no await-in-loop, no console.log, clean imports |
| Code Quality | 15 | 15 | Good function sizes, minimal long lines, some duplication |

---

## Top 5 Most Impactful Issues

### 1. **Low Error Handling Coverage (High)**
Only 6 error handling blocks covering 9% of async operations. For a router framework, uncaught panics and unhandled errors in middleware chains are critical. 62 exported functions lack `if err != nil` checks.

### 2. **No Input Validation (High)**
Zero input validation detected across 27 route-related files. While chi is a router (not a framework), providing validation middleware or hooks would significantly improve downstream security.

### 3. **32 Source Files Without Tests (High)**
Only 21/53 source files have corresponding tests. Key middleware files like `page_route.go`, `clean_path.go`, `maybe.go`, and `nocache.go` appear untested.

### 4. **Low Edge Case Test Depth (Medium-High)**
Only 5 edge/error test cases for a 10K+ line codebase. Missing: malformed URL handling, nil handler registration, concurrent route matching, oversized request scenarios.

### 5. **interface{} Usage (Medium)**
15 uses of `interface{}` across 10 files. While Go's type system mitigates risk, migrating to `any` alias and using generics where appropriate would improve readability and catch more bugs at compile time.

---

## Architecture Observations

- **Minimal, composable design:** Chi follows the standard `net/http` patterns closely. This is a strength — no framework lock-in, easy to understand.
- **Middleware-centric:** Most functionality lives in `middleware/` package. The core router (`mux.go`, `tree.go`, `context.go`) is lean.
- **Radix tree routing:** Efficient route matching via a radix/trie structure in `tree.go`.
- **No dependencies beyond stdlib:** Chi is dependency-free, which is excellent for security and maintenance.
- **Examples as documentation:** The `_examples/` directory serves as both docs and integration tests.
- **Maturity signals:** Well-structured, stable API. The TODOs in `compress.go` and test files suggest some deferred decisions but nothing critical.

---

## Comparison to Other Scanned Repos

| Repo | Score | Language | Key Strength | Key Weakness |
|---|---|---|---|---|
| **chi** | 71 | Go | Performance, zero deps | Error handling, security |
| flask | 71.5 | Python | Testing coverage | Type safety (any types) |
| fastapi | ~72 | Python | Type safety | Security middleware |
| zod | ~74 | TypeScript | Type safety | Test edge cases |
| drizzle-orm | ~68 | TypeScript | Architecture | Error handling |
| effect-ts | ~69 | TypeScript | Type system | Complexity |

Chi scores comparably to Flask — both are minimal frameworks that delegate security/validation to the user. Chi's Go compiler advantage gives it better type safety but its error handling score drags it down.

---

## Training Data Generated

- **13 structured pairs** written to `ratchet-datagen/data/deep-scan-pairs/chi-2026-04-02.jsonl`
- Categories: error-handling (3), type-safety (4), testing (2), security (2), code-quality (2)
- All severity >= medium

---

*Scanned with Ratchet v1.2.0 on 2026-04-02*
