# Council Brief: Scanner Root Cause Fix — All 3 Phases

## Date: 2026-03-22
## Priority: P0 — Product is broken. Ship tonight.

## Context
Torque is rolling back 100% of clicks due to scanner false positives. We just shipped band-aids (pre-validation gate, validated skip, better UX), but the root cause is the scanner itself: regex matching against raw file content with zero context awareness.

## The 3 Phases

### Phase 1: Context-Aware Matching
Replace raw regex matching in `countMatches()` / `countMatchesWithFiles()` (scan-constants.ts) with context-aware versions that strip comments and string literals before matching. Use a character-level parser (we already built `stripCommentsAndStrings()` for the pre-validation gate in issue-prevalidation.ts — reuse it).

Key files:
- `src/core/scan-constants.ts` — countMatches, countMatchesWithFiles, anyFileHasMatch
- `src/core/issue-prevalidation.ts` — has stripCommentsAndStrings() to reuse
- `src/commands/scan.ts` — uses countMatches throughout

Risk: This changes scoring for EVERYONE. A project that was 85/100 might jump to 92/100 because false positives stop inflating issue counts. We need to handle this gracefully.

### Phase 2: File Classification  
Tag files before scanning: production, documentation, test, config. Apply different scanning rules per classification.

Key insight: `explanations.ts` is literally a file of code examples for scanner output — it should never be scanned for the issues it's documenting.

### Phase 3: AST-Level Detection
Move high-value checks from regex to AST (TypeScript compiler API):
- Empty catch: walk for CatchClause with empty Block
- Console usage: walk for CallExpression where callee is console.*
- Secret detection: only flag string literals assigned to key/secret/token/password variables

## Questions for Council

1. **Phase 1 scoring impact:** When we strip false positives, scores will jump. Should we: (a) just let scores change, (b) add a migration note, or (c) version the scoring algorithm?

2. **Phase 2 classification:** What's the right classification taxonomy? Should we use a whitelist (production = everything not explicitly excluded) or a blacklist (docs/tests = explicitly tagged)?

3. **Phase 3 scope:** AST parsing adds latency. Should we: (a) AST-parse everything, (b) only AST-parse when regex finds a match (confirm/deny), or (c) AST-parse only specific high-false-positive rules?

4. **Backwards compatibility:** Projects using .ratchetignore already have workarounds. Should the new filtering respect or override .ratchetignore entries?

Give concrete, actionable answers. We're building tonight.
