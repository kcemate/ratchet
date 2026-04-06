#!/usr/bin/env npx tsx
/**
 * knowledge/tools/ingest.ts
 * Reads scan JSON files from training-data/datagen/, groups by repo,
 * and generates structured wiki articles using local Otto (ollama).
 *
 * Usage: npx tsx knowledge/tools/ingest.ts [--limit N] [--repo <name>] [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '../..');
const DATAGEN_DIR = join(REPO_ROOT, 'training-data/datagen');
const WIKI_DIR = join(REPO_ROOT, 'knowledge/wiki');
const RAW_DIR = join(REPO_ROOT, 'knowledge/raw');

// Ensure output dirs exist
mkdirSync(WIKI_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });

// --- Types ---
interface Issue {
  file?: string;
  line?: number;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  suggested_fix?: string;
  confidence?: number | string;
}

interface ScanResult {
  file?: string;
  issues?: Issue[];
}

type ScanData = ScanResult | Issue[];

// --- Helpers ---
function parseArgs() {
  const args = process.argv.slice(2);
  const opts: { limit?: number; repo?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i]);
    if (args[i] === '--repo' && args[i + 1]) opts.repo = args[++i];
    if (args[i] === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

function getRepoName(filename: string): string {
  // Strip path and extension
  const base = basename(filename, '.json');
  // Map sub-file scans to repo names
  // e.g. facebook-react-hooks -> facebook-react
  // e.g. trekhleb-javascript-algorithms -> trekhleb-javascript-algorithms
  // We keep the full name unless there's a clear sub-module pattern
  return base;
}

function groupByRepo(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  
  // Try to group sub-module scans under their parent repo
  const repoPatterns: { pattern: RegExp; repo: string }[] = [
    { pattern: /^facebook-react/, repo: 'facebook-react' },
    { pattern: /^vuejs-core/, repo: 'vuejs-core' },
    { pattern: /^trekhleb-javascript-algorithms/, repo: 'trekhleb-javascript-algorithms' },
  ];
  
  for (const file of files) {
    const base = basename(file, '.json');
    let matched = false;
    for (const { pattern, repo } of repoPatterns) {
      if (pattern.test(base)) {
        if (!groups.has(repo)) groups.set(repo, []);
        groups.get(repo)!.push(file);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base)!.push(file);
    }
  }
  
  return groups;
}

function loadScanFiles(filePaths: string[]): Issue[] {
  const allIssues: Issue[] = [];
  
  for (const filePath of filePaths) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data: ScanData = JSON.parse(raw);
      
      if (Array.isArray(data)) {
        // Format: [{file, line, category, severity, description, ...}]
        allIssues.push(...data as Issue[]);
      } else if (data.issues && Array.isArray(data.issues)) {
        // Format: {file, issues: [{...}]}
        const parentFile = data.file;
        for (const issue of data.issues) {
          allIssues.push({ ...issue, file: issue.file || parentFile });
        }
      }
    } catch (err) {
      console.warn(`⚠️  Failed to parse ${filePath}:`, (err as Error).message);
    }
  }
  
  return allIssues;
}

function buildPrompt(repoName: string, issues: Issue[], sourceFiles: string[]): string {
  const totalIssues = issues.length;
  const bySeverity = {
    critical: issues.filter(i => i.severity === 'critical').length,
    high: issues.filter(i => i.severity === 'high').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    low: issues.filter(i => i.severity === 'low').length,
  };
  const byCategory = new Map<string, number>();
  for (const issue of issues) {
    byCategory.set(issue.category, (byCategory.get(issue.category) || 0) + 1);
  }
  
  // Sample top issues (max 15 to keep prompt manageable)
  const topIssues = issues
    .sort((a, b) => {
      const rank = { critical: 4, high: 3, medium: 2, low: 1 };
      return (rank[b.severity] || 0) - (rank[a.severity] || 0);
    })
    .slice(0, 15);
  
  const issueList = topIssues
    .map((i, idx) => 
      `${idx + 1}. [${i.severity.toUpperCase()}] ${i.category} — ${i.description}${i.suggested_fix ? `\n   Fix: ${i.suggested_fix}` : ''}`
    )
    .join('\n\n');
  
  const categoryBreakdown = [...byCategory.entries()]
    .map(([cat, count]) => `- ${cat}: ${count} issues`)
    .join('\n');
  
  return `You are a senior software engineer writing technical documentation for a code quality knowledge base.

Generate a structured wiki article in Markdown for the repository "${repoName}".

DATA:
- Total issues found: ${totalIssues}
- Severity breakdown: ${bySeverity.critical} critical, ${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low
- Source files scanned: ${sourceFiles.map(f => basename(f)).join(', ')}
- Category breakdown:
${categoryBreakdown}

TOP ISSUES (sorted by severity):
${issueList}

Write a wiki article with EXACTLY these sections in order:
1. A title: "# [repo-name] — Code Quality Analysis"
2. ## Overview — 2-3 sentence repo summary and overall quality assessment
3. ## Severity Assessment — brief table or bullet list showing issue counts by severity
4. ## Common Patterns — the 3-5 most recurring issue patterns found
5. ## Critical & High Issues — details on the most important issues to fix
6. ## Fix Guide — prioritized list of actionable fixes (start with highest impact)
7. ## Metadata — frontmatter-style block with: repo, language, total_issues, scan_date

Be concise and technical. Output ONLY valid Markdown, no preamble, no thinking text, no explanation outside the article.`;
}

function callOtto(prompt: string): string {
  console.log('  🦙 Calling Otto (this takes ~60-90s)...');
  
  const result = spawnSync('ollama', ['run', 'otto'], {
    input: prompt,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB
    timeout: 180_000, // 3 min timeout
  });
  
  if (result.error) {
    throw new Error(`Ollama error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Ollama exited with ${result.status}: ${result.stderr}`);
  }
  
  let output = result.stdout || '';
  
  // Otto sometimes outputs thinking text before the actual content.
  // Strip everything before the first markdown heading.
  const headingIdx = output.indexOf('# ');
  if (headingIdx > 0) {
    output = output.slice(headingIdx);
  }
  
  // Also strip common thinking patterns like "<think>...</think>" blocks
  output = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  return output;
}

function generateFallbackArticle(repoName: string, issues: Issue[], sourceFiles: string[]): string {
  const totalIssues = issues.length;
  const bySeverity = {
    critical: issues.filter(i => i.severity === 'critical'),
    high: issues.filter(i => i.severity === 'high'),
    medium: issues.filter(i => i.severity === 'medium'),
    low: issues.filter(i => i.severity === 'low'),
  };
  const byCategory = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (!byCategory.has(issue.category)) byCategory.set(issue.category, []);
    byCategory.get(issue.category)!.push(issue);
  }
  
  const topIssues = [...bySeverity.critical, ...bySeverity.high].slice(0, 5);
  
  const date = new Date().toISOString().split('T')[0];
  const lang = repoName.includes('javascript') || repoName.includes('react') || repoName.includes('vue') ? 'JavaScript/TypeScript' : 'Unknown';
  
  return `# ${repoName} — Code Quality Analysis

## Overview

Static analysis of the \`${repoName}\` repository identified **${totalIssues} issues** across ${sourceFiles.length} scanned file(s). The codebase shows patterns typical of a mature project with areas needing attention in architecture, performance, and code quality.

## Severity Assessment

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${bySeverity.critical.length} |
| 🟠 High | ${bySeverity.high.length} |
| 🟡 Medium | ${bySeverity.medium.length} |
| 🟢 Low | ${bySeverity.low.length} |
| **Total** | **${totalIssues}** |

## Common Patterns

${[...byCategory.entries()].slice(0, 5).map(([cat, items]) => 
  `- **${cat}** (${items.length} issues): ${items[0]?.description?.slice(0, 100)}...`
).join('\n')}

## Critical & High Issues

${topIssues.length > 0 ? topIssues.map((issue, i) => 
  `### ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.category}
${issue.file ? `**File:** \`${issue.file}\`` : ''}${issue.line ? ` line ${issue.line}` : ''}

${issue.description}

**Fix:** ${issue.suggested_fix || 'See general fix guide below.'}`
).join('\n\n') : '_No critical or high issues found._'}

## Fix Guide

${[...byCategory.entries()].map(([cat, items]) => {
  const highPrio = items.filter(i => i.severity === 'high' || i.severity === 'critical');
  return `**${cat}** — ${highPrio.length > 0 ? `${highPrio.length} high-priority items. Start with: ${highPrio[0]?.suggested_fix?.slice(0, 150) || 'Review issues above.'}` : `${items.length} lower-priority items.`}`;
}).join('\n\n')}

## Metadata

\`\`\`yaml
repo: ${repoName}
language: ${lang}
total_issues: ${totalIssues}
severity_high_critical: ${bySeverity.critical.length + bySeverity.high.length}
scan_date: ${date}
source_files: ${sourceFiles.length}
categories: [${[...byCategory.keys()].join(', ')}]
generated_by: ratchet-knowledge-base
\`\`\`
`;
}

// --- Main ---
async function main() {
  const opts = parseArgs();
  
  // Collect all JSON files
  const allFiles: string[] = [];
  
  const scanDir = (dir: string) => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.json')) {
          allFiles.push(fullPath);
        }
      }
    } catch (err) {
      console.warn(`⚠️  Cannot read dir ${dir}:`, (err as Error).message);
    }
  };
  
  scanDir(DATAGEN_DIR);
  
  if (allFiles.length === 0) {
    console.error(`❌ No JSON files found in ${DATAGEN_DIR}`);
    process.exit(1);
  }
  
  console.log(`📂 Found ${allFiles.length} scan files`);
  
  // Group by repo
  const groups = groupByRepo(allFiles);
  console.log(`🗂️  Grouped into ${groups.size} repos: ${[...groups.keys()].join(', ')}`);
  
  // Filter by repo if specified
  let repos = [...groups.keys()];
  if (opts.repo) {
    repos = repos.filter(r => r.includes(opts.repo!));
    if (repos.length === 0) {
      console.error(`❌ No repos matching "${opts.repo}"`);
      process.exit(1);
    }
  }
  
  // Apply limit
  const limit = opts.limit ?? 3; // Default: max 3 articles per run
  repos = repos.slice(0, limit);
  console.log(`📝 Processing ${repos.length} repos (limit: ${limit})\n`);
  
  let processed = 0;
  let skipped = 0;
  
  for (const repoName of repos) {
    const files = groups.get(repoName)!;
    const wikiPath = join(WIKI_DIR, `${repoName}.md`);
    
    console.log(`\n🔍 Processing: ${repoName}`);
    console.log(`   Files: ${files.map(f => basename(f)).join(', ')}`);
    
    // Load and aggregate issues
    const issues = loadScanFiles(files);
    console.log(`   Issues: ${issues.length} total`);
    
    if (issues.length === 0) {
      console.log(`   ⏭️  Skipping — no issues found`);
      skipped++;
      continue;
    }
    
    // Save raw data
    const rawPath = join(RAW_DIR, `${repoName}-aggregated.json`);
    writeFileSync(rawPath, JSON.stringify({ repo: repoName, files: files.map(f => basename(f)), issues }, null, 2));
    
    if (opts.dryRun) {
      console.log(`   🔧 Dry run — would generate wiki at ${wikiPath}`);
      processed++;
      continue;
    }
    
    // Generate wiki article
    let article: string;
    try {
      const prompt = buildPrompt(repoName, issues, files);
      article = callOtto(prompt);
      
      // Validate output looks like markdown
      if (!article.includes('#') || article.length < 200) {
        console.warn(`   ⚠️  Otto output seems short/invalid, using fallback generator`);
        article = generateFallbackArticle(repoName, issues, files);
      }
    } catch (err) {
      console.warn(`   ⚠️  Otto failed: ${(err as Error).message}`);
      console.log(`   📄 Using fallback generator...`);
      article = generateFallbackArticle(repoName, issues, files);
    }
    
    // Add generation metadata footer
    const genDate = new Date().toISOString();
    article += `\n\n---\n*Generated by ratchet knowledge base pipeline on ${genDate}*\n`;
    
    writeFileSync(wikiPath, article, 'utf-8');
    console.log(`   ✅ Written: ${wikiPath}`);
    processed++;
  }
  
  console.log(`\n✅ Done: ${processed} articles generated, ${skipped} skipped`);
  console.log(`📁 Wiki articles in: ${WIKI_DIR}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
