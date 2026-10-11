import fs from 'node:fs';
import Database from 'better-sqlite3';

// Each entry upgrades the schema by one version (PRAGMA user_version). Append only.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE COLLATE NOCASE,
    pass_hash TEXT,
    recovery_hash TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    banned INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0 -- granted from the CLI only
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('fart','burp')),
    type TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    local_date TEXT NOT NULL,
    local_hour INTEGER NOT NULL,
    smell INTEGER,
    discomfort INTEGER,
    triggers TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL DEFAULT '',
    audio_id TEXT UNIQUE,
    audio_ms INTEGER,
    peaks TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX logs_user_date ON logs(user_id, local_date);
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    log_id INTEGER NOT NULL UNIQUE REFERENCES logs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    type TEXT NOT NULL,
    audio_id TEXT NOT NULL,
    audio_ms INTEGER NOT NULL,
    peaks TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    report_count INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX posts_feed ON posts(hidden, id);
  CREATE INDEX posts_audio ON posts(audio_id);
  CREATE TABLE reactions (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE reports (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE blocks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, blocked_id)
  );
  -- Once-a-day gut check: how bloated / sore the belly felt (0 none … 3 severe).
  CREATE TABLE gut_checks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL,
    bloating INTEGER CHECK (bloating BETWEEN 0 AND 3),
    pain INTEGER CHECK (pain BETWEEN 0 AND 3),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, local_date)
  );
  `,
];

export function openDb(cfg) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.mkdirSync(cfg.audioDir, { recursive: true });
  const db = new Database(cfg.dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
