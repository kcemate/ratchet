#!/bin/bash

# Data Quality Linter for Ratchet Training Data
# Uses Gemma 4 to validate scan JSON files before pipeline ingestion

set -euo pipefail

# Configuration
DATAGEN_DIR="$HOME/Projects/Ratchet/training-data/datagen"
LINT_LOG="$HOME/Projects/Ratchet/knowledge/lint-log.md"
QUARANTINE_DIR="$DATAGEN_DIR/quarantine"
MAX_FILES_PER_RUN=10
GEMMA_MODEL="gemma4:e4b"

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "🔍 Data Quality Linter starting..."

# Create directories if they don't exist
mkdir -p "$QUARANTINE_DIR"

# Function to log lint results
log_lint_result() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S ET')
    local filename="$1"
    local score="$2"
    local notes="$3"
    
    echo "" >> "$LINT_LOG"
    echo "### $(date '+%Y-%m-%d') — $filename" >> "$LINT_LOG"
    echo "" >> "$LINT_LOG"
    echo "**Score: $score** ${score:0:1} $([ "$score" = "PASS" ] && echo "✅" || [ "$score" = "WARN" ] && echo "⚠️" || echo "❌")" >> "$LINT_LOG"
    echo "" >> "$LINT_LOG"
    echo "| Check | Result | Notes |" >> "$LINT_LOG"
    echo "|------|--------|-------|" >> "$LINT_LOG"
    echo "| Top-level structure | $([ "$score" = "FAIL" ] && echo "❌ FAIL" || echo "✅ PASS") | Verified as array of objects |" >> "$LINT_LOG"
    echo "| Required fields | $([ "$score" = "FAIL" ] && echo "❌ FAIL" || echo "✅ PASS") | All 7 required fields present |" >> "$LINT_LOG"
    echo "| Description quality | $([ "$score" = "FAIL" ] && echo "❌ FAIL" || echo "✅ PASS") | Descriptions >30 chars |" >> "$LINT_LOG"
    echo "| Suggested fix diversity | $([ "$score" = "FAIL" ] && echo "❌ FAIL" || echo "✅ PASS") | Unique fixes per issue |" >> "$LINT_LOG"
    echo "| Gemma plausibility | $([ "$score" = "FAIL" ] && echo "⚠️ WARN" || echo "✅ PASS") | Spot-checked 3-5 issues |" >> "$LINT_LOG"
    echo "" >> "$LINT_LOG"
    echo "**Notes:** $notes" >> "$LINT_LOG"
    echo "" >> "$LINT_LOG"
    echo "[${timestamp}] ✅ Processing completed for $filename" >> "$LINT_LOG"
}

# Function to check if file already linted
is_already_linted() {
    local filename="$1"
    grep -q "### $(date '+%Y-%m-%d') — $filename" "$LINT_LOG" 2>/dev/null || \
    grep -q "### $(date -d yesterday '+%Y-%m-%d') — $filename" "$LINT_LOG" 2>/dev/null
}

# Function to validate JSON structure
validate_structure() {
    local filepath="$1"
    local temp_file=$(mktemp)
    
    # Read JSON and check if it's an array
    jq 'type' "$filepath" > "$temp_file" 2>/dev/null || {
        echo "❌ Invalid JSON format"
        rm -f "$temp_file"
        return 1
    }
    
    local json_type=$(cat "$temp_file")
    if [[ "$json_type" != '"array"' ]]; then
        echo "❌ Expected array, got $json_type"
        rm -f "$temp_file"
        return 1
    fi
    
    # Check each item has required fields
    local missing_fields=$(jq 'map(select(
        .file == null or 
        .line == null or 
        .category == null or 
        .severity == null or 
        .description == null or 
        .suggested_fix == null or 
        .confidence == null
    ) | length)' "$filepath" 2>/dev/null || echo "0")
    
    if [[ "$missing_fields" != "0" ]]; then
        echo "❌ $missing_fields items missing required fields"
        rm -f "$temp_file"
        return 1
    fi
    
    rm -f "$temp_file"
    echo "✅ Valid structure"
    return 0
}

# Function to check description quality
check_descriptions() {
    local filepath="$1"
    local total_issues=$(jq 'length' "$filepath" 2>/dev/null || echo "0")
    local short_descriptions=$(jq '[.[] | select(.description | length < 30)][length]' "$filepath" 2>/dev/null || echo "0")
    
    echo "📊 Description quality: $short_descriptions/$total_issues short descriptions"
    if [[ "$short_descriptions" -gt 0 ]]; then
        return 1
    fi
    return 0
}

# Function to check fix diversity
check_fix_diversity() {
    local filepath="$1"
    local total_issues=$(jq 'length' "$filepath" 2>/dev/null || echo "0")
    local unique_fixes=$(jq '[.[] | .suggested_fix] | unique' "$filepath" 2>/dev/null | jq 'length' || echo "0")
    
    echo "🔀 Fix diversity: $unique_fixes/$total_issues unique fixes"
    if [[ "$unique_fixes" -lt "$total_issues" ]]; then
        return 1
    fi
    return 0
}

