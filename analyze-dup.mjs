import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', '.git', '.next', 'build', 'coverage', '__pycache__', '.cache', 'vendor', 'out'
]);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs']);
const TEST_PATTERNS = ['.test.', '.spec.', '_test.', '_spec.', '/test/', '/tests/', '/spec/'];

function isTestFile(fp) { return TEST_PATTERNS.some(p => fp.includes(p)); }

function findSourceFiles(dir) {
  const results = [];
  function walk(current) {
    let entries;
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue;
      const fullPath = join(current, entry);
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }
      if (stat.isDirectory()) walk(fullPath);
      else if (CODE_EXTENSIONS.has(extname(entry))) results.push(fullPath);
    }
  }
  walk(dir);
  return results;
}

const files = findSourceFiles('./src').filter(f => !isTestFile(f));
const lineFiles = new Map();
for (const file of files) {
  let content = '';
  try { content = readFileSync(file, 'utf-8'); } catch {}
  const lines = content.split('\n');
  for (const line of lines) {
    const s = line.trim();
    if (s.length > 10 && !s.startsWith('//') && !s.startsWith('*')) {
      if (!lineFiles.has(s)) lineFiles.set(s, { files: new Set(), count: 0 });
      lineFiles.get(s).files.add(file);
      lineFiles.get(s).count++;
    }
  }
}

const exactly3Files = [];
for (const [line, data] of lineFiles) {
  if (data.files.size === 3) {
    exactly3Files.push({ line: line.slice(0, 100),
      files: [...data.files].map(f => f.replace('/Users/giovanni/Projects/ratchet/', '')),
      count: data.count });
  }
}
exactly3Files.sort((a, b) => b.count - a.count);
console.log('Patterns in exactly 3 source files (top 20):');
exactly3Files.slice(0, 20).forEach(d => {
  console.log(d.count + 'x | ' + d.files.join(', ') + ' | ' + d.line.slice(0,80));
});

console.log('\nTotal duplicated lines:', [...lineFiles.values()].filter(d => d.count >= 3).length);
