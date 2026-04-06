#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

file_path = path.join(__dirname, 'src/core/agents/shell.ts');
content = fs.readFileSync(file_path, 'utf8');

// Find the buildIssuePlanPrompt function and modify its return statement
// We'll search for the pattern: "  return (\n    `You are a code improvement assistant..."
pattern = /(  return \(\n    `You are a code improvement assistant\. Fix the top issue in \$\{targetPath\}\.\n\n` +)/;
replacement = "    `⚠️  CRITICAL: Do NOT invent, guess, or hallucinate file paths. Work ONLY on the provided target path.\n` +\n\\1";
new_content = content.replace(pattern, replacement);

fs.writeFileSync(file_path, new_content, 'utf8');
console.log('File modified successfully');