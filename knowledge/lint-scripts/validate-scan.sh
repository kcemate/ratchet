#!/bin/bash

# Data Quality Linter for Scan JSON files
# Validates scan JSON files before they enter the knowledge base pipeline

set -euo pipefail

# Configuration
DATAGEN_DIR="$HOME/Projects/Ratchet/training-data/datagen"
LINT_LOG="$HOME/Projects/Ratchet/knowledge/lint-log.md"
QUARANTINE_DIR="$DATAGEN_DIR/quarantine"
TEMP_DIR=$(mktemp -d)
MAX_FILES_PER_RUN=10

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "📊 Data Quality Linter Started at $(date)"
echo "📁 Scanning: $DATAGEN_DIR"
echo "📝 Log: $LINT_LOG"
echo "🏥 Quarantine: $QUARANTINE_DIR"
echo ""

# Create directories if they don't exist
mkdir -p "$QUARANTINE_DIR"
mkdir -p "$(dirname "$LINT_LOG")"

# Function to log results
log_result() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local filename="$1"
    local score="$2"
    local notes="$3"
    
    echo "$timestamp - $filename - $score - $notes" >> "$LINT_LOG"
}

# Function to validate JSON structure
validate_structure() {
    local filepath="$1"
    local json_content="$2"
    
    # Check if it's valid JSON array
    if ! echo "$json_content" | jq -e 'type == "array"' >/dev/null 2>&1; then
        echo "  ❌ FAIL: Not a valid JSON array"
        return 1
    fi
    
    local array_length=$(echo "$json_content" | jq 'length')
    if [[ $array_length -eq 0 ]]; then
        echo "  ⚠️  WARN: Empty array (0 items)"
        return 0
    fi
    
    # Check each item has required fields
    local missing_fields=()
    local invalid_items=()
    local item_count=0
    
    while IFS= read -r item; do
        item_count=$((item_count + 1))
        
        # Check required fields
        for field in file line category severity description suggested_fix confidence; do
            if ! echo "$item" | jq -e ".\"$field\"" >/dev/null 2>&1; then
                missing_fields+=("$field")
                break
            fi
        done
        
        # Additional validation for specific fields
        local confidence=$(echo "$item" | jq -r '.confidence')
        if [[ ! "$confidence" =~ ^[0-9]+(\.[0-9]+)?$ ]] || \
           [[ $(echo "$confidence < 0 || $confidence > 100" | bc -l) -eq 1 ]]; then
            invalid_items+=("item $item_count: confidence=$confidence")
        fi
        
        local severity=$(echo "$item" | jq -r '.severity')
        if [[ ! "$severity" =~ ^(low|medium|high|critical)$ ]]; then
            invalid_items+=("item $item_count: severity=$severity")
        fi
        
    done < <(echo "$json_content" | jq -c '.[]')
    
    if [[ ${#missing_fields[@]} -gt 0 ]]; then
        echo "  ❌ FAIL: Missing required fields: ${missing_fields[*]}"
        return 1
    fi
    
    if [[ ${#invalid_items[@]} -gt 0 ]]; then
        echo "  ❌ FAIL: Invalid field values:"
        for issue in "${invalid_items[@]}"; do
            echo "    $issue"
        done
        return 1
    fi
    
    echo "  ✅ PASS: Valid structure with $array_length items"
    return 0
}

# Function to score plausibility using Gemma 4
score_plausibility() {
    local filepath="$1"
    local json_content="$2"
    local sample_size="$3"
    
    # Get random sample of issues
    local sample
    sample=$(echo "$json_content" | jq -c --argjson n "$sample_size" '.[random($n)]' 2>/dev/null || \
             echo "$json_content" | jq -c --argjson n "$sample_size" 'limit $n; .[]' 2>/dev/null)
    
    if [[ -z "$sample" ]]; then
        echo "  ⚠️  WARN: Could not sample issues for scoring"
        echo "score=0.0"
        return
    fi
    
    # Create prompt for Gemma 4
    cat <<EOF > "$TEMP_DIR/gemma_prompt.txt"
You are a data quality expert. Review the following code issues extracted from a static analysis scan:

ISSUE SAMPLES:
$sample

Review each issue and answer:
1. Are these real issues or hallucinated? (0-100% confidence)
2. Do the descriptions make sense? (0-100% clarity)
3. Are severity ratings reasonable? (0-100% accuracy)

Provide a brief analysis with specific scores for each dimension:
EOF
    
    # Run Gemma 4 via Ollama
    if ! command -v ollama &>/dev/null; then
        echo "  ❌ OLLAMA NOT FOUND: Install Ollama to use Gemma 4"
        echo "score=0.5"
        return
    fi
    
    # Run analysis
    local analysis
    analysis=$(ollama run gemma4:e4b "$TEMP_DIR/gemma_prompt.txt" 2>/dev/null || \
               echo "Analysis failed: Could not run Gemma 4")
    
    # Extract scores from analysis
    local real_issues_score=0
    local description_score=0
    local severity_score=0
    
    # Try to extract numeric scores from the analysis
    if echo "$analysis" | grep -qiE "real.*hallucinated|hallucinated.*real"; then
        # Extract confidence percentage
        if echo "$analysis" | grep -oE "[0-9]+%[[:space:]]*confidence" | grep -oE "[0-9]+"; then
            real_issues_score=$(echo "$analysis" | grep -oE "[0-9]+%[[:space:]]*confidence" | grep -oE "[0-9]+" | head -1)
        elif echo "$analysis" | grep -qi "high confidence"; then
            real_issues_score=80
        elif echo "$analysis" | grep -qi "moderate confidence"; then
            real_issues_score=60
        elif echo "$analysis" | grep -qi "low confidence"; then
            real_issues_score=40
        fi
    fi
    
    # Default scores if extraction fails
    if [[ -z "$real_issues_score" ]]; then
        real_issues_score=50
    fi
    
    # Calculate weighted average (weights: real issues 40%, descriptions 30%, severity 30%)
    local weighted_score=$(echo "scale=2; ($real_issues_score * 0.4) / 1" | bc)
    
    echo "score=$weighted_score"
}

# Function to process a single file
process_file() {
    local filepath="$1"
    local filename=$(basename "$filepath")
    
    echo "📋 Processing: $filename"
    
    # Read JSON content
    local json_content
    json_content=$(jq -c '.' "$filepath" 2>/dev/null || {
        echo "  ❌ FAIL: Invalid JSON syntax"
        log_result "$filename" "FAIL" "Invalid JSON syntax"
        mv "$filepath" "$QUARANTINE_DIR/$filename"
        return 1
    })
    
    # Check if already linted
    if grep -q "^.* - $filename -" "$LINT_LOG"; then
        echo "  ⏭️  SKIPPED: Already linted"
        return 0
    fi
    
    # Validate structure
    if ! validate_structure "$filepath" "$json_content"; then
        log_result "$filename" "FAIL" "Invalid JSON structure"
        mv "$filepath" "$QUARANTINE_DIR/$filename"
        return 1
    fi
    
    # Score plausibility
    local plausibility_score
    plausibility_score=$(score_plausibility "$filepath" "$json_content" 5)
    plausibility_score=$(echo "$plausibility_score" | cut -d= -f2)
    
    # Determine final score
    local final_score=$(echo "$plausibility_score * 100" | bc)
    local rounded_score=$(printf "%.0f" "$final_score")
    
    echo "  📊 Plausibility Score: ${rounded_score}%"
    
    # Determine grade
    local grade
    local grade_color=$GREEN
    
    if [[ $rounded_score -ge 80 ]]; then
        grade="PASS"
        grade_color=$GREEN
    elif [[ $rounded_score -ge 50 ]]; then
        grade="WARN"
        grade_color=$YELLOW
    else
        grade="FAIL"
        grade_color=$RED
    fi
    
    echo -e "  🏷️  Grade: ${grade_color}${grade}${NC}"
    
    # Log and quarantine if FAIL
    log_result "$filename" "$grade" "Plausibility: ${rounded_score}%"
    
    if [[ "$grade" == "FAIL" ]]; then
        echo "  🏥 Moving to quarantine..."
        mv "$filepath" "$QUARANTINE_DIR/$filename"
    fi
    
    return 0
}

# Main execution
echo "🔍 Finding JSON files..."
cd "$DATAGEN_DIR" || exit 1

# Find all JSON files (excluding quarantine)
json_files=()
while IFS= read -r filepath; do
    json_files+=("$filepath")
done < <(find . -name "*.json" -not -path "./quarantine/*" -type f | head -n "$MAX_FILES_PER_RUN")

if [[ ${#json_files[@]} -eq 0 ]]; then
    echo "ℹ️  No JSON files found to process"
    exit 0
fi

echo "Found ${#json_files[@]} files to process:"
for filepath in "${json_files[@]}"; do
    printf '  - %s\n' "$filepath"
done

echo ""
echo "🚀 Starting validation..."
echo ""

# Process each file
fail_count=0
pass_count=0
warn_count=0

for filepath in "${json_files[@]}"; do
    if process_file "$filepath"; then
        if [[ $? -eq 0 ]]; then
            ((pass_count++))
        elif [[ $? -eq 1 ]]; then
            ((fail_count++))
        else
            ((warn_count++))
        fi
    fi
    echo ""
done

echo "📈 Validation Summary:"
echo "  ✅ PASS: $pass_count"
echo "  ⚠️  WARN: $warn_count"
echo "  ❌ FAIL: $fail_count"
echo "  🏥 Quarantined files moved to: $QUARANTINE_DIR"

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "✅ Data Quality Linter Completed"