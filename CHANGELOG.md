# Changelog

All notable changes to ratchet-run are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.8] - 2025-03-23

### Fixed
- AST-level detection for high false-positive scanner rules (empty catches, hardcoded secrets, console.log)
- Comment-only catch bodies now treated as documented intent, not empty catches
- Context-aware scanner strips comments and string literals before regex matching
- Scanner false positives in `explanations.ts` and other internal files

### Added
- Pre-validation gate: torque skips targets that fail pre-scan validation (reduces wasted clicks)
- File classification: production / docs / test / config — code quality rules skip non-production files
- Proactive `--architect` recommendation when structural/cross-cutting issues dominate scan output

## [1.0.7] - 2025-02-XX

### Added
- Swarm v2: MiroFish intelligence — agent personalities, debate rounds, social learning between agents
- Self-evolving strategy: autoresearch meta-learning, agents adapt prompts based on prior click outcomes
- `--mode feature`: graph-aware feature builder engine
- Deep GitNexus integration: blast radius, execution flows, and risk scoring injected into click prompts
- `--timeout` and `--budget` flags: hard limits on wall time and token spend
- Plateau detection and `--stop-on-regression` for automatic early exit
- Background mode: `--background` flag + `ratchet stop` command
- Context pruning (`--fast`): strips low-signal file content to reduce token cost per click
- Auto-checkpoint after every click; auto-resume on rerun
- Graceful shutdown and `--resume` for interrupted runs
- Score-aware click prioritization: torque targets highest-ROI categories by default
- Per-click category breakdown: shows which scoring dimensions moved each click
- Adaptive escalation: auto-switches to cross-file sweep on stall
- Architect mode auto-escalation: `--architect` flag, auto-escalates on score ceiling
- Named guard profiles: `tight` / `refactor` / `broad` / `atomic` with CLI flag and per-target config
- `--parallel N`: multi-spec parallel execution

## [1.0.6] - 2025-01-XX

### Added
- `ratchet improve` command: multi-sweep scan→fix→rescan→report loop
- PDF report export with score hero, sparklines, top wins, and timeline
- Scan cache: true incremental scanning with per-file baselines
- Pre-commit validation + dynamic click allocation
- Cross-cutting issue detection: classifies single-file vs cross-cutting vs architectural issues
- Sweep engine overhaul: relaxed guards, multi-file batching, score-aware priority, `--category` flag
- `ratchet vision`: interactive Cytoscape.js dependency graph with quality scores and cyberpunk theme
- `ratchet badge`: SVG score badge generation + README snippet
- PR comment: auto-generated score cards on torque commits
- `--scope` flag: git-aware scope locking

### Fixed
- Granular scoring thresholds — proportional instead of binary
- Regression guard in architect engine
- Smart stop, ceiling detection, rollback transparency

## [1.0.5] - 2024-12-XX

### Added
- Quality gates: `--fail-on <score>` exits with code 1 below threshold
- Per-category gates: `--fail-on-category Security=12`
- `--explain` flag: human-readable why/fix explanations per subcategory
- Scoring overhaul: Grok-informed weight rebalance across 12 subcategories
- Anonymous telemetry (opt-out via env var)
- Stats API endpoint

## [1.0.4] - 2024-11-XX

### Added
- Stripe license validation: tier enforcement via license key
- `ratchet login` / `ratchet logout` commands
- Welcome page with license key delivery
- Cloudflare Worker API for license delivery and Stripe webhook

### Fixed
- Tier mapping from Stripe metadata
- License validation endpoint (POST→GET)

## [1.0.3] - 2024-11-XX

### Fixed
- npm package name corrected (`ratchet-run`)
- License key references and welcome page flags
- Version bump and lockfile sync

## [1.0.2] - 2024-11-XX

### Changed
- Package renamed from `ratchet-cli` to `ratchet-run` for npm publish

## [1.0.1] - 2024-10-XX

### Added
- GitHub Action (`action.yml`): quality gate scans in CI
- Composite action with bash entrypoint, PR comment posting, badge URL output
- `ratchet report` command: run history and summary
- HTML-based PDF report with Puppeteer (dark theme)

## [1.0.0] - 2024-10-XX

### Added
- `ratchet scan`: production readiness score (0–100) across 6 categories
  - Testing (25 pts): coverage ratio, edge cases, test quality
  - Security (15 pts): secrets, input validation, auth & rate limiting
  - Type Safety (15 pts): strict config, any-type density
  - Error Handling (20 pts): coverage, empty catches, structured logging
  - Performance (10 pts): async patterns, console cleanup, import hygiene
  - Code Quality (15 pts): function length, line length, dead code, duplication
- `ratchet torque`: click-loop engine — scan → propose → build → test → commit
- `ratchet init`: zero-config auto-detection and `.ratchet.yml` generation
- `ratchet status`: show current run state and score
- `ratchet log`: view click history with markdown rendering
- `ratchet tighten`: `--pr` flag to open GitHub PRs
- GitNexus knowledge graph integration
- `.ratchetignore` support
- Multi-provider AI: Anthropic, OpenRouter, OpenAI
- Click guards: reject over-aggressive changes before running tests
- Swarm mode (competing agents + debate)
- `ratchet stop` command

## [0.1.0] - 2024-09-XX

### Added
- Initial release
- `scan`, `torque`, `init`, `status`, `log`, `tighten` commands
- Core scan engine and torque click loop
- Basic CLI with Commander.js
