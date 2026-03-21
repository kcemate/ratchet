# Ratchet Code Quality Scan

A GitHub Action that scans your codebase with [ratchet-run](https://github.com/samloux/ratchet) and gates your build on a production readiness score.

**Features:**
- 📊 Overall score (0–100) with a shields.io dynamic badge
- 🚫 Optional build gate via `threshold` input
- 🏷️ Per-category gates (`Security=12,Testing=20`)
- 💬 Automatic PR comment with score summary and category breakdown
- ⚙️ Fully composite — bring your own Node version

---

## Usage

### 1 — Basic scan (no gating)

```yaml
- uses: giovanni-labs/ratchet-code-quality-scan@v1
  with:
    working-directory: .
    version: latest
```

### 2 — Gate on minimum score

Fails the workflow if the overall score drops below 60:

```yaml
- uses: giovanni-labs/ratchet-code-quality-scan@v1
  with:
    threshold: 60
    version: latest
```

### 3 — Per-category gates

Each listed category is gated independently. The scan fails if *any* category falls below its threshold:

```yaml
- uses: giovanni-labs/ratchet-code-quality-scan@v1
  with:
    category-thresholds: "Security=15,Testing=20,Performance=10"
    version: latest
```

### 4 — Threshold + category gates combined

Both checks run. The action exits non-zero if *either* fails:

```yaml
- uses: giovanni-labs/ratchet-code-quality-scan@v1
  with:
    threshold: 50
    category-thresholds: "Security=12,Testing=20"
    version: latest
```

### 5 — Explain mode + PR comment

`explain: true` passes `--explain` to ratchet, enabling category-level detail in the JSON output (used to build the PR comment table):

```yaml
- uses: giovanni-labs/ratchet-code-quality-scan@v1
  with:
    explain: true
    threshold: 60
    version: latest
```

> **Note:** ratchet-run must be configured for the target repository (e.g. via `.ratchet-config.json` or equivalent).

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `threshold` | No | `""` | Minimum overall score (0–100). Action exits non-zero if score is below this value. |
| `category-thresholds` | No | `""` | Comma-separated `"Category=Score"` pairs, e.g. `"Security=12,Testing=20"`. Each category is gated independently. |
| `explain` | No | `false` | Pass `--explain` to ratchet scan. Enables category details in the JSON output. |
| `working-directory` | No | `.` | Directory to run the scan in, relative to the repository root. |
| `version` | No | `latest` | ratchet-run version to install. Accepts any npm tag or semver. |

---

## Outputs

| Output | Description |
|---|---|
| `score` | Overall ratchet score (0–100) parsed from the JSON output. |
| `json` | Absolute path to `ratchet-scan.json` written to the working directory. |
| `badge-url` | shields.io dynamic badge URL that reads `$.score` from the committed JSON file. |
| `pr-comment-id` | GitHub API ID of the posted PR comment. Empty string if not in a PR context. |

---

## Example Workflows

### Full CI gate

```yaml
name: Code Quality

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ratchet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Ratchet scan
        id: ratchet
        uses: giovanni-labs/ratchet-code-quality-scan@v1
        with:
          threshold: 60
          category-thresholds: "Security=12,Testing=20"
          explain: true
          version: latest

      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: ratchet-report
          path: ${{ steps.ratchet.outputs.json }}
          retention-days: 30
```

### Using the badge output in a subsequent step

```yaml
- name: Print badge URL
  run: echo "Badge: ${{ steps.ratchet.outputs.badge-url }}"
```

### Matrix across multiple packages

```yaml
jobs:
  scan:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        dir: ["packages/api", "packages/web", "packages/shared"]
    steps:
      - uses: actions/checkout@v4

      - uses: giovanni-labs/ratchet-code-quality-scan@v1
        id: ratchet
        with:
          working-directory: ${{ matrix.dir }}
          threshold: 50
          version: latest
```

---

## Badge Integration

The `badge-url` output is a shields.io dynamic badge that reads `$.score` directly from the committed `ratchet-scan.json` on the default branch.

### Markdown

```markdown
![Ratchet Score](https://img.shields.io/badge/dynamic/json?color=informational&label=Ratchet+Score&query=$.score&url=https%3A%2F%2Fraw.githubusercontent.com%2FYOUR_ORG%2FYOUR_REPO%2Fmain%2Fratchet-scan.json)
```

### HTML

```html
<img src="https://img.shields.io/badge/dynamic/json?color=informational&label=Ratchet+Score&query=$.score&url=https%3A%2F%2Fraw.githubusercontent.com%2FYOUR_ORG%2FYOUR_REPO%2Fmain%2Fratchet-scan.json" alt="Ratchet Score" />
```

### shields.io dashboard

```
https://img.shields.io/badge/dynamic/json?color=informational&label=Ratchet+Score&query=$.score&url=https%3A%2F%2Fraw.githubusercontent.com%2F<ORG>%2F<REPO>%2F<BRANCH>%2F<WORKING_DIRECTORY>%2Fratchet-scan.json
```

> **Prerequisite:** `ratchet-scan.json` must be committed to the default branch for the badge to resolve. Add `ratchet-scan.json` to `.gitignore` in intermediate runs, then commit only on main/merge.

---

## PR Comment

When the action runs on a `pull_request` event and the `GITHUB_TOKEN` is available, it posts a comment to the PR with:

- Overall score and pass/fail status
- A clickable badge
- Per-category score table (if `explain: true` or the JSON contains categories)
- The configured thresholds

Only one comment is created per run (subsequent runs add new comments; you can manage them via the GitHub UI).

---

## Requirements

- [ratchet-run](https://github.com/samloux/ratchet) must be compatible with your repository (run `ratchet scan` locally first to validate your configuration).
- `jq` or `node` must be available in the runner for JSON parsing (both are pre-installed on GitHub's `ubuntu-latest`, `macos-latest`, and `windows-latest` images).
- Node.js is required to install and run ratchet-run.
