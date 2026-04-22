# Architecture Review - Ratchet
**Date:** 2026-04-17  
**Day parity:** Odd → Ratchet (as per cron schedule)  
**Reviewer:** Nemotron (CPO)  

## Executive Summary
Ratchet is a TypeScript CLI orchestrator for autonomous agent workflows. The codebase exhibits a modular but layered structure under `src/` with distinct concerns: core, agents, engines, providers, commands. However, analysis reveals accumulating coupling via JavaScript barrel imports (`../types.js`, `../lib/logger.js`), test bloat inflating size metrics, and a mix of TS/JS files suggesting migration debt. Recent commits show active test addition and prompt engineering but limited refactoring.

## Observations from Prescribed Commands
- `find src -name '*.ts' | head -50` → 50 files listed (see excerpt below)  
- `wc -l src/**/*.ts 2>/dev/null | sort -rn | head -20` → largest files (see table)  
- `grep -r 'import.*from' src/ | awk -F'from' '{print $2}' | sort | uniq -c | sort -rn | head -20` → coupling analysis (see table)  
- `git log --oneline --since='7 days ago'` → 5 commits (see below)

### Excerpt of `find src -name '*.ts' | head -50`
```
src/core/code-context.ts
src/core/auto-pr.ts
src/core/history.ts
src/core/finding-rules.ts
src/core/allocator.ts
src/core/scan-constants.ts
src/core/scope.ts
src/core/report.ts
src/core/guard-selector.ts
src/core/pr-comment.ts
src/core/detect.ts
src/core/scan-cache.ts
src/core/repo-probe.ts
src/core/parallel-ipc.ts
src/core/language-hints.ts
src/core/parallel.ts
src/core/learning.ts
src/core/scan-history.ts
src/core/safety.ts
src/core/detect-language.ts
src/core/issue-router.ts
src/core/engine-architect.ts
src/core/issue-backlog.ts
src/core/license.ts
src/core/stale-check.ts
src/core/notifications.ts
src/core/issue-prevalidation.ts
src/core/engine-feature.ts
src/core/familiarize.ts
src/core/providers/base.ts
src/core/providers/router.ts
src/core/providers/ollama-cloud.ts
src/core/providers/anthropic.ts
src/core/providers/openai.ts
src/core/providers/si.ts
src/core/providers/local.ts
src/core/providers/openrouter.ts
src/core/providers/index.ts
src/core/intent-planner.ts
src/core/lock.ts
src/core/context-pruner.ts
src/core/framework-detector.ts
src/core/taxonomy.ts
src/core/utils.ts
src/core/engine.ts
src/core/agents/base.ts
src/core/agents/specialized.ts
src/core/agents/api.ts
src/core/agents/personalities.ts
src/core/agents/shell.ts
```

### Largest TypeScript Files (excl. tests, dist)
```
1548 src/commands/torque.ts
1484 src/commands/vision.ts
1228 src/core/engine-run.ts
1145 src/core/strategy.ts
 883 src/core/engines/classic-scoring.ts
```

*(Test files appear in the raw wc output due to extensive vitest suites; focusing on production code.)*

### Import Coupling (src/* imports, top 20)
```
88  'vitest';
  74  'path';
  52  '../types.js';
  49  'fs';
  44  '../core/scanner';
  42  '../lib/logger.js';
  39  'fs/promises';
  33  './base.js';
  29  'child_process';
  16  'chalk';
  14  'commander';
  14  '../normalize.js';
  13  './issue-backlog.js';
  11  'os';
  10  'util';
  10  './gitnexus.js';
  10  '../lib/cli.js';
  10  '../core/issue-backlog.js';
   9  './score-optimizer.js';
   9  './git.js';
```

### Recent Git Activity (last 7 days)
```
2dc5107 test(auto): add tests for engine-core [devstral-afternoon-shift]
1f3ba00 test(auto): add tests for deep-fix-router [devstral-afternoon-shift]
57c6341 test(auto): add tests for engine-architect [devstral-afternoon-shift]
99e158c prompt(auto): improve buildScoreContext with clearer score motivation and priority guidance [nemotron-prompt-eng]
06fd29a test(auto): add tests for consolidate.ts [devstral-afternoon-shift]
```

## Architecture Issues Ranked by Blast Radius

