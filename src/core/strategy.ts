import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger.js';
import type { ScanResult } from '../commands/scan.js';
import type { RatchetRun, Click } from '../types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CodebaseProfile {
  name: string;
  techStack: string[];
  patterns: string[];
  testFramework: string;
  totalFiles: number;
  lastScanned: string;
}

export interface StrategyInsight {
  id: string;
  type: 'what-works' | 'what-fails' | 'observation';
  description: string;
  evidence: string;
  confidence: number; // 0-1
  createdAt: string;
  runId: string;
}

export interface HotSpot {
  filePath: string;
  rollbackRate: number;
  attempts: number;
  lastAttempt: string;
  notes: string;
}

export interface AntiPattern {
  pattern: string;
  occurrences: number;
  lastSeen: string;
  example: string;
}

export interface RunSummary {
  runId: string;
  date: string;
  mode: string;
  scoreBefore: number;
  scoreAfter: number;
  landed: number;
  rolledBack: number;
  keyInsight: string;
}

export interface Strategy {
  version: number;
  createdAt: string;
  updatedAt: string;
  profile: CodebaseProfile;
  insights: StrategyInsight[];
  hotSpots: HotSpot[];
  antiPatterns: AntiPattern[];
  runSummaries: RunSummary[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STRATEGY_FILE = '.ratchet/strategy.md';
const MAX_RUN_SUMMARIES = 20;
const HOT_SPOT_MIN_ATTEMPTS = 3;
const HOT_SPOT_ROLLBACK_THRESHOLD = 0.5;
const CONFIDENCE_DECAY = 0.1;

// ── YAML Frontmatter Parser ───────────────────────────────────────────────────

function parseYamlValue(val: string): unknown {
  const trimmed = val.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;
  // Strip surrounding quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseInlineArray(val: string): string[] {
  const trimmed = val.trim();
  if (!trimmed.startsWith('[')) return [trimmed].filter(Boolean);
  const inner = trimmed.slice(1, -1);
  return inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Supports: key: value, key: [a, b, c], nested objects (one level via key.subkey).
 */
function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const yaml = match[1];
  const body = match[2] ?? '';
  const data: Record<string, unknown> = {};

  const lines = yaml.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === '' || rest === '|' || rest === '>') {
      // Check if next lines are a YAML list
      const list: string[] = [];
      i++;
      while (i < lines.length && lines[i].trimStart().startsWith('-')) {
        list.push(lines[i].trimStart().slice(1).trim().replace(/^["']|["']$/g, ''));
        i++;
      }
      if (list.length > 0) {
        data[key] = list;
      }
      continue;
    }

    if (rest.startsWith('[')) {
      data[key] = parseInlineArray(rest);
    } else {
      data[key] = parseYamlValue(rest);
    }
    i++;
  }

  return { data, body };
}

/**
 * Serialize a value to YAML inline format.
 */
function toYamlValue(val: unknown): string {
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    return '[' + val.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(', ') + ']';
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'string') {
    // Quote if contains special chars
    if (/[:#\[\]{},]/.test(val) || val.includes('\n')) {
      return `"${val.replace(/"/g, '\\"')}"`;
    }
    return val;
  }
  return String(val);
}

// ── Serialization ─────────────────────────────────────────────────────────────

function strategyToMarkdown(strategy: Strategy): string {
  const fm = [
    '---',
    `version: ${strategy.version}`,
    `createdAt: ${strategy.createdAt}`,
    `updatedAt: ${strategy.updatedAt}`,
    '',
    '# Codebase Profile',
    `profile.name: ${toYamlValue(strategy.profile.name)}`,
    `profile.techStack: ${toYamlValue(strategy.profile.techStack)}`,
    `profile.patterns: ${toYamlValue(strategy.profile.patterns)}`,
    `profile.testFramework: ${toYamlValue(strategy.profile.testFramework)}`,
    `profile.totalFiles: ${strategy.profile.totalFiles}`,
    `profile.lastScanned: ${strategy.profile.lastScanned}`,
    '---',
  ].join('\n');

  const sections: string[] = [];

  sections.push(`# Ratchet Strategy — ${strategy.profile.name}\n`);
  sections.push(`> Auto-generated by Ratchet v${strategy.version}. Last updated: ${strategy.updatedAt}\n`);

  // Profile
  sections.push(`## Codebase Profile\n`);
  sections.push(`- **Name:** ${strategy.profile.name}`);
  sections.push(`- **Tech stack:** ${strategy.profile.techStack.join(', ') || 'unknown'}`);
  sections.push(`- **Test framework:** ${strategy.profile.testFramework}`);
  sections.push(`- **Total files:** ${strategy.profile.totalFiles}`);
  sections.push(`- **Patterns:** ${strategy.profile.patterns.join(', ') || 'none detected'}`);
  sections.push('');

  // Insights
  const works = strategy.insights.filter(i => i.type === 'what-works');
  const fails = strategy.insights.filter(i => i.type === 'what-fails');
  const obs = strategy.insights.filter(i => i.type === 'observation');

  if (works.length > 0) {
    sections.push(`## What Works\n`);
    for (const ins of works) {
      const conf = Math.round(ins.confidence * 100);
      sections.push(`### ${ins.description}`);
      sections.push(`- **Evidence:** ${ins.evidence}`);
      sections.push(`- **Confidence:** ${conf}%`);
      sections.push(`- **Run:** ${ins.runId} | **Added:** ${ins.createdAt}`);
      sections.push('');
    }
  }

  if (fails.length > 0) {
    sections.push(`## What Doesn't Work\n`);
    for (const ins of fails) {
      const conf = Math.round(ins.confidence * 100);
      sections.push(`### ${ins.description}`);
      sections.push(`- **Evidence:** ${ins.evidence}`);
      sections.push(`- **Confidence:** ${conf}%`);
      sections.push(`- **Run:** ${ins.runId} | **Added:** ${ins.createdAt}`);
      sections.push('');
    }
  }

  if (obs.length > 0) {
    sections.push(`## Observations\n`);
    for (const ins of obs) {
      sections.push(`- ${ins.description} _(${ins.evidence})_`);
    }
    sections.push('');
  }

  // Hot spots
  if (strategy.hotSpots.length > 0) {
    sections.push(`## Hot Spots (High Rollback Rate)\n`);
    sections.push(`> Files that are hard to change — approach with extra caution\n`);
    for (const hs of strategy.hotSpots) {
      const pct = Math.round(hs.rollbackRate * 100);
      sections.push(`- **${hs.filePath}** — ${pct}% rollback rate (${hs.attempts} attempts)`);
      if (hs.notes) sections.push(`  - ${hs.notes}`);
    }
    sections.push('');
  }

  // Anti-patterns
  if (strategy.antiPatterns.length > 0) {
    sections.push(`## Anti-Patterns (Don't Repeat These)\n`);
    for (const ap of strategy.antiPatterns) {
      sections.push(`### ${ap.pattern} (seen ${ap.occurrences}x)`);
      sections.push(`- **Example:** ${ap.example}`);
      sections.push(`- **Last seen:** ${ap.lastSeen}`);
      sections.push('');
    }
  }

  // Recommended approach
  sections.push(`## Recommended Approach\n`);
  const rec = buildRecommendationText(strategy);
  sections.push(rec);
  sections.push('');

  // Run history
  if (strategy.runSummaries.length > 0) {
    sections.push(`## Run History (last ${strategy.runSummaries.length})\n`);
    sections.push(`| Date | Mode | Before | After | Δ | Landed | Rolled Back | Key Insight |`);
    sections.push(`|------|------|--------|-------|---|--------|-------------|-------------|`);
    for (const rs of [...strategy.runSummaries].reverse()) {
      const delta = rs.scoreAfter - rs.scoreBefore;
      const sign = delta > 0 ? '+' : '';
      const date = rs.date.split('T')[0];
      sections.push(`| ${date} | ${rs.mode} | ${rs.scoreBefore} | ${rs.scoreAfter} | ${sign}${delta} | ${rs.landed} | ${rs.rolledBack} | ${rs.keyInsight} |`);
    }
    sections.push('');
  }

  return fm + '\n\n' + sections.join('\n');
}

function buildRecommendationText(strategy: Strategy): string {
  const lines: string[] = [];

  const works = strategy.insights.filter(i => i.type === 'what-works' && i.confidence >= 0.6);
  if (works.length > 0) {
    lines.push(`**Based on ${strategy.runSummaries.length} run(s):**`);
    for (const ins of works.slice(0, 3)) {
      lines.push(`- ✅ ${ins.description}`);
    }
  }

  const hotFiles = strategy.hotSpots.filter(hs => hs.rollbackRate >= HOT_SPOT_ROLLBACK_THRESHOLD);
  if (hotFiles.length > 0) {
    lines.push(`\n**Avoid touching:**`);
    for (const hs of hotFiles.slice(0, 3)) {
      lines.push(`- ⚠️ \`${hs.filePath}\` (${Math.round(hs.rollbackRate * 100)}% rollback rate)`);
    }
  }

  if (strategy.antiPatterns.length > 0) {
    lines.push(`\n**Known anti-patterns to avoid:**`);
    for (const ap of strategy.antiPatterns.slice(0, 3)) {
      lines.push(`- ❌ ${ap.pattern}`);
    }
  }

  if (lines.length === 0) {
    lines.push('Not enough data yet. Run more clicks to build up strategy knowledge.');
  }

  return lines.join('\n');
}

function markdownToStrategy(content: string): Strategy | null {
  try {
    const { data } = parseFrontmatter(content);

    const version = Number(data['version'] ?? 1);
    const createdAt = String(data['createdAt'] ?? new Date().toISOString());
    const updatedAt = String(data['updatedAt'] ?? new Date().toISOString());

    const profile: CodebaseProfile = {
      name: String(data['profile.name'] ?? ''),
      techStack: Array.isArray(data['profile.techStack']) ? (data['profile.techStack'] as string[]) : [],
      patterns: Array.isArray(data['profile.patterns']) ? (data['profile.patterns'] as string[]) : [],
      testFramework: String(data['profile.testFramework'] ?? 'unknown'),
      totalFiles: Number(data['profile.totalFiles'] ?? 0),
      lastScanned: String(data['profile.lastScanned'] ?? createdAt),
    };

    // Parse insight/hotspot/antipattern/runSummary sections from markdown body
    // These are stored as structured markdown; we rebuild them from the file
    // For simplicity, we re-derive them from the embedded JSON comment block
    // Actually we keep a JSON metadata block at the end of the file
    // BUT: Per spec, we use YAML frontmatter only for structured data
    // The markdown body is human-readable — we only parse the frontmatter
    // Insights etc. need to be stored in frontmatter too (extended)

    // Extended frontmatter fields for arrays — stored as JSON-encoded strings
    const insights = parseJsonField<StrategyInsight[]>(data['insights'], []);
    const hotSpots = parseJsonField<HotSpot[]>(data['hotSpots'], []);
    const antiPatterns = parseJsonField<AntiPattern[]>(data['antiPatterns'], []);
    const runSummaries = parseJsonField<RunSummary[]>(data['runSummaries'], []);

    return {
      version,
      createdAt,
      updatedAt,
      profile,
      insights,
      hotSpots,
      antiPatterns,
      runSummaries,
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to parse strategy file');
    return null;
  }
}

function parseJsonField<T>(val: unknown, fallback: T): T {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch (err) {
      logger.debug({ err, val }, 'Failed to parse JSON field, using fallback');
      return fallback;
    }
  }
  return fallback;
}

/**
 * Full serialization: YAML frontmatter with JSON-encoded arrays for structured data,
 * plus a human-readable markdown body.
 */
function serializeStrategy(strategy: Strategy): string {
  const insightsJson = JSON.stringify(strategy.insights);
  const hotSpotsJson = JSON.stringify(strategy.hotSpots);
  const antiPatternsJson = JSON.stringify(strategy.antiPatterns);
  const runSummariesJson = JSON.stringify(strategy.runSummaries);

  const fm = [
    '---',
    `version: ${strategy.version}`,
    `createdAt: ${strategy.createdAt}`,
    `updatedAt: ${strategy.updatedAt}`,
    `profile.name: ${toYamlValue(strategy.profile.name)}`,
    `profile.techStack: ${toYamlValue(strategy.profile.techStack)}`,
    `profile.patterns: ${toYamlValue(strategy.profile.patterns)}`,
    `profile.testFramework: ${toYamlValue(strategy.profile.testFramework)}`,
    `profile.totalFiles: ${strategy.profile.totalFiles}`,
    `profile.lastScanned: ${strategy.profile.lastScanned}`,
    `insights: ${toYamlValue(insightsJson)}`,
    `hotSpots: ${toYamlValue(hotSpotsJson)}`,
    `antiPatterns: ${toYamlValue(antiPatternsJson)}`,
    `runSummaries: ${toYamlValue(runSummariesJson)}`,
    '---',
  ].join('\n');

  const body = buildMarkdownBody(strategy);
  return fm + '\n\n' + body;
}

function buildMarkdownBody(strategy: Strategy): string {
  const sections: string[] = [];

  sections.push(`# Ratchet Strategy — ${strategy.profile.name}\n`);
  sections.push(`> Auto-generated by Ratchet (v${strategy.version}). Last updated: ${strategy.updatedAt.split('T')[0]}\n`);
  sections.push(`> This file is committed to git. Edit freely — ratchet will merge its updates.\n`);

  // Profile
  sections.push(`## 📦 Codebase Profile\n`);
  sections.push(`| Field | Value |`);
  sections.push(`|-------|-------|`);
  sections.push(`| Name | ${strategy.profile.name} |`);
  sections.push(`| Tech stack | ${strategy.profile.techStack.join(', ') || 'unknown'} |`);
  sections.push(`| Test framework | ${strategy.profile.testFramework} |`);
  sections.push(`| Total files | ${strategy.profile.totalFiles} |`);
  sections.push(`| Patterns | ${strategy.profile.patterns.join(', ') || 'none detected'} |`);
  sections.push(`| Last scanned | ${strategy.profile.lastScanned.split('T')[0]} |`);
  sections.push('');

  // What works
  const works = strategy.insights.filter(i => i.type === 'what-works').sort((a, b) => b.confidence - a.confidence);
  if (works.length > 0) {
    sections.push(`## ✅ What Works\n`);
    for (const ins of works) {
      const conf = Math.round(ins.confidence * 100);
      sections.push(`### ${ins.description}`);
      sections.push(`- **Evidence:** ${ins.evidence}`);
      sections.push(`- **Confidence:** ${conf}% | **Run:** \`${ins.runId.slice(0, 8)}\` | **Added:** ${ins.createdAt.split('T')[0]}`);
      sections.push('');
    }
  }

  // What fails
  const fails = strategy.insights.filter(i => i.type === 'what-fails').sort((a, b) => b.confidence - a.confidence);
  if (fails.length > 0) {
    sections.push(`## ❌ What Doesn't Work\n`);
    for (const ins of fails) {
      const conf = Math.round(ins.confidence * 100);
      sections.push(`### ${ins.description}`);
      sections.push(`- **Evidence:** ${ins.evidence}`);
      sections.push(`- **Confidence:** ${conf}% | **Run:** \`${ins.runId.slice(0, 8)}\` | **Added:** ${ins.createdAt.split('T')[0]}`);
      sections.push('');
    }
  }

  // Observations
  const obs = strategy.insights.filter(i => i.type === 'observation');
  if (obs.length > 0) {
    sections.push(`## 👁 Observations\n`);
    for (const ins of obs) {
      sections.push(`- ${ins.description} _(${ins.evidence})_`);
    }
    sections.push('');
  }

  // Hot spots
  if (strategy.hotSpots.length > 0) {
    sections.push(`## 🔥 Hot Spots\n`);
    sections.push(`> Files with high rollback rates — approach with caution\n`);
    const sorted = [...strategy.hotSpots].sort((a, b) => b.rollbackRate - a.rollbackRate);
    for (const hs of sorted) {
      const pct = Math.round(hs.rollbackRate * 100);
      sections.push(`- **\`${hs.filePath}\`** — ${pct}% rollback over ${hs.attempts} attempts`);
      if (hs.notes) sections.push(`  - _${hs.notes}_`);
    }
    sections.push('');
  }

  // Anti-patterns
  if (strategy.antiPatterns.length > 0) {
    sections.push(`## 🚫 Anti-Patterns\n`);
    for (const ap of strategy.antiPatterns) {
      sections.push(`### ${ap.pattern} _(seen ${ap.occurrences}x)_`);
      sections.push(`- **Example:** ${ap.example}`);
      sections.push(`- **Last seen:** ${ap.lastSeen.split('T')[0]}`);
      sections.push('');
    }
  }

  // Recommendation
  sections.push(`## 💡 Recommended Approach\n`);
  sections.push(buildRecommendationText(strategy));
  sections.push('');

  // Run history
  if (strategy.runSummaries.length > 0) {
    sections.push(`## 📈 Run History (last ${strategy.runSummaries.length})\n`);
    sections.push(`| Date | Mode | Score | Δ | L/RB | Key Insight |`);
    sections.push(`|------|------|-------|---|------|-------------|`);
    for (const rs of [...strategy.runSummaries].reverse()) {
      const delta = rs.scoreAfter - rs.scoreBefore;
      const sign = delta > 0 ? '+' : '';
      const date = rs.date.split('T')[0];
      const total = rs.landed + rs.rolledBack;
      sections.push(`| ${date} | ${rs.mode} | ${rs.scoreBefore}→${rs.scoreAfter} | ${sign}${delta} | ${rs.landed}/${total} | ${rs.keyInsight} |`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load strategy from .ratchet/strategy.md. Returns null if not found or invalid.
 */
export async function loadStrategy(cwd: string): Promise<Strategy | null> {
  const filePath = join(cwd, STRATEGY_FILE);
  if (!existsSync(filePath)) return null;

  try {
    const content = await readFile(filePath, 'utf-8');
    const strategy = markdownToStrategy(content);
    if (strategy) {
      logger.debug({ version: strategy.version }, 'Strategy loaded');
    }
    return strategy;
  } catch (err) {
    logger.warn({ err }, 'Failed to load strategy file');
    return null;
  }
}

/**
 * Save strategy to .ratchet/strategy.md.
 */
export async function saveStrategy(cwd: string, strategy: Strategy): Promise<void> {
  const dir = join(cwd, '.ratchet');
  await mkdir(dir, { recursive: true });
  const filePath = join(cwd, STRATEGY_FILE);
  const content = serializeStrategy(strategy);
  await writeFile(filePath, content, 'utf-8');
  logger.debug({ version: strategy.version, path: filePath }, 'Strategy saved');
}

/**
 * Delete .ratchet/strategy.md to start fresh.
 */
export async function resetStrategy(cwd: string): Promise<boolean> {
  const filePath = join(cwd, STRATEGY_FILE);
  if (!existsSync(filePath)) return false;
  await unlink(filePath);
  logger.info({ path: filePath }, 'Strategy reset');
  return true;
}

/**
 * Create an initial strategy from the first scan result.
 */
export function initStrategy(cwd: string, scan: ScanResult): Strategy {
  const techStack = detectTechStack(cwd);
  const patterns = detectPatterns(cwd, scan);
  const testFramework = detectTestFramework(cwd);

  const profile: CodebaseProfile = {
    name: scan.projectName || cwd.split('/').pop() || 'unknown',
    techStack,
    patterns,
    testFramework,
    totalFiles: scan.totalIssuesFound >= 0 ? estimateTotalFiles(scan) : 0,
    lastScanned: new Date().toISOString(),
  };

  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    profile,
    insights: [],
    hotSpots: [],
    antiPatterns: [],
    runSummaries: [],
  };
}

/**
 * Evolve the strategy after a completed run.
 * Returns { updated: Strategy; keyInsight: string }
 */
export async function evolveStrategy(
  cwd: string,
  run: RatchetRun,
  scanBefore: ScanResult | undefined,
  scanAfter: ScanResult | undefined,
): Promise<{ updated: Strategy; keyInsight: string }> {
  let strategy = await loadStrategy(cwd);
  if (!strategy) {
    strategy = initStrategy(cwd, scanAfter ?? scanBefore ?? makeFallbackScan(cwd));
  }

  const oldVersion = strategy.version;
  const now = new Date().toISOString();

  const landedClicks = run.clicks.filter(c => c.testsPassed);
  const rolledBackClicks = run.clicks.filter(c => !c.testsPassed);

  const scoreBefore = scanBefore?.total ?? 0;
  const scoreAfter = scanAfter?.total ?? scoreBefore;

  // Extract insights from this run
  const newInsights = extractInsights(run, landedClicks, rolledBackClicks);

  // Decay existing insight confidence
  strategy.insights = strategy.insights.map(ins => ({
    ...ins,
    confidence: Math.max(0, ins.confidence - CONFIDENCE_DECAY),
  })).filter(ins => ins.confidence > 0.05); // Prune very stale insights

  // Merge new insights (deduplicate by description similarity)
  for (const ins of newInsights) {
    const existing = strategy.insights.find(i =>
      i.type === ins.type && isSimilarDescription(i.description, ins.description)
    );
    if (existing) {
      // Reinforce confidence
      existing.confidence = Math.min(1, existing.confidence + 0.2);
      existing.evidence = ins.evidence;
    } else {
      strategy.insights.push(ins);
    }
  }

  // Update hot spots from rolled-back clicks
  strategy.hotSpots = updateHotSpots(strategy.hotSpots, run.clicks, now);

  // Extract anti-patterns from rollbacks
  strategy.antiPatterns = updateAntiPatterns(strategy.antiPatterns, rolledBackClicks, now);

  // Build key insight for this run
  const keyInsight = deriveKeyInsight(landedClicks, rolledBackClicks, scoreBefore, scoreAfter);

  // Add run summary
  const runMode = detectRunMode(run);
  const summary: RunSummary = {
    runId: run.id,
    date: now,
    mode: runMode,
    scoreBefore,
    scoreAfter,
    landed: landedClicks.length,
    rolledBack: rolledBackClicks.length,
    keyInsight,
  };

  strategy.runSummaries.push(summary);

  // Trim old summaries
  if (strategy.runSummaries.length > MAX_RUN_SUMMARIES) {
    strategy.runSummaries = strategy.runSummaries.slice(-MAX_RUN_SUMMARIES);
  }

  // Update profile
  if (scanAfter) {
    strategy.profile.lastScanned = now;
    strategy.profile.totalFiles = estimateTotalFiles(scanAfter);
  }

  strategy.version = oldVersion + 1;
  strategy.updatedAt = now;

  await saveStrategy(cwd, strategy);

  logger.info(
    { version: strategy.version, keyInsight, landed: landedClicks.length, rolledBack: rolledBackClicks.length },
    'Strategy evolved'
  );

  return { updated: strategy, keyInsight };
}

/**
 * Format strategy as prompt context for injection into agent prompts.
 * Kept intentionally short (~500 tokens max).
 */
export function buildStrategyContext(strategy: Strategy): string {
  const lines: string[] = ['STRATEGY CONTEXT (from previous runs):'];

  // What works — top 3 high-confidence
  const works = strategy.insights
    .filter(i => i.type === 'what-works' && i.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  if (works.length > 0) {
    lines.push('\nWhat works for this codebase:');
    for (const ins of works) {
      lines.push(`  ✅ ${ins.description} (${ins.evidence})`);
    }
  }

  // Hot spots — top 3
  const hotFiles = strategy.hotSpots
    .filter(hs => hs.rollbackRate >= HOT_SPOT_ROLLBACK_THRESHOLD && hs.attempts >= HOT_SPOT_MIN_ATTEMPTS)
    .sort((a, b) => b.rollbackRate - a.rollbackRate)
    .slice(0, 3);

  if (hotFiles.length > 0) {
    lines.push('\nHigh-risk files (avoid if possible):');
    for (const hs of hotFiles) {
      lines.push(`  ⚠️  ${hs.filePath} (${Math.round(hs.rollbackRate * 100)}% rollback rate)`);
    }
  }

  // Anti-patterns — top 3
  const antiPats = strategy.antiPatterns
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 3);

  if (antiPats.length > 0) {
    lines.push('\nDo NOT repeat these patterns:');
    for (const ap of antiPats) {
      lines.push(`  ❌ ${ap.pattern}`);
    }
  }

  // What fails
  const fails = strategy.insights
    .filter(i => i.type === 'what-fails' && i.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2);

  if (fails.length > 0) {
    lines.push('\nApproaches that cause rollbacks:');
    for (const ins of fails) {
      lines.push(`  ❌ ${ins.description} (${ins.evidence})`);
    }
  }

  // Recent score trend
  if (strategy.runSummaries.length > 0) {
    const last = strategy.runSummaries[strategy.runSummaries.length - 1];
    const delta = last.scoreAfter - last.scoreBefore;
    const sign = delta >= 0 ? '+' : '';
    lines.push(`\nLast run: ${sign}${delta} score, ${last.landed} landed / ${last.rolledBack} rolled back`);
  }

  if (lines.length === 1) {
    // No useful context yet
    return '';
  }

  return lines.join('\n');
}

/**
 * Suggest the best approach for a target file based on strategy history.
 */
export function getRecommendation(strategy: Strategy, target: string): string {
  const lines: string[] = [];

  // Check if it's a known hot spot
  const hotSpot = strategy.hotSpots.find(hs =>
    hs.filePath === target || target.includes(hs.filePath) || hs.filePath.includes(target)
  );

  if (hotSpot && hotSpot.rollbackRate >= HOT_SPOT_ROLLBACK_THRESHOLD) {
    lines.push(`⚠️  This file has a ${Math.round(hotSpot.rollbackRate * 100)}% rollback rate (${hotSpot.attempts} attempts).`);
    if (hotSpot.notes) lines.push(`   Note: ${hotSpot.notes}`);
    lines.push('   Approach with extra caution. Make minimal, targeted changes.');
  }

  // Top working approaches
  const works = strategy.insights
    .filter(i => i.type === 'what-works' && i.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2);

  if (works.length > 0) {
    lines.push('\nRecommended approaches:');
    for (const ins of works) {
      lines.push(`  - ${ins.description}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No recommendation available yet.';
}

// ── Helper Functions ──────────────────────────────────────────────────────────

function extractInsights(
  run: RatchetRun,
  landed: Click[],
  rolledBack: Click[],
): StrategyInsight[] {
  const insights: StrategyInsight[] = [];
  const now = new Date().toISOString();
  const total = run.clicks.length;

  if (total === 0) return insights;

  const landRate = landed.length / total;
  const rollRate = rolledBack.length / total;

  // High land rate → what-works insight
  if (landRate >= 0.7 && landed.length >= 2) {
    // Look for common file patterns in landed clicks
    const allFiles = landed.flatMap(c => c.filesModified);
    const ext = dominantExtension(allFiles);
    const desc = ext
      ? `Changes to ${ext} files tend to land cleanly`
      : `Focused, single-file changes have high success rate`;

    insights.push({
      id: randomUUID(),
      type: 'what-works',
      description: desc,
      evidence: `${landed.length}/${total} clicks landed in run ${run.id.slice(0, 8)}`,
      confidence: 0.6 + landRate * 0.2,
      createdAt: now,
      runId: run.id,
    });
  }

  // High rollback rate → what-fails insight
  if (rollRate >= 0.5 && rolledBack.length >= 2) {
    const allFiles = rolledBack.flatMap(c => c.filesModified);
    const ext = dominantExtension(allFiles);
    const desc = ext
      ? `Changes to ${ext} files frequently cause test failures`
      : `Multi-file changes have high rollback rate`;

    insights.push({
      id: randomUUID(),
      type: 'what-fails',
      description: desc,
      evidence: `${rolledBack.length}/${total} clicks rolled back in run ${run.id.slice(0, 8)}`,
      confidence: 0.5 + rollRate * 0.3,
      createdAt: now,
      runId: run.id,
    });
  }

  // Swarm specialization insight
  const swarmWins = landed.filter(c => c.swarmSpecialization);
  if (swarmWins.length >= 2) {
    const specCounts: Record<string, number> = {};
    for (const c of swarmWins) {
      const s = c.swarmSpecialization!;
      specCounts[s] = (specCounts[s] ?? 0) + 1;
    }
    const topSpec = Object.entries(specCounts).sort((a, b) => b[1] - a[1])[0];
    if (topSpec) {
      insights.push({
        id: randomUUID(),
        type: 'observation',
        description: `The "${topSpec[0]}" specialization wins swarm competitions most often`,
        evidence: `${topSpec[1]} wins in this run`,
        confidence: 0.5,
        createdAt: now,
        runId: run.id,
      });
    }
  }

  return insights;
}

function updateHotSpots(existing: HotSpot[], clicks: Click[], now: string): HotSpot[] {
  const fileStats: Map<string, { attempts: number; rollbacks: number }> = new Map();

  for (const click of clicks) {
    const isRollback = !click.testsPassed;
    for (const file of click.filesModified) {
      const s = fileStats.get(file) ?? { attempts: 0, rollbacks: 0 };
      s.attempts++;
      if (isRollback) s.rollbacks++;
      fileStats.set(file, s);
    }
  }

  const updated = [...existing];

  for (const [filePath, stats] of fileStats) {
    const existingIdx = updated.findIndex(hs => hs.filePath === filePath);
    if (existingIdx >= 0) {
      const hs = updated[existingIdx];
      const totalAttempts = hs.attempts + stats.attempts;
      // Weighted merge
      const totalRollbacks = Math.round(hs.rollbackRate * hs.attempts) + stats.rollbacks;
      updated[existingIdx] = {
        ...hs,
        attempts: totalAttempts,
        rollbackRate: totalRollbacks / totalAttempts,
        lastAttempt: now,
        notes: generateHotSpotNote(totalRollbacks / totalAttempts, totalAttempts),
      };
    } else if (stats.attempts >= HOT_SPOT_MIN_ATTEMPTS) {
      const rollbackRate = stats.rollbacks / stats.attempts;
      if (rollbackRate >= HOT_SPOT_ROLLBACK_THRESHOLD) {
        updated.push({
          filePath,
          rollbackRate,
          attempts: stats.attempts,
          lastAttempt: now,
          notes: generateHotSpotNote(rollbackRate, stats.attempts),
        });
      }
    }
  }

  // Remove hot spots that have improved (< 30% rollback now)
  return updated.filter(hs => hs.rollbackRate >= 0.3 || hs.attempts < HOT_SPOT_MIN_ATTEMPTS);
}

function generateHotSpotNote(rollbackRate: number, attempts: number): string {
  if (rollbackRate >= 0.8) return `Very hard to change — ${Math.round(rollbackRate * 100)}% rollback. Consider skipping.`;
  if (rollbackRate >= 0.6) return `Frequently causes test failures. Make minimal changes only.`;
  if (rollbackRate >= 0.4) return `Moderate difficulty. Test thoroughly before committing.`;
  return '';
}

function updateAntiPatterns(existing: AntiPattern[], rolledBack: Click[], now: string): AntiPattern[] {
  const updated = [...existing];

  for (const click of rolledBack) {
    if (!click.rollbackReason) continue;

    const reason = click.rollbackReason.toLowerCase();
    let pattern: string | null = null;

    if (reason.includes('too many files') || reason.includes('max-files')) {
      pattern = 'Touching too many files in one click';
    } else if (reason.includes('too many lines') || reason.includes('max-lines')) {
      pattern = 'Making too many line changes at once';
    } else if (reason.includes('test') && reason.includes('fail')) {
      pattern = 'Changes that break existing tests';
    } else if (reason.includes('scope')) {
      pattern = 'Modifying files outside the target scope';
    } else if (reason.includes('timeout')) {
      pattern = 'Operations that time out (too complex)';
    }

    if (!pattern) continue;

    const existingIdx = updated.findIndex(ap => ap.pattern === pattern);
    if (existingIdx >= 0) {
      updated[existingIdx] = {
        ...updated[existingIdx],
        occurrences: updated[existingIdx].occurrences + 1,
        lastSeen: now,
        example: click.rollbackReason ?? updated[existingIdx].example,
      };
    } else {
      updated.push({
        pattern,
        occurrences: 1,
        lastSeen: now,
        example: click.rollbackReason ?? reason,
      });
    }
  }

  return updated.sort((a, b) => b.occurrences - a.occurrences);
}

function deriveKeyInsight(
  landed: Click[],
  rolledBack: Click[],
  scoreBefore: number,
  scoreAfter: number,
): string {
  const total = landed.length + rolledBack.length;
  const delta = scoreAfter - scoreBefore;

  if (total === 0) return 'No clicks completed';

  if (delta > 5) return `Strong run: +${delta} score, ${landed.length}/${total} landed`;
  if (delta > 0) return `Incremental improvement: +${delta} score`;
  if (delta === 0 && landed.length > 0) return `${landed.length} landed but no score change`;
  if (rolledBack.length === total) return 'All clicks rolled back — check constraints';

  const topReason = rolledBack
    .filter(c => c.rollbackReason)
    .map(c => c.rollbackReason!)
    .slice(0, 1)[0];

  if (topReason) return `Most rollbacks: ${topReason.slice(0, 60)}`;
  return `${landed.length}/${total} landed, ${delta >= 0 ? '+' : ''}${delta} score`;
}

function detectRunMode(run: RatchetRun): string {
  if (run.planResult) return 'plan-first';
  if (run.resumeState) return 'resumed';
  return 'normal';
}

function dominantExtension(files: string[]): string | null {
  if (files.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const f of files) {
    const m = f.match(/\.([a-zA-Z]+)$/);
    if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? `.${top[0]}` : null;
}

function isSimilarDescription(a: string, b: string): boolean {
  // Simple heuristic: first 30 chars match
  return a.slice(0, 30).toLowerCase() === b.slice(0, 30).toLowerCase();
}

function detectTechStack(cwd: string): string[] {
  const stack: string[] = [];
  const checks: [string, string][] = [
    ['package.json', 'Node.js'],
    ['tsconfig.json', 'TypeScript'],
    ['pyproject.toml', 'Python'],
    ['Cargo.toml', 'Rust'],
    ['go.mod', 'Go'],
    ['pom.xml', 'Java/Maven'],
    ['build.gradle', 'Java/Gradle'],
    ['Gemfile', 'Ruby'],
    ['composer.json', 'PHP'],
  ];
  for (const [file, name] of checks) {
    if (existsSync(join(cwd, file))) stack.push(name);
  }
  return stack;
}

function detectTestFramework(cwd: string): string {
  if (existsSync(join(cwd, 'vitest.config.ts')) || existsSync(join(cwd, 'vitest.config.js'))) return 'vitest';
  if (existsSync(join(cwd, 'jest.config.ts')) || existsSync(join(cwd, 'jest.config.js'))) return 'jest';
  if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'pyproject.toml'))) return 'pytest';
  if (existsSync(join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')) as { devDependencies?: Record<string, string>; scripts?: Record<string, string> };
      if (pkg.devDependencies?.vitest) return 'vitest';
      if (pkg.devDependencies?.jest || pkg.devDependencies?.['@jest/core']) return 'jest';
      if (pkg.devDependencies?.mocha) return 'mocha';
    } catch (err) {
      logger.debug({ err }, 'Failed to read package.json for test framework detection');
    }
  }
  return 'unknown';
}

function detectPatterns(cwd: string, scan: ScanResult): string[] {
  const patterns: string[] = [];
  if (existsSync(join(cwd, 'src'))) patterns.push('src/ layout');
  if (existsSync(join(cwd, 'tests')) || existsSync(join(cwd, 'test'))) patterns.push('dedicated test directory');
  if (existsSync(join(cwd, '.ratchet'))) patterns.push('ratchet-enabled');
  // Infer from scan categories
  const cats = scan.categories.map(c => c.name);
  if (cats.includes('Type Safety')) patterns.push('typed');
  if (cats.includes('Testing')) patterns.push('tested');
  return patterns;
}

function estimateTotalFiles(scan: ScanResult): number {
  // Best estimate from scan data
  return scan.totalIssuesFound > 0 ? Math.max(10, scan.totalIssuesFound * 2) : 0;
}

function makeFallbackScan(cwd: string): ScanResult {
  const name = cwd.split('/').pop() ?? 'unknown';
  return {
    projectName: name,
    total: 0,
    maxTotal: 100,
    categories: [],
    totalIssuesFound: 0,
    issuesByType: [],
  };
}
