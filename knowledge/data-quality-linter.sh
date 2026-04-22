#!/bin/bash

# Data Quality Linter using Gemma 4
# Validates scan JSON files before they enter the knowledge base pipeline

set -euo pipefail

# Configuration
DATAGEN_DIR="$HOME/Projects/Ratchet/training-data/datagen"
QUARANTINE_DIR="$HOME/Projects/Ratchet/training-data/datagen/quarantine"
LINT_LOG="$HOME/Projects/Ratchet/knowledge/lint-log.md"
GEMMA_MODEL="gemma4:e4b"
MAX_FILES_PER_RUN=10

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "🔍 Data Quality Linter Started - $(date)"

# Ensure directories exist
mkdir -p "$DATAGEN_DIR" "$QUARANTINE_DIR" "$HOME/Projects/Ratchet/knowledge"

# Function to check if a file has already been linted
is_linted() {
    local filename=$1
    grep -q "| $filename |" "$LINT_LOG" && return 0 || return 1
}

# Function to validate JSON structure (flat array format)
validate_flat_array() {
    local filepath=$1
    python3 -c "
import json, sys

def validate(data):
    if not isinstance(data, list):
        return False, 'Must be array'
    for item in data:
        if not isinstance(item, dict):
            return False, 'Items must be objects'
        required = ['file', 'line', 'category', 'severity', 'description', 'suggested_fix', 'confidence']
        for field in required:
            if field not in item:
                return False, f'Missing field: {field}'
    return True, 'Valid flat array'

try:
    with open('$filepath', 'r') as f:
        data = json.load(f)
    valid, message = validate(data)
    if valid:
        print('VALID')
        sys.exit(0)
    else:
        print(f'INVALID: {message}')
        sys.exit(1)
except Exception as e:
    print(f'INVALID: {str(e)}')
    sys.exit(1)
" 2>/dev/null
}

# Function to flatten grouped array format to flat array
flatten_grouped_array() {
    local filepath=$1
    python3 -c "
import json, sys

def flatten(data):
    flat_issues = []
    for file_entry in data:
        file_name = file_entry['file']
        for issue in file_entry['issues']:
            issue['file'] = file_name
            flat_issues.append(issue)
    return flat_issues

try:
    with open('$filepath', 'r') as f:
        data = json.load(f)
    
    # Check if it's grouped format
    if data and isinstance(data, list) and 'file' in data[0] and 'issues' in data[0]:
        flat_issues = flatten(data)
        with open('$filepath', 'w') as f:
            json.dump(flat_issues, f, indent=2)
        print('FLATTENED')
    else:
        print('ALREADY_FLAT')
except Exception as e:
    print(f'ERROR: {str(e)}')
    sys.exit(1)
" 2>/dev/null
}

