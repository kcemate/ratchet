# Architecture

This document describes how Ratchet is put together: the major subsystems, how a
scan and an auto-fix actually flow through the code, and the design invariants that
keep auto-fix safe. File paths point at the real modules so you can read along.

## Design goals

1. **Local-first and deterministic by default.** A plain `ratchet scan` does static
   analysis on your machine with no network calls. LLM features are opt-in and BYOK.
2. **Auto-fix can only ratchet the score upward.** Like a wrench that turns one way,
   a fix is kept only if it builds and the full test suite still passes — otherwise it
   is reverted. The score is monotonic by construction.
3. **Pluggable engines and providers.** The scoring engine (deterministic vs.
   LLM-assisted) and the model provider are both chosen at runtime behind interfaces,
   so neither the CLI nor the scan pipeline depends on a concrete implementation.

## High-level flow

```
                 ┌──────────────────────────────────────────────┐
   ratchet CLI   │  src/index.ts  (commander)                    │
   (commander)   │  init · scan · report · graph · push · …      │
                 │  optional: ratchet-pro plugin (improve/deep)  │
                 └───────────────┬──────────────────────────────┘
                                 │  command invokes scanner
                                 ▼
                 ┌──────────────────────────────────────────────┐
   Scan          │  src/core/scanner/   (runScan, gates,         │
   orchestration │  baseline)                                    │
                 └───────────────┬──────────────────────────────┘
                                 │  createEngine(mode, config)
                                 ▼
        ┌────────────────── src/core/engine-router.ts ──────────────────┐
        │  mode arg → RATCHET_ENGINE env → .ratchet.yml → default        │
        ▼                                                                ▼
 ┌──────────────────────┐                            ┌──────────────────────────┐
 │ ClassicEngine        │                            │ DeepEngine                │
 │ deterministic, local │                            │ LLM-assisted, opt-in/BYOK │
 │ AST via ts-morph     │                            │ providers/ (Anthropic,    │
 │ engines/classic-*    │                            │ OpenAI, Ollama, …)        │
 └──────────┬───────────┘                            └──────────────────────────┘
            │  6-category weighted score (0–100)
            ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ Auto-fix "click" loop  —  src/core/click.ts                                    │
 │  pick highest-impact finding → agent/AST transform writes fix →                │
 │  build + progressive test gates → adversarial re-check → commit OR rollback    │
 └──────────────────────────────────────────────────────────────────────────────┘
```

## Subsystems

### CLI layer — `src/index.ts`, `src/commands/`

A [commander](https://github.com/tj/commander.js) program registers the free-tier
commands (`init`, `scan`, `report`, `vision`, `badge`, `build`, `status`, `log`,
`stop`, `push`, `quick-fix`, `graph`). Paid commands (`improve`, deep scan) are not
bundled: at startup the CLI attempts `import("ratchet-pro")` and, if present, lets the
plugin register its own commands. This keeps the open-source core fully usable on its
own while leaving a clean extension seam.

### Scan orchestration — `src/core/scanner/`

`runScan` is the entry point the `scan` command calls. It collects the target files,
runs them through the selected engine, applies quality **gates** (per-category
thresholds parsed from CLI/config) and compares against a saved **baseline** so CI can
fail a PR that regresses the score.

### Engine router — `src/core/engine-router.ts`

A small factory that returns a `ScanEngine` implementation. Resolution order is
explicit `mode` argument → `RATCHET_ENGINE` env var → `scan.engine` in `.ratchet.yml`
→ default `classic`. The `deep` path additionally resolves a model provider.

### Classic engine — `src/core/engines/classic*.ts`

The deterministic scorer. It parses TypeScript/JavaScript with `ts-morph`, detects
frameworks, and produces a **0–100 score across six weighted categories** (see
`classic-scoring.ts`):

| Category       | Weight | Scorer function      |
| -------------- | ------ | -------------------- |
| Testing        | 25     | `scoreTests`         |
| Error Handling | 20     | `scoreErrorHandling` |
| Security       | 15     | `scoreSecurity`      |
| Type Safety    | 15     | `scoreTypes`         |
| Code Quality   | 15     | `scoreCodeQuality`   |
| Performance    | 10     | `scorePerformance`   |

Each scorer returns a `CategoryResult` with the points lost and the specific
files/lines responsible, which is what `scan --explain-deductions` renders.

### Deep engine & providers — `src/core/engines/deep*.ts`, `src/core/providers/`

The opt-in LLM-assisted path. Providers (`anthropic`, `openai`, `ollama-cloud`,
`openrouter`, `local`, …) implement a common `Provider` interface behind a `router`,
so the engine is provider-agnostic and the user supplies their own key (BYOK). Only the
code under analysis is sent — never the whole repo.

### Auto-fix "click" loop — `src/core/click.ts`

The most safety-critical subsystem. One "click" = one attempted improvement:

1. **Select** the highest-impact finding from the backlog.
2. **Fix** it — either a deterministic **AST transform** (`src/core/transforms/`:
   `add-catch-handler`, `add-type-annotations`, `remove-dead-code`,
   `remove-unused-imports`, `replace-console`, `wrap-async`) or an LLM **agent**
   (`src/core/agents/`) for changes that need semantic understanding.
3. **Gate** — rebuild and run **progressive test gates** (`test-isolation.ts`):
   affected tests first, then the full suite.
4. **Adversarially re-check** — a red-team pass (`adversarial.ts`) guards against a
   "fix" that merely deletes the failing test or weakens an assertion.
5. **Commit or roll back** — only a change that builds _and_ keeps every test green is
   committed (`git.ts`). Anything else is reverted with a typed `RollbackReason`.

This is why the score can only move up: a regression never survives the gate.

### Registry / API — `src/registry/`

A small Express + SQLite service (`client`, `db`, `routes`, `api-keys`) backing license
validation for Pro features. The open-source core never calls home for a plain scan.

### GitHub Action — `action/`

A composite action (`action.yml`, `entrypoint.sh`) plus ready-to-copy workflow examples
(`pr-quality-gate.yml`, `nightly-scan.yml`, `badge-only.yml`) for running Ratchet as a
PR quality gate or scheduled scan.

## Quality bar

- **3,500+ tests** run under [vitest](https://vitest.dev) (`tests/`, `src/**/__tests__/`).
- **CI** (`.github/workflows/ci.yml`) runs typecheck → lint → test → build on every push
  and PR, then a **self-audit** job that runs `ratchet scan` on Ratchet itself —
  the project is its own most demanding test case.
