/**
 * API key management for the Score Registry.
 * Keys are 64-char hex strings prefixed with "ratchet_".
 * Only the SHA-256 hash is stored in the database.
 */

import { createHash, randomBytes } from 'crypto';
import type { Db } from './db.js';

export interface ApiKeyRecord {
  id: string;
  key_hash: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export function generateApiKey(): { key: string; id: string } {
  const id = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const key = `ratchet_${secret}`;
  return { key, id };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function createApiKey(db: Db, name?: string): { key: string; id: string } {
  const { key, id } = generateApiKey();
  const hash = hashKey(key);
  db.prepare(
    `INSERT INTO api_keys (id, key_hash, name) VALUES (?, ?, ?)`,
  ).run(id, hash, name ?? null);
  return { key, id };
}

export function verifyApiKey(db: Db, rawKey: string): ApiKeyRecord | null {
  const hash = hashKey(rawKey);
  const record = db
    .prepare(`SELECT * FROM api_keys WHERE key_hash = ?`)
    .get(hash) as ApiKeyRecord | undefined;

  if (!record) return null;

  // Update last_used_at
  db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(record.id);
  return record;
}
