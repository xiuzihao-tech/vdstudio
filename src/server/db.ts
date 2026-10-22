// 数据库：开发期用 Node 自带的 SQLite（node:sqlite），上线换 Postgres 时只改这一层和 repo.ts。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MIGRATIONS: string[] = [
  `CREATE TABLE owners (id TEXT PRIMARY KEY, current_ws TEXT, created_at TEXT NOT NULL);
   CREATE TABLE workspaces (
     id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, persona TEXT NOT NULL, positioning TEXT NOT NULL,
     balance REAL NOT NULL DEFAULT 1280, voice_clone TEXT NOT NULL DEFAULT 'none', theme TEXT NOT NULL DEFAULT 'studio',
     created_at TEXT NOT NULL, UNIQUE(owner_id, persona));
   CREATE TABLE topics (
     id TEXT PRIMARY KEY, ws TEXT NOT NULL, cat INTEGER NOT NULL, title TEXT NOT NULL, hook TEXT NOT NULL, why TEXT NOT NULL,
     dir TEXT NOT NULL, type INTEGER NOT NULL, heat INTEGER NOT NULL, k TEXT NOT NULL, age_months INTEGER NOT NULL,
     source TEXT NOT NULL, fav INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, seq INTEGER NOT NULL);
   CREATE INDEX topics_ws ON topics(ws, seq DESC);
   CREATE TABLE drafts (id TEXT PRIMARY KEY, ws TEXT NOT NULL, topic_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(ws, topic_id));
   CREATE TABLE assets (
     id TEXT PRIMARY KEY, ws TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, k TEXT NOT NULL, file TEXT, mime TEXT,
     size INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, created_at TEXT NOT NULL, seq INTEGER NOT NULL);
   CREATE INDEX assets_ws ON assets(ws, seq DESC);
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY, ws TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, steps TEXT NOT NULL,
     cost REAL NOT NULL, title TEXT NOT NULL, input TEXT NOT NULL, output TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX jobs_ws ON jobs(ws, created_at DESC);
   CREATE TABLE ledger (id TEXT PRIMARY KEY, ws TEXT NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, job_id TEXT, created_at TEXT NOT NULL);
   CREATE TABLE plans (
     id TEXT PRIMARY KEY, ws TEXT NOT NULL, account TEXT NOT NULL, weekdays TEXT NOT NULL, hour REAL NOT NULL, need_ok INTEGER NOT NULL,
     budget INTEGER NOT NULL, running INTEGER NOT NULL, mix TEXT NOT NULL, added TEXT NOT NULL DEFAULT '[]', skipped TEXT NOT NULL DEFAULT '[]',
     backlog TEXT NOT NULL DEFAULT '[]', seq INTEGER NOT NULL);
   CREATE TABLE slots (plan_id TEXT NOT NULL, date TEXT NOT NULL, topic_id TEXT NOT NULL, pin TEXT NOT NULL, why TEXT NOT NULL, col TEXT NOT NULL,
     PRIMARY KEY(plan_id, date));
   CREATE TABLE covers (id TEXT PRIMARY KEY, ws TEXT NOT NULL, title TEXT NOT NULL, style TEXT NOT NULL, created_at TEXT NOT NULL);`,
  // 1：账号与会话。owner 是数据归属，账号登录后绑定到一个 owner
  `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pass_hash TEXT NOT NULL, owner_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
   CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
   CREATE INDEX sessions_user ON sessions(user_id);`,
  // 2：小规模线上验证：点数归账号（不再按身份各算一份）、邀请码、埋点、反馈、运营开关
  `ALTER TABLE owners ADD COLUMN balance REAL;
   UPDATE owners SET balance = COALESCE((SELECT MAX(balance) FROM workspaces w WHERE w.owner_id = owners.id), 1280);
   CREATE TABLE invites (code TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', max_uses INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
   ALTER TABLE users ADD COLUMN invite TEXT;
   CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, ws TEXT, name TEXT NOT NULL, props TEXT, created_at TEXT NOT NULL);
   CREATE INDEX events_name_time ON events(name, created_at);
   CREATE INDEX events_owner ON events(owner_id, created_at);
   CREATE TABLE feedback (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, page TEXT NOT NULL, text TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL);
   CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
];

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (n INTEGER PRIMARY KEY)');
  const done = new Set((db.prepare('SELECT n FROM _migrations').all() as { n: number }[]).map(r => r.n));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i)) return;
    db.exec('BEGIN');
    try { db.exec(sql); db.prepare('INSERT INTO _migrations (n) VALUES (?)').run(i); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  });
  return db;
}

export const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
export const now = () => new Date().toISOString();
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
