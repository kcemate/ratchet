import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';

// --- Types ---

export interface CategoryResult {
  name: string;
  emoji: string;
  score: number;
  max: number;
  summary: string;
}

export interface ScanResult {
  projectName: string;
  total: number;
  maxTotal: number;
  categories: CategoryResult[];
}

// --- File discovery ---

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage', '__pycache__', '.cache', 'vendor', 'out']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs']);
const TEST_PATTERNS = ['.test.', '.spec.', '_test.', '_spec.', '/test/', '/tests/', '/spec/'];

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some(p => filePath.includes(p));
}

function findSourceFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue;
      const fullPath = join(current, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (CODE_EXTENSIONS.has(extname(entry))) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function readContents(files: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    try {
      map.set(file, readFileSync(file, 'utf-8'));
    } catch {
      map.set(file, '');
    }
  }
  return map;
}

// --- Scorers ---

function scoreTests(files: string[], cwd: string): CategoryResult {
  const testFiles = files.filter(isTestFile);
  const sourceFiles = files.filter(f => !isTestFile(f));

  let score = 0;
  const notes: string[] = [];

  if (testFiles.length > 0) {
    score += 6;
    notes.push(`${testFiles.length} test file${testFiles.length !== 1 ? 's' : ''}`);
  } else {
    notes.push('no test files');
  }

  // Test script in package.json
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
      const testScript = pkg.scripts?.test ?? '';
      if (testScript && !testScript.includes('no test') && !testScript.includes('echo "Error')) {
        score += 3;
        notes.push('test script configured');
      }
    } catch { /* ignore */ }
  }

  // Test-to-source ratio
  const ratio = sourceFiles.length > 0 ? testFiles.length / sourceFiles.length : 0;
  if (ratio >= 0.3) {
    score += 8;
    notes.push(`strong ratio (${Math.round(ratio * 100)}%)`);
  } else if (ratio >= 0.15) {
    score += 4;
    notes.push(`ok ratio (${Math.round(ratio * 100)}%)`);
  } else if (ratio > 0) {
    notes.push(`low ratio (${Math.round(ratio * 100)}%)`);
  }

  return { name: 'Testing', emoji: '🧪', score: Math.min(score, 17), max: 17, summary: notes.join(', ') };
}

function scoreErrorHandling(files: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));
  let score = 0;
  const notes: string[] = [];

  let tryCatchTotal = 0;
  let emptyCatchTotal = 0;
  let asyncTotal = 0;

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    tryCatchTotal += (content.match(/\btry\s*\{/g) ?? []).length;
    emptyCatchTotal += (content.match(/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g) ?? []).length;
    asyncTotal += (content.match(/\basync\s+function\b|\basync\s*\(/g) ?? []).length;
  }

  if (tryCatchTotal > 0) {
    score += 6;
    notes.push(`${tryCatchTotal} try/catch block${tryCatchTotal !== 1 ? 's' : ''}`);
  } else {
    notes.push('no try/catch found');
  }

  if (emptyCatchTotal === 0) {
    score += 5;
    notes.push('no empty catch blocks');
  } else {
    notes.push(`${emptyCatchTotal} empty catch${emptyCatchTotal !== 1 ? 'es' : ''}`);
  }

  // Async coverage
  if (asyncTotal === 0 || tryCatchTotal >= asyncTotal * 0.5) {
    score += 6;
    if (asyncTotal > 0) notes.push('async fns covered');
  } else {
    const pct = Math.round((tryCatchTotal / asyncTotal) * 100);
    const pts = Math.round((pct / 100) * 6);
    score += pts;
    notes.push(`${pct}% async coverage`);
  }

  return { name: 'Error Handling', emoji: '⚠️ ', score: Math.min(score, 17), max: 17, summary: notes.join(', ') };
}

function scoreTypes(files: string[], cwd: string, contents: Map<string, string>): CategoryResult {
  const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
  let score = 0;
  const notes: string[] = [];

  if (tsFiles.length === 0) {
    return { name: 'Types', emoji: '📝', score: 0, max: 17, summary: 'JavaScript only — no static types' };
  }

  score += 3;
  notes.push('TypeScript');

  // Strict mode in tsconfig
  const tsconfigPath = join(cwd, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8')) as {
        compilerOptions?: { strict?: boolean; noImplicitAny?: boolean };
      };
      if (tsconfig.compilerOptions?.strict) {
        score += 5;
        notes.push('strict mode');
      } else if (tsconfig.compilerOptions?.noImplicitAny) {
        score += 3;
        notes.push('noImplicitAny');
      } else {
        notes.push('no strict mode');
      }
    } catch { /* ignore */ }
  }

  // `any` density in source (not test) TS files
  const srcTsFiles = tsFiles.filter(f => !isTestFile(f));
  let anyCount = 0;
  let totalLines = 0;

  for (const file of srcTsFiles) {
    const content = contents.get(file) ?? '';
    anyCount += (content.match(/:\s*any\b|<any>|\bas\s+any\b/g) ?? []).length;
    totalLines += content.split('\n').length;
  }

  const anyPer1k = totalLines > 0 ? (anyCount / totalLines) * 1000 : 0;
  if (anyCount === 0) {
    score += 9;
    notes.push('zero any types');
  } else if (anyPer1k < 2) {
    score += 6;
    notes.push(`${anyCount} any type${anyCount !== 1 ? 's' : ''}`);
  } else if (anyPer1k < 5) {
    score += 3;
    notes.push(`${anyCount} any types (moderate)`);
  } else {
    notes.push(`${anyCount} any types (high)`);
  }

  return { name: 'Types', emoji: '📝', score: Math.min(score, 17), max: 17, summary: notes.join(', ') };
}

