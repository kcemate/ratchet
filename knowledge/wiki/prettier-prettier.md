## 🚀 Refactoring Roadmap & Architectural Improvements

The most impactful changes will come from standardizing error handling, managing state, and improving module boundaries.

### 1. State Management & Predictability (The "Mutable Global State" Problem)
*   **Areas Affected:** `language-server` internals, potentially any function relying on global/module-level variables (`normalize-options`, etc.).
*   **The Problem:** Relying on state that changes implicitly or is shared across unrelated executions makes testing extremely difficult and leads to hard-to-trace bugs.
*   **Recommendation:**
    *   **Immutability First:** Adopt an immutable pattern for configuration and state passing. If a function needs to "update" a state, it should *return a new state object* rather than modifying the input object.
    *   **Dependency Injection (DI):** For core components (like parsers or formatters), pass required services/state explicitly as function arguments rather than assuming they are globally available.

### 2. Error Handling & Resilience (The Safety Net)
*   **Areas Affected:** Everywhere (`format`, `print`, parser functions, etc.)
*   **The Problem:** Mixing explicit error throwing (`throw new Error()`) with potential side effects or implicit handling can lead to unhandled rejections, inconsistent error types, or data loss.
*   **Recommendation:**
    *   **Adopt a Result Type/Either Monad:** Instead of `try...catch` blocks everywhere, functions should ideally return a structured result: `Result<T, E>` (e.g., `{ type: 'Ok', value: T }` or `{ type: 'Error', error: E }`). This forces the caller to explicitly handle success or failure.
    *   **Standardize Errors:** Define a base class for custom errors (`MyAppError`) that includes machine-readable codes (e.g., `E_INVALID_SYNTAX`, `E_UNSUPPORTED_FEATURE`) instead of relying only on generic strings or built-in Error objects.

### 3. Performance & Efficiency (The Loop Optimization)
*   **Areas Affected:** `language-server` (parsing/formatting logic).
*   **The Problem:** Repeated expensive operations inside loops or recursive calls (e.g., repeated string allocations, recalculating hashes).
*   **Recommendation:**
    *   **Memoization:** Aggressively apply memoization (caching results) for expensive, pure functions (e.g., calculating normalized paths, expensive parsing steps for the same input).
    *   **Batching:** If the API allows, analyze bulk operations. Can 10 separate formatting requests be processed in one pass rather than 10 sequential passes?

---

## 🛠 Targeted Code Refactoring (By File/Function)

If you want to address specific files next, here is the prioritized list:

### 🥇 Priority 1: `language-server` (Architecture)
This module handles the most complex logic and should be refactored first.
1.  **Refactor `getOptions`**: If this function reads state, ensure it is pure or returns a snapshot of the current state cleanly.
2.  **Error Handling:** Wrap the core parsing/formatting logic in `Result` wrappers.
3.  **Optimization:** Implement caching for expensive context lookups that happen repeatedly during formatting cycles.

### 🥈 Priority 2: Path & File Utilities (Safety/Consistency)
1.  **Normalization:** Review all path manipulation functions. Ensure they exclusively use `path.resolve`, `path.join`, and *never* rely on string concatenation for paths, minimizing OS-specific bugs.
2.  **Idempotency:** Verify that running a path resolver multiple times with the same input yields the exact same result every time, regardless of the initial state.

### 🥉 Priority 3: UI/CLI Interaction (UX/Robustness)
1.  **Asynchronous Flow Control:** Ensure that asynchronous operations (like writing to files or communicating over network sockets) always use proper `async/await` patterns to prevent race conditions when multiple commands are issued rapidly.
2.  **Input Validation:** At the entry point of any command (CLI or LS protocol handler), perform strict validation on the input *before* passing it to the core logic.

---

## ✨ Summary Checklist for the Next Sprint

| Area | Action | Goal | Impact |
| :--- | :--- | :--- | :--- |
| **State** | Enforce Immutability | Functions return new state objects instead of modifying inputs. | Reliability (Lowers bugs) |
| **Error** | Adopt `Result<T, E>` | Replace `try/catch` with explicit success/error paths in core logic. | Robustness (Predictable failures) |
| **Performance**| Implement Memoization | Cache results for expensive, pure computations (e.g., context analysis). | Speed (Better scaling) |
| **Safety** | Strict Path Usage | Use dedicated path libraries exclusively; avoid string manipulation for paths. | Correctness (OS compatibility) |

By following this roadmap, you move from fixing isolated bugs to building a significantly more resilient, testable, and scalable codebase.
