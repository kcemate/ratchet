import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { logger } from '../lib/logger.js';

/** A single pending write — key is a relative path under cwd. */
interface WriteEntry {
  key: string;
  /** JSON-serializable data, or a raw string to write as-is. */
  data: unknown;
  raw?: boolean;
}

const AUTO_FLUSH_INTERVAL_MS = 5_000;
const AUTO_FLUSH_QUEUE_SIZE = 10;

/**
 * AsyncWriter batches JSON writes to disk and flushes them either:
 *   - every 5 seconds (auto-flush timer), or
 *   - when the queue exceeds 10 items.
 *
 * This avoids blocking the click loop with synchronous I/O on every outcome.
 * Call destroy() when the run finishes to clear the interval.
 */
export class AsyncWriter {
  private readonly cwd: string;
  private queue: WriteEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.timer = setInterval(() => {
      void this.flush();
    }, AUTO_FLUSH_INTERVAL_MS);
    // Don't block process exit on the timer
    if (this.timer.unref) this.timer.unref();
  }

  /**
   * Enqueue a write. `key` is a relative path under cwd (e.g. '.ratchet/learning.json').
   * `data` will be serialized as JSON when flushed.
   * If enqueuing the same key multiple times, the latest value wins.
   */
  enqueue(key: string, data: unknown): void {
    this._push({ key, data });
  }

  /**
   * Enqueue a raw string write. The content is written verbatim (no JSON serialization).
   * Use this for markdown or other non-JSON files.
   */
  enqueueRaw(key: string, content: string): void {
    this._push({ key, data: content, raw: true });
  }

  private _push(entry: WriteEntry): void {
    // Deduplicate by key — keep only the latest value
    const existing = this.queue.findIndex(e => e.key === entry.key);
    if (existing >= 0) {
      this.queue[existing] = entry;
    } else {
      this.queue.push(entry);
    }

    if (this.queue.length >= AUTO_FLUSH_QUEUE_SIZE) {
      void this.flush();
    }
  }

  /**
   * Flush all queued writes to disk. Safe to call concurrently — a second call
   * while flushing is in progress will wait and then flush any entries added
   * during the first flush.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.flushing) return;

    this.flushing = true;
    const batch = this.queue.splice(0);

    try {
      await Promise.all(
        batch.map(async ({ key, data, raw }) => {
          const absPath = join(this.cwd, key);
          await mkdir(dirname(absPath), { recursive: true });
          const content = raw ? String(data) : JSON.stringify(data, null, 2);
          await writeFile(absPath, content, 'utf-8');
        }),
      );
    } catch (err) {
      logger.warn({ err }, 'AsyncWriter: flush error');
      // Re-queue failed entries so they can be retried next flush
      this.queue.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Stop the auto-flush timer and flush any remaining queued writes.
   * Call this when the run finishes to ensure all data is persisted.
   */
  async destroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /** Number of pending (not yet flushed) entries. */
  get pendingCount(): number {
    return this.queue.length;
  }
}
