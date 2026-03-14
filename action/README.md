# Ratchet GitHub Action

Autonomously improve your codebase with AI-powered iterative refinement, directly in CI.

Ratchet runs `ratchet torque` against your repo, measures the Production Readiness Score before and after, then opens a pull request with all improvements.

## Quick start

```yaml
- uses: ratchet-dev/ratchet@v1
  with:
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | **yes** | — | OpenRouter, Anthropic (`sk-ant-…`), or OpenAI (`sk-…`) key |
| `target` | no | auto-detect | Directory to improve |
| `clicks` | no | `7` | Number of improvement iterations |
| `mode` | no | `normal` | `normal` or `harden` |
| `license-key` | no | — | Ratchet Pro license key |
| `create-pr` | no | `true` | Open a PR with the improvements |
| `pr-title` | no | `Ratchet: <target> improvements` | Custom PR title |

## Outputs

| Output | Description |
|--------|-------------|
| `pr-url` | URL of the created pull request (empty if `create-pr` is `false`) |
| `score-before` | Production Readiness Score before improvements |
| `score-after` | Production Readiness Score after improvements |
| `clicks-landed` | Number of improvement clicks that landed |

## API key detection

The action auto-detects your provider from the key prefix:

| Prefix | Provider |
|--------|----------|
| `sk-ant-…` | Anthropic |
| `sk-or-…` | OpenRouter |
| `sk-…` | OpenAI |
| other | OpenRouter (default) |

## Examples

### Weekly auto-improvement (recommended)

```yaml
name: Ratchet — Weekly Improvement

on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 09:00 UTC

permissions:
  contents: write
  pull-requests: write

jobs:
  ratchet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: ratchet-dev/ratchet@v1
        with:
          api-key: ${{ secrets.OPENROUTER_API_KEY }}
          clicks: '10'
```

### Hardening mode (security + robustness focus)

```yaml
- uses: ratchet-dev/ratchet@v1
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    mode: harden
    clicks: '5'
    pr-title: 'chore: security hardening via Ratchet'
```

### Target a specific subdirectory

```yaml
- uses: ratchet-dev/ratchet@v1
  with:
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
    target: './packages/api'
    clicks: '7'
```

### Manual trigger with parameters

```yaml
on:
  workflow_dispatch:
    inputs:
      clicks:
        description: 'Improvement iterations'
        default: '7'
      mode:
        description: 'Mode (normal/harden)'
        default: 'normal'

jobs:
  ratchet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - id: ratchet
        uses: ratchet-dev/ratchet@v1
        with:
          api-key: ${{ secrets.OPENROUTER_API_KEY }}
          clicks: ${{ inputs.clicks }}
          mode: ${{ inputs.mode }}

      - run: |
          echo "Score: ${{ steps.ratchet.outputs.score-before }} → ${{ steps.ratchet.outputs.score-after }}"
          echo "PR: ${{ steps.ratchet.outputs.pr-url }}"
```

### Without PR (apply changes directly)

```yaml
- uses: ratchet-dev/ratchet@v1
  with:
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
    create-pr: 'false'

- uses: stefanzweifel/git-auto-commit-action@v5
  with:
    commit_message: 'chore: ratchet improvements'
```

### Pro users

```yaml
- uses: ratchet-dev/ratchet@v1
  with:
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
    license-key: ${{ secrets.RATCHET_LICENSE_KEY }}
    clicks: '20'
```

## Required permissions

```yaml
permissions:
  contents: write      # push improvement branch
  pull-requests: write # open PR
```

## See also

- [Full example workflow](./examples/ratchet.yml)
- [Ratchet CLI docs](../README.md)
