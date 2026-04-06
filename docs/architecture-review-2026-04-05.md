# Architecture Review: Ratchet (April 5, 2026)

## Executive Summary
Ratchet is a **linter with delusions of grandeur** — a sprawling monolith pretending to be an AI-powered code review system. The codebase shows classic signs of organic growth without architectural discipline: god files, tight coupling, and duplicated logic. Recent momentum (7 days: 12 commits) suggests active but chaotic development.

## Key Findings

### 1. God Files That Need Immediate Splitting
- **`src/core/engine.ts` (1,837 lines)** — The nuclear reactor at the center of everything. Imports 41 modules directly, acts as a central coordinator for scanning, detection, and reporting. This file violates single responsibility principle so severely it should be classified as a weapon of mass destruction.
- **`src/commands/torque.ts` (1,548 lines)** — CLI command implementation that's grown to handle business logic, configuration, and output formatting. Should be decomposed into command handlers and service layer.
- **`src/commands/vision.ts` (1,484 lines)** — Similar bloat. Contains vision-specific logic mixed with core scanning infrastructure.

### 2. Coupling Hotspots
The import analysis reveals dangerous centralization:
- **`../core/scanner`** imported 41 times — indicates scanner module is the only thing holding everything together
- **`../core/engine.js`** imported 8 times directly, but everything depends on it indirectly
- **`../core/issue-backlog.js`** imported 11 times — backlog logic is leaking into too many places

The architecture has evolved into a **tightly-coupled spiderweb** rather than a clean layered system.

### 3. Recent Development Momentum Analysis
Last 7 days show **12 commits** with mixed focus:
- ✅ **Positive:** `refactor: decompose classic.ts god file into focused modules` (61df4ae) — someone is finally addressing god files
- ✅ `fix: remove triple duplicate imports in classic.ts` (65ae42e) — cleaning up technical debt
- ✅ `refactor: extract scan.ts core logic to core/scanner/` (4743b34) — moving in right direction
- ❌ **Negative:** `fix(auto): add error logging to config loading in scan command` (ccb38bc) — patching symptoms, not root causes
- ❌ `docs(auto): improve map documentation` (55d99b6) — documentation work while architecture burns

The team is **fighting fires while occasionally doing reconstructive surgery** — not a sustainable approach.

## Concrete Refactoring Recommendations

### Tier 1: High-Impact, High-Urgency (Blast Radius: Catastrophic)

**1. Split `engine.ts` immediately**
- **Impact:** 9.5/10 — this file is the single biggest bottleneck
- **Action:** Extract into:
  - `engine-core.ts` — orchestration logic
  - `engine-scanners.ts` — scanner management
  - `engine-detect.ts` — detection coordination
  - `engine-report.ts` — reporting pipeline
- **Success metric:** engine.ts < 500 lines within 1 week

**2. Create proper abstraction layers**
- **Impact:** 9/10 — current architecture has no separation of concerns
- **Action:**
  - Define `Scanner` interface in `core/scanner/`
  - Create `DetectionEngine` service
  - Build `ReportGenerator` service
  - Make CLI commands thin wrappers around services
- **Success metric:** CLI commands < 300 lines, no direct engine.ts imports outside core/

**3. Fix the import coupling crisis**
- **Impact:** 8/10 — 41 imports from scanner indicate it's doing too much
- **Action:**
  - Audit all 41 imports — 30% are likely dead code
  - Move utility functions to proper modules
  - Create `core/scanner/` submodules with focused responsibilities
- **Success metric:** No module imported > 15 times

### Tier 2: Medium-Impact, Medium-Urgency (Blast Radius: Severe)

**4. Address test file bloat**
- Files > 700 lines: `transforms.test.ts`, `repo-probe.test.ts`, `normalize.test.ts`
- **Action:** Split tests by feature area, use test utilities module
- **Impact:** 7/10 — test maintenance is becoming expensive

**5. Clean up duplicate imports**
- Recent commit shows triple duplicates in classic.ts — this pattern likely exists elsewhere
- **Action:** Run ESLint `no-duplicate-imports`, add to CI
- **Impact:** 6/10 — reduces cognitive load, prevents bugs

### Tier 3: Low-Impact, Low-Urgency (Blast Radius: Manageable)

**6. Document the architecture**
- **Action:** Create ARCHITECTURE.md with layered diagram
- **Impact:** 5/10 — prevents future drift

**7. Add dependency injection**
- **Action:** Replace direct module imports with DI container
- **Impact:** 4/10 — over-engineering for current state, but helpful long-term

## Risk Assessment

### Critical Risks (Address in 72 hours)
1. **Engine.ts collapse** — if this file becomes any more complex, it will be impossible to maintain
2. **Coupling cascade** — changes in one module will break unrelated features

### High Risks (Address in 2 weeks)  
1. **Test maintenance cost** — bloated test files slow down development
2. **New developer onboarding** — architecture complexity will drive away contributors

## Conclusion

Ratchet has **potential but is structurally rotten**. The recent refactoring of classic.ts shows good intentions, but the team is treating symptoms while the patient has pneumonia.

**Immediate action required:** Split engine.ts this sprint. Nothing else matters until that god file is decomposed.

---

*Nemtron, CPO — out*