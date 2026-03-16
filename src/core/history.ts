import { mkdir, readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { RatchetRun } from '../types.js';
import type { ScanResult } from '../commands/scan.js';

export const RUNS_DIR = '.ratchet/runs';

export interface HistoryEntry {
  run: RatchetRun;
  scoreBefore?: ScanResult;
  scoreAfter?: ScanResult;
  savedAt: string;
}

export async function saveRun(
  cwd: string,
  run: RatchetRun,
  scoreBefore?: ScanResult,
  scoreAfter?: ScanResult,
): Promise<void> {
  const runsDir = join(cwd, RUNS_DIR);
  await mkdir(runsDir, { recursive: true });

  const entry: HistoryEntry = {
    run,
    scoreBefore,
    scoreAfter,
    savedAt: new Date().toISOString(),
  };

  const filePath = join(runsDir, `${run.id}.json`);
  await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

function hydrateDates(entry: HistoryEntry): HistoryEntry {
  const run = entry.run;
  if (run.startedAt && typeof run.startedAt === 'string') {
    run.startedAt = new Date(run.startedAt);
  }
  if (run.finishedAt && typeof run.finishedAt === 'string') {
    run.finishedAt = new Date(run.finishedAt);
  }
  return entry;
}

export async function loadRun(cwd: string, runId: string): Promise<HistoryEntry | null> {
  const filePath = join(cwd, RUNS_DIR, `${runId}.json`);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  try {
    return hydrateDates(JSON.parse(raw) as HistoryEntry);
  } catch {
    throw new Error(`History entry ${runId}.json could not be parsed — the file may be corrupted.`);
  }
}

export async function listRuns(cwd: string): Promise<HistoryEntry[]> {
  const runsDir = join(cwd, RUNS_DIR);

  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  const results = await Promise.all(
    jsonFiles.map(async (file) => {
      const filePath = join(runsDir, file);
      try {
        const raw = await readFile(filePath, 'utf-8');
        return hydrateDates(JSON.parse(raw) as HistoryEntry);
      } catch {
        // Skip corrupted files
        return null;
      }
    }),
  );
  const entries: HistoryEntry[] = results.filter((e): e is HistoryEntry => e !== null);

  // Sort newest first by savedAt
  entries.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  return entries;
}

export async function loadLatestRun(cwd: string): Promise<HistoryEntry | null> {
  // Try history first
  const entries = await listRuns(cwd);
  if (entries.length > 0) {
    return entries[0] ?? null;
  }

  // Fallback: load from legacy .ratchet-state.json
  const legacyPath = join(cwd, '.ratchet-state.json');
  if (!existsSync(legacyPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = await readFile(legacyPath, 'utf-8');
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as RatchetRun;
    if (parsed.startedAt && typeof parsed.startedAt === 'string') {
      parsed.startedAt = new Date(parsed.startedAt);
    }
    if (parsed.finishedAt && typeof parsed.finishedAt === 'string') {
      parsed.finishedAt = new Date(parsed.finishedAt);
    }
    return { run: parsed, savedAt: (parsed.finishedAt ?? parsed.startedAt) as unknown as string };
  } catch {
    return null;
  }
}
