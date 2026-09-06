import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, DEFAULT_SETTINGS } from '../config.ts';
import { normalizeArabic } from '../lib/helpers.ts';
import { runMigrations, hasTable, SCHEMA_VERSION } from './migrations.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

export const db = new Database(config.db.file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
/** دالّة SQL للبحث العربي المطبَّع: norm(title) LIKE '%' || norm(?) || '%' */
db.function('norm', { deterministic: true }, (v: unknown) => normalizeArabic(v == null ? '' : String(v)));

/**
 * يجهّز أي قاعدة (تُستخدم أيضاً في اختبار الترحيلات على ملف مؤقّت):
 * قاعدة جديدة → schema.sql بشكله النهائي مباشرة ويُختم user_version بالإصدار الأخير (لا ترحيلات ولا نسخة احتياطية لملف فارغ)؛
 * قاعدة قديمة → الترحيلات المرقّمة (مكتفية بذاتها، بنسخة احتياطية) ثم schema.sql مرة أخرى لما استُحدث من جداول/فهارس (IF NOT EXISTS فلا يمسّ الموجود).
 */
export function migrateDb(target: Database.Database, dbFile: string, opts: { backup?: boolean } = {}): void {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  if (!hasTable(target, 'users')) { target.exec(schema); target.pragma(`user_version = ${SCHEMA_VERSION}`); return; }
  runMigrations(target, dbFile, opts);
  target.exec(schema);
}

/** ينشئ الجداول أو يرقّيها ويثبّت الإعدادات الافتراضية غير الموجودة. */
export function migrate(): void {
  migrateDb(db, config.db.file);
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, JSON.stringify(value));
}

type Params = unknown[];
export const q = {
  all: <T = any>(sql: string, ...p: Params): T[] => db.prepare(sql).all(...p) as T[],
  get: <T = any>(sql: string, ...p: Params): T | undefined => db.prepare(sql).get(...p) as T | undefined,
  run: (sql: string, ...p: Params) => db.prepare(sql).run(...p),
  val: <T = any>(sql: string, ...p: Params): T | undefined => {
    const row = db.prepare(sql).get(...p) as Record<string, T> | undefined;
    return row ? (Object.values(row)[0] as T) : undefined;
  },
};

export const tx = <T>(fn: () => T): T => db.transaction(fn)();

/* ---------- الإعدادات (السياسات) ---------- */
export const settings = {
  get<T = unknown>(key: keyof typeof DEFAULT_SETTINGS | string, fallback?: T): T {
    const row = q.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return (fallback ?? (DEFAULT_SETTINGS as Record<string, unknown>)[key]) as T;
    try { return JSON.parse(row.value) as T; } catch { return row.value as unknown as T; }
  },
  set(key: string, value: unknown): void {
    q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  },
  all(): Record<string, unknown> {
    return Object.fromEntries(q.all<{ key: string; value: string }>('SELECT key, value FROM settings').map(r => {
      try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, r.value]; }
    }));
  },
};

export const json = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
};
export const toJson = (value: unknown): string | null => (value == null ? null : JSON.stringify(value));
export const nowIso = (): string => new Date().toISOString();