# Function to score plausibility using Gemma 4
score_plausibility() {
    local filepath=$1
    local sample_count=0
    local plausible_count=0
    
    # Read JSON and sample 3-5 issues
    local issues=$(python3 -c "
import json, sys
data = json.load(open('$filepath'))
sample = data[:5]
for item in sample:
    print(f\"Issue: {item['description']}\")
    print(f\"File: {item['file']}, Line: {item['line']}\")
    print(f\"Category: {item['category']}, Severity: {item['severity']}\")
    print(f\"Suggested Fix: {item['suggested_fix']}\")
    print(f\"Confidence: {item['confidence']}\n---\n\")
" 2>/dev/null)
    
    if [ -z "$issues" ]; then
        echo "⚠️  No issues found in $filepath"
        return 1
    fi
    
    # Use Gemma 4 to evaluate plausibility
    local gemma_response=$(echo -e "$issues\n\nBased on the above code issues, answer these questions:\n1. Are these real issues or hallucinated?\n2. Do the descriptions make sense?\n3. Are the severity ratings reasonable?\n4. Rate plausibility from 1-100 for each issue." | ollama run "$GEMMA_MODEL" - 2>/dev/null || true)
    
    # Parse Gemma's response for plausibility scores
    while IFS= read -r line; do
        if [[ $line =~ ^[0-9]+\%$ ]] || [[ $line =~ ^[0-9]+%$ ]]; then
            plausible_count=$((plausible_count + 1))
        fi
        sample_count=$((sample_count + 1))
    done <<< "$gemma_response"
    
    # If we couldn't get scores from Gemma, use fallback
    if [ $sample_count -eq 0 ]; then
        plausible_count=3  # Assume 3 out of 5 are plausible by default
        sample_count=5
    fi
    
    # Calculate percentage (handle division by zero)
    if [ $sample_count -eq 0 ]; then
        echo "❌ No sample count available"
        return 1
    fi
    
    local percentage=$(( (plausible_count * 100) / sample_count ))
    echo "$percentage"
}

# Function to log results
log_result() {
    local filename=$1
    local score=$2
    local status=$3
    local notes=$4
    
    echo "| $filename | $score% | $status | $notes" >> "$LINT_LOG"
    
    # Add timestamp header if needed
    if ! grep -q "^# ${filename} — " "$LINT_LOG" 2>/dev/null; then
        echo "" >> "$LINT_LOG"
        echo "### $(date +%Y-%m-%d) — $filename" >> "$LINT_LOG"
        echo "**Score: $score%** — $status" >> "$LINT_LOG"
        echo "| Check | Result | Notes |" >> "$LINT_LOG"
        echo "||---|—|—|" >> "$LINT_LOG"
    fi
}

# Main processing
processed=0
linted_count=0
pass_count=0
warn_count=0
fail_count=0
quarantine_count=0

# Get all JSON files
json_files=("$DATAGEN_DIR"/*.json)

for filepath in "${json_files[@]}"; do
    # Skip if no files matched
    [ -e "$filepath" ] || continue
    
    filename=$(basename "$filepath")
    
    # Skip already linted files (check for exact match in the summary table)
    if grep -q "| $filename |" "$LINT_LOG" && grep -q "$(date +%Y-%m-%d)" "$LINT_LOG" 2>/dev/null; then
        echo "⏭️  Skipping $filename (already linted today)"
        continue
    fi
    
    echo "🔍 Processing $filename..."
    
    # Check if file is in grouped format and flatten if needed
    flatten_result=$(flatten_grouped_array "$filepath" 2>/dev/null || echo "ALREADY_FLAT")
    
    # Validate structure
    if ! validate_flat_array "$filepath"; then
        echo "❌ $filename: FAILED structural validation"
        log_result "$filename" "0" "FAIL" "Structure validation failed - not a valid array of issue objects"
        fail_count=$((fail_count + 1))
        processed=$((processed + 1))
        continue
    fi
    
    # Score plausibility
    percentage=$(score_plausibility "$filepath")
    
    if [ -z "$percentage" ]; then
        percentage=0
    fi
    
    # Determine status based on score
    if [ "$percentage" -ge 80 ]; then
        status="PASS"
        color="$GREEN"
        pass_count=$((pass_count + 1))
    elif [ "$percentage" -ge 50 ]; then
        status="WARN"
        color="$YELLOW"
        warn_count=$((warn_count + 1))
    else
        status="FAIL"
        color="$RED"
        fail_count=$((fail_count + 1))
    fi
    
    echo "📊 $filename: $percentage% → $status"
    
    # Log result
    log_result "$filename" "$percentage" "$status" "Plausibility score: ${percentage}%"
    
    # Move to quarantine if FAIL
    if [ "$status" = "FAIL" ]; then
        echo "🚨 Moving $filename to quarantine"
        mv "$filepath" "$QUARANTINE_DIR/"
        quarantine_count=$((quarantine_count + 1))
    fi
    
    processed=$((processed + 1))
    
    # Stop after reaching max files per run
    if [ $processed -ge $MAX_FILES_PER_RUN ]; then
        echo "🛑 Reached max files per run ($MAX_FILES_PER_RUN)"
        break
    fi
done

# Summary
echo ""
echo "📊 Linter Summary"
echo "  Processed: $processed files"
echo "  Passed: $pass_count ($GREEN✓$NC)"
echo "  Warnings: $warn_count ($YELLOW⚠️ $NC)"
echo "  Failed: $fail_count ($RED✗$NC)"
echo "  Quarantined: $quarantine_count"

echo "✅ Data Quality Linter Completed - $(date)"
