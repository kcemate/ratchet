/**
 * Post-run consolidation — Phase 2.4
 *
 * After a torque run, extract learnings about the repo into docs/repo-knowledge.md.
 * Inspired by Claude Code's autoDream triple-gated consolidation.
 *
 * Triple gate:
 *   1. Time gate  — skip if last consolidation was <24h ago
 *   2. Session gate — skip if fewer than 3 landed clicks since last consolidation
 *   3. Lock gate  — only one consolidation at a time (fs-based lock)
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadFeedback } from './feedback.js';
import type { RatchetRun } from '../types.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIME_GATE_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_GATE_MIN_CLICKS = 3;
const LOCK_STALE_MS = 60 * 60 * 1000; // 1 hour — stale lock cleanup
const META_FILE = '.ratchet/consolidation-meta.json';
const LOCK_FILE = '.ratchet/consolidation.lock';
const OUTPUT_FILE = 'docs/repo-knowledge.md';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsolidationMeta {
  version: number;
  lastConsolidatedAt: string | null; // ISO timestamp
  /** Accumulated landed clicks since last consolidation (resets on consolidation) */
  landedClicksSinceConsolidation: number;
}

export interface ConsolidationResult {
  skipped: boolean;
  skipReason?: 'time_gate' | 'session_gate' | 'lock_contention' | 'no_data';
  outputPath?: string;
  patternsExtracted?: number;
}

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

function metaPath(cwd: string): string {
  return path.join(cwd, META_FILE);
}

function lockPath(cwd: string): string {
  return path.join(cwd, LOCK_FILE);
}

export function loadMeta(cwd: string): ConsolidationMeta {
  const p = metaPath(cwd);
  if (!fs.existsSync(p)) {
    return { version: 1, lastConsolidatedAt: null, landedClicksSinceConsolidation: 0 };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ConsolidationMeta;
  } catch {
    return { version: 1, lastConsolidatedAt: null, landedClicksSinceConsolidation: 0 };
  }
}

function saveMeta(cwd: string, meta: ConsolidationMeta): void {
  const dir = path.join(cwd, '.ratchet');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath(cwd), JSON.stringify(meta, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

interface LockData {
  pid: number;
  acquiredAt: string;
}

/**
 * Try to acquire the consolidation lock.
 * Returns true if acquired, false if another process holds it.
 * Cleans up stale locks (older than LOCK_STALE_MS) automatically.
 */
export function acquireLock(cwd: string): boolean {
  const lp = lockPath(cwd);
  const dir = path.join(cwd, '.ratchet');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Check for existing lock
  if (fs.existsSync(lp)) {
    try {
      const data = JSON.parse(fs.readFileSync(lp, 'utf8')) as LockData;
      const age = Date.now() - new Date(data.acquiredAt).getTime();
      if (age < LOCK_STALE_MS) {
        return false; // valid lock held by another process
      }
      // Stale lock — clean it up
      fs.unlinkSync(lp);
      logger.debug({ age, cwd }, 'Cleaned up stale consolidation lock');
    } catch {
      // Corrupt lock file — remove and continue
      try { fs.unlinkSync(lp); } catch { /* ignore */ }
    }
  }

  // Write our lock
  const lock: LockData = { pid: process.pid, acquiredAt: new Date().toISOString() };
  fs.writeFileSync(lp, JSON.stringify(lock, null, 2), 'utf8');
  return true;
}

export function releaseLock(cwd: string): void {
  const lp = lockPath(cwd);
  try {
    if (fs.existsSync(lp)) fs.unlinkSync(lp);
  } catch (err) {
    logger.warn({ err, cwd }, 'Failed to release consolidation lock');
  }
}

// ---------------------------------------------------------------------------
// Pattern extraction helpers
// ---------------------------------------------------------------------------

/** Extract the most-touched files from run click history. */
export function extractFrequentFiles(run: RatchetRun): Array<{ file: string; count: number; totalClicks: number }> {
  const fileCounts = new Map<string, number>();
  const landedClicks = run.clicks.filter(c => c.testsPassed);

  for (const click of run.clicks) {
    for (const f of click.filesModified ?? []) {
      fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    }
  }

  return [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file, count, totalClicks: landedClicks.length }));
}

