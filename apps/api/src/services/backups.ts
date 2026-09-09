import Database from 'better-sqlite3';
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
const NAME_RE = /^manassah-\d{8}-\d{6}(-\d+)?\.db$/;

/**
 * ملف يصلح أن يُعدّ نسخة: ترويسة SQLite كاملة وبلا سجلّ استرجاع معلّق. الانقطاع أثناء الكتابة
 * (قتل العملية أو امتلاء القرص) يترك ملفاً بحجم معقول وترويسة أصفار — ولأنه الأحدث بتاريخ التعديل
 * كان يصير «آخر نسخة»، فيوقف الجدولة ويُقلَّم آخر ملف سليم بدلاً منه.
 */
function looksIntact(file: string): boolean {
  if (fs.existsSync(`${file}-journal`)) return false;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16);
    return fs.readSync(fd, head, 0, 16, 0) === 16 && head.toString('latin1') === 'SQLite format 3\0';
  } catch { return false; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* أُغلق أصلاً */ } }
}

/** لا نقبل ملفاً كنسخة قبل أن يُفتح ويجتاز quick_check وفيه جداولنا — استعادة ملف فارغ أسوأ من غياب النسخة */
function verifyBackup(file: string): void {
  if (!looksIntact(file)) throw new Error('نسخة غير صالحة: ترويسة SQLite ناقصة');
  const copy = new Database(file, { readonly: true });
  try {
    const check = copy.pragma('quick_check', { simple: true });
    const tables = (copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
    if (check !== 'ok') throw new Error(`نسخة غير صالحة: ${String(check)}`);
    if (tables === 0) throw new Error('نسخة غير صالحة: بلا جداول');
  } finally { copy.close(); }
}

/** بقايا كتابة مقطوعة: ملفات .part وملفات بأسماء نسخ لا تجتاز الفحص — تُحذف حتى لا تتراكم (listBackups لا يراها) */
export function cleanupBrokenBackups(): number {
  let names: string[];
  try { names = fs.readdirSync(BACKUP_DIR); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    const file = path.join(BACKUP_DIR, name);
    if (!name.endsWith('.db.part') && !(NAME_RE.test(name) && !looksIntact(file))) continue;
    for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) { try { fs.unlinkSync(f); } catch { /* غير موجود */ } }
    removed++;
  }
  return removed;
}

/** كل النسخ الموجودة، الأحدث أولاً */
export function listBackups(): BackupFile[] {
  let names: string[];
  try { names = fs.readdirSync(BACKUP_DIR).filter(n => NAME_RE.test(n) && looksIntact(path.join(BACKUP_DIR, n))); } catch { return []; }
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
  cleanupBrokenBackups();
  let file = path.join(BACKUP_DIR, `manassah-${stamp()}.db`);
  for (let i = 1; fs.existsSync(file); i++) file = path.join(BACKUP_DIR, `manassah-${stamp()}-${i}.db`);
  // الكتابة إلى .part ثم الفحص ثم إعادة التسمية: الانقطاع في المنتصف يترك بقايا لا تُحسب نسخة، بدل ملف مبتور باسم نسخة سليمة
  const part = `${file}.part`;
  try {
    db.exec(`VACUUM INTO '${part.replace(/'/g, "''")}'`);
    verifyBackup(part);
    fs.renameSync(part, file);
  } catch (err) {
    for (const f of [part, `${part}-journal`]) { try { fs.unlinkSync(f); } catch { /* لم يُنشأ */ } }
    throw err;
  }
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
  cleanupBrokenBackups();
  tick();
  // الفحص كل ساعة على الأكثر، وبحدّ أدنى دقيقة: فترة أصغر من ذلك تجعل الفحص حلقة تنسخ القاعدة كلّها بلا توقّف
  const timer = setInterval(tick, Math.max(60_000, Math.min(config.backups.everyHours, 1) * 3_600_000));
  timer.unref();
  return timer;
}
