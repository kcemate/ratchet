#!/bin/bash
# run.sh — composite action entry point for ratchet-code-quality-scan
# https://github.com/giovanni-labs/ratchet-code-quality-scan

set -euo pipefail

# ─── Inputs ───────────────────────────────────────────────────────────────────
THRESHOLD="${INPUT_THRESHOLD:-}"
CATEGORY_THRESHOLDS="${INPUT_CATEGORY_THRESHOLDS:-}"
EXPLAIN="${INPUT_EXPLAIN:-false}"
WORKING_DIRECTORY="${INPUT_WORKING_DIRECTORY:-.}"
VERSION="${INPUT_VERSION:-latest}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}"
GITHUB_SHA="${GITHUB_SHA:-}"
GITHUB_REF="${GITHUB_REF:-}"
GITHUB_EVENT_NAME="${GITHUB_EVENT_NAME:-}"
GITHUB_ACTION_PATH="${GITHUB_ACTION_PATH:-}"

# ─── Resolve absolute paths ────────────────────────────────────────────────────
ROOT_DIR="$(pwd)"
WORKING_DIR="$(cd "$ROOT_DIR/$WORKING_DIRECTORY" && pwd)"
SCAN_JSON="$WORKING_DIR/ratchet-scan.json"

# ─── Helpers ──────────────────────────────────────────────────────────────────
error() {
  echo "::error::$1"
  exit 1
}

has_cmd() { command -v "$1" &>/dev/null; }

# Extract a JSON top-level field (dot-notation) using jq or node
json_get() {
  local file="$1" field="$2"
  if has_cmd jq; then
    jq -r ".$field" "$file" 2>/dev/null
  elif has_cmd node; then
    node -e "
      const d = JSON.parse(require('fs').readFileSync('$file','utf8'));
      const keys = '$field'.split('.');
      let v = d;
      for (const k of keys) v = v && v[k];
      process.stdout.write(v != null ? String(v) : '');
    "
  else
    error "Neither jq nor node is available."
  fi
}

# Extract category score by name
json_cat_score() {
  local file="$1" name="$2"
  if has_cmd jq; then
    jq -r ".categories[\"$name\"].score // .categories[\"$name\"] // empty" "$file" 2>/dev/null
  elif has_cmd node; then
    node -e "
      const d = JSON.parse(require('fs').readFileSync('$file','utf8'));
      const c = d.categories && (d.categories['$name'].score ?? d.categories['$name']);
      process.stdout.write(c != null ? String(c) : '');
    "
  fi
}

set_output() {
  local name="$1" value="$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$name" "$value" >> "$GITHUB_OUTPUT"
  else
    echo "::set-output name=$name::$value"
  fi
}

# ─── Parse category-thresholds ────────────────────────────────────────────────
declare -A CAT_THRESHOLDS
if [ -n "$CATEGORY_THRESHOLDS" ]; then
  IFS=',' read -ra PAIRS <<< "$CATEGORY_THRESHOLDS"
  for pair in "${PAIRS[@]}"; do
    key="$(echo "$pair" | cut -d= -f1 | xargs)"
    val="$(echo "$pair" | cut -d= -f2 | xargs)"
    [ -n "$key" ] && [ -n "$val" ] || error "Invalid category-thresholds format: '$pair'. Expected 'Category=Score'."
    CAT_THRESHOLDS["$key"]="$val"
  done
fi

# ─── Print startup banner ──────────────────────────────────────────────────────
echo "━━━ Ratchet Code Quality Scan ━━━"
echo " Version   : $VERSION"
echo " Directory : $WORKING_DIR"
echo " Threshold : ${THRESHOLD:-none}"
for k in "${!CAT_THRESHOLDS[@]}"; do
  echo "            $k >= ${CAT_THRESHOLDS[$k]}"
done
echo " Explain   : $EXPLAIN"
echo ""

# ─── Install ratchet-run ───────────────────────────────────────────────────────
echo "▶ Installing ratchet-run@${VERSION}…"
if ! npm install -g "ratchet-run@${VERSION}" 2>&1; then
  error "npm install failed — check network or try a specific version."
fi
echo "✔ Installed: $(ratchet --version 2>&1 | head -1 || echo '[version check unavailable]')"
echo ""

# ─── Build ratchet command ─────────────────────────────────────────────────────
RATCHET_CMD=(ratchet scan)

if [ "$EXPLAIN" = "true" ]; then
  RATCHET_CMD+=(--explain)
fi

RATCHET_CMD+=(--output-json)

# ─── Run scan ─────────────────────────────────────────────────────────────────
cd "$WORKING_DIR"
echo "▶ Running: ${RATCHET_CMD[*]}"

# Some versions emit non-JSON to stdout; we pipe to a temp file and extract
if "${RATCHET_CMD[@]}" > "$SCAN_JSON" 2>/dev/null; then
  :
else
  # Fallback: try stderr
  if "${RATCHET_CMD[@]}" 2>"$SCAN_JSON" && [ -s "$SCAN_JSON" ]; then
    :
  else
    error "ratchet scan produced no output. Check your ratchet configuration."
  fi
fi

if [ ! -s "$SCAN_JSON" ]; then
  error "ratchet scan produced an empty output file."
fi

echo "✔ Output: $SCAN_JSON"
echo ""

# ─── Parse score ───────────────────────────────────────────────────────────────
raw_score="$(json_get "$SCAN_JSON" "score")"
SCORE="$(echo "$raw_score" | tr -d '"' | xargs)"
SCORE="${SCORE:-0}"
echo "📊 Overall Score: $SCORE / 100"
echo ""

