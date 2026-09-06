import fs from 'node:fs';
import path from 'node:path';
import { config, STORAGE_DIR } from '../config.ts';
import { q } from '../db/index.ts';
import { hmac, safeEqual, randomToken } from '../lib/helpers.ts';
import { AppError, notFound } from '../lib/errors.ts';

export interface StoredFile { id: number; owner_id: number | null; storage_path: string; original_name: string | null; mime: string; size: number; visibility: string; purpose: string }

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
  const file = getFile(fileId);
  if (!file || !fs.existsSync(absolutePath(file))) throw notFound('الملف غير موجود');
  return file;
}

/** الصور العامة (أغلفة، صور) — رابط ثابت بلا توقيع */
export const publicUrl = (fileId: number | null | undefined): string | null =>
  fileId ? `${config.publicUrl}/api/files/public/${fileId}` : null;
