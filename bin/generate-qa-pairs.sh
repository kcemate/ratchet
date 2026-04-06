#!/bin/bash

# Q&A Pair Generator using Gemma 4 locally via Ollama
# This script processes scan JSON files and generates Q&A training pairs

set -e

# Configuration
TRAINING_DIR="$HOME/Projects/Ratchet/training-data/datagen"
QA_DIR="$HOME/Projects/Ratchet/knowledge/qa"
MAX_PROCESS=5
OLLAMA_MODEL="gemma4:e4b"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    echo -e "${NC}[DEBUG]${NC} $1"
}

# Function to list JSON files
list_json_files() {
    local dir="$1"
    find "$dir" -name "*.json" -type f | sort
}

# Function to list JSONL files
list_jsonl_files() {
    local dir="$1"
    find "$dir" -name "*.jsonl" -type f | sort
}

# Function to extract repo name from JSON filename
extract_repo_name() {
    local json_file="$1"
    # Remove path and .json extension
    local base_name=$(basename "$json_file" .json")
    
    # Handle quarantine directory structure
    if [[ $base_name == *"/"* ]]; then
        base_name=$(echo "$base_name" | tr '/' '-')
    fi
    
    echo "$base_name"
}

# Function to check if a repo already has Q&A generated
has_qa_generated() {
    local repo_name="$1"
    local qa_file="$QA_DIR/${repo_name}.jsonl"
    
    if [ -f "$qa_file" ]; then
        return 0 # true
    else
        return 1 # false
    fi
}

# Function to extract code snippets and languages from scan JSON
extract_issues() {
    local json_file="$1"
    local temp_file="$2"
    
    # Try different possible JSON structures
    if jq -e 'type' < "$json_file" | grep -q 'array'; then
        # Check if it's an array of issues with 'code' field
        if jq -e '.[0] | has("code")' < "$json_file" > /dev/null 2>&1; then
            # Structure: array of objects with code, language, etc.
            jq -c '.[] | {code: .code, language: .language // "unknown", category: .category // "unknown"}' "$json_file" > "$temp_file"
        elif jq -e '.[0] | has("file")' < "$json_file" > /dev/null 2>&1; then
            # Structure: array of objects with file, line, description, etc.
            # Extract code from the file at the specified line
            jq -c '.[]' "$json_file" | while read -r issue; do
                file=$(echo "$issue" | jq -r '.file // ""')
                line=$(echo "$issue" | jq -r '.line // ""')
                description=$(echo "$issue" | jq -r '.description // ""')
                suggested_fix=$(echo "$issue" | jq -r '.suggested_fix // ""')
                category=$(echo "$issue" | jq -r '.category // "unknown"')
                
                # Try to get code snippet from the file if it exists
                local code="";
                if [ -n "$file" ] && [ -f "$file" ]; then
                    # File exists, try to get a snippet
                    if [ -n "$line" ] && [ "$line" -eq "$line" ] 2>/dev/null; then
                        start_line=$((line - 3))
                        end_line=$((line + 3))
                        # Get lines around the issue
                        code=$(sed -n "${start_line},${end_line}p" "$file" 2>/dev/null || cat "$file" 2>/dev/null | head -n 10)
                    else
                        # Just get the first few lines
                        code=$(head -n 10 "$file" 2>/dev/null)
                    fi
                fi
                
                # If we couldn't get code from file, use description and suggested_fix
                if [ -z "$code" ]; then
                    code="ISSUE: $description\n\nFIX: $suggested_fix"
                fi
                
                # Determine language from file extension if available
                language="unknown"
                if [ -n "$file" ]; then
                    ext="${file##*.}"
                    case "$ext" in
                        js|ts|jsx) language="javascript";;
                        py) language="python";;
                        go) language="go";;
                        java) language="java";;
                        rb) language="ruby";;
                        php) language="php";;
                        cs) language="csharp";;
                        c|cpp|h) language="cpp";;
                        rs) language="rust";;
                        *) language="unknown";;
                    esac
                fi
                
                echo "{\"code\": \"$code\", \"language\": \"$language\", \"category\": \"$category\"}" >> "$temp_file"
            done
        else
            # Unknown array structure
            log_warning "Unknown array structure in $json_file"
            > "$temp_file"
        fi
    else
        # Single issue object
        if jq -e 'has("code")' < "$json_file" > /dev/null 2>&1; then
            jq -c '{code: .code, language: .language // "unknown"}' "$json_file" > "$temp_file"
        elif jq -e 'has("file")' < "$json_file" > /dev/null 2>&1; then
            file=$(jq -r '.file // ""' "$json_file")
            line=$(jq -r '.line // ""' "$json_file")
            description=$(jq -r '.description // ""' "$json_file")
            suggested_fix=$(jq -r '.suggested_fix // ""' "$json_file")
            category=$(jq -r '.category // "unknown"' "$json_file")
            
            # Try to get code snippet from the file if it exists
            local code="";
            if [ -n "$file" ] && [ -f "$file" ]; then
                if [ -n "$line" ] && [ "$line" -eq "$line" ] 2>/dev/null; then
                    start_line=$((line - 3))
                    end_line=$((line + 3))
                    code=$(sed -n "${start_line},${end_line}p" "$file" 2>/dev/null || cat "$file" 2>/dev/null | head -n 10)
                else
                    code=$(head -n 10 "$file" 2>/dev/null)
                fi
            fi
            
            # If we couldn't get code from file, use description and suggested_fix
            if [ -z "$code" ]; then
                code="ISSUE: $description\n\nFIX: $suggested_fix"
            fi
            
            # Determine language from file extension if available
            language="unknown"
            if [ -n "$file" ]; then
                ext="${file##*.}"
                case "$ext" in
                    js|ts|jsx) language="javascript";;
                    py) language="python";;
                    go) language="go";;
                    java) language="java";;
                    rb) language="ruby";;
                    php) language="php";;
                    cs) language="csharp";;
                    c|cpp|h) language="cpp";;
                    rs) language="rust";;
                    *) language="unknown";;
                esac
            fi
            
            echo "{\"code\": \"$code\", \"language\": \"$language\", \"category\": \"$category\"}" > "$temp_file"
        else
            log_warning "Unknown single object structure in $json_file"
            > "$temp_file"
        fi
    fi
}

