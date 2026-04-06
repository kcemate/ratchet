#!/usr/bin/env npx tsx
/**
 * knowledge/tools/build-index.ts
 * Scans knowledge/wiki/ and generates knowledge/_index.md
 * with table of contents, category breakdown, cross-references, and stats.
 *
 * Usage: npx tsx knowledge/tools/build-index.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '../..');
const WIKI_DIR = join(REPO_ROOT, 'knowledge/wiki');
const INDEX_PATH = join(REPO_ROOT, 'knowledge/_index.md');

// --- Types ---
interface ArticleMeta {
  filename: string;
  repoName: string;
  title: string;
  language: string;
  totalIssues: number;
  highCritical: number;
  scanDate: string;
  categories: string[];
  severityCounts: { critical: number; high: number; medium: number; low: number };
  overview: string;
}

// --- Parsing Helpers ---
function extractMetaFromArticle(content: string, filename: string): ArticleMeta {
  const repoName = basename(filename, '.md');
  
  // Extract title
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : repoName;
  
  // Extract YAML-like metadata block
  const metaMatch = content.match(/```yaml\n([\s\S]+?)\n```/);
  let language = 'Unknown';
  let totalIssues = 0;
  let highCritical = 0;
  let scanDate = '';
  let categories: string[] = [];
  
  if (metaMatch) {
    const metaBlock = metaMatch[1];
    const langMatch = metaBlock.match(/language:\s*(.+)/);
    const issuesMatch = metaBlock.match(/total_issues:\s*(\d+)/);
    const hcMatch = metaBlock.match(/severity_high_critical:\s*(\d+)/);
    const dateMatch = metaBlock.match(/scan_date:\s*(.+)/);
    const catMatch = metaBlock.match(/categories:\s*\[(.+)\]/);
    
    if (langMatch) language = langMatch[1].trim();
    if (issuesMatch) totalIssues = parseInt(issuesMatch[1]);
    if (hcMatch) highCritical = parseInt(hcMatch[1]);
    if (dateMatch) scanDate = dateMatch[1].trim();
    if (catMatch) categories = catMatch[1].split(',').map(c => c.trim());
  }
  
  // Fallback: try to extract issue counts from severity table
  if (totalIssues === 0) {
    const tableMatch = content.match(/\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/);
    if (tableMatch) totalIssues = parseInt(tableMatch[1]);
  }
  
  // Extract overview
  const overviewMatch = content.match(/## Overview\n+([\s\S]+?)(?=\n##|\n---)/);
  const overview = overviewMatch 
    ? overviewMatch[1].replace(/\n/g, ' ').replace(/\*\*/g, '').trim().slice(0, 200) + '...'
    : 'Code quality analysis article.';
  
  // Extract severity counts from table if present
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  const critMatch = content.match(/Critical\s*\|\s*(\d+)/i);
  const highMatch = content.match(/High\s*\|\s*(\d+)/i);
  const medMatch = content.match(/Medium\s*\|\s*(\d+)/i);
  const lowMatch = content.match(/Low\s*\|\s*(\d+)/i);
  if (critMatch) severityCounts.critical = parseInt(critMatch[1]);
  if (highMatch) severityCounts.high = parseInt(highMatch[1]);
  if (medMatch) severityCounts.medium = parseInt(medMatch[1]);
  if (lowMatch) severityCounts.low = parseInt(lowMatch[1]);
  
  return {
    filename,
    repoName,
    title,
    language,
    totalIssues,
    highCritical,
    scanDate: scanDate || new Date().toISOString().split('T')[0],
    categories,
    severityCounts,
    overview,
  };
}

function detectLanguage(repoName: string): string {
  const jsRepos = ['react', 'vue', 'javascript', 'node', 'typescript', 'angular', 'svelte'];
  const pyRepos = ['python', 'django', 'flask', 'fastapi'];
  const goRepos = ['golang', 'go-'];
  const rsRepos = ['rust', 'cargo'];
  
  const lower = repoName.toLowerCase();
  if (jsRepos.some(k => lower.includes(k))) return 'JavaScript/TypeScript';
  if (pyRepos.some(k => lower.includes(k))) return 'Python';
  if (goRepos.some(k => lower.includes(k))) return 'Go';
  if (rsRepos.some(k => lower.includes(k))) return 'Rust';
  return 'Unknown';
}

function buildCrossReferences(articles: ArticleMeta[]): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  
  for (const article of articles) {
    const related: string[] = [];
    
    for (const other of articles) {
      if (other.repoName === article.repoName) continue;
      
      // Same language
      const lang1 = article.language || detectLanguage(article.repoName);
      const lang2 = other.language || detectLanguage(other.repoName);
      if (lang1 !== 'Unknown' && lang1 === lang2) {
        related.push(other.repoName);
        continue;
      }
      
      // Shared categories
      const sharedCats = article.categories.filter(c => other.categories.includes(c));
      if (sharedCats.length >= 2) {
        related.push(other.repoName);
      }
    }
    
    refs.set(article.repoName, [...new Set(related)].slice(0, 5));
  }
  
  return refs;
}

