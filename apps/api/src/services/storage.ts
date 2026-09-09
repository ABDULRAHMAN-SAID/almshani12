import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { config, STORAGE_DIR } from '../config.ts';
import { q } from '../db/index.ts';
import { hmac, safeEqual, randomToken } from '../lib/helpers.ts';
import { AppError, notFound, badRequest } from '../lib/errors.ts';

export interface StoredFile { id: number; owner_id: number | null; storage_path: string; original_name: string | null; mime: string; size: number; visibility: string; purpose: string }

const TMP_DIR = path.join(STORAGE_DIR, 'tmp');
// امتداد بحروف لاتينية فقط؛ امتداد عربي كامل («صورة») كان يترك المسار منتهياً بنقطة عارية
const extOf = (name: string) => {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  return ext === '.' ? '' : ext;
};

/** الصور النقطية وحدها: SVG مستند ينفّذ سكربتاً على نطاق التطبيق نفسه، فقبوله غلافاً عاماً يعني سرقة جلسات */
export const RASTER_IMAGE = /^image\/(png|jpe?g|gif|webp|heic|heif)$/;

/**
 * نوع الملف من بايتاته الأولى — Content-Type يكتبه العميل فلا يُصدَّق:
 * صورة PNG «مُعلَنة» PDF كانت تُخزَّن ملفاً لكتاب مدفوع لا يفتحه أي قارئ.
 */
const MAGIC: { mime: string; match: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', match: b => b.subarray(0, 4).toString('hex') === '89504e47' },
  { mime: 'image/jpeg', match: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', match: b => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { mime: 'image/webp', match: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', match: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'video/webm', match: b => b.subarray(0, 4).toString('hex') === '1a45dfa3' },
  // صور آيفون HEIC/HEIF حاوية ISO-BMFF مثل mp4 (نفس صندوق ftyp): العلامة التجارية وحدها تفصلها،
  // ولولا هذا السطر لاستُنتجت «فيديو» فرُفضت كل صورة من آيفون رغم أنّ RASTER_IMAGE يسمح بها.
  { mime: 'image/heic', match: b => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(b.subarray(8, 12).toString('latin1')) },
  { mime: 'video/mp4', match: b => b.subarray(4, 8).toString('latin1') === 'ftyp' },
];
const sniffMime = (abs: string): string | null => {
  const buf = Buffer.alloc(32);
  const fd = fs.openSync(abs, 'r');
  try { fs.readSync(fd, buf, 0, 32, 0); } finally { fs.closeSync(fd); }
  return MAGIC.find(m => m.match(buf))?.mime ?? null;
};

/**
 * رفع متدفّق إلى القرص: الملف يُكتب قطعة قطعة في tmp ثم يُنقل مكانه —
 * لا يُحمَّل في الذاكرة ولا يُكتب دفعة واحدة تعطّل حلقة الأحداث.
 * الحدّ لكل غرض (صورة صغيرة، فيديو كبير) لا حدّاً واحداً للجميع.
 */