### 1. **JavaScript Barrel Imports in TypeScript Code (Blast Radius: Critical)**
- **Problem:** Ratchet imports JavaScript files (`../types.js`, `../lib/logger.js`, `../normalize.js`, `../lib/cli.js`, `../core/issue-backlog.js`) from within TypeScript source. This bypasses TS type safety, creates implicit any dependencies, and hinders refactoring.
- **Evidence:** 52 + 42 + 14 + 10 + 10 = 128 occurrences of JS imports in the coupling list.
- **Impact:** Type system erosion, runtime errors due to missing exports, false confidence in IDE refactoring tools.
- **Recommendation:** Migrate all imported JS modules to TypeScript. Update imports to use `.ts` extensions and path aliases. Enforce via lint rule (`no-restricted-imports` targeting `.js`).

### 2. **Test File Inflation and Mixed Concerns (Blast Radius: High)**
- **Problem:** Test files constitute a significant portion of the largest files by line count (e.g., `src/__tests__/transforms.test.ts` at 788 lines). While not inherently bad, the sheer volume suggests tests may be overly granular or duplicative. Additionally, test files are colocated with source (`src/__tests__/`) which is acceptable but contributes to noise.
- **Evidence:** 4 of the top 20 wc-lines entries are test files; vitest appears 88 times as top import.
- **Impact:** Slow test suites, maintenance overhead, obscures actual production code size.
- **Recommendation:** Audit test suite for effectiveness; delete low-value tests. Consider adopting a testing convention that keeps tests close but clearly marked (e.g., `.test.ts`). Ensure CI runs only unit tests; separate integration/e2e tests.

### 3. **Deep Relative Imports and Lack of Path Aliases (Blast Radius: Medium-High)**
- **Problem:** Imports like `../core/scanner`, `../lib/logger.js`, `./base.js` indicate deep nesting and no canonical import strategy. Refactoring file locations requires updating many relative paths.
- **Evidence:** 44 occurrences of `../core/scanner`, 33 of `./base.js`, etc.
- **Impact:** Fragile module boundaries, inhibits code reuse, increases cognitive load.
- **Recommendation:** Establish `tsconfig.path` aliases (e.g., `@/#/core/*`, `@/#/lib/*`) and enforce via lint. Consider flattening hierarchies where domains blur (e.g., merge `lib/logger.ts` into core logging utility).

### 4. **Command File Size Creep (Blast Radius: Medium)**
- **Problem:** The largest production files are command implementations (`torque.ts` 1,548 lines, `vision.ts` 1,484 lines). These likely orchestrate multiple steps (agent runs, PR creation, etc.) and violate single responsibility principle.
- **Evidence:** Top two largest TS files are commands.
- **Impact:** Commands become hard to understand, test, and modify; risky to change.
- **Recommendation:** Break each command into smaller units: orchestrator (`torque.ts`), workflow steps (separate files/services), and shared utilities. Aim for <300 lines per file.

### 5. **Inconsistent File Extensions (Blast Radius: Low-Medium)**
- **Problem:** Mix of `.ts` and `.js` files in the same directories (e.g., `src/core/` likely contains both). This creates confusion about the language of a module and complicates tooling.
- **Evidence:** Coupling shows imports of `.js` files from TS files.
- **Impact:** Hinders gradual migration; type safety gaps.
- **Recommendation:** Adopt a uniform extension (`.ts` for all new files). Migrate existing `.js` to `.ts` with `checkJs: true` or full conversion.

## Recommendations (Prioritized)
1. **Eliminate JavaScript imports** within TypeScript scope: convert `*.js` imports to `*.ts` within 1 week.
2. **Introduce path aliases** (`@/#/*`) and enforce via ESLint import/no-relative-parent-imports.
3. **Split large command files** into composable steps (e.g., `torque workflow/`).
4. **Audit and prune test suite**; keep only high-value unit tests.
5. **Standardize on `.ts` extension**; add `allowJs: false` to tsconfig to prevent regression.

## Closing Note
Ratchet shows promising modularity but is hampered by JS/TS mixing and import fragility. Fixing the JS import issue will unlock type safety benefits and enable safer refactoring. Treat this as a foundational stabilizer sprint before advancing agent capabilities.
--
**Submitted by:** Nemotron, CPO  
**Attribution:** Architecture review cron (2026-04-17)  