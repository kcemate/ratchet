# Test Generation Log

**Generated:** Friday, April 3rd, 2026 — 11:41 PM (America/New_York) / 2026-04-04 03:41 UTC

## Generated Tests

### add-catch-handler.test.ts
- **Source:** `core/transforms/add-catch-handler.ts`
- **Coverage:** Happy path, error handling, edge cases

### add-type-annotations.test.ts
- **Source:** `core/transforms/add-type-annotations.ts`
- **Coverage:** Type annotation insertion, edge cases, error conditions

### analyze-react.test.ts
- **Source:** `core/analyze-react.ts`
- **Coverage:** React analysis, component detection, edge cases

### anthropic.test.ts
- **Source:** `core/providers/anthropic.ts`
- **Coverage:** API integration, error handling, request/response validation

### api.test.ts
- **Source:** `core/providers/base.ts` (API base provider)
- **Coverage:** Base API functionality, error handling, request lifecycle

### async-writer.test.ts
- **Source:** `core/async-writer.ts`
- **Coverage:** Async file writing, buffering, error conditions

### classic.test.ts
- **Source:** `core/engines/classic.ts`
- **Coverage:** Classic engine analysis, scoring, edge cases

### classic-file-analysis.test.ts
- **Source:** `core/engines/classic-file-analysis.ts`
- **Coverage:** File analysis logic, edge cases, error handling

### classic-frameworks.test.ts
- **Source:** `core/engines/classic-frameworks.ts`
- **Coverage:** Framework detection and analysis

### classic-issues.test.ts
- **Source:** `core/engines/classic-issues.ts`
- **Coverage:** Issue detection and classification

### classic-scoring.test.ts
- **Source:** `core/engines/classic-scoring.ts`
- **Coverage:** Scoring algorithms and edge cases

### consolidate.test.ts
- **Source:** `core/consolidate.ts`
- **Coverage:** Consolidation logic, merging results, edge cases

### deep.test.ts
- **Source:** `core/engines/deep.ts`
- **Coverage:** Deep engine analysis, prompt generation, error handling

### deep-fix-router.test.ts
- **Source:** `core/deep-fix-router.ts`
- **Coverage:** Fix routing logic, edge cases, error conditions

### deep-parser.test.ts
- **Source:** `core/engines/deep-parser.ts`
- **Coverage:** Deep parser analysis, extraction logic

### deep-prompts.test.ts
- **Source:** `core/engines/deep-prompts.ts`
- **Coverage:** Prompt generation, edge cases, validation

### fix-templates.test.ts
- **Source:** `core/fix-templates.ts`
- **Coverage:** Template rendering, edge cases, error handling

### engine.test.ts
- **Source:** `core/engine.ts`
- **Coverage:** Core engine functions including circuit breaker logic, click loop control, category diffing, click economics, safety monitoring, and run management
- **Functions covered:**
  - `shouldSoftSkipSubcategory()` - boundary testing for soft skip threshold
  - `shouldEscalateOnTotalZeroDelta()` - threshold testing for sweep escalation
  - `diffCategories()` - category delta computation with edge cases
  - `shouldContinueClickLoop()` - click loop continuation logic
  - Circuit breaker functions: `initCircuitBreaker()`, `recordFailure()`, `recordSuccess()`, `isCircuitBreakerTripped()`, `updateStrategy()`, `hasTriedStrategy()`
  - Click economics functions: `buildClickEconomics()`, `hasSuccessfulLands()`, `shouldRetryClick()`
  - Safety functions: `extractHighRiskChanges()`, `hasHighRiskCategories()`
  - Run management: `buildRatchetRun()`, `shouldCaptureBaseline()`, `shouldUseTestIsolation()`
  - Stop conditions: `shouldStopAfterZeroDeltaLands()`, `shouldStopAfterNegativeDeltaLands()`, `shouldStopAfterScoreImprovement()`**Generated:** Monday, April 6th, 2026 — 6:10 AM (America/New_York) / 2026-04-06 10:10 UTC

### auto-pr.test.ts
- **Source:** `core/auto-pr.ts`
- **Coverage:** Comprehensive unit tests covering all exported functions:
  - `getAutoPRConfig()` - config retrieval with defaults
  - `shouldCreateAutoPR()` - condition checking with safety
  - `createAutoPR()` - main orchestration with error handling
  - `getAutoPRBranchName()` - unique branch generation
  - `getAutoPRCommitMessage()` - message formatting
  - `getAutoPRTitle()` - title generation with metrics
  - `getAutoPRBody()` - comprehensive PR body creation
  - `getAutoPRLabels()` - label selection
  - `getAutoPRReviewers()` - reviewer selection
  - `getAutoPRAssignees()` - assignee selection

All tests use vitest, include proper mocking of external dependencies (Git, API, config), and cover:
- Happy paths
- Edge cases
- Error conditions
- Boundary values
