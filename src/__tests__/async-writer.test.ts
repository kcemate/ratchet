import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AsyncWriter } from '../core/async-writer.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ratchet-async-writer-'));
}

describe('AsyncWriter', () => {
  let dir: string;
  let writer: AsyncWriter;

  beforeEach(() => {
    dir = tmpDir();
    writer = new AsyncWriter(dir);
  });

  afterEach(async () => {
    await writer.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('enqueue + flush', () => {
    it('writes JSON data to disk on flush', async () => {
      writer.enqueue('.ratchet/test.json', { hello: 'world' });
      await writer.flush();

      const filePath = join(dir, '.ratchet/test.json');
      expect(existsSync(filePath)).toBe(true);
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(parsed.hello).toBe('world');
    });

    it('creates parent directories automatically', async () => {
      writer.enqueue('nested/deep/data.json', { x: 1 });
      await writer.flush();

      const filePath = join(dir, 'nested/deep/data.json');
      expect(existsSync(filePath)).toBe(true);
    });

    it('deduplicates by key — keeps latest value', async () => {
      writer.enqueue('.ratchet/state.json', { version: 1 });
      writer.enqueue('.ratchet/state.json', { version: 2 });
      await writer.flush();

      const parsed = JSON.parse(readFileSync(join(dir, '.ratchet/state.json'), 'utf-8'));
      expect(parsed.version).toBe(2);
    });

    it('flushes multiple keys in one batch', async () => {
      writer.enqueue('a.json', { id: 'a' });
      writer.enqueue('b.json', { id: 'b' });
      await writer.flush();

      expect(existsSync(join(dir, 'a.json'))).toBe(true);
      expect(existsSync(join(dir, 'b.json'))).toBe(true);
    });

    it('does nothing on flush when queue is empty', async () => {
      await expect(writer.flush()).resolves.toBeUndefined();
    });
  });

  describe('enqueueRaw', () => {
    it('writes raw string content verbatim', async () => {
      const markdown = '# Strategy\n\n> Auto-generated\n';
      writer.enqueueRaw('.ratchet/strategy.md', markdown);
      await writer.flush();

      const content = readFileSync(join(dir, '.ratchet/strategy.md'), 'utf-8');
      expect(content).toBe(markdown);
    });

    it('deduplicates raw entries by key', async () => {
      writer.enqueueRaw('file.md', 'first');
      writer.enqueueRaw('file.md', 'second');
      await writer.flush();

      const content = readFileSync(join(dir, 'file.md'), 'utf-8');
      expect(content).toBe('second');
    });
  });

  describe('pendingCount', () => {
    it('reflects queued items before flush', () => {
      expect(writer.pendingCount).toBe(0);
      writer.enqueue('x.json', {});
      expect(writer.pendingCount).toBe(1);
      writer.enqueue('y.json', {});
      expect(writer.pendingCount).toBe(2);
    });

    it('resets to 0 after flush', async () => {
      writer.enqueue('x.json', {});
      await writer.flush();
      expect(writer.pendingCount).toBe(0);
    });
  });

  describe('destroy', () => {
    it('flushes remaining items and clears timer', async () => {
      writer.enqueue('.ratchet/final.json', { done: true });
      await writer.destroy();

      expect(existsSync(join(dir, '.ratchet/final.json'))).toBe(true);
      expect(writer.pendingCount).toBe(0);
    });

    it('is safe to call multiple times', async () => {
      await expect(writer.destroy()).resolves.toBeUndefined();
      await expect(writer.destroy()).resolves.toBeUndefined();
    });
  });

  describe('auto-flush at queue threshold', () => {
    it('auto-flushes when queue exceeds 10 items', async () => {
      // Enqueue 11 items to trigger auto-flush
      for (let i = 0; i < 11; i++) {
        writer.enqueue(`item-${i}.json`, { i });
      }
      // Auto-flush is async (void), give it a tick
      await new Promise(r => setTimeout(r, 50));

      expect(existsSync(join(dir, 'item-0.json'))).toBe(true);
    });
  });


});
