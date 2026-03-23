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
BASELINE="${INPUT_BASELINE:-}"
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

# Extract a top-level JSON number field using jq or node
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

# Extract category score by name (categories is an array: [{name, score, max, ...}])
json_cat_score() {
  local file="$1" name="$2"
  if has_cmd jq; then
    jq -r --arg n "$name" '.categories[] | select(.name == $n) | .score' "$file" 2>/dev/null
  elif has_cmd node; then
    node -e "
      const d = JSON.parse(require('fs').readFileSync('$file','utf8'));
      const c = (d.categories || []).find(x => x.name === '$name');
      process.stdout.write(c != null ? String(c.score) : '');
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
[ -n "$BASELINE" ] && echo " Baseline  : $BASELINE"
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
raw_score="$(json_get "$SCAN_JSON" "total")"
SCORE="$(echo "$raw_score" | tr -d '"' | xargs)"
SCORE="${SCORE:-0}"
echo "📊 Overall Score: $SCORE / 100"

# ─── Delta comparison (optional baseline) ─────────────────────────────────────
SCORE_DELTA=""
if [ -n "$BASELINE" ] && [ -f "$BASELINE" ]; then
  baseline_raw="$(json_get "$BASELINE" "total")"
  BASELINE_SCORE="$(echo "$baseline_raw" | tr -d '"' | xargs)"
  if [ -n "$BASELINE_SCORE" ] && [ "$BASELINE_SCORE" != "null" ]; then
    if has_cmd node; then
      SCORE_DELTA="$(node -e "
        const d = $SCORE - $BASELINE_SCORE;
        process.stdout.write(d > 0 ? '+' + d : String(d));
      ")"
    fi
    echo "📈 Delta vs baseline: ${SCORE_DELTA} pts (was ${BASELINE_SCORE})"
  else
    echo "⚠ Could not read baseline score from '$BASELINE'"
  fi
elif [ -n "$BASELINE" ]; then
  echo "⚠ Baseline file not found: '$BASELINE' — skipping delta"
fi
echo ""

# ─── Badge URL ─────────────────────────────────────────────────────────────────
BADGE_COLOR="brightgreen"
if [ -n "$SCORE" ]; then
  if [ "$SCORE" -lt 50 ] 2>/dev/null; then BADGE_COLOR="red"
  elif [ "$SCORE" -lt 70 ] 2>/dev/null; then BADGE_COLOR="orange"
  elif [ "$SCORE" -lt 85 ] 2>/dev/null; then BADGE_COLOR="yellow"
  fi
fi
BADGE_URL="https://img.shields.io/badge/Ratchet%20Score-${SCORE}%2F100-${BADGE_COLOR}"

# ─── Set outputs ────────────────────────────────────────────────────────────────
set_output "score" "$SCORE"
set_output "score-delta" "$SCORE_DELTA"
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
    # Build category markdown table from array [{name, score, max}]
    CAT_TABLE=""
    if has_cmd jq && jq -e '.categories | length > 0' "$SCAN_JSON" &>/dev/null; then
      CAT_TABLE=$'| Category | Score | Max |\n|---|---|---|\n'
      while IFS=$'\t' read -r name score max; do
        [ -n "$name" ] && CAT_TABLE+="| ${name} | ${score} | ${max} |\n"
      done < <(jq -r '.categories[] | [.name, (.score|tostring), (.max|tostring)] | @tsv' "$SCAN_JSON" 2>/dev/null)
    fi

    if [ "$EXIT_CODE" = "0" ]; then
      STATUS_EMOJI="✅" STATUS_TEXT="Passed"
    else
      STATUS_EMOJI="❌" STATUS_TEXT="Failed"
    fi

    DELTA_LINE=""
    if [ -n "$SCORE_DELTA" ]; then
      DELTA_LINE="**Score delta:** ${SCORE_DELTA} pts vs baseline  "
    fi

    COMMENT_BODY="${STATUS_EMOJI} **Ratchet Code Quality — ${STATUS_TEXT}**

**Score: ${SCORE} / 100**
${DELTA_LINE}
[![Ratchet Score](${BADGE_URL})](https://github.com/${GITHUB_REPOSITORY}/actions)

$(if [ -n "$CAT_TABLE" ]; then printf "### Category Breakdown\n\n${CAT_TABLE}\n"; fi)
> [View scan JSON](https://github.com/${GITHUB_REPOSITORY}/blob/${GITHUB_SHA}/${WORKING_DIRECTORY}/ratchet-scan.json) · Powered by [ratchet-run](https://github.com/giovanni-labs/ratchet)
"

    # Escape for JSON
    if has_cmd jq; then
      ESCAPED_BODY="$(printf '%s' "$COMMENT_BODY" | jq -Rs .)"
    else
      # Fallback: node
      ESCAPED_BODY="$(node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))" <<< "$COMMENT_BODY")"
    fi

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
