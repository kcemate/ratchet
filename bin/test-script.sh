#!/bin/bash

# Minimal test script

set -e

TRAINING_DIR="$HOME/Projects/Ratchet/training-data/datagen"
QA_DIR="$HOME/Projects/Ratchet/knowledge/qa"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

extract_repo_name() {
    local json_file="$1"
    local base_name=$(basename "$json_file" .json)
    if [[ $base_name == *"/"* ]]; then
        base_name=$(echo "$base_name" | tr '/' '-')
    fi
    echo "$base_name"
}

list_json_files() {
    local dir="$1"
    find "$dir" -name "*.json" -type f | sort
}

list_jsonl_files() {
    local dir="$1"
    find "$dir" -name "*.jsonl" -type f | sort
}

has_qa_generated() {
    local repo_name="$1"
    local qa_file="$QA_DIR/${repo_name}.jsonl"
    if [ -f "$qa_file" ]; then
        return 0
    else
        return 1
    fi
}

main() {
    log_info "Starting Q&A Pair Generator"
    
    local json_files=$(list_json_files "$TRAINING_DIR")
    local jsonl_files=$(list_jsonl_files "$QA_DIR")
    
    log_info "JSON files:"
    while IFS= read -r json_file; do
        repo_name=$(extract_repo_name "$json_file")
        echo "  $repo_name"
    done < <(echo "$json_files")
    
    log_info "JSONL files:"
    while IFS= read -r jsonl_file; do
        repo_name=$(basename "$jsonl_file" .jsonl")
        echo "  $repo_name"
    done < <(echo "$jsonl_files")
}

main "$@"