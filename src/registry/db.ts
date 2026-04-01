/**
 * Score Registry — SQLite database initialisation.
 * Uses better-sqlite3 directly for synchronous, zero-config access.
 * WAL mode gives safe concurrent reads alongside writes.
 */

import Database from 'better-sqlite3';
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

export type Db = Database.Database;

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;

  const path =
    dbPath ??
    process.env['RATCHET_DB_PATH'] ??
    resolve(process.cwd(), 'ratchet-registry.db');

  if (path !== ':memory:') {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  initSchema(sqlite);

  _db = sqlite;
  return _db;
}

/** Reset the singleton — used in tests to get a fresh in-memory DB. */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function initSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      key_hash    TEXT NOT NULL UNIQUE,
      name        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS score_submissions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_owner          TEXT    NOT NULL,
      repo_name           TEXT    NOT NULL,
      repo_url            TEXT,
      language            TEXT,
      overall_score       INTEGER NOT NULL,
      testing_score       INTEGER,
      security_score      INTEGER,
      type_safety_score   INTEGER,
      error_handling_score INTEGER,
      performance_score   INTEGER,
      code_quality_score  INTEGER,
      ratchet_version     TEXT,
      submitted_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      submitted_by        TEXT,
      metadata            TEXT
    );

    CREATE TABLE IF NOT EXISTS repo_profiles (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      owner                TEXT    NOT NULL,
      name                 TEXT    NOT NULL,
      first_scanned        TEXT    NOT NULL,
      latest_score         INTEGER,
      scan_count           INTEGER NOT NULL DEFAULT 0,
      language             TEXT,
      best_score           INTEGER,
      worst_score          INTEGER,
      latest_submission_id INTEGER,
      UNIQUE(owner, name)
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_repo
      ON score_submissions(repo_owner, repo_name, submitted_at DESC);

    CREATE INDEX IF NOT EXISTS idx_profiles_score
      ON repo_profiles(latest_score DESC);

    CREATE INDEX IF NOT EXISTS idx_profiles_language
      ON repo_profiles(language, latest_score DESC);
  `);
}
