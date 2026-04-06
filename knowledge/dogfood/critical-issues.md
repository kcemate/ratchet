# Ratchet Critical Code Issues

## Critical Issues Found (6 total)

### 🔴 CRITICAL: Missing Centralized Error Handling
**Severity:** Critical  
**Files Affected:** src/engine.ts, src/click.ts, src/scan-cache.ts  
**Risk:** If any handler throws an unexpected error, the server will likely crash or return a vague, unhandled 500 status code. This leads to unpredictable behavior in production, poor debugging capabilities, and potential service downtime.  
**Impact:** Critical production reliability issue.  
**Recommendation:** Implement a global Express error middleware at the end of the middleware chain. This middleware should log error details and return a sanitized, generic 500 response to the client.

### 🔴 CRITICAL: Missing Operational Logging
**Severity:** Critical  
**Files Affected:** src/engine.ts, src/click.ts, src/scan-cache.ts  
**Risk:** The server only logs startup success. There is no logging for authentication failures, rate limit hits, failed requests (4xx), or successful requests (2xx/3xx). Debugging production issues becomes nearly impossible.  
**Impact:** Critical observability gap.  
**Recommendation:** Integrate a structured logging library (like Winston or Pino). Log key metrics including request path, status code, IP address, and authentication status for every request.

### 🔴 CRITICAL: Insecure Token Handling/Storage
**Severity:** Critical  
**Files Affected:** src/engine.ts, src/click.ts, src/scan-cache.ts  
**Risk:** The API secret is compared directly against a potentially vulnerable environment variable. If the application fails to load this secret, the comparison might fail silently or allow unexpected access. Furthermore, relying solely on a single shared secret is a critical risk.  
**Impact:** Potential unauthorized access if the secret is compromised or misconfigured.  
**Recommendation:** Implement a more robust authentication scheme (e.g., mutual TLS, OAuth/JWTs with expiration, or IP whitelisting combined with tokens). Never rely solely on a single, static secret token for critical services.

### 🔴 CRITICAL: God File / Lack of Separation of Concern
**Severity:** Critical  
**Files Affected:** src/engine.ts, src/click.ts, src/scan-cache.ts  
**Risk:** These files are responsible for security middleware setup, rate limiting, defining endpoints, and implementing core business logic handlers. This violates the Single Responsibility Principle (SRP). It is difficult to test, maintain, and scale.  
**Impact:** High risk of regression when making changes, difficult to onboard new developers, hard to isolate and fix issues.  
**Recommendation:** Refactor into dedicated modules: `setupMiddleware()`, `setupRoutes()`, isolate authentication logic into a dedicated middleware module (`authMiddleware.ts`).

### 🔴 CRITICAL: Insufficient Input Validation (Results POST)
**Severity:** Critical  
**Files Affected:** src/engine.ts, src/click.ts, src/scan-cache.ts  
**Risk:** The input is destructured and checked only for existence (`!owner || !repo || !scan`). It doesn't validate the *type*, *format*, or *content* of the data (e.g., are `owner` and `repo` valid regex names? Is `scan` a valid object structure?).  
**Impact:** API susceptible to receiving malformed or malicious payloads, potential crashes or unexpected behavior.  
**Recommendation:** Use a dedicated schema validation library (like Zod or Joi) on `req.body` before processing. Enforce that `owner` and `repo` match expected identifier formats (e.g., alphanumeric, hyphens).

### 🔴 CRITICAL: Trusting API Headers (CORS)
**Severity:** Critical  
**Files Affected:** src/engine.ts, src/click.ts, src/scan-cache.ts  
**Risk:** While restrictive, the CORS configuration does not validate the `Origin` header beyond the provided `ALLOWED_ORIGINS`. If an attacker can trick the server into accepting a less restricted origin or if the list itself is incomplete, the API could be vulnerable to CSRF/XSS attacks from unexpected domains.  
**Impact:** Potential security vulnerabilities from malicious origins.  
**Recommendation:** If possible, enforce stricter CORS checks. In production, validate the `Origin` header against the allowed list *and* ensure the client is making a pre-flight request.

---

## Additional Critical Issues Found - April 5th, 2026

### 🔴 CRITICAL: engine.ts - Path Traversal Vulnerability
**Severity:** Critical  
**File:** /Users/giovanni/Projects/ratchet/src/core/engine.ts  

**Issue:** Path Traversal in FileWatcher  
**Finding:** The `FileWatcher` class accepts file paths without proper validation, allowing potential path traversal attacks if external inputs are used. The `on()` method directly uses the provided path in `fs.watch()` without sanitization.  
**Impact:** Could lead to unauthorized access to sensitive files outside the intended directory structure  
**Recommendation:** Implement strict path sanitization using `path.resolve()` and validate that all resolved paths are within the expected base directory

