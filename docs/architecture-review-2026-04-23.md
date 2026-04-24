# Architecture Review - Ratchet
Date: 2026-04-23

## 1. File List (first 20 TypeScript files)
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

## 2. Largest Files by Line Count (top 20)
58045 total
    1548 src/commands/torque.ts
    1484 src/commands/vision.ts
    1228 src/core/engine-run.ts
    1145 src/core/strategy.ts
     883 src/core/engines/classic-scoring.ts
     863 src/core/gitnexus.ts
     841 src/core/click.ts
     809 src/core/scan-cache.ts
     788 src/__tests__/transforms.test.ts
     773 src/__tests__/repo-probe.test.ts
     744 src/core/parallel.ts
     720 src/core/pdf-report.ts
     701 src/__tests__/normalize.test.ts
     668 src/core/agents/shell.ts
     592 src/core/score-optimizer.ts
     573 src/__tests__/smart-applier.test.ts
     573 src/__tests__/scan-scorers.test.ts
     552 src/core/agents/api.ts
     548 src/__tests__/engine-core.test.ts

## 3. Import Coupling Analysis (top 20)
87  'vitest';
  74  'path';
  53  '../types.js';
  49  'fs';
  44  '../core/scanner';
  41  '../lib/logger.js';
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

## 4. Recent Activity (last 7 days)
d3e4e29 prompt(auto): add pre-execution checklist + fix output format in buildIssuePlanPrompt [nemotron-prompt-eng]
98608a4 test(auto): add tests for engine-architect [devstral-afternoon-shift]
d29c3dd test(auto): add tests for deep-fix-router [devstral-afternoon-shift]
0e25529 test(auto): add tests for consolidate [devstral-afternoon-shift]

## 5. Findings & Recommendations

### Findings
- **Large files**: The largest files are in `src/commands/` (torque.ts, vision.ts) and core modules (engine-run.ts, strategy.ts), each exceeding 1000 lines. Large files often indicate multiple responsibilities and tight coupling.
- **Test file size**: Several test files appear in the top 20 largest files (e.g., transforms.test.ts at 788 lines), suggesting test files may be overly large and could benefit from modularization.
- **Import coupling**: Heavy reliance on file system modules (`fs`, `path`, `fs/promises`) and deeply nested relative imports (e.g., `../core/scanner`, `../lib/logger.js`). This creates tight coupling and makes refactoring difficult.
- **Recent activity**: Only 4 commits in the past 7 days, all test-related. Development momentum appears low, with no feature or refactoring commits observed.

### Recommendations (ordered by blast radius)
1. **Split large files**: Refactor torque.ts, vision.ts, engine-run.ts, and strategy.ts into smaller, focused modules (aim for <300 lines each). This will reduce complexity and improve maintainability.
2. **Decouple file system dependencies**: Encapsulate `fs` and `path` operations behind utility services or interfaces to reduce direct imports across the codebase. Consider using a dependency injection pattern.
3. **Simplify import paths**: Use barrel exports or TypeScript path aliases (via `tsconfig.json`) to reduce deeply nested relative imports like `../core/scanner`. Aim for imports like `@core/scanner`.
4. **Modularize test files**: Break large test files into multiple files per unit or feature (e.g., split transforms.test.ts by function). This improves test readability and maintainability.
5. **Increase development cadence**: Set weekly goals for feature additions, refactoring, or technical improvements. Ensure regular commits beyond test additions to sustain momentum.

-- 
Review completed by Nemotron (CPO).