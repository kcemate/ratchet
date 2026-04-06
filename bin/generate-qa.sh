#!/bin/bash

# Q&A Pair Generator for Ratchet training data
# Uses Gemma 4 locally via Ollama to generate Q&A pairs from scan JSONs

set -e

SCAN_DIR="$HOME/Projects/Ratchet/training-data/datagen"
QA_DIR="$HOME/Projects/Ratchet/knowledge/qa"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if ollama is available
if ! command -v ollama &> /dev/null; then
    echo -e "${RED}Error: ollama is not installed${NC}"
    exit 1
fi

# Check if Gemma 4 model is available
if ! ollama list | grep -q "gemma4:e4b"; then
    echo -e "${RED}Error: gemma4:e4b model not found. Please pull it first:${NC}"
    echo "ollama pull gemma4:e4b"
    exit 1
fi

# Find unprocessed repos
echo "Scanning for unprocessed repositories..."
scan_files=()
while IFS= read -r -d $'\0' file; do
    scan_files+=("$file")
done < <(find "$SCAN_DIR" -name "*.json" -type f -print0 | sort)

qa_files=()
while IFS= read -r -d $'\0' file; do
    qa_files+=("$file")
done < <(find "$QA_DIR" -name "*.jsonl" -type f -print0 | sort)

unprocessed=()

for scan_file in "${scan_files[@]}"; do
    repo_name=$(basename "$scan_file" .json)
    
    # Check if corresponding Q&A file exists
    qa_file="$QA_DIR/${repo_name}.jsonl"
    if [[ ! -f "$qa_file" ]]; then
        unprocessed+=("$repo_name")
    fi
done

