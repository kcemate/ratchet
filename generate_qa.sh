#!/bin/bash

# Generate Q&A pairs for a given scan file
SCAN_FILE="$1"
REPO_NAME="$2"
OUTPUT_FILE="~/Projects/Ratchet/knowledge/qa/${REPO_NAME}.jsonl"

# Clear the output file
echo "" > "$OUTPUT_FILE"

# Read the JSON file and process each issue
jq -c '.[]' "$SCAN_FILE" | while read -r issue; do
  # Extract relevant fields
  file=$(echo "$issue" | jq -r '.file')
  line=$(echo "$issue" | jq -r '.line')
  category=$(echo "$issue" | jq -r '.category')
  severity=$(echo "$issue" | jq -r '.severity')
  description=$(echo "$issue" | jq -r '.description')
  suggested_fix=$(echo "$issue" | jq -r '.suggested_fix')
  
  # Create a code snippet reference
  code_snippet="[Code from ${file} line ${line}]"
  
  # Generate Q&A pair 1: Review for issues
  echo '{"instruction": "Review this code for '