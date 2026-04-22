🔍 Code Analysis Summary Report

**File:** `~/Projects/Ratchet/training-data/datagen/uber-go-zap.json`

**Primary Focus:** uber-go-zap - structured, leveled logging

Zap is a fast, structured, leveled logging library for Go. It focuses on performance and type safety, providing a powerful yet simple API for logging in applications.

---

### 🎯 Top 3 Development Focus Areas

Based on the breadth and frequency of the reported issues, the highest leverage areas for immediate improvement are:

**1. Error Handling and Validation Consistency (High Priority)**
*   **Observation:** Multiple functions (`updateUser`, `processRequest`, etc.) are noted for lacking comprehensive error handling, returning simple errors, or failing to validate inputs (e.g., "Missing required field 'email'").
*   **Recommendation:** Implement a centralized error handling middleware/utility. All service and API layers should validate inputs *before* calling core business logic. Use custom error types rather than generic string returns.

**2. Resource Management and Context Passing (Medium-High Priority)**
*   **Observation:** Several functions deal with external resources (databases, file handlers, network calls) but sometimes fail to reliably close or release them. Some functions also appear to operate without explicit context passing.
*   **Recommendation:** Adopt the `defer` statement pattern consistently for resource cleanup (e.g., database connections, file writers). For functions spanning multiple layers, ensure context (`context.Context`) is passed down to respect timeouts and cancellations.

**3. Security and Input Sanitization (Critical Area)**
*   **Observation:** Issues like potential SQL injection vectors (if direct query construction is used) and inadequate sanitization of user-submitted data are flagged.
*   **Recommendation:** Never trust user input. Use parameterized queries for all database interactions. Implement input sanitization (HTML escaping, trimming whitespace) at the API boundary for *all* user-provided strings.

---

### ⚙️ Quick Summary of Other Major Issues

*   **Performance:** Be mindful of N+1 query patterns and unnecessary large data fetching.
*   **Readability/Maintainability:** Many functions are noted as being too long or doing too many things (violating Single Responsibility Principle). Consider splitting them up.
*   **API Design:** Review API contracts to ensure status codes are used correctly (e.g., 400 for validation failure, 404 for not found, 500 for server error).

This summary moves beyond just listing problems and instead provides an actionable development roadmap based on the detected patterns.
