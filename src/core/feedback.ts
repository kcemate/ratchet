import fs from 'node:fs';
import path from 'node:path';

const FEEDBACK_VERSION = 1;
const MAX_ENTRIES = 500;
const DEFAULT_MAX_FAILURES = 3;

export interface RollbackEntry {
  issueId: string;
  strategy: string;
  filesTargeted: string[];
  rollbackReason: 'test_fail' | 'score_regression' | 'parse_error' | 'timeout' | 'guard_violation';
  model: string;
  timestamp: string; // ISO 8601
}

export interface FeedbackStore {
  version: number;
  entries: RollbackEntry[];
}

function feedbackPath(cwd: string): string {
  return path.join(cwd, '.ratchet', 'feedback.json');
}

export function loadFeedback(cwd: string): FeedbackStore {
  const fp = feedbackPath(cwd);
  if (!fs.existsSync(fp)) {
    return { version: FEEDBACK_VERSION, entries: [] };
  }
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    return JSON.parse(raw) as FeedbackStore;
  } catch {
    return { version: FEEDBACK_VERSION, entries: [] };
  }
}

export function recordRollback(cwd: string, entry: RollbackEntry): void {
  const store = loadFeedback(cwd);
  store.entries.push(entry);
  // FIFO eviction: keep only the last MAX_ENTRIES
  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.slice(store.entries.length - MAX_ENTRIES);
  }
  const dir = path.join(cwd, '.ratchet');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(feedbackPath(cwd), JSON.stringify(store, null, 2), 'utf8');
}

export function getFailureCount(cwd: string, issueId: string, strategy?: string): number {
  const store = loadFeedback(cwd);
  return store.entries.filter(e => {
    if (e.issueId !== issueId) return false;
    if (strategy !== undefined && e.strategy !== strategy) return false;
    return true;
  }).length;
}

export function isBlacklisted(
  cwd: string,
  issueId: string,
  strategy?: string,
  maxFailures = DEFAULT_MAX_FAILURES,
): boolean {
  return getFailureCount(cwd, issueId, strategy) >= maxFailures;
}

/**
 * Returns files that appear in >= maxConsecutive rollback entries.
 * Since the store records only rollbacks, total appearances = consecutive rollbacks.
 */
export function getBlacklistedFiles(cwd: string, maxConsecutive = DEFAULT_MAX_FAILURES): string[] {
  const store = loadFeedback(cwd);
  const counts = new Map<string, number>();
  for (const entry of store.entries) {
    for (const file of entry.filesTargeted) {
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }
  const blacklisted: string[] = [];
  for (const [file, count] of counts) {
    if (count >= maxConsecutive) {
      blacklisted.push(file);
    }
  }
  return blacklisted;
}
