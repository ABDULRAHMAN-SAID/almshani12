import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const db = new Database(config.db.file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/** ينشئ الجداول إن لم تكن موجودة. */
export function migrate() {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

/* ---------- مساعدات استعلام مختصرة ---------- */
export const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
  /** أول عمود من أول صف */
  val: (sql, ...p) => {
    const row = db.prepare(sql).get(...p);
    return row ? Object.values(row)[0] : undefined;
  },
};

/** تنفيذ داخل معاملة واحدة. */
export function tx(fn) {
  return db.transaction(fn)();
}

/* ---------- الإعدادات العامة ---------- */
export const settings = {
  get(key, fallback = null) {
    const row = q.get('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  },
  set(key, value) {
    q.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key, JSON.stringify(value),
    );
    return value;
  },
  all() {
    return Object.fromEntries(q.all('SELECT key, value FROM settings').map(r => {
      let v = r.value;
      try { v = JSON.parse(r.value); } catch {}
      return [r.key, v];
    }));
  },
};

export default db;
