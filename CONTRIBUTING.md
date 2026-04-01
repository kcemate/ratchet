# Contributing to Ratchet

Thanks for your interest in contributing. Ratchet uses Ratchet to improve itself — the `docs/` directory contains logs from real self-improvement runs on this codebase.

---

## Development Setup

```bash
git clone https://github.com/ratchet-run/ratchet
cd ratchet
npm install
npm test
```

**Requirements:** Node.js >=18, npm, git.

### Build

```bash
npm run build     # compile TypeScript → dist/
```

### Test

```bash
npm test          # run Vitest test suite
```

### Lint / Typecheck

```bash
npx tsc --noEmit  # type-check without emitting
```

### Run locally without installing

```bash
node dist/index.js --help
```

Or link it globally during development:

```bash
npm link
ratchet --help
```

---

## Project Structure

```
src/
  index.ts              CLI entry point (Commander.js setup)
  types.ts              Shared TypeScript interfaces
  commands/
    init.ts             ratchet init
    improve.ts          ratchet improve (the main click loop)
    report.ts           ratchet report (--status, --log, --badge)
    ship.ts             ratchet ship
    map.ts              ratchet map
    auth.ts             ratchet auth
  core/
    engine.ts           Click loop orchestration
    click.ts            Single click execution (analyze → build → test → commit)
    config.ts           .ratchet.yml parser and validation
    git.ts              Git operations
    runner.ts           Test runner abstraction
    logger.ts           Markdown log writer (docs/<target>-ratchet.md)
    lock.ts             Concurrency lock (prevents parallel runs)
    agents/
      base.ts           Agent interface
      shell.ts          ShellAgent — runs AI coding agent via shell command
tests/
  *.test.ts             Vitest test files (mirror src/ structure)
docs/
  *-ratchet.md          Living logs from Ratchet self-improvement runs
```

---

## Architecture

The core abstraction is the **click loop**:

```
for each click:
  1. agent.analyze(context)   → what could be improved?
  2. agent.propose(analysis)  → pick ONE improvement
  3. agent.build(proposal)    → implement it
  4. runner.runTests()        → does it still pass?
  5a. git.commit()            → yes: lock it in
  5b. git.stashPop()          → no: revert (the Pawl)
```

The `Agent` interface is the key extension point:

```typescript
interface Agent {
  analyze(context: string): Promise<string>;
  propose(analysis: string, target: Target): Promise<string>;
  build(proposal: string, cwd: string): Promise<BuildResult>;
}
```

To add a new agent backend, implement this interface and register it in `commands/improve.ts`.

---

## Adding a New Agent Backend

1. Create `src/core/agents/<name>.ts` implementing the `Agent` interface
2. Add the agent name to the `agent` field union type in `src/types.ts`
3. Wire it up in `src/commands/improve.ts` where `ShellAgent` is instantiated
4. Update the `agent` validation in `src/core/config.ts`
5. Add tests in `tests/agents.test.ts`
6. Document it in `docs/configuration.md`

---

## Testing

Tests live in `tests/` and mirror the `src/` structure. We use [Vitest](https://vitest.dev/).

```bash
npm test               # run all tests
npm test -- --watch   # watch mode
```

When adding a new feature:
- Add or update tests in the matching `tests/*.test.ts` file
- The test suite must pass before submitting a PR

When fixing a bug:
- Add a regression test that would have caught the bug

---

## Submitting a PR

1. Fork the repo and create a branch: `git checkout -b feat/my-improvement`
2. Make your changes with tests
3. Run `npm test` — all tests must pass
4. Run `npm run build` — build must succeed
5. Open a PR with a clear description of what changed and why

PR titles follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat: add X`
- `fix: resolve Y`
- `docs: improve Z`
- `refactor: simplify W`

---

## Code Style

- TypeScript throughout — no `any` if avoidable
- Prefer `async/await` over raw Promises
- Use `chalk` for terminal color output
- Keep command files thin — business logic belongs in `core/`
- Friendly error messages: tell the user what went wrong and how to fix it

---

## What Ratchet Uses to Improve Itself

```bash
# Run a self-improvement sprint on the CLI output
ratchet improve --target cli-polish --clicks 7

# Run a self-improvement sprint on error handling
ratchet improve --target error-handling --clicks 7
```

The `docs/` directory contains logs from previous self-runs. Read them to see what kinds of improvements the agent makes.