if [[ ${#unprocessed[@]} -eq 0 ]]; then
    echo -e "${GREEN}✓ All repositories are up to date!${NC}"
    exit 0
fi

echo -e "${YELLOW}Found ${#unprocessed[@]} unprocessed repositories:${NC}"
printf '%s\n' "${unprocessed[@]}"

# Process up to 5 repos per run
max_to_process=5
processed_count=0

for repo in "${unprocessed[@]}"; do
    if [[ $processed_count -ge $max_to_process ]]; then
        echo -e "${YELLOW}Reached maximum of $max_to_process repos per run.${NC}"
        break
    fi
    
    scan_file="$SCAN_DIR/${repo}.json"
    qa_file="$QA_DIR/${repo}.jsonl"
    
    echo -e "\n${GREEN}Processing $repo...${NC}"
    
    # Create temporary directory for Python scripts
    tmpdir=$(mktemp -d)
    
    # Write Python script to extract issues
    cat > "$tmpdir/extract_issues.py" << 'ENDOFFILE'
import json
import sys

scan_file = sys.argv[1]
with open(scan_file, 'r') as f:
    data = json.load(f)

# Extract issues
issues = []
if isinstance(data, dict):
    if 'issues' in data and isinstance(data['issues'], list):
        issues = data['issues']
    elif 'files_analyzed' in data and 'issues' in data:
        issues = data['issues']
    else:
        for key, value in data.items():
            if isinstance(value, list) and len(value) > 0 and isinstance(value[0], dict):
                if 'issues' in value[0]:
                    for item in value:
                        if 'issues' in item and isinstance(item['issues'], list):
                            issues.extend(item['issues'])
                elif 'code' in value[0] or 'description' in value[0]:
                    issues.extend(value)
elif isinstance(data, list) and len(data) > 0:
    first_item = data[0]
    if isinstance(first_item, dict):
        if 'issues' in first_item and isinstance(first_item['issues'], list):
            for item in data:
                if 'issues' in item and isinstance(item['issues'], list):
                    issues.extend(item['issues'])
        elif 'code' in first_item or 'description' in first_item:
            issues.extend(data)

# Output all issues
for issue in issues:
    print(json.dumps(issue))
ENDOFFILE
    
    # Write Python script to extract repo name
    cat > "$tmpdir/extract_repo.py" << 'ENDOFFILE'
import json
import sys

scan_file = sys.argv[1]
with open(scan_file, 'r') as f:
    data = json.load(f)

if isinstance(data, dict):
    print(data.get('repo', ''))
elif isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
    print(data[0].get('repo', ''))
else:
    print("")
ENDOFFILE
    
    # Write Python script to count issues
    cat > "$tmpdir/count_issues.py" << 'ENDOFFILE'
import json
import sys

scan_file = sys.argv[1]
with open(scan_file, 'r') as f:
    data = json.load(f)

# Extract issues
issues = []
if isinstance(data, dict):
    if 'issues' in data and isinstance(data['issues'], list):
        issues = data['issues']
    elif 'files_analyzed' in data and 'issues' in data:
        issues = data['issues']
    else:
        for key, value in data.items():
            if isinstance(value, list) and len(value) > 0 and isinstance(value[0], dict):
                if 'issues' in value[0]:
                    for item in value:
                        if 'issues' in item and isinstance(item['issues'], list):
                            issues.extend(item['issues'])
                elif 'code' in value[0] or 'description' in value[0]:
                    issues.extend(value)
elif isinstance(data, list) and len(data) > 0:
    first_item = data[0]
    if isinstance(first_item, dict):
        if 'issues' in first_item and isinstance(first_item['issues'], list):
            for item in data:
                if 'issues' in item and isinstance(item['issues'], list):
                    issues.extend(item['issues'])
        elif 'code' in first_item or 'description' in first_item:
            issues.extend(data)

print(len(issues))
ENDOFFILE
    
    # Read scan JSON to get repo name and count issues
    python3 << 'PYEOF' > /tmp/scan_data.json
import json
import sys

scan_file = sys.argv[1]
with open(scan_file, 'r') as f:
    data = json.load(f)

output = {
    "repo": data.get('repo', "$repo"),
    "issues": []
}
issues = []
if isinstance(data, dict):
    if 'issues' in data and isinstance(data['issues'], list):
        issues = data['issues']
    elif 'files_analyzed' in data and 'issues' in data:
        issues = data['issues']
    else:
        for key, value in data.items():
            if isinstance(value, list) and len(value) > 0 and isinstance(value[0], dict):
                if 'issues' in value[0]:
                    for item in value:
                        if 'issues' in item and isinstance(item['issues'], list):
                            issues.extend(item['issues'])
                elif 'code' in value[0] or 'description' in value[0]:
                    issues.extend(value)
elif isinstance(data, list):
    if len(data) > 0:
        first_item = data[0]
        if isinstance(first_item, dict):
            if 'issues' in first_item and isinstance(first_item['issues'], list):
                for item in data:
                    if 'issues' in item and isinstance(item['issues'], list):
                        issues.extend(item['issues'])
            elif 'code' in first_item or 'description' in first_item:
                issues.extend(data)

output['issues'] = issues[:10]  # Return first 10 for preview
print(json.dumps(output))
PYEOF
    
    # Check if there was an error
    if grep -q '"error"' /tmp/scan_data.json; then
        error_msg=$(grep -o '"error": *"[^"]*"' /tmp/scan_data.json | cut -d'"' -f4)
        echo -e "${RED}Failed to read scan file: $error_msg${NC}"
        continue
    fi
    
    # Extract repo name from output
    repo_name=$(python3 "$tmpdir/extract_repo.py" "$scan_file" 2>/dev/null || echo "$repo")
    
    # Count issues
    total_issues=$(python3 "$tmpdir/count_issues.py" "$scan_file" 2>/dev/null || echo "0")
    
    echo "Repository: $repo_name"
    echo "Total issues found: $total_issues"
    
    # Create Q&A file
    echo "# Q&A pairs generated from $repo on $(date)" > "$qa_file"
    echo "# Total issues: $total_issues" >> "$qa_file"
    echo "# Generated by: $(whoami) on $(hostname)" >> "$qa_file"
    echo "" >> "$qa_file"
    
    # Process each issue
    issue_count=0
    success_count=0
    error_count=0
    
    # Extract all issues using the Python script
    while IFS= read -r issue_json; do
        issue_count=$((issue_count + 1))
        
        # Parse issue
        title=$(echo "$issue_json" | python3 -c "import json, sys; issue = json.load(sys.stdin); print(issue.get('title', issue.get('description', 'Unknown')))")
        code_snippet=$(echo "$issue_json" | python3 -c "import json, sys; issue = json.load(sys.stdin); print(issue.get('code', '') or issue.get('suggested_fix', '') or '')")
        language=$(echo "$issue_json" | python3 -c "import json, sys; issue = json.load(sys.stdin); print(issue.get('language', 'unknown'))")
        category=$(echo "$issue_json" | python3 -c "import json, sys; issue = json.load(sys.stdin); print(issue.get('category', 'Unknown'))")
        severity=$(echo "$issue_json" | python3 -c "import json, sys; issue = json.load(sys.stdin); print(issue.get('severity', 'Unknown'))")
        file_info=$(echo "$issue_json" | python3 -c "import json, sys; issue = json.load(sys.stdin); print(issue.get('file', 'Unknown'))")
        
        # If no code snippet, try to construct one
        if [[ -z "$code_snippet" ]]; then
            code_snippet="// Issue from $file_info\n$title"
        fi
        
        # Generate Q&A pairs using Gemma 4
        prompt=$(cat << EOF
Generate 2-3 detailed Q&A pairs for this code snippet and issue:

Code Snippet:
```python
$code_snippet
```

Issue Details:
- Title: $title
- Category: $category
- Severity: $severity
- Language: $language
- File: $file_info

Generate pairs in these exact formats:

1. Question: Review this code for security issues: [code snippet]
   Answer: [detailed analysis with severity, explanation, and fix]

2. Question: What production-readiness problems exist in this $language code? [code snippet]
   Answer: [structured analysis covering performance, reliability, maintainability]

3. Question: How would you fix [specific issue] in this code? [code snippet]
   Answer: [step by step fix with corrected code]

Make the answers comprehensive, authoritative, and suitable for fine-tuning a code review model.
EOF
)
        
        # Run ollama with timeout
        if output=$(timeout 60 ollama run gemma4:e4b "$prompt" 2>/dev/null); then
            # Write to Q&A file
            echo "" >> "$qa_file"
            echo "# Issue $issue_count/$total_issues" >> "$qa_file"
            echo "# Original: $title | Severity: $severity | Category: $category" >> "$qa_file"
            echo "$output" >> "$qa_file"
            echo "" >> "$qa_file"
            
            success_count=$((success_count + 1))
            echo -e "${GREEN}✓ Generated Q&A for issue $issue_count/$total_issues${NC}"
        else
            echo -e "${RED}✗ Failed to generate Q&A for issue $issue_count/$total_issues${NC}"
            echo "# FAILED TO GENERATE - Timeout or error" >> "$qa_file"
            echo "# Issue: $title" >> "$qa_file"
            echo "# Category: $category | Severity: $severity" >> "$qa_file"
            echo "" >> "$qa_file"
            error_count=$((error_count + 1))
        fi
        
    done < <(python3 "$tmpdir/extract_issues.py" "$scan_file")
    
    echo "" >> "$qa_file"
    echo "# Summary: Processed $success_count/$total_issues issues successfully, $error_count errors" >> "$qa_file"
    
    echo -e "${GREEN}✓ Completed $repo. Generated $success_count Q&A pairs ($error_count errors)${NC}"
    echo "File saved to: $qa_file"
    
    processed_count=$((processed_count + 1))
    
    # Clean up temporary directory
    rm -rf "$tmpdir"
    
done

echo -e "\n${GREEN}✅ Processing complete!${NC}"
echo "Processed $processed_count/${#unprocessed[@]} repositories"
echo "Next run: $(ls -1 "$QA_DIR"/*.jsonl | wc -l) total Q&A files"