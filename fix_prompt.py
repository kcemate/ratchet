import re

with open('src/core/agents/shell.ts', 'r') as f:
    content = f.read()

# Find the buildIssuePlanPrompt function and modify the return statement
pattern = r'(const fixGuidance = issues\[0\]?.fixInstruction\;\s*return \(\s*`⚠️  CRITICAL: Do NOT refactor, restructure, or rewrite functions\\n` +\s*`⚠️  CRITICAL: Do NOT rename variables, extract helpers, or "improve" unrelated code\\n` +\s*`⚠️  CRITICAL: Do NOT add new dependencies or change public function signatures\\n` +\s*`⚠️  CRITICAL: Do NOT change formatting, whitespace, or style in untouched lines\\n\\n` +\s*`You are a code improvement assistant\. Fix the top issue in \$\{targetPath\}\.\n\n` +)'
replacement = r'`⚠️  CRITICAL: Do NOT invent, guess, or hallucinate file paths. Work ONLY on the provided target path.\n` +\n\1'
new_content = re.sub(pattern, replacement, content)

with open('src/core/agents/shell.ts', 'w') as f:
    f.write(new_content)

print('File modified successfully')