function scoreSecurity(files: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));
  let score = 0;
  const notes: string[] = [];

  const SECRET_PATTERNS = [
    /(?:api[_-]?key|apikey|secret|password|passwd|token)\s*=\s*['"][^'"]{8,}['"]/gi,
    /(?:sk-|pk-live_|ghp_|gho_|ghs_|AKIA)[A-Za-z0-9]{16,}/g,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
  ];

  let secretCount = 0;
  let usesEnvVars = false;
  let usesEval = false;

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    for (const pattern of SECRET_PATTERNS) {
      secretCount += (content.match(pattern) ?? []).length;
    }
    if (/\bprocess\.env\b|\bos\.environ\b|\bos\.getenv\b/.test(content)) {
      usesEnvVars = true;
    }
    if (/\beval\s*\(/.test(content)) {
      usesEval = true;
    }
  }

  if (secretCount === 0) {
    score += 6;
    notes.push('no hardcoded secrets');
  } else {
    notes.push(`${secretCount} potential secret${secretCount !== 1 ? 's' : ''}`);
  }

  if (usesEnvVars) {
    score += 4;
    notes.push('uses env vars');
  } else {
    notes.push('no env var usage');
  }

  if (!usesEval) {
    score += 6;
    notes.push('no eval()');
  } else {
    notes.push('eval() found');
  }

  return { name: 'Security', emoji: '🔒', score: Math.min(score, 16), max: 16, summary: notes.join(', ') };
}

function scorePerformance(files: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));
  let score = 0;
  const notes: string[] = [];

  let awaitInLoopCount = 0;
  let consoleLogCount = 0;

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    const lines = content.split('\n');

    consoleLogCount += (content.match(/\bconsole\.log\s*\(/g) ?? []).length;

    // Detect await inside for/while loops via line scanning
    let loopDepth = 0;
    let braceStack: number[] = [];

    for (const line of lines) {
      const stripped = line.trim();
      // Detect loop start
      if (/^\s*(?:for|while)\s*\(/.test(line) || /^\s*for\s+\w+/.test(line)) {
        loopDepth++;
        braceStack.push(0);
      }
      if (loopDepth > 0) {
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        if (braceStack.length > 0) {
          braceStack[braceStack.length - 1] = (braceStack[braceStack.length - 1] ?? 0) + opens - closes;
          if ((braceStack[braceStack.length - 1] ?? 0) < 0) {
            braceStack.pop();
            loopDepth = Math.max(0, loopDepth - 1);
          }
        }
        if (/\bawait\s+/.test(stripped)) {
          awaitInLoopCount++;
        }
      }
    }
  }

  if (awaitInLoopCount === 0) {
    score += 8;
    notes.push('no await-in-loop');
  } else {
    score += 3;
    notes.push(`${awaitInLoopCount} await-in-loop pattern${awaitInLoopCount !== 1 ? 's' : ''}`);
  }

  if (consoleLogCount === 0) {
    score += 8;
    notes.push('no console.log in src');
  } else if (consoleLogCount <= 5) {
    score += 5;
    notes.push(`${consoleLogCount} console.log`);
  } else {
    score += 2;
    notes.push(`${consoleLogCount} console.log calls`);
  }

  return { name: 'Performance', emoji: '⚡', score: Math.min(score, 16), max: 16, summary: notes.join(', ') };
}

