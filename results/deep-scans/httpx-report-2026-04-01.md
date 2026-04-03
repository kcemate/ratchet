# httpx Deep Scan Report — 2026-04-01

**Repo:** [encode/httpx](https://github.com/encode/httpx)
**Language:** Python
**Score:** 77/100 | 304 issues

## Score Breakdown

| Category | Score | Notes |
|---|---|---|
| 🧪 Testing | 19/25 | Excellent coverage (161% ratio, 539 cases), but low assertion density |
| 🔒 Security | 2/15 | 1 hardcoded secret, no input validation, auth middleware only |
| 📝 Type Safety | 11/15 | mypy strict enabled, but 69 `Any` types across 10 files |
| ⚠️ Error Handling | 20/20 | Perfect — 55 try/catch blocks, no empty catches, structured logging |
| ⚡ Performance | 10/10 | Perfect — clean async, no console.log, clean imports |
| 📖 Code Quality | 15/15 | Near-perfect — 1 TODO, 231 repeated lines (sync/async duplication) |

## Top 5 Most Impactful Issues

1. **No input validation (Security, High Impact)** — URL parameters pass through to transport with zero sanitization. No scheme filtering, no parameter type checking. For an HTTP client library, this is the biggest risk surface.

2. **Sync/Async code duplication (Code Quality, Medium)** — `_client.py` at 2019 lines contains near-identical `Client` and `AsyncClient` classes. 231 repeated lines. This is a known pain point in Python async libraries but still a maintenance burden.

3. **69 `Any` types across core modules (Type Safety, Medium)** — Despite having strict mypy config, `Any` leaks through `json` parameters (11 occurrences in _client.py alone), EventHook, QueryParams, and extension types. Undermines the strict typing promise.

4. **Hardcoded credential in docstring (Security, High)** — `_urls.py` contains `a%20secret` as a password in URL examples. While it's documentation, scanners flag it and it sets a bad pattern.

5. **Low assertion density in tests (Testing, Medium)** — 539 test cases but test quality scored only 2/8. Tests exist but may be integration-heavy with fewer granular assertions per test.

## Architecture Observations

- **Clean module separation** — Clear boundaries between client, transport, URL parsing, auth, and content handling. Well-architected for a library.
- **Error handling is exemplary** — 55 structured try/catch blocks with no empty catches. This is the gold standard.
- **Performance patterns are solid** — No await-in-loop antipatterns despite being an async-first library.
- **The sync/async split is the core tech debt** — Nearly every method exists twice. Python's lack of async/sync code sharing makes this structural.
- **Type system is "strict with holes"** — mypy strict is on but `Any` is used liberally at API boundaries (json, extensions, event hooks). The typing is rigorous internally but permissive at edges.

## Comparison

| Metric | httpx | DeuceDiary (ref) | fastapi | flask |
|---|---|---|---|---|
| Overall Score | 77 | ~65-70 | 74 | 71 |
| Testing | 19/25 | ~15/25 | 17/25 | 18/25 |
| Security | 2/15 | ~8/15 | 3/15 | 2/15 |
| Error Handling | 20/20 | ~12/20 | 18/20 | 15/20 |
| Type Safety | 11/15 | ~10/15 | 11/15 | 8/15 |

httpx scores well overall — its error handling is best-in-class among scanned repos. The security score is typical for library code (no auth/rate-limiting needed at library level). The real differentiator is the perfect performance and error handling scores.

## Training Data

8 training pairs extracted to `ratchet-datagen/data/deep-scan-pairs/httpx-2026-04-01.jsonl`
