# Ratchet Scoring Guide

_How scoring works, what moves the needle, and how to hit 95+._

## How Scores Work

Ratchet scores your codebase across **6 categories** (max 100):

| Category | Max Points | What It Measures |
|---|---|---|
| 🧪 Testing | 25 | Coverage ratio, edge cases, assertion density, test quality |
| 🔒 Security | 15 | Auth middleware, input validation, rate limiting scope |
| 📝 Type Safety | 15 | `any` types, type assertions, generic usage |
| ⚠️ Error Handling | 20 | Empty catches, async error handling, structured errors |
| ⚡ Performance | 10 | N+1 queries, sync I/O, memory patterns |
| 📖 Code Quality | 15 | Duplication, function length, structured logging, console cleanup |

Each category has **subcategories** scored individually. Your total is the sum of all subcategory scores.

## The Score Plateau Problem

Most codebases hit a ceiling around **85-90**. Here's why and how to break through:

### Common Plateaus

**Stuck at ~75:** You probably have minimal tests and lots of `console.log`. Focus on:
1. Write test files (target 50%+ file coverage ratio)
2. Replace `console.*` with a structured logger (pino, winston)

**Stuck at ~85:** Tests exist but are shallow. Quality subcategories are holding you back:
1. Assertion density — most tests have only 1 `expect()`. Add 2+ per test.
2. Remaining `console.*` calls mixed with structured logging
3. A few empty catch blocks

**Stuck at ~90-95:** You're in the long tail. Remaining points come from:
1. Test quality (assertions per test ≥ 2.0)
2. Auth/rate-limiting scope (broad middleware patterns)
3. Edge case test coverage

### What Moves Points vs. What Doesn't

**High impact (1-4 pts each):**
- Adding test files for untested modules → Coverage ratio
- Migrating console.* → structured logger → Structured logging + Console cleanup
- Increasing assertions per test from 1.x to 2.0+ → Test quality
- Fixing empty catch blocks → Error handling
- Narrowing `app.use("/api/path", limiter)` to `app.post(...)` → Auth & rate limiting

**Low/zero impact (wastes clicks):**
- Deduplicating code in a category that's already maxed
- Refactoring function length when Code Quality is at 15/15
- Adding more tests when Testing subcategories are already maxed
- Type improvements when Type Safety is at 15/15

### The #1 Mistake

Ratchet torque currently picks fixes by **issue count**, not **score impact**. A category with many issues but a maxed score will attract clicks over a category with fewer issues and 6 points of headroom.

**Workaround:** Use `--focus` to target specific categories:
```bash
ratchet torque --target "." --clicks 3 --focus coverage
ratchet torque --target "." --clicks 3 --focus logging
```

## Subcategory Thresholds

### Testing (25 pts max)

| Subcategory | Score | Threshold |
|---|---|---|
| Coverage ratio | 8 | ≥50% of source files have corresponding test files |
| | 6 | ≥30% ratio |
| | 4 | ≥15% ratio |
| Edge case depth | 9 | ≥100 edge/error test cases |
| Test quality | 8 | ≥50 test cases AND ≥2.0 assertions per test AND uses describe blocks |
| | 6 | ≥10 test cases AND ≥1.5 assertions per test |
| | 4 | ≥5 test cases AND ≥1.0 assertions per test |

**Assertion counting:** Ratchet counts `expect(` and `assert(` calls as assertions, and `it(` and `test(` as test cases. Be aware that the word `test` in variable names or strings can inflate the test case count and lower your ratio.

**Pro tip:** Rename variables like `const test = ...` to `const spec = ...` or `const tc = ...` to avoid false matches.

### Security (15 pts max)

| Subcategory | Score | Threshold |
|---|---|---|
| Input validation | 6 | Validation patterns (zod, joi, express-validator) on route files |
| Auth & rate limiting | 6 | Auth middleware present AND rate limiters scoped to specific methods |
| | 4 | Auth middleware OR rate limiting present but broadly scoped |

**Common trap:** `app.use("/api/groups", rateLimiter)` covers ALL methods (GET, POST, PUT, DELETE). Ratchet flags this. Fix: `app.post("/api/groups", rateLimiter)`.

**CLI/library projects:** Auth & rate limiting may not apply. This is a known false positive — your ceiling may be 13/15 for Security.

### Error Handling (20 pts max)

| Subcategory | Score | Threshold |
|---|---|---|
| Empty catches | 5 | Zero empty catch blocks |
| | 4.5 | 1 empty catch |
| Async error handling | ... | Proper try/catch or .catch() on async operations |

**Quick win:** Find empty catches with `grep -rn "catch.*{}" src/` and add error logging or a `// intentionally empty` comment.

### Code Quality (15 pts max)

| Subcategory | Score | Threshold |
|---|---|---|
| Structured logging | 7 | Only structured logger calls (pino, winston), no console.* |
| | 3 | Mix of structured and console |
| Console cleanup | 5 | Zero `console.log` in src/ |
| | 2 | Some console.log remaining |
| Function length | ... | Functions under 50 lines |

**Migration path:** Install pino, create a logger module, then find/replace:
```bash
# Find all console calls
grep -rn "console\." src/ --include="*.ts" | grep -v node_modules | grep -v __tests__
```

## Real-World Score Journey

From our own dogfooding run (ratchet-oss):

```
85.5 → 87.5  Deduplication refactors (accidental — crossed a threshold)
87.5 → 89    Added 10 test files (coverage ratio 23% → 48%)
89   → 93    Migrated 44 console.* → pino (structured logging 3/7 → 7/7)
93   → 96    Added 7 more test files + assertion density push + empty catch fix
96   → ???   Pushing assertion ratio from 1.9 → 2.0+
```

**Key lesson:** The automated torque engine ran 11 clicks and scored zero points (kept fixing maxed categories). The breakthrough came from **manually diagnosing which subcategories had headroom** and targeting those specifically. This is why `ratchet scan` output is your best friend — read the subcategory breakdown, find the gaps, then focus your clicks there.

## Quick Reference: Score Ceilings by Project Type

| Project Type | Realistic Ceiling | Why |
|---|---|---|
| Full-stack web app | 95-98 | All categories apply |
| CLI tool | 93-96 | Auth/rate-limiting may not apply (false positive) |
| Library/SDK | 95-98 | All categories apply, testing is key |
| API-only backend | 96-100 | Natural fit for all categories |
| Frontend-only (React) | 90-95 | Limited error handling patterns |
