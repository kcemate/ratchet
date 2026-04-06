#!/usr/bin/env python3
import re

file_path = 'src/core/agents/shell.ts'
with open(file_path, 'r') as f:
    content = f.read()

# Find the buildIssuePlanPrompt function and modify its return statement
# We'll search for the pattern: "  return (\n    `You are a code improvement assistant..."
pattern = r'(  return \(\n    `You are a code improvement assistant\. Fix the top issue in \$\{targetPath\}\.\n\n` +)'
replacement = r"    `⚠️  CRITICAL: Do NOT invent, guess, or hallucinate file paths. Work ONLY on the provided target path.\n` +\n\1"
new_content = re.sub(pattern, replacement, content)

with open(file_path, 'w') as f:
    f.write(new_content)

print('File modified successfully')