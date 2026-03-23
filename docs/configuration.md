# Ratchet Configuration Reference

Ratchet is configured via `.ratchet.yml` in your project root. Run `ratchet init` to generate one automatically with detected settings.

---

## Full Example

```yaml
agent: default
model: claude-sonnet-4-6

defaults:
  clicks: 7
  test_command: npm test
  auto_commit: true

targets:
  - name: error-handling
    path: src/api/
    description: "Improve error handling across all API routes"

  - name: types
    path: src/types/
    description: "Strengthen TypeScript types and remove any casts"

boundaries:
  - path: src/auth/
    rule: no-modify
    reason: "Auth architecture is intentional — Clerk dual-mode"

  - path: "**/*.test.ts"
    rule: preserve-pattern
    reason: "Test structure follows team convention"

  - path: migrations/
    rule: no-delete
    reason: "Migration files are append-only"
```

---

## Top-Level Fields

### `agent`

The AI coding agent backend to use.

| Value | Description |
|-------|-------------|
| `shell` | Runs an AI coding agent via shell command. Default. |
| `claude-code` | Claude Code native integration. |
| `codex` | OpenAI Codex via API. |

```yaml
agent: shell
```

**Default:** `shell`

The `shell` agent runs a command like `claude --print <prompt>` to invoke the AI. It works with any coding agent that accepts `--print` or similar flags for non-interactive use.

---

### `model`

Optional model override, passed to the agent backend.

```yaml
model: claude-sonnet-4-6
```

**Default:** Not set (agent uses its own default model)

The meaning of this field depends on the agent. For the `shell` agent, it's passed as a flag to the underlying command.

---

## `defaults`

Settings that apply to all targets unless overridden at run time.

### `defaults.clicks`

Number of improvement clicks to run per invocation.

```yaml
defaults:
  clicks: 7
```

**Default:** `7`
**Constraints:** Must be a positive integer (≥1).

Override at run time with `--clicks`:

```bash
ratchet torque --target my-target --clicks 3
```

---

### `defaults.test_command`

The shell command used to validate each click. Must exit 0 on success.

```yaml
defaults:
  test_command: npm test
```

**Default:** `npm test`
**Detected automatically by `ratchet init`** based on your project type.

Common values:

| Stack | Command |
|-------|---------|
| Node (npm) | `npm test` |
| Node (yarn) | `yarn test` |
| Node (pnpm) | `pnpm test` |
| Python | `pytest` |
| Go | `go test ./...` |
| Rust | `cargo test` |
| Make | `make test` |

You can use any command that exits 0 on success:

```yaml
test_command: npm run test:unit && npm run lint
```

> **Note:** Whitespace is trimmed. An empty or blank value falls back to `npm test`.

---

### `defaults.auto_commit`

Whether to automatically commit each click that passes tests.

```yaml
defaults:
  auto_commit: true
```

**Default:** `true`

Set to `false` to stage changes without committing — useful if you want to review before committing.

---

## `targets`

A list of named improvement targets. Each target defines where to focus and what to improve.

```yaml
targets:
  - name: error-handling
    path: src/api/
    description: "Improve error handling across all API routes"
```

All three fields are required. Targets with missing fields are silently dropped with a warning.

### `targets[].name`

A short identifier used to reference this target on the command line.

```bash
ratchet torque --target error-handling
```

**Constraints:** Must be non-empty. Use lowercase, hyphens are fine.

---

### `targets[].path`

The file or directory the agent focuses on.

```yaml
path: src/api/
```

Can be a directory (agent considers all files within) or a specific file:

```yaml
path: src/utils/format.ts
```

---

### `targets[].description`

A plain English description of what to improve. This is the primary instruction to the agent.

```yaml
description: "Improve error handling across all API routes"
```

**Write a good description:**
- Be specific about the goal: `"Add null checks and improve error messages"` not `"fix stuff"`
- Mention patterns to look for: `"Replace try/catch swallowing with proper logging"`
- Scope it appropriately: a tight description produces tighter improvements

---

## `boundaries`

Optional. Protects critical paths from agent modification.

```yaml
boundaries:
  - path: src/auth/
    rule: no-modify
    reason: "Auth architecture is intentional"
```

### `boundaries[].path`

The path to protect. Supports glob patterns.

```yaml
path: "**/*.test.ts"
```

---

### `boundaries[].rule`

How the boundary is enforced.

| Rule | Effect |
|------|--------|
| `no-modify` | Agent cannot change any file under this path |
| `no-delete` | Agent cannot delete files under this path |
| `preserve-pattern` | File structure and naming must be preserved |

---

### `boundaries[].reason`

Optional. Documents why the boundary exists. Shown in error messages and logs.

```yaml
reason: "Migration files are append-only by DB convention"
```

---

## Multiple Targets

Define as many targets as you need:

```yaml
targets:
  - name: error-handling
    path: src/api/
    description: "Improve error handling across all API routes"

  - name: types
    path: src/types/
    description: "Strengthen TypeScript types and remove any casts"

  - name: performance
    path: src/db/
    description: "Optimize database queries and reduce N+1 patterns"
```

Run them independently:

```bash
ratchet torque --target error-handling
ratchet torque --target types --clicks 3
ratchet torque --target performance --clicks 10
```

---

## YAML Field Name Conventions

The config file uses `snake_case` for multi-word fields:

| YAML field | Internal name |
|------------|---------------|
| `test_command` | `testCommand` |
| `auto_commit` | `autoCommit` |

This follows standard YAML convention. The CLI and source code use camelCase internally.

---

## Validation Errors

Ratchet validates your config at startup and gives clear error messages:

```
Error loading .ratchet.yml: ...
Run ratchet init to create one.
```

**Common issues:**

| Problem | Fix |
|---------|-----|
| `agent` is not a recognized value | Use `shell`, `claude-code`, or `codex` |
| `clicks` is not a positive integer | Use a whole number ≥1 (e.g. `7`) |
| `test_command` is blank | Provide a valid command or remove the field to use the default |
| Target missing `name`, `path`, or `description` | All three fields are required per target |

---

## .ratchetignore

Place a `.ratchetignore` file in your project root to exclude paths from `ratchet scan` and `ratchet torque`.

### Format

- One path per line
- Lines starting with `#` are comments
- Trailing `/` on directory names is optional (both `vendor` and `vendor/` work)
- Paths are resolved relative to the project root

### Example

```
# Ignore generated code
generated/
proto-gen/

# Ignore a vendored directory
vendor/

# Ignore a specific file
src/legacy/shim.ts
```

### Default exclusions

The following directories are always excluded and do not need to be listed in `.ratchetignore`:

| Directory | Reason |
|-----------|--------|
| `node_modules/` | Third-party dependencies |
| `dist/` | Build output |
| `.git/` | Version control internals |
| `.next/` | Next.js build cache |
| `build/` | Generic build output |
| `coverage/` | Test coverage reports |
| `__pycache__/` | Python bytecode cache |
| `.cache/` | Generic tool caches |
| `vendor/` | Vendored dependencies |
| `out/` | Generic output directory |

---

## .gitignore

Add the state file to `.gitignore`:

```
.ratchet-state.json
```

Commit the log files — they're the receipts for what the agent did:

```
docs/error-handling-ratchet.md   ← commit this
```
