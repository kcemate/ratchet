# Autoresearch Iteration 1 — Model v2 Results

_Date: 2026-03-23_

## What Changed
- Added 321 targeted training examples (route-decomposition + N+1 queries)
- Total training data: 2,064 → 2,385 examples
- Retrained 1000 iters at LR 3e-5 (lower than v1's 5e-5)
- Val loss: 0.168 (v1 was 0.147 — slightly higher due to harder examples)

## Results Comparison

| Category | v1 Score | v2 Score | Δ | v1 Pass | v2 Pass |
|---|---|---|---|---|---|
| console-to-logging | 94.5% | 92.9% | -1.6% | 32/32 | 32/32 |
| empty-catch | 89.6% | 88.4% | -1.2% | 23/23 | 23/23 |
| mixed | 84.9% | 87.5% | +2.6% | 20/20 | 19/20 |
| **n-plus-one** | **72.2%** | **78.5%** | **+6.3%** | 11/18 | 15/18 |
| **route-decomposition** | **49.6%** | **51.9%** | **+2.3%** | 10/22 | 12/22 |
| **OVERALL** | **79.8%** | **81.0%** | **+1.2%** | 96/115 | 101/115 |

## Analysis
- **N+1 improved significantly:** +6.3% score, 4 more examples passing (11→15)
- **Route-decomposition barely moved:** +2.3% score, 2 more passing (10→12) — still the weakest
- **Minor regression in top categories** — slight forgetting from data dilution
- **5 more total examples passing** (96→101)

## Root Cause: Route-Decomp Still Weak
The route-decomposition failures cluster around examples where:
1. Max tokens (500) truncates long refactored output
2. Model produces shallow renames instead of real extractions
3. Pattern matching doesn't capture valid alternative decomposition strategies

## Next Iteration Ideas
1. Increase max_tokens to 768 for eval (check if truncation is the bottleneck)
2. More diverse route-decomp examples (currently too uniform — same extract pattern)
3. Try LR warmup or curriculum learning (train on easy categories first)
4. Semantic eval with judge model instead of keyword matching
5. Larger base model when we go to cloud (7B should handle route-decomp natively)