function scoreReadability(files: string[], contents: Map<string, string>): CategoryResult {
  const srcFiles = files.filter(f => !isTestFile(f));
  let score = 0;
  const notes: string[] = [];

  let totalFnLength = 0;
  let fnCount = 0;
  let longLineCount = 0;
  let commentedCodeCount = 0;

  for (const file of srcFiles) {
    const content = contents.get(file) ?? '';
    const lines = content.split('\n');

    longLineCount += lines.filter(l => l.length > 120).length;
    commentedCodeCount += lines.filter(l =>
      /^\s*\/\/\s*(?:const|let|var|function|return|if\s*\(|for\s*\(|while\s*\(|import|export)\b/.test(l),
    ).length;

    // Estimate function lengths via brace tracking
    let fnStart = -1;
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isFnDecl =
        /\bfunction\s+\w+\s*\(/.test(line) ||
        /\b(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\(/.test(line) ||
        /\b(?:const|let)\s+\w+\s*=\s*async\s+function/.test(line);

      if (isFnDecl && line.includes('{') && fnStart === -1) {
        fnStart = i;
        depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      } else if (fnStart !== -1) {
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (depth <= 0) {
          fnCount++;
          totalFnLength += i - fnStart;
          fnStart = -1;
          depth = 0;
        }
      }
    }
  }

  const avgLen = fnCount > 0 ? totalFnLength / fnCount : 0;
  if (avgLen === 0 || avgLen <= 20) {
    score += 6;
    notes.push('short functions');
  } else if (avgLen <= 40) {
    score += 4;
    notes.push(`avg ${Math.round(avgLen)}-line functions`);
  } else {
    score += 2;
    notes.push(`long avg (${Math.round(avgLen)} lines)`);
  }

  if (longLineCount === 0) {
    score += 5;
    notes.push('no long lines');
  } else if (longLineCount <= 10) {
    score += 3;
    notes.push(`${longLineCount} long line${longLineCount !== 1 ? 's' : ''}`);
  } else {
    notes.push(`${longLineCount} long lines`);
  }

  if (commentedCodeCount === 0) {
    score += 6;
    notes.push('no dead code');
  } else if (commentedCodeCount <= 5) {
    score += 3;
    notes.push(`${commentedCodeCount} commented-out lines`);
  } else {
    notes.push(`${commentedCodeCount} commented-out lines`);
  }

  return { name: 'Readability', emoji: '📖', score: Math.min(score, 17), max: 17, summary: notes.join(', ') };
}

// --- Main scan logic ---

export async function runScan(cwd: string): Promise<ScanResult> {
  // Resolve project name from package.json or directory name
  let projectName = cwd.split('/').pop() ?? 'unknown';
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
      if (pkg.name) projectName = pkg.name;
    } catch { /* ignore */ }
  }

  const files = findSourceFiles(cwd);
  const contents = readContents(files);

  const categories: CategoryResult[] = [
    scoreTests(files, cwd),
    scoreErrorHandling(files, contents),
    scoreTypes(files, cwd, contents),
    scoreSecurity(files, contents),
    scorePerformance(files, contents),
    scoreReadability(files, contents),
  ];

  const total = categories.reduce((sum, c) => sum + c.score, 0);
  const maxTotal = categories.reduce((sum, c) => sum + c.max, 0);

  return { projectName, total, maxTotal, categories };
}

function scoreColor(score: number, max: number): chalk.Chalk {
  const pct = score / max;
  if (pct >= 0.8) return chalk.green;
  if (pct >= 0.5) return chalk.yellow;
  return chalk.red;
}

function renderScan(result: ScanResult): void {
  console.log('');
  console.log(chalk.bold('🔧 Ratchet Scan — Production Readiness'));
  console.log('');
  console.log(`Your app: ${chalk.cyan(result.projectName)}`);

  const pct = result.total / result.maxTotal;
  const totalColor = pct >= 0.8 ? chalk.green : pct >= 0.5 ? chalk.yellow : chalk.red;
  console.log(`Score:    ${totalColor.bold(`${result.total}/${result.maxTotal}`)}`);
  console.log('');

  for (const cat of result.categories) {
    const color = scoreColor(cat.score, cat.max);
    const label = `${cat.emoji} ${cat.name}`.padEnd(22);
    const score = color(`${cat.score}/${cat.max}`).padEnd(color === chalk.green ? 9 : color === chalk.yellow ? 9 : 9);
    console.log(`  ${label} ${score}  ${chalk.dim(cat.summary)}`);
  }

  console.log('');
  console.log(chalk.dim("Run 'npx ratchet fix' to improve your score."));
  console.log('');
}

// --- Command ---

export function scanCommand(): Command {
  const cmd = new Command('scan');

  cmd
    .description(
      'Scan the project and generate a Production Readiness Score (0-100).\n' +
      'Analyzes testing, error handling, types, security, performance, and readability.',
    )
    .argument('[dir]', 'Directory to scan (default: current directory)', '.')
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet scan\n' +
      '  $ ratchet scan ./my-project\n',
    )
    .action(async (dir: string) => {
      const { resolve } = await import('path');
      const cwd = resolve(dir);

      const result = await runScan(cwd);
      renderScan(result);
    });

  return cmd;
}
