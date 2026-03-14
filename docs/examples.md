# Ratchet Configuration Examples

Ready-to-use `.ratchet.yml` configurations for common use cases. Copy and adjust for your project.

---

## Node.js / TypeScript Project

```yaml
agent: default

defaults:
  clicks: 7
  test_command: npm test
  auto_commit: true

targets:
  - name: error-handling
    path: src/api/
    description: "Improve error handling — add null checks, consistent logging, proper HTTP status codes"

  - name: types
    path: src/
    description: "Strengthen TypeScript types — replace 'any' with proper types, add missing generics"

  - name: test-coverage
    path: src/utils/
    description: "Add unit tests for untested utility functions"

boundaries:
  - path: "**/*.test.ts"
    rule: preserve-pattern
    reason: "Test structure follows team convention"

  - path: "**/*.spec.ts"
    rule: preserve-pattern
    reason: "Test structure follows team convention"
```

---

## Python / pytest Project

```yaml
agent: default

defaults:
  clicks: 5
  test_command: pytest
  auto_commit: true

targets:
  - name: error-handling
    path: src/api/
    description: "Add proper exception handling, replace bare except with specific exceptions"

  - name: type-hints
    path: src/
    description: "Add type hints to all functions missing them"

  - name: docstrings
    path: src/core/
    description: "Add docstrings to public functions and classes"
```

---

## Go Project

```yaml
agent: default

defaults:
  clicks: 7
  test_command: go test ./...
  auto_commit: true

targets:
  - name: error-handling
    path: internal/api/
    description: "Improve error handling — wrap errors with context, add proper logging"

  - name: interfaces
    path: internal/
    description: "Extract interfaces for dependencies to improve testability"

boundaries:
  - path: internal/migrations/
    rule: no-delete
    reason: "Migration files are append-only"
```

---

## Rust Project

```yaml
agent: default

defaults:
  clicks: 5
  test_command: cargo test
  auto_commit: true

targets:
  - name: error-handling
    path: src/
    description: "Replace unwrap() and expect() with proper error propagation using ?"

  - name: clippy
    path: src/
    description: "Fix clippy warnings — improve idiomatic Rust patterns"
```

---

## Monorepo — Multiple Services

```yaml
agent: default

defaults:
  clicks: 5
  test_command: npm test
  auto_commit: true

targets:
  - name: api-errors
    path: services/api/src/
    description: "Standardize error responses across all API endpoints"

  - name: auth-types
    path: services/auth/src/
    description: "Strengthen TypeScript types in auth service"

  - name: worker-resilience
    path: services/worker/src/
    description: "Add retry logic and better error handling to job processors"

boundaries:
  - path: services/api/src/auth/
    rule: no-modify
    reason: "Auth logic is security-sensitive — requires manual review"

  - path: shared/contracts/
    rule: no-modify
    reason: "Shared API contracts require cross-team coordination"
```

---

## Legacy Codebase Hardening

A configuration for incrementally hardening a large legacy codebase — run in multiple sessions over time:

```yaml
agent: default

defaults:
  clicks: 10
  test_command: npm test
  auto_commit: true

targets:
  - name: null-safety
    path: src/
    description: "Add null/undefined checks to reduce runtime errors — focus on functions that access object properties without guards"

  - name: async-fixes
    path: src/
    description: "Find and fix missing await keywords, unhandled promise rejections, and async functions called synchronously"

  - name: dead-code
    path: src/
    description: "Remove unused variables, imports, and functions — focus on exported symbols that are never imported"

  - name: constants
    path: src/
    description: "Extract magic numbers and strings into named constants"

boundaries:
  - path: src/legacy/
    rule: no-modify
    reason: "Legacy module — untested, do not touch until migration is complete"

  - path: "**/*.generated.ts"
    rule: no-modify
    reason: "Generated files — will be overwritten by codegen"
```

---

## Pre-Release Polish

Quick sprint before shipping:

```yaml
agent: default

defaults:
  clicks: 3
  test_command: npm run test:all
  auto_commit: true

targets:
  - name: logging
    path: src/
    description: "Improve log messages — add context, fix log levels, remove debug noise"

  - name: edge-cases
    path: src/api/
    description: "Handle edge cases — empty inputs, missing optional fields, boundary values"

  - name: cleanup
    path: src/
    description: "Remove TODO comments that have been addressed, dead imports, and console.log debug statements"
```

---

## Tips for Writing Good Target Descriptions

**Be specific about what to look for:**
- ✅ `"Replace bare try/catch swallowing with proper logging and re-throw"`
- ❌ `"Fix errors"`

**Name the pattern, not just the goal:**
- ✅ `"Find functions that call .find() or .filter() without null checks on the result"`
- ❌ `"Make the code safer"`

**Scope it to what can change in one click:**
- ✅ `"Improve error handling in src/api/users.ts"`
- ❌ `"Refactor the entire authentication system"`

**Mention what NOT to change (if unclear):**
- ✅ `"Add JSDoc comments to public functions — do not modify the function signatures"`
- Use `boundaries` for enforced constraints
