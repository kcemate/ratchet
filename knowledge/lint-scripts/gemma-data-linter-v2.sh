#!/bin/zsh

# Gemma Data Linter v2 - Fixes for already-linted detection and structural false positives
# Focuses on structural validation without Gemma checks for reliability

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Gemma Data Linter v2 (Structural Only)"

# Configuration
DATA_DIR="$HOME/Projects/Ratchet/training-data/datagen"
KNOWLEDGE_DIR="$HOME/Projects/Ratchet/knowledge"
LINT_LOG="$KNOWLEDGE_DIR/lint-log.md"
QUARANTINE_DIR="$DATA_DIR/quarantine"
MAX_FILES_PER_RUN=10

# Create directories if they don't exist
mkdir -p "$QUARANTINE_DIR"

# Function to check if file is already linted
is_already_linted() {
    local filename="$1"
    if grep -F "$filename" "$LINT_LOG" > /dev/null 2>&1; then
        return 0  # Already linted
    else
        return 1  # Not linted yet
    fi
}

# Function to validate JSON structure with verify-before-FAIL for Check 1
check_top_level_structure() {
    local filepath="$1"
    
    # VERIFY BEFORE FAILING: Read the raw start of the file
    local first_char
    first_char=$(head -c 1 "$filepath" | tr -d '[:space:]')
    
    if [[ "$first_char" == "[" ]]; then
        echo "PASS"
        return 0
    elif [[ "$first_char" == "{" ]]; then
        echo "FAIL"
        return 1
    else
        echo "FAIL"
        return 1
    fi
}

# Function to check required fields
check_required_fields() {
    local filepath="$1"
    
    # Check if all objects have all 7 required fields
    local missing_count
    missing_count=$(jq -r '.[] | select(.file == null or .line == null or .category == null or .severity == null or .description == null or .suggested_fix == null or .confidence == null) | .file' "$filepath" 2>/dev/null | wc -l)
    
    if [[ $missing_count -eq 0 ]]; then
        echo "PASS"
        return 0
    else
        echo "FAIL"
        return 1
    fi
}

# Function to check description quality
check_description_quality() {
    local filepath="$1"
    
    # Check if descriptions are substantive (>=30 characters)
    local short_desc_count
    short_desc_count=$(jq -r '.[] | select(.description | length < 30) | .description' "$filepath" 2>/dev/null | wc -l)
    local total_count
    total_count=$(jq '. | length' "$filepath" 2>/dev/null)
    
    if [[ $total_count -eq 0 ]]; then
        echo "FAIL"
        return 1
    fi
    
    # If most descriptions are short/gibberish, fail
    if [[ $short_desc_count -gt $(( total_count / 2 )) ]]; then
        echo "FAIL"
        return 1
    else
        echo "PASS"
        return 0
    fi
}

# Function to check suggested fix diversity
check_fix_diversity() {
    local filepath="$1"
    
    # Check if suggested fixes are unique and specific per issue
    local unique_fixes
    unique_fixes=$(jq -r '.[].suggested_fix' "$filepath" 2>/dev/null | sort -u | wc -l)
    local total_count
    total_count=$(jq '. | length' "$filepath" 2>/dev/null)
    
    if [[ $total_count -eq 0 ]]; then
        echo "FAIL"
        return 1
    fi
    
    # If only 1-3 unique fix strings across many issues, fail
    if [[ $unique_fixes -le 3 && $total_count -gt 5 ]]; then
        echo "FAIL"
        return 1
    else
        echo "PASS"
        return 0
    fi
}

