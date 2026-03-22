import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../lib/logger.js';

export const SCAN_HISTORY_FILE = '.ratchet/history.json';

export interface ScanHistoryEntry {
  score: number;
  maxScore: number;
  categories: Record<string, number>; // category name → score
  timestamp: string;                  // ISO 8601
  branch: string;
}

export interface ScoreDelta {
  delta: number;       // positive = improvement, negative = regression
  direction: 'up' | 'down' | 'same';
  before: number;
  after: number;
}

export async function loadScanHistory(cwd: string): Promise<ScanHistoryEntry[]> {
  const filePath = join(cwd, SCAN_HISTORY_FILE);
  if (!existsSync(filePath)) return [];

  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ScanHistoryEntry[];
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to parse scan history file');
    return [];
  }
}

export async function appendScanHistory(cwd: string, entry: ScanHistoryEntry): Promise<void> {
  await mkdir(join(cwd, '.ratchet'), { recursive: true });
  const history = await loadScanHistory(cwd);
  history.push(entry);
  await writeFile(join(cwd, SCAN_HISTORY_FILE), JSON.stringify(history, null, 2), 'utf-8');
}

export async function calculateDelta(cwd: string): Promise<ScoreDelta | null> {
  const history = await loadScanHistory(cwd);
  if (history.length < 2) return null;

  const latest = history[history.length - 1]!;
  const previous = history[history.length - 2]!;
  const delta = latest.score - previous.score;

  return {
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
    before: previous.score,
    after: latest.score,
  };
}

export async function calculateStreak(cwd: string, threshold: number): Promise<number> {
  const history = await loadScanHistory(cwd);
  if (history.length === 0) return 0;

  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.score >= threshold) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export async function getHistory(cwd: string, days?: number): Promise<ScanHistoryEntry[]> {
  const history = await loadScanHistory(cwd);
  if (days === undefined) return history;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return history.filter((entry) => new Date(entry.timestamp) >= cutoff);
}
