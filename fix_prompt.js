const fs = require('fs');

const filePath = 'src/core/agents/shell.ts';
const content = fs.readFileSync(filePath, 'utf8');

// Find the line with fixGuidance and the return statement
const lines = content.split('\n');
let insertIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const fixGuidance = issues[0]?.fixInstruction;')) {
    // Look ahead for the return statement
    for (let j = i; j < Math.min(i + 20, lines.length); j++) {
      if (lines[j].includes('return (')) {
        // Find the first line with a backtick inside the return block
        for (let k = j; k < Math.min(j + 5, lines.length); k++) {
          if (lines[k].includes('`')) {
            // Insert new line after this line
            lines.insert(k + 1, "    `⚠️  CRITICAL: Do NOT invent, guess, or hallucinate file paths. Work ONLY on the provided target path.\n` +");
            insertIdx = k + 1;
            break;
          }
        }
        break;
      }
    }
    break;
  }
}

if (insertIdx !== -1) {
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  console.log('File modified successfully');
} else {
  console.log('Could not find insertion point');
}