import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from '@manassah/shared';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
/** مخزن الملفات الخاص — لا يُخدَم مباشرة أبداً */
export const STORAGE_DIR = process.env.STORAGE_DIR || path.join(DATA_DIR, 'storage');

for (const dir of [DATA_DIR, STORAGE_DIR]) fs.mkdirSync(dir, { recursive: true });

function persistentSecret(name: string): string {
  const file = path.join(DATA_DIR, `.${name}`);
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* يُولَّد أدناه */ }
  const value = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

const num = (v: string | undefined, d: number) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v: string | undefined, d = false) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const list = (v: string | undefined, d: string[]) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : d);

const isTest = process.env.NODE_ENV === 'test';

export const config = {
  env: process.env.NODE_ENV || 'development',
  /** الإقلاع الأول على خادم فارغ: بذر تجريبي كامل (خادم عرض) أو المنهج فقط + مدير أوّل */
  bootstrap: {
    allowDemoSeed: bool(process.env.ALLOW_DEMO_SEED, false),
    adminPhone: process.env.ADMIN_PHONE || null,
  },
  isTest,
  port: num(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',
  /** العنوان العام: PUBLIC_URL، وإلا ما تضبطه المنصّات تلقائياً (Render / Fly)، وإلا localhost */
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : '') || `http://localhost:${num(process.env.PORT, 4000)}`).replace(/\/$/, ''),
  brand,

  db: { file: process.env.DB_FILE || path.join(DATA_DIR, 'manassah.db') },

  jwt: {
    secret: process.env.JWT_SECRET || persistentSecret('jwt_secret'),
    accessTtl: process.env.JWT_ACCESS_TTL || '30m',
    refreshTtlDays: num(process.env.JWT_REFRESH_TTL_DAYS, 60),
  },
  /** توقيع روابط الملفات المحمية */
  signing: {
    secret: process.env.SIGNING_SECRET || persistentSecret('signing_secret'),
    fileUrlTtlSeconds: num(process.env.FILE_URL_TTL, 900),
  },

  otp: {
    ttlSeconds: num(process.env.OTP_TTL, 300),
    maxAttempts: 5,
    /**
     * في التطوير يُطبَع الرمز في السجلّ ويُقبل 000000.
     * في الإنتاج بلا مزوّد رسائل بعد: OTP_FIXED_CODE يثبّت رمزاً للتجربة (أزله فور ربط مزوّد SMS).
     */
    devCode: process.env.OTP_FIXED_CODE || (isTest || process.env.NODE_ENV !== 'production' ? '000000' : null),
  },

  money: {
    currency: brand.currency.code,
    decimals: brand.currency.decimals,
    taxRate: num(process.env.TAX_RATE, 0),
  },

  payments: {
    providers: list(process.env.PAYMENT_PROVIDERS, ['mock', 'wallet', 'manual']),
    stripe: { secretKey: process.env.STRIPE_SECRET_KEY || '', webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '' },
    thawani: { secretKey: process.env.THAWANI_SECRET_KEY || '', publishableKey: process.env.THAWANI_PUBLISHABLE_KEY || '', webhookSecret: process.env.THAWANI_WEBHOOK_SECRET || '' },
    manual: {
      bankName: process.env.BANK_NAME || 'بنك مسقط',
      accountName: process.env.BANK_ACCOUNT_NAME || brand.name.ar,
      iban: process.env.BANK_IBAN || 'OM00 0000 0000 0000 0000 0000',
    },
  },

  rooms: {
    provider: (process.env.ROOM_PROVIDER || 'internal') as 'internal' | 'livekit' | 'daily' | 'agora',
    livekit: { url: process.env.LIVEKIT_URL || '', apiKey: process.env.LIVEKIT_API_KEY || '', apiSecret: process.env.LIVEKIT_API_SECRET || '' },
    tokenTtlSeconds: num(process.env.ROOM_TOKEN_TTL, 3 * 3600),
  },

  rateLimit: {
    enabled: bool(process.env.RATE_LIMIT_ENABLED, !isTest),
    apiPerMinute: num(process.env.RATE_LIMIT_API, 300),
    otpPer15Min: num(process.env.RATE_LIMIT_OTP, 8),
  },

  security: {
    trustProxy: bool(process.env.TRUST_PROXY, false),
    corsOrigins: list(process.env.CORS_ORIGINS, []),
  },

  uploads: { maxSizeMb: num(process.env.UPLOAD_MAX_MB, 200) },
} as const;

/** القيم الافتراضية للسياسات — تُحفَظ في جدول settings وتُدار من لوحة الإدارة */
export const DEFAULT_SETTINGS = {
  commission_rate: 0.20,
  tax_rate: 0,
  min_payout: 10,
  /** الإلغاء: قبل أكثر من ٢٤ ساعة كامل، ١٢–٢٤ نصف، أقل من ١٢ لا شيء */
  cancellation_policy: [
    { hoursBefore: 24, refundPercent: 100 },
    { hoursBefore: 12, refundPercent: 50 },
    { hoursBefore: 0, refundPercent: 0 },
  ],
  room_open_minutes_before: 15,
  room_close_minutes_after: 30,
  booking_payment_window_minutes: 10,
  earnings_hold_hours: 24,
  reminder_minutes: [60, 15],
  max_teacher_slots_per_day: 12,
} as const;

export default config;
