# Contributing to Ratchet

Thanks for your interest! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/kcemate/ratchet.git
cd ratchet
npm ci
npm run build
npm link   # makes `ratchet` available globally
```

## Branching Strategy

- `main` — stable, release-ready
- Feature branches: `feat/<short-description>`
- Fix branches: `fix/<short-description>`
- Phase branches: `fix/phase-N-<slug>`

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add --json output to scan command
fix: handle missing package.json gracefully
docs: update README with self-audit badge
chore: upgrade vitest to latest
```

## Adding a New Scanner

1. Create `src/core/scanners/<name>.ts` implementing the `Scanner` interface.
2. Register it in `src/core/scanners/index.ts`.
3. Add tests in `tests/<name>.test.ts`.
4. Document the scanner in `docs/scanners.md`.

## Running Tests

```bash
npm test           # full suite
npm run lint       # eslint
npm run format:check  # prettier check
npm run typecheck  # tsc --noEmit
```

## Pull Request Process

1. Ensure CI passes (lint, typecheck, test, build).
2. Keep PRs focused — one concern per PR.
3. Add or update tests for any changed behavior.
4. Update documentation if you're adding a feature.

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
