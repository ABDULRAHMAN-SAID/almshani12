import fs from 'node:fs';
import path from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db/index.ts';

/**
 * نسخ احتياطية لقاعدة SQLite عبر VACUUM INTO (نسخة متماسكة حتى مع WAL) إلى DATA_DIR/backups،
 * مع الإبقاء على آخر `keep` ملفات. المجدول في index.ts يشغّلها كل everyHours ساعة (لا شيء لقاعدة في الذاكرة أو عند BACKUP_ENABLED=0).
 */
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export type BackupFile = { file: string; bytes: number; at: string };

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // YYYYMMDD-HHMMSS

/** كل النسخ الموجودة، الأحدث أولاً */
export function listBackups(): BackupFile[] {
  let names: string[];
  try { names = fs.readdirSync(BACKUP_DIR).filter(n => /^manassah-\d{8}-\d{6}(-\d+)?\.db$/.test(n)); } catch { return []; }
  return names.map(n => { const st = fs.statSync(path.join(BACKUP_DIR, n)); return { file: path.join(BACKUP_DIR, n), bytes: st.size, at: st.mtime.toISOString(), mtime: st.mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ mtime: _m, ...b }) => b);
}

export const lastBackup = (): BackupFile | null => listBackups()[0] ?? null;

/** يحذف ما زاد عن `keep` (الأقدم أولاً) ويعيد عدد المحذوف */
export function pruneBackups(keep = config.backups.keep): number {
  const extra = listBackups().slice(Math.max(0, keep));
  for (const b of extra) { try { fs.unlinkSync(b.file); } catch { /* حُذف من خارجنا */ } }
  return extra.length;
}

/** نسخة الآن — تُنشئ المجلّد، تكتب الملف، ثم تقلّم القديم */
export function runBackup(): { file: string; bytes: number } {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let file = path.join(BACKUP_DIR, `manassah-${stamp()}.db`);
  for (let i = 1; fs.existsSync(file); i++) file = path.join(BACKUP_DIR, `manassah-${stamp()}-${i}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const bytes = fs.statSync(file).size;
  pruneBackups();
  if (!config.isTest) console.log(`[backup] ${path.basename(file)} (${bytes} bytes)`);
  return { file, bytes };
}

/** هل مضى على آخر نسخة أكثر من `hours` ساعة (أو لا نسخة أصلاً)؟ */
export function backupDue(hours = config.backups.everyHours): boolean {
  const last = lastBackup();
  return !last || Date.now() - new Date(last.at).getTime() > hours * 3_600_000;
}

/** يُشغَّل مرة عند الإقلاع: نسخة فورية إن لم توجد نسخة حديثة، ثم فحص كل ساعة (unref حتى لا يمنع الإغلاق) */
export function startBackupScheduler(): NodeJS.Timeout | null {
  if (!config.backups.enabled || config.db.file === ':memory:') return null;
  const tick = () => { if (backupDue()) { try { runBackup(); } catch (err) { console.error('[backup] failed', (err as Error)?.message); } } };
  tick();
  const timer = setInterval(tick, Math.min(config.backups.everyHours, 1) * 3_600_000);
  timer.unref();
  return timer;
}