# Function to generate Q&A for a single scan JSON
generate_qa_for_scan() {
    local json_file="$1"
    local repo_name=$(extract_repo_name "$json_file")
    local qa_file="$QA_DIR/${repo_name}.jsonl"
    
    log_info "Processing $repo_name from $json_file"
    
    # Create temporary files
    local temp_issues=$(mktemp)
    local temp_qa=$(mktemp)
    
    # Extract issues from JSON
    extract_issues "$json_file" "$temp_issues"
    
    # Check if we got any issues
    if [ ! -s "$temp_issues" ]; then
        log_warning "No issues found in $json_file"
        rm -f "$temp_issues" "$temp_qa"
        return 1
    fi
    
    # Process each issue
    local issue_count=0
    while IFS= read -r issue; do
        issue_count=$((issue_count + 1))
        code=$(echo "$issue" | jq -r '.code // ""' 2>/dev/null)
        language=$(echo "$issue" | jq -r '.language // "unknown"' 2>/dev/null)
        category=$(echo "$issue" | jq -r '.category // "unknown"' 2>/dev/null)
        
        # Skip if code is empty
        if [ -z "$code" ] || [ "$code" = "null" ]; then
            continue
        fi
        
        log_debug "Processing issue $issue_count, language: $language, category: $category"
        
        # Generate 2-3 Q&A pairs per issue using different prompt templates
        generate_qa_pairs "$code" "$language" "$category" "$temp_qa"
        
    done < "$temp_issues"
    
    # Write Q&A pairs to file
    if [ -s "$temp_qa" ]; then
        # Sort and unique the Q&A pairs
        sort -u "$temp_qa" > "$qa_file"
        log_success "Generated $(wc -l < "$qa_file") Q&A pairs for $repo_name to $qa_file"
    else
        log_warning "No Q&A pairs generated for $repo_name"
        # Create empty file to mark as processed
        touch "$qa_file"
    fi
    
    # Cleanup
    rm -f "$temp_issues" "$temp_qa"
    
    return 0
}

