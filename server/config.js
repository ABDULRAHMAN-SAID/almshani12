import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'public', 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** يولّد مفتاحاً ثابتاً ويحفظه محلياً حتى لا تُبطَل الجلسات عند كل تشغيل. */
function persistentSecret(name) {
  const file = path.join(DATA_DIR, `.${name}`);
  try { return fs.readFileSync(file, 'utf8').trim(); } catch {}
  const value = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d = false) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 3000)}`).replace(/\/$/, ''),

  platform: {
    name: process.env.PLATFORM_NAME || 'منصّة',
    tagline: process.env.PLATFORM_TAGLINE || 'تعلّم بلا حدود — حصص مباشرة، دورات، وملخّصات كتب',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
  },

  db: { file: process.env.DB_FILE || path.join(DATA_DIR, 'manassah.db') },

  jwt: {
    secret: process.env.JWT_SECRET || persistentSecret('jwt_secret'),
    accessTtl: process.env.JWT_ACCESS_TTL || '30m',
    refreshTtlDays: num(process.env.JWT_REFRESH_TTL_DAYS, 30),
  },

  money: {
    currency: process.env.CURRENCY || 'OMR',
    symbol: process.env.CURRENCY_SYMBOL || 'ر.ع',
    decimals: num(process.env.CURRENCY_DECIMALS, 3),
    taxRate: num(process.env.TAX_RATE, 0),            // 0.05 = ٥٪
    commissionRate: num(process.env.COMMISSION_RATE, 0.2),
    minPayout: num(process.env.MIN_PAYOUT, 10),
    referralBonus: num(process.env.REFERRAL_BONUS, 1),
  },

  payments: {
    // mock | stripe | manual — يمكن تفعيل أكثر من بوابة
    providers: (process.env.PAYMENT_PROVIDERS || 'mock,wallet,manual').split(',').map(s => s.trim()).filter(Boolean),
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    },
    manual: {
      bankName: process.env.BANK_NAME || 'بنك مسقط',
      accountName: process.env.BANK_ACCOUNT_NAME || 'منصّة للتعليم',
      iban: process.env.BANK_IBAN || 'OM00 0000 0000 0000 0000 0000',
    },
  },

  mail: {
    driver: process.env.MAIL_DRIVER || 'log',   // log | smtp
    from: process.env.MAIL_FROM || 'no-reply@example.com',
  },

  uploads: {
    dir: UPLOAD_DIR,
    maxSizeMb: num(process.env.UPLOAD_MAX_MB, 50),
  },

  rateLimit: {
    // التعطيل مخصّص لبيئة الاختبار فقط
    enabled: bool(process.env.RATE_LIMIT_ENABLED, process.env.NODE_ENV !== 'test'),
    apiPerMinute: num(process.env.RATE_LIMIT_API, 300),
    authPer15Min: num(process.env.RATE_LIMIT_AUTH, 20),
  },

  security: {
    trustProxy: bool(process.env.TRUST_PROXY, false),
    corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    bcryptRounds: num(process.env.BCRYPT_ROUNDS, 10),
  },

  seedPassword: process.env.SEED_PASSWORD || 'Passw0rd!',
};

export default config;