// --- Main ---
async function main() {
  if (!existsSync(WIKI_DIR)) {
    console.error(`❌ Wiki directory not found: ${WIKI_DIR}`);
    process.exit(1);
  }
  
  const wikiFiles = readdirSync(WIKI_DIR).filter(f => f.endsWith('.md'));
  
  if (wikiFiles.length === 0) {
    console.log('ℹ️  No wiki articles found yet. Run ingest.ts first.');
    process.exit(0);
  }
  
  console.log(`📚 Found ${wikiFiles.length} wiki article(s)`);
  
  // Parse all articles
  const articles: ArticleMeta[] = [];
  for (const file of wikiFiles) {
    const content = readFileSync(join(WIKI_DIR, file), 'utf-8');
    const meta = extractMetaFromArticle(content, file);
    // Fill language from repo name if not detected
    if (meta.language === 'Unknown') {
      meta.language = detectLanguage(meta.repoName);
    }
    articles.push(meta);
    console.log(`  ✓ ${file}: ${meta.totalIssues} issues, ${meta.language}`);
  }
  
  // Build cross-references
  const xrefs = buildCrossReferences(articles);
  
  // Compute global stats
  const totalIssues = articles.reduce((s, a) => s + a.totalIssues, 0);
  const totalHighCritical = articles.reduce((s, a) => s + a.highCritical, 0);
  const allCategories = new Set(articles.flatMap(a => a.categories));
  const languageGroups = new Map<string, ArticleMeta[]>();
  for (const a of articles) {
    const lang = a.language || 'Unknown';
    if (!languageGroups.has(lang)) languageGroups.set(lang, []);
    languageGroups.get(lang)!.push(a);
  }
  const categoryGroups = new Map<string, ArticleMeta[]>();
  for (const a of articles) {
    for (const cat of a.categories) {
      if (!categoryGroups.has(cat)) categoryGroups.set(cat, []);
      categoryGroups.get(cat)!.push(a);
    }
  }
  
  const genDate = new Date().toISOString();
  
  // --- Build index content ---
  const lines: string[] = [
    `# Knowledge Base Index`,
    ``,
    `> Auto-generated by \`build-index.ts\` on ${genDate}`,
    ``,
    `## 📊 Statistics`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Repos scanned | ${articles.length} |`,
    `| Total issues found | ${totalIssues} |`,
    `| High/Critical issues | ${totalHighCritical} |`,
    `| Issue categories | ${allCategories.size} |`,
    `| Languages covered | ${languageGroups.size} |`,
    ``,
    `## 📑 Table of Contents`,
    ``,
  ];
  
  for (const article of articles.sort((a, b) => b.totalIssues - a.totalIssues)) {
    const priority = article.highCritical > 0 ? ' 🔴' : '';
    lines.push(`- [${article.repoName}](wiki/${article.filename})${priority} — ${article.totalIssues} issues`);
  }
  
  lines.push(``, `## 🌍 By Language`, ``);
  for (const [lang, arts] of [...languageGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${lang}`);
    lines.push(``);
    for (const a of arts) {
      lines.push(`- [${a.repoName}](wiki/${a.filename}) — ${a.overview}`);
    }
    lines.push(``);
  }
  
  lines.push(`## 🏷️ By Issue Category`, ``);
  for (const [cat, arts] of [...categoryGroups.entries()].sort((a, b) => b.length - a.length)) {
    lines.push(`### ${cat}`);
    lines.push(``);
    lines.push(`${arts.length} repo(s) affected: ${arts.map(a => `[${a.repoName}](wiki/${a.filename})`).join(', ')}`);
    lines.push(``);
  }
  
  lines.push(`## 🔗 Cross-References`, ``);
  for (const [repo, related] of xrefs) {
    if (related.length > 0) {
      lines.push(`**${repo}** → ${related.map(r => {
        const f = articles.find(a => a.repoName === r);
        return f ? `[${r}](wiki/${f.filename})` : r;
      }).join(', ')}`);
      lines.push(``);
    }
  }
  
  lines.push(`## 📄 Article Summaries`, ``);
  for (const article of articles.sort((a, b) => b.highCritical - a.highCritical)) {
    lines.push(`### [${article.title}](wiki/${article.filename})`);
    lines.push(``);
    lines.push(`**Language:** ${article.language} | **Issues:** ${article.totalIssues} total (${article.highCritical} high/critical) | **Scanned:** ${article.scanDate}`);
    lines.push(``);
    lines.push(article.overview);
    if (article.categories.length > 0) {
      lines.push(``);
      lines.push(`**Categories:** ${article.categories.join(', ')}`);
    }
    const related = xrefs.get(article.repoName) || [];
    if (related.length > 0) {
      const relatedLinks = related.map(r => {
        const f = articles.find(a => a.repoName === r);
        return f ? `[${r}](wiki/${f.filename})` : r;
      });
      lines.push(``);
      lines.push(`**See also:** ${relatedLinks.join(', ')}`);
    }
    lines.push(``);
  }
  
  lines.push(`---`);
  lines.push(`*Ratchet Knowledge Base — updated automatically by the pipeline*`);
  
  const content = lines.join('\n');
  writeFileSync(INDEX_PATH, content, 'utf-8');
  
  console.log(`\n✅ Index written to: ${INDEX_PATH}`);
  console.log(`   ${articles.length} articles | ${totalIssues} total issues | ${allCategories.size} categories`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