# Function to generate Q&A pairs for a single code snippet
generate_qa_pairs() {
    local code="$1"
    local language="$2"
    local category="$3"
    local output_file="$4"
    
    # Escape code for JSON formatting
    escaped_code=$(echo "$code" | jq -Rs . 2>/dev/null || echo "\"code\"")
    
    # Prompt 1: Security review
    prompt1="Review this $language code for security issues. Provide a detailed analysis including:\n- Security vulnerabilities found\n- Severity assessment\n- Explanation of risks\n- Suggested fixes\n\nCode:\n$code"
    
    # Prompt 2: Production readiness
    prompt2="What production-readiness problems exist in this $language code? Provide a structured analysis covering:\n- Architecture issues\n- Performance concerns\n- Error handling problems\n- Scalability limitations\n- Best practices violations\n\nCode:\n$code"
    
    # Prompt 3: Specific issue fix
    prompt3="How would you fix potential $category issues in this $language code? Provide a step-by-step fix with corrected code.\n\nCode:\n$code"
    
    # Generate Q&A pairs using ollama run
    generate_single_qa_pair "$prompt1" "security-review" "$output_file" "$code" || true
    generate_single_qa_pair "$prompt2" "production-review" "$output_file" "$code" || true
    generate_single_qa_pair "$prompt3" "fix-issue" "$output_file" "$code" || true
}

# Function to generate a single Q&A pair
generate_single_qa_pair() {
    local prompt="$1"
    local category="$2"
    local output_file="$3"
    local code="$4"
    
    # Use ollama run with Gemma 4
    if command -v ollama &> /dev/null; then
        # Generate Q&A and format as JSON
        response=$(echo "$prompt" | ollama run "$OLLAMA_MODEL" 2>/dev/null || true)
        
        if [ -n "$response" ]; then
            # Format as Q&A pair - instruction is the prompt, output is the response
            # We'll create a single JSON object per line
            echo "{\"instruction\": \"$prompt\", \"output\": \"$response\", \"category\": \"$category\", \"language\": \"$(echo "$code" | head -c 50)\"}" >> "$output_file"
            return 0
        else
            log_warning "No response from Ollama for category: $category"
            return 1
        fi
    else
        log_error "Ollama not found. Please install Ollama to generate Q&A pairs."
        return 1
    fi
}

# Main function
main() {
    log_info "Starting Q&A Pair Generator"
    log_info "Using model: $OLLAMA_MODEL"
    
    # List all JSON files in training directory
    local json_files=$(list_json_files "$TRAINING_DIR")
    local json_count=$(echo "$json_files" | wc -l)
    
    log_info "Found $json_count JSON files in training directory"
    
    # List all JSONL files in QA directory
    local jsonl_files=$(list_jsonl_files "$QA_DIR")
    local jsonl_count=$(echo "$jsonl_files" | wc -l)
    
    log_info "Found $jsonl_count existing Q&A files in knowledge directory"
    
    # Debug: List all JSON files and their repo names
    log_debug "JSON files:"
    while IFS= read -r json_file; do
        repo_name=$(extract_repo_name "$json_file")
        echo "  $repo_name"
    done < <(echo "$json_files")
    
    # Debug: List all JSONL files and their repo names
    log_debug "JSONL files:"
    while IFS= read -r jsonl_file; do
        repo_name=$(basename "$jsonl_file" .jsonl")
        echo "  $repo_name"
    done < <(echo "$jsonl_files")
    
    # Find unprocessed repositories
    local unprocessed=()
    local processed_count=0
    
    while IFS= read -r json_file && [ $processed_count -lt $MAX_PROCESS ]; do
        repo_name=$(extract_repo_name "$json_file")
        
        if ! has_qa_generated "$repo_name"]; then
            unprocessed+=("$json_file")
            processed_count=$((processed_count + 1))
        fi
    done < <(echo "$json_files")
    
    local unprocessed_count=${#unprocessed[@]}
    
    if [ $unprocessed_count -eq 0 ]; then
        log_info "All repositories already have Q&A generated. Nothing to process."
        exit 0
    fi
    
    log_info "Processing $unprocessed_count unprocessed repositories (max $MAX_PROCESS per run):"
    for ((i=0; i<${#unprocessed[@]}; i++)); do
        log_info "  $((i+1)). $(extract_repo_name "${unprocessed[$i]}")"
    done
    
    # Process each unprocessed repository
    local success_count=0
    for json_file in "${unprocessed[@]}"; do
        if generate_qa_for_scan "$json_file"; then
            success_count=$((success_count + 1))
        else
            log_error "Failed to process: $(extract_repo_name "$json_file")"
        fi
    done
    
    log_success "Completed: Processed $success_count/${#unprocessed[@]} repositories"
}

# Run main function
main "$@"