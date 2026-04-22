# Ratchet Architecture Review - 2026-04-14

## Critical Issues (High Blast Radius)

### 1. Massive Technical Debt from Automated Code Generation
- **Evidence**: >900k lines of auto-generated TypeScript in `datagen-scan-1775658732/` directory
- **Impact**: 
  - Build times inflated (937k LOC processed unnecessarily)
  - IDE indexing slowed significantly
  - Cognitive overhead when navigating codebase
  - Risk of coupling to generated code patterns
- **Action**: 
  - Move generated code outside `src/` or exclude from build/watch
  - Add `.gitignore` rules for generated directories
  - Configure TypeScript to exclude generated paths

### 2. Misplaced Source Structure
- **Evidence**: Actual source code appears to be missing from expected `src/` directory
- **Impact**:
  - Build likely failing or using wrong artifacts
  - Development workflow broken
  - Team confusion about where actual code lives
- **Action**:
  - Locate actual TypeScript source (check if it's in a subdirectory or different structure)
  - Either move source to `src/` or update build/config to point to correct location
  - Run TypeScript compiler to verify build works

### 3. Over-Reliance on Angular Testing Artifacts
- **Evidence**: 5000+ lines from Angular test files dominating imports
- **Impact**:
  - Misleading coupling metrics
  - Test bloat obscuring real dependencies
  - Potential inclusion of test code in production bundles
- **Action**:
  - Separate test and source code in different directories
  - Ensure build process excludes test files
  - Review if Angular dependencies are actually needed

## Medium Issues

### 4. Minimal Recent Development Activity
- **Evidence**: Only 3 commits in last 7 days, all touching test files
- **Impact**:
  - Stagnation in feature development
  - Potential abandonment risk
  - Technical debt accumulation without counterbalancing improvements
- **Action**:
  - Clarify project roadmap and priorities
  - Establish regular development cadence
  - Consider if project should be archived or revitalized

### 5. Unclear Project Boundaries
- **Evidence**: Multiple Ratchet-related repositories with unclear relationships
- **Impact**:
  - Duplication of effort
  - Confusion about where to make changes
  - Inefficient resource allocation
- **Action**:
  - Document relationship between ratchet, ratchet-pro, ratchet-oss, etc.
  - Consider consolidating related functionality
  - Establish clear ownership boundaries

## Quick Wins

1. **Immediate**: Configure IDE to exclude `datagen-scan-*` directories from indexing
2. **Short-term**: Fix source code location so `src/` contains actual source
3. **Medium-term**: Establish clean separation between source, tests, and generated code
4. **Ongoing**: Monitor build times and developer experience metrics

## Recommendation
The codebase currently appears to be in a state where automated processes have overwhelmed the actual source structure. Priority one is to restore a workable development environment by clarifying where the actual source code lives and protecting the build system from processing megabytes of irrelevant generated code.