/** Extract anti-patterns from feedback rollback data. */
export function extractAntiPatterns(cwd: string): string[] {
  const store = loadFeedback(cwd);
  if (store.entries.length === 0) return [];

  const antiPatterns: string[] = [];
  const reasons = new Map<string, number>();
  const problemFiles = new Map<string, number>();

  for (const entry of store.entries) {
    reasons.set(entry.rollbackReason, (reasons.get(entry.rollbackReason) ?? 0) + 1);
    for (const f of entry.filesTargeted) {
      problemFiles.set(f, (problemFiles.get(f) ?? 0) + 1);
    }
  }

  // Top rollback reasons
  const sortedReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedReasons.slice(0, 3)) {
    const label = rollbackReasonLabel(reason);
    antiPatterns.push(`${label} (caused ${count} rollback${count > 1 ? 's' : ''})`);
  }

  // Problem files (rolled back 2+ times)
  const problemList = [...problemFiles.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [file, count] of problemList) {
    antiPatterns.push(`Modifying ${file} causes failures — rolled back ${count} times`);
  }

  return antiPatterns;
}

function rollbackReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    test_fail: 'Changes that break tests',
    score_regression: 'Changes that regress the score',
    parse_error: 'Malformed code changes',
    timeout: 'Long-running or hanging changes',
    guard_violation: 'Changes that exceed scope guards',
  };
  return labels[reason] ?? reason;
}

/** Extract known-good patterns from landed clicks. */
export function extractKnownPatterns(run: RatchetRun): string[] {
  const patterns: string[] = [];
  const landedClicks = run.clicks.filter(c => c.testsPassed);

  if (landedClicks.length === 0) return patterns;

  // Group by category from the click's score delta (positive = worked)
  const categories = new Map<string, number>();
  for (const click of landedClicks) {
    if (click.categoryDeltas) {
      for (const delta of click.categoryDeltas) {
        if (delta.delta > 0) {
          categories.set(delta.category, (categories.get(delta.category) ?? 0) + delta.delta);
        }
      }
    }
  }

  const topCategories = [...categories.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [category, totalDelta] of topCategories) {
    patterns.push(`Fixes to "${category}" category landed reliably (+${totalDelta.toFixed(1)} pts across ${landedClicks.length} clicks)`);
  }

  // Note total landed vs total attempted
  const totalAttempted = run.clicks.length;
  const landRate = totalAttempted > 0 ? Math.round((landedClicks.length / totalAttempted) * 100) : 0;
  if (totalAttempted > 0) {
    patterns.push(`Click land rate: ${landedClicks.length}/${totalAttempted} (${landRate}%)`);
  }

  return patterns;
}

