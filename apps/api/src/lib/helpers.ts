import crypto from 'node:crypto';
import { config } from '../config.ts';

export const randomCode = (len = 6, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string =>
  Array.from(crypto.randomBytes(len)).map(b => alphabet[b % alphabet.length]).join('');
export const randomDigits = (len = 6): string => Array.from(crypto.randomBytes(len)).map(b => String(b % 10)).join('');
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('hex');
export const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
export const hmac = (value: string, secret: string): string => crypto.createHmac('sha256', secret).update(value).digest('hex');
export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** تقريب حسب خانات العملة — الريال العُماني بثلاث خانات */
export const money = (amount: number): number => {
  const f = 10 ** config.money.decimals;
  return Math.round((Number(amount) || 0) * f) / f;
};

export const orderNumber = (): string => {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `ORD-${stamp}-${randomCode(5)}`;
};

export const slugify = (text: string, max = 80): string =>
  String(text || '').normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, max) || 'item';

export const nowIso = (): string => new Date().toISOString();
export const addMinutes = (minutes: number, from: Date = new Date()): string => new Date(from.getTime() + minutes * 60_000).toISOString();
export const addHours = (hours: number, from: Date = new Date()): string => addMinutes(hours * 60, from);
export const addDays = (days: number, from: Date = new Date()): string => addMinutes(days * 1440, from);

/** طابع زمني موحّد ISO-8601 UTC بلاحقة Z — يقبل صيغة SQLite القديمة 'YYYY-MM-DD HH:MM:SS' */
export const iso = <T extends string | null | undefined>(value: T): T =>
  (typeof value === 'string' && value.length >= 19 && value[10] === ' ' ? (`${value.slice(0, 10)}T${value.slice(11, 19)}Z` as T) : value);

/** تاريخ عربي مقروء بتوقيت مسقط — «٦ نوفمبر ٢٠٢٦» */
export function arabicDate(value: string): string {
  const d = new Date(iso(value));
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('ar-OM', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Muscat' }).format(d);
}

/** الفرق بالساعات بين الآن ووقت مستقبلي (سالب إن مضى) */
export const hoursUntil = (iso: string): number => (new Date(iso).getTime() - Date.now()) / 3_600_000;

/** تطبيع عربي للبحث: توحيد الهمزات والتاء المربوطة وحذف «ال» والتشكيل */
export function normalizeArabic(text: string): string {
  return String(text || '')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\bال/g, '')
    .toLowerCase().trim();
}

export const paginate = (page: number, limit: number) => ({ limit, offset: (page - 1) * limit });
export const pageMeta = (total: number, page: number, limit: number) => ({ total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });

/** تحويل وقت بتوقيت مسقط (yyyy-mm-dd + HH:mm) إلى ISO UTC — بلا مكتبة مناطق زمنية */
export function muscatToUtc(date: string, time: string): string {
  // عُمان ثابتة على +04:00 بلا توقيت صيفي
  return new Date(`${date}T${time}:00+04:00`).toISOString();
}
export function utcToMuscatParts(iso: string): { date: string; time: string; weekday: number } {
  const d = new Date(new Date(iso).getTime() + 4 * 3_600_000);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return { date, time, weekday: d.getUTCDay() };
}
