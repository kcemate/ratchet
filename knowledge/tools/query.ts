#!/usr/bin/env npx tsx
/**
 * knowledge/tools/query.ts
 * Query the knowledge base using keyword/category matching.
 * Finds relevant wiki articles, builds context, and asks Otto.
 *
 * Usage: npx tsx knowledge/tools/query.ts "your question here"
 *        npx tsx knowledge/tools/query.ts --category architecture
 *        npx tsx knowledge/tools/query.ts --repo facebook-react "what are the main issues?"
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '../..');
const WIKI_DIR = join(REPO_ROOT, 'knowledge/wiki');
const INDEX_PATH = join(REPO_ROOT, 'knowledge/_index.md');

// --- Types ---
interface SearchResult {
  repoName: string;
  filename: string;
  score: number;
  matchedKeywords: string[];
  excerpt: string;
}

// --- Helpers ---
function parseArgs(): { query: string; category?: string; repo?: string; noOtto: boolean } {
  const args = process.argv.slice(2);
  const opts: { query: string; category?: string; repo?: string; noOtto: boolean } = {
    query: '',
    noOtto: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) opts.category = args[++i];
    else if (args[i] === '--repo' && args[i + 1]) opts.repo = args[++i];
    else if (args[i] === '--no-otto') opts.noOtto = true;
    else if (!args[i].startsWith('--')) opts.query += (opts.query ? ' ' : '') + args[i];
  }
  
  return opts;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function scoreArticle(content: string, keywords: string[]): { score: number; matched: string[] } {
  const contentLower = content.toLowerCase();
  const matched: string[] = [];
  let score = 0;
  
  for (const kw of keywords) {
    const count = (contentLower.match(new RegExp(kw, 'g')) || []).length;
    if (count > 0) {
      matched.push(kw);
      score += count;
      // Boost if keyword appears in heading
      if (contentLower.match(new RegExp(`#.+${kw}`))) score += 5;
      // Boost if keyword appears in category metadata
      if (contentLower.match(new RegExp(`categories:.+${kw}`))) score += 3;
    }
  }
  
  return { score, matched };
}

function extractExcerpt(content: string, keywords: string[]): string {
  const lines = content.split('\n');
  
  // Find the line with the most keyword matches
  let bestLine = '';
  let bestScore = 0;
  
  for (const line of lines) {
    if (line.startsWith('#') || line.trim().length < 20) continue;
    const lineLower = line.toLowerCase();
    const score = keywords.filter(kw => lineLower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }
  
  return bestLine ? bestLine.trim().slice(0, 200) : lines.find(l => l.trim().length > 50)?.slice(0, 200) || '';
}

function searchWiki(query: string, opts: { category?: string; repo?: string }): SearchResult[] {
  if (!existsSync(WIKI_DIR)) {
    return [];
  }
  
  const files = readdirSync(WIKI_DIR).filter(f => f.endsWith('.md'));
  const keywords = tokenize(query);
  
  // Add category and repo as forced keywords if specified
  if (opts.category) keywords.push(...tokenize(opts.category));
  if (opts.repo) keywords.push(...tokenize(opts.repo));
  
  const results: SearchResult[] = [];
  
  for (const file of files) {
    const repoName = basename(file, '.md');
    
    // Filter by repo if specified
    if (opts.repo && !repoName.toLowerCase().includes(opts.repo.toLowerCase())) {
      continue;
    }
    
    const content = readFileSync(join(WIKI_DIR, file), 'utf-8');
    
    // Filter by category if specified
    if (opts.category) {
      const catMatch = content.toLowerCase().includes(opts.category.toLowerCase());
      if (!catMatch) continue;
    }
    
    const { score, matched } = scoreArticle(content, keywords);
    
    if (score > 0 || opts.repo) {
      results.push({
        repoName,
        filename: file,
        score: opts.repo ? score + 100 : score, // Boost exact repo match
        matchedKeywords: matched,
        excerpt: extractExcerpt(content, keywords),
      });
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

function buildContext(results: SearchResult[]): string {
  const parts: string[] = [];
  
  for (const result of results) {
    const content = readFileSync(join(WIKI_DIR, result.filename), 'utf-8');
    
    // Extract key sections (don't dump the whole article)
    const sections: string[] = [];
    
    // Title + overview
    const titleMatch = content.match(/^(#[^\n]+)\n[\s\S]*?(## Overview[\s\S]+?)(?=\n##)/m);
    if (titleMatch) sections.push(titleMatch[1], titleMatch[2].slice(0, 500));
    
    // Critical issues section
    const critMatch = content.match(/(## Critical & High Issues[\s\S]+?)(?=\n##)/);
    if (critMatch) sections.push(critMatch[1].slice(0, 800));
    
    // Fix guide section
    const fixMatch = content.match(/(## Fix Guide[\s\S]+?)(?=\n##)/);
    if (fixMatch) sections.push(fixMatch[1].slice(0, 600));
    
    // Metadata
    const metaMatch = content.match(/(## Metadata[\s\S]+?)(?=\n---|$)/);
    if (metaMatch) sections.push(metaMatch[1].slice(0, 300));
    
    parts.push(`--- Article: ${result.repoName} (matched: ${result.matchedKeywords.join(', ')}) ---`);
    parts.push(sections.join('\n\n') || content.slice(0, 1000));
  }
  
  return parts.join('\n\n');
}

function callOtto(prompt: string): string {
  console.log('\n🦙 Asking Otto...\n');
  
  const result = spawnSync('ollama', ['run', 'otto'], {
    input: prompt,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180_000,
  });
  
  if (result.error) throw new Error(`Ollama error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Ollama exited with ${result.status}: ${result.stderr}`);
  
  let output = result.stdout || '';
  
  // Strip thinking text
  const headingOrBulletIdx = Math.min(
    output.indexOf('# ') > -1 ? output.indexOf('# ') : Infinity,
    output.indexOf('**') > -1 ? output.indexOf('**') : Infinity,
    output.indexOf('- ') > -1 ? output.indexOf('- ') : Infinity,
  );
  
  if (headingOrBulletIdx > 50 && headingOrBulletIdx < output.length) {
    output = output.slice(headingOrBulletIdx);
  }
  
  output = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  return output;
}

// --- Main ---
async function main() {
  const opts = parseArgs();
  
  if (!opts.query && !opts.category && !opts.repo) {
    console.log('Usage: npx tsx knowledge/tools/query.ts "your question"');
    console.log('       npx tsx knowledge/tools/query.ts --category architecture');
    console.log('       npx tsx knowledge/tools/query.ts --repo facebook-react "main issues?"');
    console.log('       npx tsx knowledge/tools/query.ts --no-otto "search without LLM"');
    process.exit(0);
  }
  
  const question = opts.query || `What are the main issues in ${opts.repo || 'the codebase'}?`;
  
  console.log(`🔍 Query: "${question}"`);
  if (opts.category) console.log(`   Category filter: ${opts.category}`);
  if (opts.repo) console.log(`   Repo filter: ${opts.repo}`);
  
  // Search wiki
  const results = searchWiki(question, { category: opts.category, repo: opts.repo });
  
  if (results.length === 0) {
    console.log('\n❌ No matching articles found in knowledge base.');
    console.log('   Run `npx tsx knowledge/tools/ingest.ts` to generate wiki articles first.');
    process.exit(0);
  }
  
  console.log(`\n📚 Found ${results.length} relevant article(s):`);
  for (const r of results) {
    console.log(`   - ${r.repoName} (score: ${r.score}, keywords: ${r.matchedKeywords.join(', ')})`);
    if (r.excerpt) console.log(`     "${r.excerpt.slice(0, 100)}..."`);
  }
  
  if (opts.noOtto) {
    // Just return the raw context
    console.log('\n--- Raw Context ---\n');
    console.log(buildContext(results));
    return;
  }
  
  // Build context and query Otto
  const context = buildContext(results);
  
  const prompt = `You are a senior software engineer answering questions about code quality using a knowledge base.

KNOWLEDGE BASE CONTEXT:
${context}

QUESTION: ${question}

Instructions:
- Answer based ONLY on the knowledge base context above
- Be specific and cite which repo/article you're drawing from
- If the context doesn't have enough information, say so clearly
- Format your answer in clear Markdown
- Include concrete actionable recommendations where relevant

Answer:`;
  
  try {
    const answer = callOtto(prompt);
    
    console.log('\n--- Answer ---\n');
    console.log(answer);
    
    console.log('\n--- Citations ---');
    for (const r of results) {
      console.log(`- knowledge/wiki/${r.filename}`);
    }
  } catch (err) {
    console.error(`\n❌ Otto failed: ${(err as Error).message}`);
    console.log('\nHere is the raw context instead:\n');
    console.log(buildContext(results));
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