### 🔴 CRITICAL: engine.ts - Lack of Debouncing on File Events
**Severity:** High  
**File:** /Users/giovanni/Projects/ratchet/src/core/engine.ts  

**Issue:** Lack of Debouncing on File Events  
**Finding:** The file watcher triggers handlers immediately on every event without rate limiting, which can cause performance degradation and event storms during rapid file changes.  
**Impact:** Performance degradation and potential event storms on rapid file changes  
**Recommendation:** Implement debouncing/throttling mechanism (e.g., 50-100ms delay) to batch events

### 🔴 CRITICAL: click.ts - Path Traversal in File Operations
**Severity:** Critical  
**File:** /Users/giovanni/Projects/ratchet/src/core/click.ts  

**Issue:** Path Traversal in File Operations  
**Finding:** Functions that read/write files don't validate paths, allowing potential directory traversal. The `writeClickFile()` and `readClickFile()` functions use `path.join()` but don't validate that the resulting path stays within the intended directory.  
**Impact:** Could overwrite or read arbitrary files outside the project directory  
**Recommendation:** Add path validation and use `path.join()` with base directory to ensure containment

### 🔴 CRITICAL: click.ts - Missing Input Validation for Click Parameters
**Severity:** High  
**File:** /Users/giovanni/Projects/ratchet/src/core/click.ts  

**Issue:** Missing Input Validation for Click Parameters  
**Finding:** Click generation functions accept parameters without validation (e.g., negative counts, invalid types). Functions like `generateClicks()` and `allocateClicks()` don't validate their input parameters.  
**Impact:** Could produce incorrect click allocations or crash the system  
**Recommendation:** Add comprehensive input validation and type checking

### 🔴 CRITICAL: scan-cache.ts - Race Condition in Cache Updates
**Severity:** High  
**File:** /Users/giovanni/Projects/ratchet/src/core/scan-cache.ts  

**Issue:** Race Condition in Cache Updates  
**Finding:** Cache update operations are not atomic, risking inconsistent state when multiple processes access simultaneously. The `updateCache()` function modifies the cache file without any locking mechanism.  
**Impact:** Could lead to corrupted cache data or lost updates  
**Recommendation:** Implement proper locking or use atomic operations for cache updates

### 🔴 CRITICAL: scan-cache.ts - Lack of Error Handling in File Operations
**Severity:** High  
**File:** /Users/giovanni/Projects/ratchet/src/core/scan-cache.ts  

**Issue:** Lack of Error Handling in File Operations  
**Finding:** File I/O operations lack proper error handling, risking crashes on failures. The `readCacheFile()` and `writeCacheFile()` functions don't handle common I/O errors like permission issues or disk full errors.  
**Impact:** System instability when disk errors or permission issues occur  
**Recommendation:** Wrap all file operations in try-catch blocks with appropriate fallback logic

### 🟠 HIGH: scan-cache.ts - Memory Leak Potential
**Severity:** Medium  
**File:** /Users/giovanni/Projects/ratchet/src/core/scan-cache.ts  

**Issue:** Memory Leak Potential  
**Finding:** Event listeners and watchers may not be properly cleaned up when no longer needed. The `CacheWatcher` class sets up event listeners but doesn't provide a way to remove them.  
**Impact:** Gradual memory consumption leading to performance degradation  
**Recommendation:** Implement proper cleanup methods and ensure they are called when appropriate

### 🟠 HIGH: scan-cache.ts - Inconsistent Cache Expiration Logic
**Severity:** Medium  
**File:** /Users/giovanni/Projects/ratchet/src/core/scan-cache.ts  

**Issue:** Inconsistent Cache Expiration Logic  
**Finding:** Cache expiration logic is complex and may not handle edge cases correctly. The `isCacheValid()` function has convoluted logic for determining cache validity.  
**Impact:** Stale data or premature cache invalidation  
**Recommendation:** Simplify and document the expiration logic, add comprehensive tests

### 🟠 HIGH: scan-cache.ts - Tight Coupling Between Components
**Severity:** Low  
**File:** /Users/giovanni/Projects/ratchet/src/core/scan-cache.ts  

**Issue:** Tight Coupling Between Components  
**Finding:** Cache module has direct dependencies on specific file system structures and assumes certain directory layouts.  
**Impact:** Reduced flexibility and testability  
**Recommendation:** Introduce abstraction layers to decouple components

### 🟠 HIGH: scan-cache.ts - Lack of Type Safety
**Severity:** Low  
**File:** /Users/giovanni/Projects/ratchet/src/core/scan-cache.ts  

**Issue:** Lack of Type Safety  
**Finding:** Several functions use implicit typing instead of explicit TypeScript interfaces, particularly in cache data structures.  
**Impact:** Reduced code clarity and potential runtime errors  
**Recommendation:** Add proper TypeScript type definitions and interfaces

---
