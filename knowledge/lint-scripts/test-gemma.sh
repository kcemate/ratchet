#!/bin/bash

# Test script to debug Gemma 4 scoring

TEMP_DIR=$(mktemp -d)

# Create a sample JSON content
cat <<EOF > "$TEMP_DIR/sample.json"
[
  {
    "file": "test.py",
    "line": 10,
    "category": "error",
    "severity": "high",
    "description": "Missing import statement",
    "suggested_fix": "Add import at top",
    "confidence": 95
  },
  {
    "file": "test.py",
    "line": 15,
    "category": "warning",
    "severity": "medium",
    "description": "Unused variable",
    "suggested_fix": "Remove unused variable",
    "confidence": 85
  }
]
EOF

json_content=$(jq -c '.' "$TEMP_DIR/sample.json")

# Create prompt for Gemma 4
cat <<EOF > "$TEMP_DIR/gemma_prompt.txt"
You are a data quality expert. Review the following code issues extracted from a static analysis scan:

ISSUE SAMPLES:
$json_content

Review each issue and answer:
1. Are these real issues or hallucinated? (0-100% confidence)
2. Do the descriptions make sense? (0-100% clarity)
3. Are severity ratings reasonable? (0-100% accuracy)

Provide a brief analysis with specific scores for each dimension:
EOF

# Show the prompt
echo "PROMPT CREATED:"
cat "$TEMP_DIR/gemma_prompt.txt"
echo ""

# Run Gemma 4 via Ollama
if command -v ollama &>/dev/null; then
    echo "Running Gemma 4..."
    analysis=$(ollama run gemma4:e4b "$TEMP_DIR/gemma_prompt.txt" 2>&1)
    echo "ANALYSIS OUTPUT:"
    echo "$analysis"
else
    echo "Ollama not found"
fi

# Cleanup
rm -rf "$TEMP_DIR"
