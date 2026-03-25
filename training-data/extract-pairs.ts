import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

interface TrainingPair {
  id: string;
  category: string;
  file: string;
  before: string;
  after: string;
  instruction: string;
  score_impact: string;
}

const CATEGORIES: Record<string, string> = {
  '01': 'empty-catch-to-structured-error',
  '02': 'console-to-structured-logging',
  '03': 'console-to-structured-logging',
  '04': 'auth-rate-limiting',
  '05': 'route-decomposition',
  '06': 'n-plus-one-query-fix',
  '07': 'mixed-sweep-fixes',
  '08': 'mixed-torque-fixes',
  '09': 'bare-fetch-to-auth-request',
  '10': 'auth-integration-fix',
};

const INSTRUCTIONS: Record<string, string> = {
  'empty-catch-to-structured-error':
    'Replace the empty catch block with structured error handling using a logger.' +
    ' Log the error context including the operation name and any relevant variables.',
  'console-to-structured-logging':
    'Replace console.log/console.error calls with structured logging using pino logger.' +
    ' Include appropriate log levels and context objects.',
  'auth-rate-limiting':
    'Add authentication middleware and rate limiting to this Express route.' +
    ' Use proper middleware scoping (route-specific, not path-prefix).',
  'route-decomposition':
    'Decompose this monolithic routes file into domain-specific modules.' +
    ' Each module should handle one resource type with its own router.',
  'n-plus-one-query-fix': 'Fix the N+1 query by using batch fetching instead of per-item database calls.',
  'bare-fetch-to-auth-request':
    'Replace bare fetch() calls with the authenticated apiRequest() wrapper' +
    ' that includes the Bearer token header.',
  'auth-integration-fix':
    'Fix the auth integration to properly handle the Clerk authentication flow with redirect URLs.',
  'mixed-sweep-fixes': 'Apply the code quality improvement shown in this diff.',
  'mixed-torque-fixes': 'Apply the code quality improvement shown in this diff.',
};

function parseDiff(content: string): Array<{file: string, hunks: Array<{before: string, after: string}>}> {
  const files: Array<{file: string, hunks: Array<{before: string, after: string}>}> = [];
  const fileSections = content.split(/^diff --git /m).filter(s => s.trim());
  
  for (const section of fileSections) {
    const fileMatch = section.match(/a\/(.+?) b\//);
    if (!fileMatch) continue;
    const file = fileMatch[1];
    
    const hunks: Array<{before: string, after: string}> = [];
    const hunkParts = section.split(/^@@.*@@/m).slice(1);
    
    for (const hunk of hunkParts) {
      const lines = hunk.split('\n');
      const before: string[] = [];
      const after: string[] = [];
      
      for (const line of lines) {
        if (line.startsWith('-') && !line.startsWith('---')) {
          before.push(line.substring(1));
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          after.push(line.substring(1));
        } else if (line.startsWith(' ')) {
          before.push(line.substring(1));
          after.push(line.substring(1));
        }
      }
      
      if (before.join('').trim() !== after.join('').trim()) {
        hunks.push({ before: before.join('\n'), after: after.join('\n') });
      }
    }
    
    if (hunks.length > 0) files.push({ file, hunks });
  }
  return files;
}

import { fileURLToPath } from 'url';
import { dirname } from 'path';
const dir = dirname(fileURLToPath(import.meta.url));
const pairs: TrainingPair[] = [];
let pairId = 0;

for (const diffFile of readdirSync(dir).filter(f => f.endsWith('.diff')).sort()) {
  const prefix = diffFile.substring(0, 2);
  const category = CATEGORIES[prefix] || 'unknown';
  const instruction = INSTRUCTIONS[category] || 'Apply the code quality fix.';
  const content = readFileSync(join(dir, diffFile), 'utf-8');
  
  // Split on commit boundaries if present
  const commits = content.split('---END_COMMIT---').filter(c => c.trim());
  
  for (const commitContent of commits) {
    const files = parseDiff(commitContent);
    for (const file of files) {
      for (const hunk of file.hunks) {
        // Skip trivial hunks (< 3 meaningful lines changed)
        const beforeLines = hunk.before.split('\n').filter(l => l.trim()).length;
        const afterLines = hunk.after.split('\n').filter(l => l.trim()).length;
        if (beforeLines < 3 && afterLines < 3) continue;
        
        pairs.push({
          id: `fix_${String(++pairId).padStart(4, '0')}`,
          category,
          file: file.file,
          before: hunk.before.substring(0, 2000),
          after: hunk.after.substring(0, 2000),
          instruction,
          score_impact: category.includes('empty-catch') ? '+2-3' : 
                       category.includes('console') ? '+1-2' :
                       category.includes('auth') ? '+3-5' :
                       category.includes('route') ? '+5-10' :
                       category.includes('n-plus') ? '+2-3' : '+1-2',
        });
      }
    }
  }
}

// Write JSONL (standard fine-tuning format)
const jsonl = pairs.map(p => JSON.stringify({
  messages: [
    {
      role: 'system',
      content: 'You are Ratchet Fix, a code quality improvement engine. Given a code snippet with issues,' +
        ' output only the fixed version. Focus on: structured error handling, logging, type safety,' +
        ' auth patterns, and code organization.',
    },
    {
      role: 'user',
      content: `File: ${p.file}\nCategory: ${p.category}\nInstruction: ${p.instruction}` +
        `\n\nCode to fix:\n\`\`\`typescript\n${p.before}\n\`\`\``,
    },
    { role: 'assistant', content: `\`\`\`typescript\n${p.after}\n\`\`\`` }
  ]
})).join('\n');

writeFileSync(join(dir, 'ratchet-fix-v1.jsonl'), jsonl);

// Write summary
const catCounts: Record<string, number> = {};
for (const p of pairs) catCounts[p.category] = (catCounts[p.category] || 0) + 1;

const summary = `# Ratchet Fix Training Data v1
Generated: ${new Date().toISOString()}

## Stats
- Total pairs: ${pairs.length}
- Source repos: ratchet, DeuceDiary
- Format: ChatML JSONL (OpenAI/Unsloth compatible)

## Categories
${Object.entries(catCounts).sort((a,b) => b[1]-a[1]).map(([k,v]) => `- ${k}: ${v} pairs`).join('\n')}

## Source Commits
- Ratchet: 98205fb, 9e600e8, b188e98, 15249d0, cb297f6
- DeuceDiary: 3b90e02f, d4673ce2, f20c7e64, ef2d7631, 70bedc60,
  0f5f8513, 7fa3eb88, 73078970, 589cda32, 7a9249fe, 1162da95

## Usage
\`\`\`bash
# With Unsloth Studio
# 1. Load ratchet-fix-v1.jsonl as training data
# 2. Base model: Qwen 3.5 7B or Llama 4 Scout 8B
# 3. LoRA rank 16, epochs 3-5, lr 2e-4
# 4. Export to GGUF Q4_K_M for Ollama
\`\`\`
`;

writeFileSync(join(dir, 'README.md'), summary);

console.log(`✅ Generated ${pairs.length} training pairs`);
console.log(`Categories: ${JSON.stringify(catCounts, null, 2)}`);