# ─── Badge URL ─────────────────────────────────────────────────────────────────
BADGE_URL="https://img.shields.io/badge/dynamic/json?color=informational&label=Ratchet+Score&query=$.score&url=https%3A%2F%2Fraw.githubusercontent.com%2F${GITHUB_REPOSITORY}%2F${GITHUB_SHA}%2F${WORKING_DIRECTORY}%2Fratchet-scan.json"

# ─── Set outputs ────────────────────────────────────────────────────────────────
set_output "score" "$SCORE"
set_output "json" "$SCAN_JSON"
set_output "badge-url" "$BADGE_URL"
set_output "pr-comment-id" ""

# ─── Threshold checks ──────────────────────────────────────────────────────────
EXIT_CODE=0
FAILED_CATS=()

if [ -n "$THRESHOLD" ]; then
  if ! [[ "$THRESHOLD" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    error "threshold must be a number, got: '$THRESHOLD'"
  fi
  if (( $(echo "$SCORE < $THRESHOLD" | bc -l 2>/dev/null || node -e "process.exit($SCORE < $THRESHOLD ? 0 : 1)") )); then
    echo "✘ Score $SCORE < threshold $THRESHOLD"
    EXIT_CODE=1
  else
    echo "✔ Score $SCORE >= threshold $THRESHOLD"
  fi
fi

if [ ${#CAT_THRESHOLDS[@]} -gt 0 ]; then
  echo ""
  echo "▶ Checking category gates…"
  for cat in "${!CAT_THRESHOLDS[@]}"; do
    req="${CAT_THRESHOLDS[$cat]}"
    act="$(json_cat_score "$SCAN_JSON" "$cat")"
    if [ -z "$act" ]; then
      echo "⚠ Category '$cat' not in output — skipping gate"
      continue
    fi
    if (( $(echo "$act < $req" | bc -l 2>/dev/null || node -e "process.exit($act < $req ? 0 : 1)") )); then
      echo "✘ $cat: $act < $req"
      FAILED_CATS+=("$cat")
      EXIT_CODE=1
    else
      echo "✔ $cat: $act >= $req"
    fi
  done
fi

echo ""

# ─── PR comment ───────────────────────────────────────────────────────────────
if [ "$GITHUB_EVENT_NAME" = "pull_request" ] && [ -n "$GITHUB_TOKEN" ]; then
  echo "▶ Posting PR comment…"

  # Extract PR number from ref (e.g. refs/pull/123/merge → 123)
  PR_NUMBER="$(echo "$GITHUB_REF" | grep -oE '[0-9]+' | tail -1 || true)"
  [ -z "$PR_NUMBER" ] && echo "⚠ Could not determine PR number from ref '$GITHUB_REF'" && PR_NUMBER=""

  if [ -n "$PR_NUMBER" ]; then
    # Build category markdown table
    CAT_TABLE=""
    if [ -n "$(json_get "$SCAN_JSON" "categories")" ]; then
      CAT_TABLE=$'| Category | Score |\n|---|---|\n'
      if has_cmd jq; then
        while IFS='=' read -r name score; do
          [ -n "$name" ] && CAT_TABLE+="| $name | $score |\n"
        done < <(jq -r '.categories | to_entries | .[] | "\(.key)=\(.value.score // .value)"' "$SCAN_JSON" 2>/dev/null)
      fi
    fi

    if [ "$EXIT_CODE" = "0" ]; then
      STATUS_EMOJI="✅" STATUS_TEXT="**Passed**"
    else
      STATUS_EMOJI="❌" STATUS_TEXT="**Failed**"
    fi

    COMMENT_BODY="${STATUS_EMOJI} **Ratchet Code Quality Scan — ${STATUS_TEXT}**

**Overall Score:** ${SCORE} / 100
[![Ratchet Score](${BADGE_URL})](https://github.com/${GITHUB_REPOSITORY}/actions)

$(if [ -n "$CAT_TABLE" ]; then printf "\`\`\`\n${STATUS_EMOJI} Category Breakdown\n${CAT_TABLE}\n\`\`\`\n"; fi)\`\`\`yaml
threshold:${THRESHOLD:+" $THRESHOLD"}\ncategory_thresholds:${CATEGORY_THRESHOLDS:+" $CATEGORY_THRESHOLDS"}\n\`\`\`

> Powered by [ratchet-run](https://github.com/samloux/ratchet) · [View full report](https://github.com/${GITHUB_REPOSITORY}/blob/${GITHUB_SHA}/${WORKING_DIRECTORY}/ratchet-scan.json)
"

    # Escape for JSON
    ESCAPED_BODY="$(printf '%s' "$COMMENT_BODY" | jq -Rs .)"
    COMMENT_RESPONSE="$(
      curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        -H "Content-Type: application/json" \
        "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
        -d "{\"body\": $ESCAPED_BODY}"
    )"

    if echo "$COMMENT_RESPONSE" | jq -e '.id' &>/dev/null; then
      PR_CID="$(echo "$COMMENT_RESPONSE" | jq -r '.id')"
      set_output "pr-comment-id" "$PR_CID"
      echo "✔ PR comment posted (ID: $PR_CID)"
    else
      echo "⚠ PR comment not posted. Response: $COMMENT_RESPONSE"
    fi
  fi
fi

# ─── Exit ──────────────────────────────────────────────────────────────────────
if [ "$EXIT_CODE" = "0" ]; then
  echo "━━━ ✅ Ratchet scan passed ━━━"
else
  echo "━━━ ❌ Ratchet scan failed ━━━"
fi
exit "$EXIT_CODE"
