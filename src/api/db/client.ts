import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import * as schema from './schema.js';

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

function getDbPath(): string {
  if (process.env.RATCHET_DB_PATH) return process.env.RATCHET_DB_PATH;
  const dir = join(process.cwd(), '.ratchet');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'api.db');
}

let _db: DbClient | null = null;

export function getDb(): DbClient {
  if (!_db) {
    const sqlite = new Database(getDbPath());
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    initSchema(sqlite);
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

/** Reset singleton — used in tests to get a fresh in-memory DB. */
export function resetDb(): void {
  _db = null;
}

function initSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_id TEXT UNIQUE,
      email TEXT,
      username TEXT NOT NULL,
      avatar_url TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      api_key TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      cycle_count INTEGER NOT NULL DEFAULT 1,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start INTEGER,
      current_period_end INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
}
