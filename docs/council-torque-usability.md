# Council Brief: Torque Usability Crisis

## Date: 2026-03-22
## Priority: CRITICAL — this is what users pay for

## Problem Statement

`ratchet torque` — the core paid feature — fails to land clicks in common scenarios. When the remaining issues are nuanced (false positives, unfixable patterns, doc-only occurrences), torque burns time and money producing zero results.

### Evidence

**Latest self-run (ratchet on itself at 86.5/100):**
- 3/3 clicks rolled back
- 58 seconds wall time, 0 value delivered
- Agent was told to fix "console.log in explanations.ts" — but it was a code example in a comment
- Agent was told to fix "hardcoded secrets" — but they were example strings in documentation
- Agent correctly determined nothing needed fixing, did nothing, and got rolled back

**Previous run (84/100):**
- 3/3 clicks rolled back
- Same pattern — agent targets files that don't have real issues

### Root Causes

1. **Scanner false positives pollute the backlog**
   - `/\bconsole\.log\s*\(/g` matches string literals and comments
   - Secret detection matches example code (`sk-1234567890abcdef` in a teaching example)
   - Empty catch detection matches code examples showing bad patterns
   - Result: score-optimizer sends agent after phantom issues

2. **No "nothing to fix" exit path**
   - Agent looks at the file, finds nothing wrong, makes no changes
   - Torque sees no diff → rolls back → counts as failure
   - User sees "rolled back" with no explanation of why
   - Should be: "Skipped — no actionable issues found in target file"

3. **Target selection doesn't filter documentation/example files**
   - `explanations.ts` is literally a file of code examples for the scanner's output
   - Scanner treats it the same as production code
   - Agent wastes a click investigating a docs file

4. **No agent feedback loop**
   - When the agent reports "this file doesn't have the issue you described", torque ignores it
   - Should: mark the issue as false positive, skip to next target, not count as a click

5. **Wasted economics are terrible UX**
   - Each failed click costs ~$0.02-0.05 in API calls
   - 3 failed clicks = user paid for nothing
   - No refund mechanism, no skip mechanism
   - "0% efficiency" in the report is demoralizing

### Current Score Breakdown (90/100 after manual fixes)

| Category | Score | Max | Gap | Fixable by torque? |
|----------|-------|-----|-----|-------------------|
| Structured logging | 3 | 7 | 4 | Maybe — 32 console calls in scanner code (intentional) |
| Console cleanup | 4 | 5 | 1 | No — it's a comment example |
| Dead code | 2 | 4 | 2 | Maybe — 9 TODOs, 1 commented line |
| Duplication | 1 | 3 | 2 | No — needs architect (505 repeated lines) |
| Line length | 3 | 4 | 1 | Yes — 28 long lines |

### What We Need From Council

1. **How should the scanner distinguish real issues from code examples/docs?**
   - Ignore files matching certain patterns (e.g., `explanations.ts`, `*.example.ts`)?
   - Strip comments before scanning?
   - Use AST-level detection instead of regex?

2. **What should happen when an agent finds nothing to fix?**
   - Skip and move to next target?
   - Mark issue as false positive in the backlog?
   - Don't count as a click?

3. **How should torque handle diminishing returns?**
   - At 85+ score, most remaining issues are nuanced
   - Should torque refuse to run above a threshold?
   - Should it switch strategies (architect mode, manual suggestions)?

4. **What's the ideal UX for a "nothing landed" run?**
   - Current: "No clicks landed. Try adjusting your target description." (useless)
   - What should it say? What should it do automatically?

5. **Should torque pre-validate targets before spawning the agent?**
   - Check if the issue actually exists in the file
   - Verify the issue is in production code (not docs/comments)
   - Estimate fixability before burning a click