# Function to log result
log_result() {
    local date_str="$1"
    local filename="$2"
    local score="$3"
    local structural_results="$4"
    local notes="$5"
    
    echo "" >> "$LINT_LOG"
    echo "### $date_str — $filename" >> "$LINT_LOG"
    echo "**Score: $score**" >> "$LINT_LOG"
    echo "" >> "$LINT_LOG"
    echo "| Check | Result | Notes |" >> "$LINT_LOG"
    echo "|---|---|---|" >> "$LINT_LOG"
    
    # Add structural check results
    local checks=("Top-level structure" "Required fields" "Description quality" "Suggested fix diversity")
    local results=(${(ps:|:)structural_results})
    
    for i in {1..4}; do
        local result_icon="❌"
        if [[ "${results[$i]}" == "PASS" ]]; then
            result_icon="✅"
        fi
        echo "| ${checks[$i]} | $result_icon | |" >> "$LINT_LOG"
    done
    
    # Add placeholder for Gemma check (skipped in this version)
    echo "| Gemma plausibility | ⏭️ | Skipped in v2 (structural focus) |" >> "$LINT_LOG"
    
    echo "" >> "$LINT_LOG"
    echo "**Notes:** $notes" >> "$LINT_LOG"
    echo "" >> "$LINT_LOG"
}

# Main processing
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Scanning for JSON files in $DATA_DIR"

# Get list of JSON files (not in subdirectories)
json_files=($(find "$DATA_DIR" -maxdepth 1 -name "*.json" -type f | sort))

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Found ${#json_files[@]} JSON files to check"

processed_count=0

for filepath in "${json_files[@]}"; do
    # Check if we've processed enough files for this run
    if [[ $processed_count -ge $MAX_FILES_PER_RUN ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Reached max files per run ($MAX_FILES_PER_RUN). Stopping."
        break
    fi
    
    filename=$(basename "$filepath")
    
    # Check if already linted (MANDATORY STEP)
    if is_already_linted "$filename"; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⏭️  Skipping $filename: already linted"
        continue
    fi
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔍 Processing $filename..."
    
    # Initialize results
    structural_results="||||"
    notes=""
    
    # Run checks
    struct_result=$(check_top_level_structure "$filepath")
    structural_results="$struct_result|$structural_results"
    
    # Only continue with other checks if structure is valid (array)
    if [[ "$struct_result" == "PASS" ]]; then
        fields_result=$(check_required_fields "$filepath")
        structural_results="$fields_result|$structural_results"
        
        desc_result=$(check_description_quality "$filepath")
        structural_results="$desc_result|$structural_results"
        
        fix_result=$(check_fix_diversity "$filepath")
        structural_results="$fix_result|$structural_results"
        
        notes="Structural validation completed"
    else
        # If structure failed, skip other structural checks
        structural_results="FAIL|FAIL|FAIL|FAIL|$structural_results"
        notes="Structural validation failed - not a valid array of issue objects"
    fi
    
    # Determine overall score
    # Count structural passes (first 4 results)
    local struct1 struct2 struct3 struct4
    struct1="${structural_results%%|*}"
    structural_results="${structural_results#*|}"
    struct2="${structural_results%%|*}"
    structural_results="${structural_results#*|}"
    struct3="${structural_results%%|*}"
    structural_results="${structural_results#*|}"
    struct4="${structural_results%%|*}"
    
    local structural_passes=0
    [[ "$struct1" == "PASS" ]] && ((structural_passes++))
    [[ "$struct2" == "PASS" ]] && ((structural_passes++))
    [[ "$struct3" == "PASS" ]] && ((structural_passes++))
    [[ "$struct4" == "PASS" ]] && ((structural_passes++))
    
    if [[ $structural_passes -eq 4 ]]; then
        score="PASS"
        notes="$notes - All structural checks passed"
    elif [[ $structural_passes -ge 2 ]]; then
        score="WARN"
        notes="$notes - Some structural issues detected"
    else
        score="FAIL"
        notes="$notes - Too many structural failures"
        
        # Move to quarantine if FAIL
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🚨 Moving $filename to quarantine"
        mv "$filepath" "$QUARANTINE_DIR/"
    fi
    
    # Log result
    date_str=$(date '+%Y-%m-%d')
    log_result "$date_str" "$filename" "$score" "$structural_results" "$notes"
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Finished processing $filename - Score: $score"
    ((processed_count++))
done

# Process remaining files if any
if [[ $processed_count -lt ${#json_files[@]} ]]; then
    remaining=$(( ${#json_files[@]} - processed_count ))
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $remaining files remaining for next run"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Gemma Data Linter v2 completed. Processed $processed_count files."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Check $LINT_LOG for details."