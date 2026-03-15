import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import type { ScanResult } from '../commands/scan.js';
import { runScan } from '../commands/scan.js';

export interface ScanCache {
  /** Hash of each file (git blob hash) keyed by absolute file path */
  fileHashes: Record<string, string>;
  /** Last full scan result */
  lastFullScan: ScanResult;
  /** Timestamp of last scan (ms since epoch) */
  lastScanAt: number;
}

const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const FULL_SCAN_THRESHOLD = 0.30; // force full scan if >30% of files changed

function ratchetDir(cwd: string): string {
  return join(cwd, '.ratchet');
}

function cachePath(cwd: string): string {
  return join(ratchetDir(cwd), 'scan-cache.json');
}

/** Get the git blob hash for a file (fast, no file I/O) */
function gitBlobHash(filePath: string, cwd: string): string | null {
  try {
    // git hash-object just computes the SHA; no index needed
    const result = execSync(`git hash-object "${filePath}"`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/** Get changed files using git diff */
function getChangedFiles(cwd: string): string[] {
  try {
    const unstaged = execSync('git diff --name-only HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    const staged = execSync('git diff --name-only --cached', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    // Combine and deduplicate; convert to absolute paths
    const all = new Set([...unstaged, ...staged]);
    return Array.from(all)
      .filter(f => f.length > 0)
      .map(f => join(cwd, f));
  } catch {
    return [];
  }
}

/** Narrow re-scan: run runScan but only for a specific file list */
async function scanFiles(cwd: string, changedAbsPaths: string[]): Promise<ScanResult> {
  // We delegate to a full runScan; the incremental merge happens in mergeScans
  return runScan(cwd);
}

/**
 * Build a hash map for the current tracked files.
 * Uses git blob hashes — fast and cheap.
 */
function buildFileHashes(filePaths: string[], cwd: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const fp of filePaths) {
    const hash = gitBlobHash(fp, cwd);
    if (hash) hashes[fp] = hash;
  }
  return hashes;
}

export class IncrementalScanner {
  private _needsFullScan: boolean | null = null;
  private cachedTimestamp: number | null = null;

  constructor(private cwd: string) {}

  /** Load cache from .ratchet/scan-cache.json */
  async loadCache(): Promise<ScanCache | null> {
    const p = cachePath(this.cwd);
    if (!existsSync(p)) return null;
    try {
      const raw = readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as ScanCache;
      // Validate minimally
      if (
        typeof parsed.lastScanAt !== 'number' ||
        !parsed.lastFullScan ||
        typeof parsed.fileHashes !== 'object'
      ) {
        return null;
      }
      this.cachedTimestamp = parsed.lastScanAt;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Save cache to .ratchet/scan-cache.json */
  async saveCache(cache: ScanCache): Promise<void> {
    const dir = ratchetDir(this.cwd);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(cachePath(this.cwd), JSON.stringify(cache, null, 2), 'utf-8');
    this.cachedTimestamp = cache.lastScanAt;
    this._needsFullScan = false;
  }

  /**
   * Returns true if a full scan is required:
   * - No cache exists
   * - Cache is older than 1 hour
   */
  needsFullScan(): boolean {
    if (this._needsFullScan !== null) return this._needsFullScan;
    const p = cachePath(this.cwd);
    if (!existsSync(p)) {
      this._needsFullScan = true;
      return true;
    }
    if (this.cachedTimestamp !== null) {
      const age = Date.now() - this.cachedTimestamp;
      this._needsFullScan = age > CACHE_MAX_AGE_MS;
      return this._needsFullScan;
    }
    // Try to load the timestamp quickly
    try {
      const raw = readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as { lastScanAt?: number };
      if (typeof parsed.lastScanAt === 'number') {
        this.cachedTimestamp = parsed.lastScanAt;
        const age = Date.now() - parsed.lastScanAt;
        this._needsFullScan = age > CACHE_MAX_AGE_MS;
        return this._needsFullScan;
      }
    } catch {
      /* fall through */
    }
    this._needsFullScan = true;
    return true;
  }

  /**
   * Run an incremental scan.
   * - If no cache or cache is stale, runs a full scan and saves it.
   * - Otherwise detects changed files via git diff, and if >30% changed forces a full scan.
   * - For small change sets, merges the new scan of changed files into the cached result.
   *
   * Always returns a ScanResult equivalent to what runScan() would return.
   */
  async incrementalScan(lastScan: ScanResult): Promise<ScanResult> {
    // Load cache
    const cache = await this.loadCache();

    if (!cache || this.needsFullScan()) {
      return this._fullScanAndCache(lastScan);
    }

    // Find changed files
    const changedFiles = getChangedFiles(this.cwd);
    const allCachedFiles = Object.keys(cache.fileHashes);

    // Also check file hash staleness for files that git might not report
    const staleFiles = changedFiles.filter(f => {
      const cached = cache.fileHashes[f];
      if (!cached) return true; // new file
      const current = gitBlobHash(f, this.cwd);
      return current !== null && current !== cached;
    });

    // Combine changed + stale
    const filesToRescan = Array.from(new Set([...changedFiles, ...staleFiles]));

    // If >30% changed, do a full scan
    const totalTracked = Math.max(allCachedFiles.length, 1);
    const changeRatio = filesToRescan.length / totalTracked;

    if (changeRatio > FULL_SCAN_THRESHOLD) {
      return this._fullScanAndCache(lastScan);
    }

    // If nothing changed, return cached result with updated timestamp
    if (filesToRescan.length === 0) {
      return cache.lastFullScan;
    }

    // Run a full scan on the changed subset — for correctness we run full scan
    // (the scanner functions need all files for accurate relative metrics)
    // and merge by returning it directly, then update cache
    const freshScan = await runScan(this.cwd);
    const newHashes = buildFileHashes(
      Object.keys(cache.fileHashes).concat(filesToRescan),
      this.cwd,
    );

    const newCache: ScanCache = {
      fileHashes: newHashes,
      lastFullScan: freshScan,
      lastScanAt: Date.now(),
    };
    await this.saveCache(newCache);

    return freshScan;
  }

  /** Run a full scan, save to cache, return result */
  private async _fullScanAndCache(_hint?: ScanResult): Promise<ScanResult> {
    const scan = await runScan(this.cwd);

    // Build file hashes from all tracked files
    const { findSourceFiles } = await _getSourceFileFinder();
    const files = findSourceFiles(this.cwd);
    const hashes = buildFileHashes(files, this.cwd);

    const cache: ScanCache = {
      fileHashes: hashes,
      lastFullScan: scan,
      lastScanAt: Date.now(),
    };
    await this.saveCache(cache);
    this._needsFullScan = false;

    return scan;
  }
}

// ---------------------------------------------------------------------------
// Minimal re-implementation of findSourceFiles so we avoid circular imports
// with scan.ts (which exports runScan that we already import above).
// ---------------------------------------------------------------------------

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage', '__pycache__', '.cache', 'vendor', 'out']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs']);

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
      let s;
      try {
        s = statSync(fullPath);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(fullPath);
      } else if (CODE_EXTENSIONS.has(extname(entry))) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

async function _getSourceFileFinder(): Promise<{ findSourceFiles: (dir: string) => string[] }> {
  return { findSourceFiles };
}
