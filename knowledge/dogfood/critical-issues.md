# Ratchet Critical Issues Log

## Critical Issues Found During Dogfood Audits

### 🔴 HIGH: code-context.ts - Incomplete String Handling
**Date:** Wednesday, April 22nd, 2026
**File:** /Users/giovanni/Projects/ratchet/src/core/code-context.ts
**Function:** `stripCommentsAndStrings`

**Issue:** The function doesn't handle multi-line strings properly - it stops at newlines, causing incorrect truncation of string literals that span multiple lines.

**Impact:**
- **Correctness:** Multi-line string literals will be incorrectly truncated
- **False Positives:** Pattern matching may produce incorrect results
- **Reliability:** Core functionality for code analysis is compromised
- **Security:** Could potentially miss security issues hidden in multi-line strings

**Evidence:**
```typescript
// Single-quoted string: ' … '
if (ch === "'") {
  i++;
  while (i < len && source[i] !== "'" && source[i] !== '\n') {
    // Stops at newline, breaking multi-line strings
    if (source[i] === '\\') i++;
    result += ' ';
    i++;
  }
  i++; // skip closing '
  result += ' ';
  continue;
}
```

**Recommended Fix:**
1. Remove the `&& source[i] !== '\n'` condition from string parsing loops
2. Add proper handling for escaped newlines in strings
3. Ensure template literals also handle multi-line content correctly
4. Add comprehensive tests for multi-line string scenarios

**Priority:** HIGH - This affects the core code analysis functionality
**Estimated Effort:** 2-4 hours
**Risk Level:** Low - Fix is straightforward and can be well-tested

---

## Critical Issues Found During Dogfood Audits

### 🔴 HIGH: click.ts - Complex Function with Multiple Responsibilities
**Date:** Wednesday, April 15th, 2026
**File:** /Users/giovanni/Projects/ratchet/src/core/click.ts
**Function:** `executeClick`

**Issue:** The `executeClick` function is extremely large (800+ lines) and handles multiple complex responsibilities including risk gating, AST transforms, LLM agent execution, guard checking, testing, committing, and rollback logic.

**Impact:** 
- **Maintainability:** Very difficult to test, debug, and modify
- **Reliability:** Increased risk of bugs due to complexity
- **Performance:** Potential performance bottlenecks in large monolithic function
- **Team productivity:** High cognitive load for developers working on this code

**Evidence:**
```typescript
// Function spans 800+ lines with deeply nested logic
export async function executeClick(ctx: ClickContext): Promise<ClickOutcome> {
  // ... complex multi-phase execution ...
}
```

**Recommended Fix:**
1. Refactor into smaller, focused functions following Single Responsibility Principle
2. Extract major logical blocks into separate functions:
   - `checkPreconditions()`
   - `applyAstTransforms()`
   - `executeAgentPhases()`
   - `validateAndGuard()`
   - `runTestAndCommit()`
   - `handleRollback()`
3. Use a state machine pattern for better clarity
4. Each function should be < 50 lines and have a single clear responsibility

**Priority:** HIGH - This is a systemic architectural issue affecting core functionality
**Estimated Effort:** 16-24 hours
**Risk Level:** Medium - Refactoring requires comprehensive testing

---

### 🔴 HIGH: click.ts - Deep Nesting and Complex Control Flow
**Date:** Wednesday, April 15th, 2026
**File:** /Users/giovanni/Projects/ratchet/src/core/click.ts
**Function:** `executeClick` (main execution flow)

**Issue:** The main execution flow has deeply nested try-catch blocks, conditional logic, and multiple early returns creating a "spaghetti code" pattern.

**Impact:**
- **Readability:** Very difficult to follow the execution flow
- **Debugging:** Hard to trace errors through nested logic
- **Maintenance:** High risk of introducing bugs when modifying
- **Code quality:** Violates clean code principles

**Evidence:**
```typescript
try {
  // ... main logic ...
  try {
    // ... nested logic ...
    if (condition) {
      try {
        // ... more nesting ...
      } catch (err) {
        // ... error handling ...
      }
    }
  } catch (err) {
    // ... error handling ...
  }
} catch (err) {
  // ... top-level error handling ...
}
```