export const upload = (maxMb: number = config.uploads.maxSizeMb) => {
  const handler = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => { fs.mkdirSync(TMP_DIR, { recursive: true }); cb(null, TMP_DIR); },
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomToken(8)}${extOf(file.originalname)}`),
    }),
    limits: { fileSize: Math.max(1, maxMb) * 1024 * 1024 },
    // بدونه يفكّ busboy اسم «ملخص الحصة.pdf» كـ latin1 فيصل طلاسم — خيار مدعوم في multer 2 وغائب عن أنواعه
    defParamCharset: 'utf8',
  } as multer.Options).single('file');
  return (req: Request, res: Response, next: NextFunction) => handler(req, res, (err?: unknown) => {
    // ما لم يُنقل إلى المخزن (رفض النوع، خطأ لاحق) يُحذف بعد انتهاء الاستجابة
    const tmp = req.file?.path;
    if (tmp) res.on('finish', () => { try { fs.rmSync(tmp, { force: true }); } catch { /* حُذف بالنقل */ } });
    next(err ? uploadError(err, maxMb) : undefined);
  });
};

/** خطأ multer خطأُ عميل لا عطلُ خادم: بلا ترجمة يصير 500 «حاول مرة أخرى» ولا يعرف الرافع أن ملفه أكبر من الحدّ */
function uploadError(err: unknown, maxMb: number): unknown {
  if (!(err instanceof multer.MulterError)) return err;
  if (err.code === 'LIMIT_FILE_SIZE') return new AppError('file_too_large', `الملف أكبر من الحدّ المسموح (${maxMb} ميغابايت)`, 413);
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return badRequest('أرسل الملف في الحقل «file» وحده');
  return badRequest('تعذّر قراءة الملف المرفوع');
}

/** ينقل ملفاً مرفوعاً (على القرص) إلى المخزن ويسجّله — بلا نسخ في الذاكرة */
export function storeUpload(file: { path: string; originalname: string; mimetype: string; size: number },
  { ownerId, purpose = 'general', visibility = 'private' as 'private' | 'public' }: { ownerId: number | null; purpose?: string; visibility?: 'private' | 'public' }): StoredFile {
  // البايتات هي الحقيقة: نوع مُعلَن يخالفها يُرفض، وما نخزّنه هو المستنتَج لا ما ادّعاه العميل
  const sniffed = sniffMime(file.path);
  const known = /^(image\/|video\/|application\/pdf)/.test(file.mimetype);
  if (sniffed ? sniffed.split('/')[0] !== file.mimetype.split('/')[0] : known) throw badRequest('محتوى الملف لا يطابق نوعه المعلن');
  const mime = sniffed ?? file.mimetype;
  const rel = path.join(purpose, `${Date.now()}-${randomToken(8)}${extOf(file.originalname)}`);
  const abs = path.join(STORAGE_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  try { fs.renameSync(file.path, abs); }
  catch { fs.copyFileSync(file.path, abs); fs.rmSync(file.path, { force: true }); } // نظام ملفات مختلف
  const info = q.run(
    'INSERT INTO files (owner_id, storage_path, original_name, mime, size, purpose, visibility) VALUES (?,?,?,?,?,?,?)',
    ownerId, rel, file.originalname.slice(0, 200), mime, file.size, purpose, visibility);
  return q.get<StoredFile>('SELECT * FROM files WHERE id = ?', info.lastInsertRowid)!;
}

/** يحفظ ملفاً في المخزن الخاص ويسجّله. الملفات لا تُخدَم مباشرة أبداً. */
export function storeFile(buffer: Buffer, { ownerId, originalName, mime, purpose = 'general', visibility = 'private' as 'private' | 'public' }:
  { ownerId: number | null; originalName: string; mime: string; purpose?: string; visibility?: 'private' | 'public' }): StoredFile {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const rel = path.join(purpose, `${Date.now()}-${randomToken(8)}${ext}`);
  const abs = path.join(STORAGE_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  const info = q.run(
    'INSERT INTO files (owner_id, storage_path, original_name, mime, size, purpose, visibility) VALUES (?,?,?,?,?,?,?)',
    ownerId, rel, originalName.slice(0, 200), mime, buffer.length, purpose, visibility);
  return q.get<StoredFile>('SELECT * FROM files WHERE id = ?', info.lastInsertRowid)!;
}

export const getFile = (id: number): StoredFile | undefined => q.get<StoredFile>('SELECT * FROM files WHERE id = ?', id);
export const absolutePath = (file: StoredFile): string => path.join(STORAGE_DIR, file.storage_path);

/**
 * يحذف ملفاً بديلاً وبايتاته — يُستدعى عند استبدال غلاف أو ملف كتاب أو فيديو:
 * الصفّ المستبدَل يبقى بلا مرجع لكنه يظلّ مقروءاً على القرص وفي جدول files للأبد.
 */
export function deleteFile(fileId: number | null | undefined): void {
  if (!fileId) return;
  const f = getFile(fileId);
  if (!f) return;
  try { fs.rmSync(path.join(STORAGE_DIR, f.storage_path), { force: true }); } catch { /* مفقود أصلاً */ }
  q.run('DELETE FROM files WHERE id = ?', fileId);
}

/** بقايا رفع لم يكتمل (تعطّل أو نشر في منتصف الرفع) تبقى في tmp بلا صاحب — تُكنس عند الإقلاع */
export function sweepTmpUploads(maxAgeHours = 24): number {
  let removed = 0;
  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  for (const name of (fs.existsSync(TMP_DIR) ? fs.readdirSync(TMP_DIR) : [])) {
    const abs = path.join(TMP_DIR, name);
    try { if (fs.statSync(abs).mtimeMs < cutoff) { fs.rmSync(abs, { force: true }); removed++; } } catch { /* اختفى بالتوازي */ }
  }
  return removed;
}

/**
 * رابط موقّع قصير العمر مرتبط بالمستخدم — لا يُخزَّن ولا يُشارَك.
 * الصيغة: /api/files/:id?u=userId&e=expires&s=signature
 */
export function signedUrl(fileId: number, userId: number, ttlSeconds = config.signing.fileUrlTtlSeconds): { url: string; expiresAt: string } {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(`${fileId}.${userId}.${expires}`, config.signing.secret);
  return {
    url: `${config.publicUrl}/api/files/${fileId}?u=${userId}&e=${expires}&s=${sig}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

/** يتحقّق من التوقيع ويعيد الملف — أو يرفض */
export function verifySignedAccess(fileId: number, userId: number, expires: number, sig: string): StoredFile {
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) throw new AppError('content_unavailable', 'انتهت صلاحية الرابط', 403);
  const expected = hmac(`${fileId}.${userId}.${expires}`, config.signing.secret);
  if (!sig || !safeEqual(expected, sig)) throw new AppError('forbidden', 'رابط غير صالح', 403);
  // الرابط الموقّع حاملٌ محض: نعيد التفويض عند القراءة لا عند الإصدار وحده. حالة الحساب هي ما يمكن التحقّق منه
  // هنا بلا تكرار قواعد كل نطاق — إيقاف حساب أو حذفه كان يترك روابطه صالحة حتى ساعة بعد الإيقاف.
  // userId = 0 رابط ضيف (معاينة كتاب، مقدّمة دورة) فلا حساب يُراجَع له.
  if (userId > 0 && q.val<string>('SELECT status FROM users WHERE id = ?', userId) !== 'active') throw new AppError('forbidden', 'رابط غير صالح', 403);
  const file = getFile(fileId);
  if (!file || !fs.existsSync(absolutePath(file))) throw notFound('الملف غير موجود');
  return file;
}

/** الصور العامة (أغلفة، صور) — رابط ثابت بلا توقيع */
export const publicUrl = (fileId: number | null | undefined): string | null =>
  fileId ? `${config.publicUrl}/api/files/public/${fileId}` : null;

/** عكسها: معرّف الملف داخل مسار صورة عامة محفوظ في profiles.avatar_path أو learners.avatar_path */
export const publicFileIdOf = (avatarPath: string | null | undefined): number | null =>
  Number(/^\/api\/files\/public\/(\d+)$/.exec(avatarPath ?? '')?.[1]) || null;
