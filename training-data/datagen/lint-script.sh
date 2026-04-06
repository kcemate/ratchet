#!/bin/bash

# Data Quality Linter Framework
# Uses Gemma 4 via Ollama for plausibility checking
# Run: ./lint-script.sh [json_file]

set -euo pipefail

# Configuration
DATA_DIR="$HOME/Projects/Ratchet/training-data/datagen"
QUARANTINE_DIR="$DATA_DIR/quarantine"
LINT_LOG="$HOME/Projects/Ratchet/knowledge/lint-log.md"
GEMMA_MODEL="gemma4:e4b"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LINT_LOG"
}

# Initialize quarantine directory if needed
mkdir -p "$QUARANTINE_DIR"

# Check if file is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <json_file>"
    echo "Scanning all JSON files in $DATA_DIR..."
    FILES=$(ls "$DATA_DIR"/*.json 2>/dev/null)
else
    FILES="$@"
fi

# Check if Gemma 4 is available
if ! command -v ollama &> /dev/null; then
    log "❌ ERROR: Ollama not found. Install Ollama to use this linter."
    exit 1
fi

if ! ollama list | grep -q "$GEMMA_MODEL"; then
    log "❌ ERROR: Gemma 4 model '$GEMMA_MODEL' not found. Pull the model first."
    exit 1
fi

# Process each file
for JSON_FILE in $FILES; do
    if [ ! -f "$JSON_FILE" ]; then
        log "⚠️  Skipping $JSON_FILE: not a file"
        continue
    fi

    BASENAME=$(basename "$JSON_FILE")
    log "🔍 Processing $BASENAME..."

    # Check if already linted
    if grep -q "$BASENAME" "$LINT_LOG"; then
        log "⏭️  Skipping $BASENAME: already linted"
        continue
    fi

    # Validate basic structure
    if ! jq -e . >/dev/null 2>&1 <<< "$(cat "$JSON_FILE")"; then
        log "❌ FAIL: Invalid JSON structure"
        mv "$JSON_FILE" "$QUARANTINE_DIR/"
        continue
    fi

    # Check if it's an array
    if ! jq -e 'type == "array"' "$JSON_FILE" >/dev/null 2>&1; then
        log "⚠️  WARN: Not an array - checking for {file, issues:[]} structure"
        # Check if it's the React-style object
        if jq -e '.file and .issues' "$JSON_FILE" >/dev/null 2>&1; then
            log "⚠️  WARN: React-style object detected - needs conversion"
            SCORE="WARN"
            NOTES="Object {file, issues:[]} structure - needs conversion to array"
        else
            log "❌ FAIL: Invalid top-level structure"
            mv "$JSON_FILE" "$QUARANTINE_DIR/"
            continue
        fi
    else
        # It's an array - validate each item
        ARRAY_LENGTH=$(jq 'length' "$JSON_FILE")
        if [ "$ARRAY_LENGTH" -eq 0 ]; then
            log "⚠️  WARN: Empty array"
            SCORE="WARN"
            NOTES="Empty array - no findings"
        else
            # Check required fields in first few items
            VALIDATION=$(jq -r 'map(has("file") and has("line") and has("category") and has("severity") and has("description") and has("suggested_fix") and has("confidence")) | all' "$JSON_FILE")
            if [ "$VALIDATION" != "true" ]; then
                log "❌ FAIL: Missing required fields"
                mv "$JSON_FILE" "$QUARANTINE_DIR/"
                continue
            fi
            
            # Count items with short descriptions (<30 chars)
            SHORT_DESC_COUNT=$(jq '[.[] | select(.description | length < 30)] | length' "$JSON_FILE")
            SHORT_DESC_PERCENT=$((SHORT_DESC_COUNT * 100 / ARRAY_LENGTH))
            
            # Count items with template-like suggested fixes
            TEMPLATE_FIX_COUNT=$(jq '[.[] | select(.suggested_fix | contains("Add proper error handling") or contains("Consider using a more specific type") or contains("Refactor to use a dedicated module") or contains("Improve the algorithm complexity") or contains("Add null checks") or contains("Use more descriptive variable names")) | length' "$JSON_FILE")
            TEMPLATE_FIX_PERCENT=$((TEMPLATE_FIX_COUNT * 100 / ARRAY_LENGTH))
            
            log "📊 Analysis: $ARRAY_LENGTH items, $SHORT_DESC_PERCENT% short descriptions, $TEMPLATE_FIX_PERCENT% template fixes"
            
            # Use Gemma 4 to spot-check 3-5 issues
            log "🤖 Querying Gemma 4 for plausibility check..."
            
            # Select 3 random issues for checking
            SAMPLE_ISSUES=$(jq -c '.[:3]' "$JSON_FILE")
            
            # Create prompt for Gemma
            PROMPT=$(cat <<EOF
You are a code quality expert. Evaluate the following code issues for plausibility:

$ SAMPLE_ISSUES

For each issue, answer:
- Is this a real code quality issue or hallucinated? (PLAUSIBLE/ALWAYS/NO)
- Does the description make sense? (YES/NO)
- Is the severity rating reasonable? (YES/NO)
- Brief explanation.

Provide a summary score: percentage of plausible issues.
EOF
)
            
            # Run Gemma 4 via Ollama
            RESULT=$(echo "$PROMPT" | ollama run gemma4:e4b 2>/dev/null || echo "ERROR: Gemma 4 query failed")
            
            if echo "$RESULT" | grep -q "ERROR"; then
                log "❌ FAIL: Gemma 4 query failed"
                mv "$JSON_FILE" "$QUARANTINE_DIR/"
                continue
            fi
            
            # Extract score from Gemma's response
            GEMMA_SCORE=$(echo "$RESULT" | grep -oE '[0-9]+% plausible' | head -1 || echo "0%")
            GEMMA_PERCENT=${GEMMA_SCORE%%\%*}
            
            # Calculate overall score
            # Structure: 30%, Content: 50%, Gemma: 20%
            STRUCTURE_SCORE=100
            if jq -e 'type == "array"' "$JSON_FILE" >/dev/null 2>&1; then
                STRUCTURE_SCORE=100
            else
                STRUCTURE_SCORE=50  # Needs conversion but fixable
            fi
            
            CONTENT_SCORE=100
            if [ "$SHORT_DESC_PERCENT" -gt 50 ]; then
                CONTENT_SCORE=30
            elif [ "$SHORT_DESC_PERCENT" -gt 20 ]; then
                CONTENT_SCORE=70
            fi
            
            if [ "$TEMPLATE_FIX_PERCENT" -gt 50 ]; then
                CONTENT_SCORE=30
            elif [ "$TEMPLATE_FIX_PERCENT" -gt 20 ]; then
                CONTENT_SCORE=70
            fi
            
            # Weighted score
            OVERALL_SCORE=$(((STRUCTURE_SCORE * 3 + CONTENT_SCORE * 5 + GEMMA_PERCENT * 2) / 10))
            
            log "📈 Overall score: $OVERALL_SCORE% (Structure: $STRUCTURE_SCORE%, Content: $CONTENT_SCORE%, Gemma: $GEMMA_PERCENT%)"
            
            # Determine rating
            if [ "$OVERALL_SCORE" -ge 80 ]; then
                RATING="PASS"
                ACTION=""
            elif [ "$OVERALL_SCORE" -ge 50 ]; then
                RATING="WARN"
                ACTION="Needs structural fix and content review"
            else
                RATING="FAIL"
                ACTION="Quarantine - content quality too low"
            fi
            
            # Log result
            echo "
### $(date '+%Y-%m-%d') — $BASENAME

**Score: $RATING** ${ACTION:+— $ACTION}

| Check | Result | Notes |
|---|---|---|
| Top-level structure | ${STRUCTURE_SCORE}/100 | ${STRUCTURE_SCORE}% |
| Required fields | ✅ PASS | All items have required fields |
| Description quality | ${SHORT_DESC_PERCENT}% | ${SHORT_DESC_COUNT}/${ARRAY_LENGTH} descriptions <30 chars |
| Suggested fix diversity | ${TEMPLATE_FIX_PERCENT}% | ${TEMPLATE_FIX_COUNT}/${ARRAY_LENGTH} template fixes |
| Gemma plausibility | ${GEMMA_PERCENT}% | ${GEMMA_SCORE} plausible |
| Overall | ${OVERALL_SCORE}% | Weighted score |

$RESULT

**Notes:** Short descriptions: $SHORT_DESC_COUNT/$ARRAY_LENGTH (${SHORT_DESC_PERCENT}%). Template fixes: $TEMPLATE_FIX_COUNT/${ARRAY_LENGTH} (${TEMPLATE_FIX_PERCENT}%).
" >> "$LINT_LOG"
            
            if [ "$RATING" = "FAIL" ]; then
                log "❌ FAIL: Moving to quarantine"
                mv "$JSON_FILE" "$QUARANTINE_DIR/"
            elif [ "$RATING" = "WARN" ]; then
                log "⚠️  WARN: Needs structural fix"
                # For WARN, we don't move but log the warning
            fi
        fi
    fi
done

log "✅ Linter completed. Check $LINT_LOG for details."
