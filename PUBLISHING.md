# Publishing @ratchet-run/cli to npm

## Prerequisites

- npm account with access to the `@ratchet-run` org
- `npm login` completed locally

## Build

```bash
npm run build
```

Compiled output lands in `dist/`. The `prepare` script runs this automatically before `npm publish`.

## Test Locally

```bash
npm link
npx ratchet --help
```

To unlink when done:

```bash
npm unlink -g @ratchet-run/cli
```

## Bump Version

```bash
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0
```

This updates `package.json` and creates a git tag automatically.

## Publish

Scoped packages default to private — pass `--access public`:

```bash
npm publish --access public
```

Or do a dry run first to verify what gets included:

```bash
npm pack --dry-run
```

## Verify After Publish

```bash
npm show @ratchet-run/cli
npx @ratchet-run/cli --help
```
