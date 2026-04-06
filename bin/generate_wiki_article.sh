#!/bin/bash

# Generate wiki article for a Ratchet scan
# Usage: ./generate_wiki_article.sh <scan_file.json>

set -e

SCAN_FILE="$1"
WIKI_DIR="$HOME/Projects/Ratchet/knowledge/wiki"

# Validate input
if [ -z "$SCAN_FILE" ] || [ ! -f "$SCAN_FILE" ]; then
    echo "Error: Please provide a valid scan file path"
    exit 1
fi

# Extract repo info
filename=$(basename "$SCAN_FILE" .json)
IFS='-' read -r repo_owner repo_name <<< "$filename"
repo_name="${repo_name:-$repo_owner}"

# Read scan data
SCAN_DATA=$(cat "$SCAN_FILE" | jq -c '.' 2>/dev/null || cat "$SCAN_FILE")

# Build the prompt
PROMPT=$(cat <<'EOF'
You are an expert code analysis writer and quality assessor. Transform the raw scan JSON data below into a comprehensive, actionable wiki article.

SCAN_DATA: {{SCAN_DATA}}

ARTICLE REQUIREMENTS:
- Depth over breadth: Provide thorough analysis of significant issues
- Concrete examples: Include specific code snippets from the scan
- Actionable guidance: Every problem must have clear, implementable solutions
- Structured clarity: Organize for easy scanning and reference

ARTICLE STRUCTURE:
- Title: {{REPO_NAME}}
- Summary: 2-3 sentences about what the repo does, primary language, and rough size/complexity
- Issues Found: 3-5 significant, substantive issues (not minor nitpicks)
  - Each issue: clear description + specific code context + impact explanation
  - Use actual code snippets (not paraphrased)
- Patterns: 2-3 overarching anti-patterns across the issues
  - Show how different issues reflect the same underlying problem
- Fix Guide: Specific, step-by-step remediation instructions
  - Include before/after code examples
  - Explain why the fix works
- Severity Assessment: Well-reasoned opinion on production readiness
  - Consider issue severity, prevalence, and fix complexity

WRITING STYLE:
- Professional but accessible tone
- Use markdown formatting for scannability
- Include summary tables for quick reference
- Use emojis sparingly for emphasis (🔍, 🚨, ✅, 💡)
- Keep explanations concise but thorough

OUTPUT FORMAT:
```markdown
🔍 Code Analysis Summary Report

**File:** `{{SCAN_FILE}}`
**Primary Focus:** {primary_focus_areas}

{opening_summary}

---

## 💡 Analysis by Theme

### {Theme 1 Name} (Severity: {level}, Confidence: {level})
{detailed_analysis_with_code_examples}

### {Theme 2 Name} (Severity: {level}, Confidence: {level})
{detailed_analysis_with_code_examples}

...

## 🚀 Remediation Strategy (Action Plan)

### 🛠️ Priority 1: {Most_critical_fix}
{description}

### 🛡️ Priority 2: {Important_fix}
{description}

### 📊 Priority 3: {Nice_to_have}
{description}

---

## ✨ Summary Table

| Finding Category | Core Problem | Recommended Fix | Priority | Affected Components |
| :--- | :--- | :--- | :--- | :--- |

---

## 📊 Severity Assessment

**Overall Production-Readiness Opinion:** {emoji} **{Risk_Level}**  
{reasoning}

**Recommendation:** {action}
```

Generate the comprehensive wiki article for the {{REPO_NAME}} repository.
EOF
)

# Replace placeholders
PROMPT=${PROMPT//'{{SCAN_DATA}}'/$(echo "$SCAN_DATA" | jq -c '.' 2>/dev/null || echo "$SCAN_DATA")}
PROMPT=${PROMPT//'{{SCAN_FILE}}'/"$SCAN_FILE"}
PROMPT=${PROMPT//'{{REPO_NAME}}'/"$repo_owner-$repo_name"}

# Create temp file for prompt
TMP_FILE=$(mktemp)
echo "$PROMPT" > "$TMP_FILE"

# Run ollama and capture output
OUTPUT=$(cat "$TMP_FILE" | ollama run gemma4:e4b 2>&1)

# Clean up
rm "$TMP_FILE"

# Extract markdown content
if echo "$OUTPUT" | grep -q '```markdown'; then
    # Extract content between markdown code fences
    CONTENT=$(echo "$OUTPUT" | sed -n '/```markdown/,/```/p' | head -n -1 | tail -n +2)
else
    # Fallback: extract the analysis part
    CONTENT=$(echo "$OUTPUT" | awk '/SCAN_DATA:/,/Generate the comprehensive wiki article for the/{print}' | 
               sed 's/SCAN_DATA://;s/Generate the comprehensive wiki article for the.*//')
fi

# Write to wiki file
WIKI_FILE="$WIKI_DIR/${repo_owner}-${repo_name}.md"
echo "$CONTENT" > "$WIKI_FILE"

echo "✅ Successfully generated wiki article:"
echo "  Input:  $SCAN_FILE"
echo "  Output: $WIKI_FILE"
echo ""
echo "Generated content preview:"
echo "----------------------------------------------------------------"
echo "$CONTENT"
echo "----------------------------------------------------------------"

exit 0