# Ratchet Feature Spec — Grok 4.2 Feedback (2026-03-19)

Source: Grok 4.2 reasoning review of DD architect mode failures (86→86 after 5 clicks, 3 rolled back).

## Problem Statement
Ratchet has a binary guard model (normal: 3 files/40 lines vs architect: 20 files/500 lines). Cross-cutting issues (logging migration, deduplication) fall in the gap — too broad for normal, too aggressive for architect. Result: wasted clicks and no score movement.

---

## Feature 1: Guard Profiles (`--guards <profile>`)

**Current state:** `--maxLines` and `--maxFiles` flags exist but are hidden/undocumented. Architect hardcodes 20/500, sweep uses 10/120.

**Proposal:** Named guard profiles in `.ratchet.yml` + a `--guards` CLI flag.

```yaml
guard_profiles:
  tight:        # current normal default
    maxFiles: 3
    maxLines: 40
  refactor:     # Grok's recommended sweet spot
    maxFiles: 12
    maxLines: 280
  broad:        # current architect default
    maxFiles: 20
    maxLines: 500
  atomic:       # no guards, test suite is only gate
    maxFiles: null
    maxLines: null
```

CLI: `ratchet torque --guards refactor` or `ratchet torque --maxFiles 12 --maxLines 280`

Per-target override:
```yaml
targets:
  - name: logging-cleanup
    path: server/
    guards: refactor
```

**Implementation:** Modify `click.ts` guard resolution to check: CLI flag > target config > profile name > mode defaults.

---

## Feature 2: Planning Click (`--plan-first`)

**Problem:** Agent jumps straight to code changes without understanding the full scope. Cross-cutting fixes need a plan.

**Proposal:** When `--plan-first` is set, click 0 is a read-only analysis click:
1. Agent gets the scan results + all target files
2. Agent outputs a structured JSON plan: which files to touch, what patterns to extract, dependency order
3. Plan is saved to `.ratchet/plans/<timestamp>.json`
4. Subsequent execution clicks receive the plan as context
5. Plan click does NOT count toward click budget

**Plan schema:**
```json
{
  "strategy": "extract-then-propagate",
  "steps": [
    {
      "order": 1,
      "action": "Create server/lib/common.ts with shared response wrappers",
      "files": ["server/lib/common.ts"],
      "estimatedLines": 80
    },
    {
      "order": 2, 
      "action": "Replace duplicated patterns in route files with imports from common.ts",
      "files": ["server/routes/groups.ts", "server/routes/deuces.ts", "..."],
      "estimatedLines": -200
    }
  ],
  "expectedScoreDelta": "+4-6"
}
```

**Implementation:** New `runPlanningClick()` in engine.ts. Uses existing agent infra but with a planning-specific prompt and `--no-commit` flag.

---

## Feature 3: Cross-Cutting Issue Detection

**Problem:** Ratchet scans per-file but scores project-wide. When 36 console.* calls are spread across 14 files, normal torque (3 file limit) literally cannot fix it. The user doesn't know this until they waste clicks.

**Proposal:** After scan, classify each issue category as:
- `single-file` — fixable within one file (dead code, empty catches)
- `cross-cutting` — spans N files, needs broad access (logging, duplication)
- `architectural` — needs new abstractions (god functions, missing patterns)

Show this in the scan output:
```
📊 Score: 86/100

  ⚠ Cross-cutting issues detected:
    Structured logging (36 hits across 14 files) — needs --guards refactor or --architect
    Duplication (687 lines across 8 file pairs) — needs extract-then-propagate plan
    
  ✅ Single-file issues (fixable with normal torque):
    Function length (73 functions in individual files)
    Line length (235 lines in individual files)
```

Auto-recommend the right mode:
```
  💡 Recommended: ratchet torque --plan-first --guards refactor -c 5
```

**Implementation:** New `classifyCrossCutting()` in `scan.ts`. Group issues by category, count unique files per category. If files > maxFiles guard → flag as cross-cutting.

---

## Feature 4: Per-Click Category Breakdown

**Current:** `Score: 86 → 86 (±0) — 16 issues fixed` — useless when issues fixed are in maxed categories.

**Proposal:** Show which scoring categories changed:
```
✔ Click 4 — Score: 86 → 88 (+2)
   Structured logging: 3/7 → 5/7 (+2) — 12 console.* replaced with pino
   Function length: 3/4 → 3/4 (±0) — no change
   ⚠ Type safety: 15/15 → 15/15 — 16 issues fixed but category already maxed
```

Highlight wasted effort: if a click fixes issues in a maxed category, flag it so the engine can learn to prioritize unfixed categories.

**Implementation:** Compare `scan.categories` before/after click. Already have both scans in engine.ts — just need to diff and format.

---

## Feature 5: Smart Cross-Cutting Escalation

**Current escalation trigger:** 2+ rollbacks AND all remaining backlog items have `architectPrompt`.

**Proposed additional trigger:** When remaining unfixed issues are cross-cutting (span > current maxFiles guard), auto-suggest or auto-escalate to a broader guard profile.

```
[ratchet] ⚠ Remaining issues span 14 files but guard allows 3. 
          Escalating to refactor profile (12 files / 280 lines).
```

Also: if a click keeps getting rolled back for "too many lines changed", automatically try the next guard profile up instead of wasting the click.

**Implementation:** Track rollback reasons in engine loop. If 2+ rollbacks for guard violations → bump to next profile tier. Add `--no-auto-guards` to disable.

---

## Priority Order

1. **Per-click category breakdown** (Feature 4) — cheapest to build, immediately useful
2. **Cross-cutting detection** (Feature 3) — informs everything else
3. **Guard profiles** (Feature 1) — already half-built with `--maxLines`/`--maxFiles`
4. **Planning click** (Feature 2) — highest impact for hard problems
5. **Smart escalation** (Feature 5) — builds on 1+3

## Estimated Effort
- Feature 1: ~2 hours (mostly config parsing + CLI wiring)
- Feature 2: ~4 hours (new engine mode + prompt engineering)
- Feature 3: ~3 hours (scan analysis + output formatting)
- Feature 4: ~1 hour (diff two scan results, format output)
- Feature 5: ~2 hours (engine loop modification)

Total: ~12 hours of agent work (~2 ratchet runs of 7 clicks each, ironically)