**Recommended Fix:**
1. Flatten the control flow using early returns and guard clauses
2. Extract nested try-catch blocks into separate functions with clear error handling
3. Use a more linear execution pattern where possible
4. Consider using a state machine or workflow pattern for complex multi-step operations

**Priority:** HIGH - Affects code quality and maintainability of core engine
**Estimated Effort:** 8-12 hours (can be done as part of the larger refactoring)
**Risk Level:** Medium - Requires careful testing of error paths

---

### 🔴 HIGH: engine-run.ts - Complex Function with Multiple Responsibilities
**Date:** Tuesday, April 14th, 2026
**File:** /Users/giovanni/Projects/ratchet/src/core/engine-run.ts
**Function:** `runEngine`

**Issue:** The `runEngine` function is extremely large (70KB+) and handles multiple complex responsibilities including:
- Engine initialization
- Click loop execution  
- Outcome processing
- Stop condition checking
- State management
- Error handling
- Strategy evolution

**Impact:** 
- **Maintainability:** Very difficult to test, debug, and modify
- **Reliability:** Increased risk of bugs due to complexity
- **Performance:** Potential performance bottlenecks in large monolithic function
- **Team productivity:** High cognitive load for developers working on this code

**Evidence:**
```typescript
// Function spans hundreds of lines with deeply nested logic
export async function runEngine(options: EngineRunOptions): Promise<RatchetRun> {
  // ... 500+ lines of complex logic ...
}
```

**Recommended Fix:**
1. Refactor into smaller, focused functions following Single Responsibility Principle
2. Extract major logical blocks into separate functions:
   - `initializeEngineState()`
   - `executeClickLoop()`
   - `handleClickOutcome()`
   - `applyStopConditions()`
   - `finalizeRun()`
3. Use a state machine pattern for better clarity
4. Each function should be < 50 lines and have a single clear responsibility

**Priority:** HIGH - This is a systemic architectural issue affecting core functionality
**Estimated Effort:** 8-16 hours
**Risk Level:** Medium - Refactoring requires comprehensive testing

---

### 🔴 HIGH: engine-run.ts - Deep Nesting and Complex Control Flow
**Date:** Tuesday, April 14th, 2026
**File:** /Users/giovanni/Projects/ratchet/src/core/engine-run.ts
**Function:** `runEngine` (main loop)

**Issue:** The main run loop has deeply nested try-catch blocks, conditional logic, and multiple early returns creating a "spaghetti code" pattern.

**Impact:**
- **Readability:** Very difficult to follow the execution flow
- **Debugging:** Hard to trace errors through nested logic
- **Maintenance:** High risk of introducing bugs when modifying
- **Code quality:** Violates clean code principles

**Evidence:**
```typescript
try {
  for (let i = 1; i <= clicks; i++) {
    try {
      // Deeply nested logic with multiple levels
      if (condition) {
        try {
          // More nesting...
        } catch (err) {
          // Error handling at deep level
        }
      }
    } catch (err) {
      // Middle-level error handling
    }
  }
} catch (err) {
  // Top-level error handling
}
```

**Recommended Fix:**
1. Flatten the control flow using early returns and guard clauses
2. Extract nested try-catch blocks into separate functions with clear error handling
3. Use a more linear execution pattern where possible
4. Consider using a state machine pattern for complex multi-step operations

**Priority:** HIGH - Affects code quality and maintainability of core engine
**Estimated Effort:** 4-8 hours (can be done as part of the larger refactoring)
**Risk Level:** Medium - Requires careful testing of error paths

---

## Summary

### Active Critical Issues: 5
1. **code-context.ts string handling** - Multi-line string parsing bug
2. **click.ts complexity** - 800+ line monolithic function
3. **click.ts nesting** - Deeply nested control flow
4. **engine-run.ts complexity** - 70KB monolithic function
5. **engine-run.ts nesting** - Deeply nested control flow

### Resolution Status
- **Open:** 4 issues
- **In Progress:** 0 issues  
- **Resolved:** 0 issues

### Next Steps
1. Create tickets for each critical issue in issue tracker
2. Schedule refactoring work as high priority
3. Implement comprehensive test coverage before refactoring
4. Break down refactoring into smaller, manageable PRs
5. Monitor for regressions after changes
6. Consider architectural review to prevent similar issues in future

---