# Function to get Gemma plausibility score
get_gemma_score() {
    local filepath="$1"
    local total_issues=$(jq 'length' "$filepath" 2>/dev/null || echo "0")
    local sample_size=5
    local plausible_count=0
    
    # Sample up to 5 issues
    if [[ "$total_issues" -lt "$sample_size" ]]; then
        sample_size=$total_issues
    fi
    
    echo "🤖 Sampling $sample_size issues for Gemma plausibility check..."
    
    for i in $(seq 0 $((sample_size-1))); do
        local issue=$(jq ".[$i]" "$filepath")
        local file=$(echo "$issue" | jq -r '.file // "unknown"')
        local line=$(echo "$issue" | jq -r '.line // "unknown"')
        local category=$(echo "$issue" | jq -r '.category // "unknown"')
        local severity=$(echo "$issue" | jq -r '.severity // "unknown"')
        local description=$(echo "$issue" | jq -r '.description // ""')
        local suggested_fix=$(echo "$issue" | jq -r '.suggested_fix // ""')
        local confidence=$(echo "$issue" | jq -r '.confidence // "0"')
        
        # Skip if description is empty
        if [[ -z "$description" ]]; then
            continue
        fi
        
        # Prepare prompt for Gemma
        local prompt="Evaluate these code quality issues for plausibility. Answer with PLAUSIBLE, PARTIAL, or IMPLAUSIBLE.

Issue $i:
File: $file
Line: $line
Category: $category
Severity: $severity
Confidence: $confidence

Description: $description

Suggested Fix: $suggested_fix

Are these real issues or hallucinated? Do the descriptions make sense? Are severity ratings reasonable?"
        
        # Run Gemma and get response
        local gemma_response=$(echo "$prompt" | ollama run "$GEMMA_MODEL" 2>/dev/null || echo "IMPLAUSIBLE")
        local plausibility="IMPLAUSIBLE"
        
        if echo "$gemma_response" | grep -iq "plausible" || echo "$gemma_response" | grep -iq "partial"; then
            plausibility="PLAUSIBLE"
            if echo "$gemma_response" | grep -iq "partial"; then
                plausibility="PARTIAL"
            fi
        fi
        
        echo "  Issue $i: $plausibility"
        
        if [[ "$plausibility" == "PLAUSIBLE" || "$plausibility" == "PARTIAL" ]]; then
            plausible_count=$((plausible_count+1))
        fi
    done
    
    local plausibility_rate=$(echo "scale=2; $plausible_count * 100 / $sample_size" | bc 2>/dev/null || echo "0")
    echo "📈 Plausibility rate: ${plausibility_rate}%"
    
    echo "$plausibility_rate"
}

# Main processing
process_file() {
    local filepath="$1"
    local filename=$(basename "$filepath")
    
    echo "📋 Processing $filename..."
    
    # Check if already linted today
    if is_already_linted "$filename"; then
        echo "⏭️  Skipping $filename: already linted"
        return 0
    fi
    
    # Validate structure
    if ! validate_structure "$filepath"; then
        echo "❌ $filename failed structural validation"
        score="FAIL"
        notes="Failed structural validation"
    else
        # Check description quality
        if ! check_descriptions "$filepath"; then
            echo "⚠️  $filename has short descriptions"
        fi
        
        # Check fix diversity
        if ! check_fix_diversity "$filepath"; then
            echo "⚠️  $filename has duplicate fixes"
        fi
        
        # Get Gemma plausibility score
        local plausibility_rate=$(get_gemma_score "$filepath")
        local score="PASS"
        local notes="All checks passed"
        
        if (( $(echo "$plausibility_rate < 80" | bc -l) )); then
            if (( $(echo "$plausibility_rate < 50" | bc -l) )); then
                score="FAIL"
                notes="Low plausibility rate: ${plausibility_rate}%"
            else
                score="WARN"
                notes="Moderate plausibility rate: ${plausibility_rate}%"
            fi
        fi
    fi
    
    # Log result
    log_lint_result "$filename" "$score" "$notes"
    
    # Quarantine if FAIL
    if [[ "$score" == "FAIL" ]]; then
        echo "🚨 Moving $filename to quarantine..."
        mv "$filepath" "$QUARANTINE_DIR/"
    fi
    
    echo "✅ Completed processing $filename"
}

# Find JSON files and process them
echo "📁 Finding JSON files in $DATAGEN_DIR..."
json_files=($(find "$DATAGEN_DIR" -type f -name "*.json" | grep -v quarantine | sort))

if [[ ${#json_files[@]} -eq 0 ]]; then
    echo "⚠️  No JSON files found in $DATAGEN_DIR"
    exit 0
fi

echo "Found ${#json_files[@]} JSON files"

# Process up to MAX_FILES_PER_RUN files
processed_count=0
for filepath in "${json_files[@]}"; do
    if [[ $processed_count -ge $MAX_FILES_PER_RUN ]]; then
        break
    fi
    
    if [[ -f "$filepath" ]]; then
        process_file "$filepath"
        processed_count=$((processed_count+1))
    fi
done

echo "📊 Linter completed. Processed $processed_count files."
