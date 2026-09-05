import crypto from 'node:crypto';
import config from '../config.js';

/** تحويل نصّ عربي/لاتيني إلى معرّف URL آمن. */
export function slugify(text, { maxLength = 80 } = {}) {
  const base = String(text || '')
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')       // إزالة التشكيل
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, maxLength);
  return base || 'item';
}

/** يضمن تفرّد المعرّف داخل جدول. */
export function uniqueSlug(db, table, text) {
  const base = slugify(text);
  let slug = base;
  let i = 1;
  const stmt = db.prepare(`SELECT 1 AS x FROM ${table} WHERE slug = ?`);
  while (stmt.get(slug)) slug = `${base}-${++i}`;
  return slug;
}

export const randomCode = (len = 6) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(len)).map(b => alphabet[b % alphabet.length]).join('');
};

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** تقريب المبلغ حسب خانات العملة المعتمدة. */
export function money(amount) {
  const f = 10 ** config.money.decimals;
  return Math.round((Number(amount) || 0) * f) / f;
}

export const formatMoney = (amount) =>
  `${money(amount).toFixed(config.money.decimals)} ${config.money.symbol}`;

export const nowIso = () => new Date().toISOString();
export const addDays = (days, from = new Date()) => new Date(from.getTime() + days * 86400000).toISOString();
export const addMinutes = (minutes, from = new Date()) => new Date(from.getTime() + minutes * 60000).toISOString();

export const json = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

export const toJson = (value) => (value == null ? null : JSON.stringify(value));

/** ترقيم الصفحات مع حدود آمنة. */
export function paginate(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(query.limit, 10) || 12));
  return { page, limit, offset: (page - 1) * limit };
}

export function pageMeta(total, { page, limit }) {
  return { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** إخفاء الحقول الحسّاسة قبل الإرسال للعميل. */
export function publicUser(user) {
  if (!user) return null;
  const { password_hash, verify_token, reset_token, reset_expires, ...safe } = user;
  return safe;
}

export const orderNumber = () => {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ORD-${stamp}-${randomCode(5)}`;
};

export const certSerial = () => `CERT-${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
