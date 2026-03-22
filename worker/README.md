# Ratchet Badge Worker

Cloudflare Worker that serves live SVG badges for [Ratchet](https://ratchetcli.com) code quality scores.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/badge/{owner}/{repo}` | Overall score badge |
| `GET` | `/badge/{owner}/{repo}/{category}` | Per-category badge |
| `GET` | `/badge/{owner}/{repo}/trend` | Score delta badge |
| `GET` | `/api/scores/{owner}/{repo}` | JSON score data |
| `POST` | `/api/push` | Push scan results (authenticated) |

### Badge categories

`testing` · `security` · `error-handling` · `type-safety` · `performance` · `code-quality`

### Query parameters

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `style` | `flat`, `flat-square`, `for-the-badge` | `flat` | Badge style |
| `label` | any string | `ratchet` | Override left-side label |
| `branch` | branch name | default branch | Pin to a specific branch |

### README examples

```markdown
![Ratchet Score](https://ratchetcli.com/badge/myorg/myrepo)
![Testing](https://ratchetcli.com/badge/myorg/myrepo/testing)
![Security](https://ratchetcli.com/badge/myorg/myrepo/security)
![Trend](https://ratchetcli.com/badge/myorg/myrepo/trend)
```

## Authentication

`POST /api/push` requires a `Bearer` token in the `Authorization` header:

```
Authorization: Bearer <API_KEY>
```

Set the key via `wrangler secret put API_KEY` — never commit it.

## POST /api/push payload

```json
{
  "owner": "myorg",
  "repo": "myrepo",
  "branch": "main",
  "score": 92,
  "maxScore": 100,
  "categories": {
    "testing":          { "score": 22, "max": 25 },
    "security":         { "score": 14, "max": 15 },
    "error-handling":   { "score": 12, "max": 15 },
    "type-safety":      { "score": 14, "max": 15 },
    "performance":      { "score": 13, "max": 15 },
    "code-quality":     { "score": 17, "max": 15 }
  },
  "timestamp": "2026-03-22T00:00:00Z"
}
```

## Color scale

| Score | Color |
|-------|-------|
| 90–100 | brightgreen `#44cc11` |
| 75–89  | green `#97ca00` |
| 60–74  | yellow `#dfb317` |
| 40–59  | orange `#fe7d37` |
| 0–39   | red `#e05d44` |

For category badges, color is based on `score / max * 100`.

## KV storage

Namespace binding: `RATCHET_SCORES`

| Key | Value |
|-----|-------|
| `{owner}/{repo}` | `{ current: ScanResult, previous?: ScanResult }` |
| `{owner}/{repo}/history` | `ScanResult[]` (last 90 scans) |

## Setup

```bash
# Install dependencies
npm install

# Create KV namespaces
wrangler kv:namespace create RATCHET_SCORES
wrangler kv:namespace create RATCHET_SCORES --preview

# Update wrangler.toml with the returned IDs

# Set API key secret
wrangler secret put API_KEY

# Local development
npm run dev

# Deploy
npm run deploy
```

## Tests

```bash
npm test
```

Tests cover SVG generation (color scale, text measurement, all badge types and styles) and all HTTP routes (auth, push, scoring, badge serving).