/** Detect project structure from package.json and filesystem. */
export function extractProjectStructure(cwd: string): string[] {
  const items: string[] = [];

  // Entry point from package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>;
    if (typeof pkg['main'] === 'string') items.push(`Entry point: ${pkg['main']}`);
    if (pkg['scripts'] && typeof pkg['scripts'] === 'object') {
      const scripts = pkg['scripts'] as Record<string, string>;
      if (scripts['test']) items.push(`Test command: ${scripts['test']}`);
      if (scripts['build']) items.push(`Build command: ${scripts['build']}`);
      if (scripts['dev']) items.push(`Dev command: ${scripts['dev']}`);
    }
    if (typeof pkg['name'] === 'string') items.push(`Package: ${pkg['name']}`);
  } catch {
    // No package.json
  }

  // Common structural files
  const customLoggerPaths = [
    'lib/logger.ts', 'src/lib/logger.ts', 'lib/logger.js', 'src/logger.ts',
    'utils/logger.ts', 'src/utils/logger.ts',
  ];
  for (const p of customLoggerPaths) {
    if (fs.existsSync(path.join(cwd, p))) {
      items.push(`Custom logger: ${p} (use instead of console.log)`);
      break;
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

export function buildRepoKnowledgeDoc(
  cwd: string,
  run: RatchetRun,
  projectStructure: string[],
  knownPatterns: string[],
  antiPatterns: string[],
  frequentFiles: Array<{ file: string; count: number; totalClicks: number }>,
): string {
  // Try to get project name
  let projectName = path.basename(cwd);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>;
    if (typeof pkg['name'] === 'string') projectName = pkg['name'];
  } catch { /* ignore */ }

  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [
    `# Repo Knowledge — ${projectName}`,
    `_Auto-generated by Ratchet. Last updated: ${now}_`,
    '',
  ];

  if (projectStructure.length > 0) {
    lines.push('## Project Structure');
    for (const item of projectStructure) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (knownPatterns.length > 0) {
    lines.push('## Known Patterns');
    for (const p of knownPatterns) {
      lines.push(`- ${p}`);
    }
    lines.push('');
  }

  if (antiPatterns.length > 0) {
    lines.push('## Anti-Patterns Discovered');
    for (const ap of antiPatterns) {
      lines.push(`- ${ap}`);
    }
    lines.push('');
  }

  if (frequentFiles.length > 0) {
    lines.push('## Files Frequently Modified');
    for (const { file, count, totalClicks } of frequentFiles) {
      lines.push(`- ${file} (touched in ${count}/${totalClicks} clicks)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Post-run consolidation: extract learnings from this run into docs/repo-knowledge.md.
 *
 * Triple-gated (mirrors Claude Code's autoDream):
 *   1. Time gate  — skips if last consolidation was <24h ago
 *   2. Session gate — skips if <3 landed clicks accumulated since last consolidation
 *   3. Lock gate  — only one consolidation at a time
 *
 * Non-blocking: all errors are caught and logged. Never throws.
 */
export async function consolidateRunLearnings(cwd: string, run: RatchetRun): Promise<ConsolidationResult> {
  try {
    const landedThisRun = run.clicks.filter(c => c.testsPassed).length;

    // Load and update meta (always update the counter, gates run after)
    const meta = loadMeta(cwd);
    meta.landedClicksSinceConsolidation += landedThisRun;

    // ── Gate 1: Time gate
    if (meta.lastConsolidatedAt !== null) {
      const age = Date.now() - new Date(meta.lastConsolidatedAt).getTime();
      if (age < TIME_GATE_MS) {
        // Persist updated counter even when gated (so clicks accumulate)
        saveMeta(cwd, meta);
        logger.debug({ age, cwd }, 'Consolidation skipped: time gate');
        return { skipped: true, skipReason: 'time_gate' };
      }
    }

    // ── Gate 2: Session gate
    if (meta.landedClicksSinceConsolidation < SESSION_GATE_MIN_CLICKS) {
      saveMeta(cwd, meta);
      logger.debug({ landedSince: meta.landedClicksSinceConsolidation, cwd }, 'Consolidation skipped: session gate');
      return { skipped: true, skipReason: 'session_gate' };
    }

    // ── Gate 3: Lock gate
    if (!acquireLock(cwd)) {
      saveMeta(cwd, meta);
      logger.debug({ cwd }, 'Consolidation skipped: lock contention');
      return { skipped: true, skipReason: 'lock_contention' };
    }

    try {
      // Extract patterns
      const projectStructure = extractProjectStructure(cwd);
      const knownPatterns = extractKnownPatterns(run);
      const antiPatterns = extractAntiPatterns(cwd);
      const frequentFiles = extractFrequentFiles(run);

      const totalPatterns = projectStructure.length + knownPatterns.length + antiPatterns.length + frequentFiles.length;

      if (totalPatterns === 0) {
        return { skipped: true, skipReason: 'no_data' };
      }

      // Build document
      const doc = buildRepoKnowledgeDoc(cwd, run, projectStructure, knownPatterns, antiPatterns, frequentFiles);

      // Write to docs/repo-knowledge.md
      const outPath = path.join(cwd, OUTPUT_FILE);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outPath, doc, 'utf8');

      // Update meta: reset counter, record timestamp
      meta.lastConsolidatedAt = new Date().toISOString();
      meta.landedClicksSinceConsolidation = 0;
      saveMeta(cwd, meta);

      logger.info({ outPath, patternsExtracted: totalPatterns, cwd }, 'Consolidation complete');
      return { skipped: false, outputPath: outPath, patternsExtracted: totalPatterns };
    } finally {
      releaseLock(cwd);
    }
  } catch (err) {
    logger.warn({ err, cwd }, 'Consolidation failed — non-fatal');
    return { skipped: true, skipReason: 'no_data' };
  }
}

// ---------------------------------------------------------------------------
// Injection helper — used at run start
// ---------------------------------------------------------------------------

/**
 * If docs/repo-knowledge.md exists in the target repo, return its content
 * formatted for injection into the agent's system prompt.
 * Returns null if the file doesn't exist or can't be read.
 */
export function loadRepoKnowledge(cwd: string): string | null {
  const p = path.join(cwd, OUTPUT_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    const content = fs.readFileSync(p, 'utf8').trim();
    if (!content) return null;
    return `REPO KNOWLEDGE (from prior runs):\n${content}`;
  } catch (err) {
    logger.debug({ err, cwd }, 'Failed to load repo knowledge — continuing without it');
    return null;
  }
}
