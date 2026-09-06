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
/** فارغ = غير مضبوط (القيمة الافتراضية) — ملفات البيئة وأسرار CI تمرّر '' لا undefined */
const bool = (v: string | undefined, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const list = (v: string | undefined, d: string[]) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : d);

const isTest = process.env.NODE_ENV === 'test';

type IceServer = { urls: string | string[]; username?: string; credential?: string };
function iceServers(): IceServer[] {
  if (process.env.ICE_SERVERS) { try { return JSON.parse(process.env.ICE_SERVERS) as IceServer[]; } catch { /* يُتجاهل — نستعمل الافتراضي */ } }
  const list: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) list.push({ urls: process.env.TURN_URL.split(',').map(u => u.trim()), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  else if (process.env.NODE_ENV !== 'production') list.push({ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' });
  return list;
}

/* ---------- رموز التحقّق: المزوّدات تُستنتج من المتغيّرات مرة واحدة عند الإقلاع ---------- */
export type SmsProvider = 'twilio_verify' | 'twilio' | 'http' | 'log';
export type EmailProvider = 'smtp' | 'resend' | 'log';
const jsonRecord = (v: string | undefined): Record<string, string> => {
  if (!v) return {};
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, x]) => [k, String(x)])) : {}; } catch { return {}; }
};
const fixedCode: string | null = process.env.OTP_FIXED_CODE === 'none' ? null
  : process.env.OTP_FIXED_CODE || (isTest || process.env.NODE_ENV !== 'production' ? '000000' : null);
const twilio = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || '', authToken: process.env.TWILIO_AUTH_TOKEN || '',
  verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '', from: process.env.TWILIO_FROM || '',
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '', whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || '',
};
/** SMS_PROVIDER الصريح يفوز (auto افتراضياً): Verify ← Twilio ← بوابة HTTP ← سجلّ */
const smsProvider: SmsProvider = (() => {
  const explicit = (process.env.SMS_PROVIDER || 'auto').toLowerCase();
  if (['twilio_verify', 'twilio', 'http', 'log'].includes(explicit)) return explicit as SmsProvider;
  if (twilio.accountSid && twilio.authToken && twilio.verifyServiceSid) return 'twilio_verify';
  if (twilio.accountSid && twilio.authToken && (twilio.from || twilio.messagingServiceSid)) return 'twilio';
  if (process.env.SMS_HTTP_URL) return 'http';
  return 'log';
})();
const smtpPort = num(process.env.SMTP_PORT, 587);
const smtp = { host: process.env.SMTP_HOST || '', port: smtpPort, secure: bool(process.env.SMTP_SECURE, smtpPort === 465), user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' };
/** EMAIL_PROVIDER الصريح يفوز: SMTP عند SMTP_HOST، وإلا Resend عند RESEND_API_KEY، وإلا سجلّ */
const emailProvider: EmailProvider = (() => {
  const explicit = (process.env.EMAIL_PROVIDER || 'auto').toLowerCase();
  if (['smtp', 'resend', 'log'].includes(explicit)) return explicit as EmailProvider;
  if (smtp.host) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return 'log';
})();

/** مفاتيح VAPID للإشعارات عبر المتصفح: من البيئة، وإلا تُولَّد مرة واحدة وتُحفَظ في DATA_DIR/.vapid.json */
function vapidKeys(): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const file = path.join(DATA_DIR, '.vapid.json');
  try { const k = JSON.parse(fs.readFileSync(file, 'utf8')); if (k.publicKey && k.privateKey) return k; } catch { /* يُولَّد أدناه */ }
  // ECDSA P-256 كما تتطلّبه RFC 8292 — بلا مكتبة خارجية حتى لا يتأخّر الإقلاع
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string; y: string; d: string };
  // المفتاح العام بصيغة النقطة غير المضغوطة (0x04 ‖ x ‖ y) والخاص هو d — كلاهما base64url كما يتوقّعهما المتصفح وweb-push
  const keys = {
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'),
    privateKey: Buffer.from(jwk.d, 'base64url').toString('base64url'),
  };
  void publicKey;
  try { fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 }); } catch { /* قرص للقراءة فقط — تُستعمل لهذه الجلسة فقط */ }
  return keys;
}

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
    /** رمز ثابت: OTP_FIXED_CODE، وإلا 000000 خارج الإنتاج (وفي الاختبار). OTP_FIXED_CODE=none يعطّله في أي بيئة */
    fixedCode,
    /** أهداف اختبار تقبل الرمز الثابت دائماً (حتى مع مزوّد حقيقي): OTP_TEST_TARGETS (قائمة بفواصل، يسمح بـ * في النهاية كبادئة) + أنماط حسابات العرض عند ALLOW_DEMO_SEED=1: '+96890000*', '+96891000*' */
    testTargets: [...list(process.env.OTP_TEST_TARGETS, []), ...(bool(process.env.ALLOW_DEMO_SEED, false) ? ['+96890000*', '+96891000*'] : [])],
    sendPerTargetPerHour: num(process.env.OTP_SEND_PER_TARGET_HOUR, 5),
    /** سقف يومي عام للإرسال الحقيقي (حماية الرصيد) */
    sendPerDay: num(process.env.OTP_SEND_PER_DAY, 300),
    resendCooldownSeconds: num(process.env.OTP_RESEND_COOLDOWN, 30),
    sms: {
      provider: smsProvider,
      /** الدول المسموح بالإرسال إليها (بادئات E.164) — '*' = الكل */
      allowedCountries: list(process.env.SMS_ALLOWED_COUNTRIES, ['+968']),
      /** واتساب: متاح مع twilio_verify (مرسل Twilio المشترك) أو twilio مع TWILIO_WHATSAPP_FROM؛ OTP_WHATSAPP=0 يعطّله */
      whatsapp: bool(process.env.OTP_WHATSAPP, true) && (smsProvider === 'twilio_verify' || (smsProvider === 'twilio' && !!twilio.whatsappFrom)),
      twilio,
      http: {
        url: process.env.SMS_HTTP_URL || '',
        method: (process.env.SMS_HTTP_METHOD || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
        headers: jsonRecord(process.env.SMS_HTTP_HEADERS),
        body: process.env.SMS_HTTP_BODY || '',
        okMatch: process.env.SMS_HTTP_OK || '',
      },
    },
    email: {
      provider: emailProvider,
      from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost',
      smtp,
      resend: { apiKey: process.env.RESEND_API_KEY || '' },
    },
  },

  money: {
    currency: brand.currency.code,
    decimals: brand.currency.decimals,
    taxRate: num(process.env.TAX_RATE, 0),
  },

  payments: {
    providers: list(process.env.PAYMENT_PROVIDERS, ['mock', 'wallet', 'manual']),
    stripe: { secretKey: process.env.STRIPE_SECRET_KEY || '', webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '', mode: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'live' : 'test' as 'live' | 'test' },
    /** ثواني: UAT (بيئة الاختبار) افتراضياً خارج الإنتاج، وlive في الإنتاج — THAWANI_MODE يثبّتها */
    thawani: (() => {
      const mode = (process.env.THAWANI_MODE || (process.env.NODE_ENV === 'production' ? 'live' : 'uat')) === 'live' ? 'live' : 'uat';
      return { secretKey: process.env.THAWANI_SECRET_KEY || '', publishableKey: process.env.THAWANI_PUBLISHABLE_KEY || '', webhookSecret: process.env.THAWANI_WEBHOOK_SECRET || '',
        mode, baseUrl: (process.env.THAWANI_BASE_URL || (mode === 'uat' ? 'https://uatcheckout.thawani.om' : 'https://checkout.thawani.om')).replace(/\/$/, '') } as const;
    })(),
    manual: {
      bankName: process.env.BANK_NAME || 'بنك مسقط',
      accountName: process.env.BANK_ACCOUNT_NAME || brand.name.ar,
      iban: process.env.BANK_IBAN || 'OM00 0000 0000 0000 0000 0000',
    },
  },

  rooms: {
    provider: (process.env.ROOM_PROVIDER || 'internal') as 'internal' | 'livekit' | 'daily' | 'agora',
    /**
     * خوادم ICE للفيديو المباشر (WebRTC): STUN عام دائماً، وTURN من TURN_URL/TURN_USERNAME/TURN_CREDENTIAL
     * (أو ICE_SERVERS كمصفوفة JSON). خارج الإنتاج يُضاف مرحّل TURN عام مجاني حتى تعمل التجربة عبر شبكات الجوال.
     */
    iceServers: iceServers(),
    livekit: { url: process.env.LIVEKIT_URL || '', apiKey: process.env.LIVEKIT_API_KEY || '', apiSecret: process.env.LIVEKIT_API_SECRET || '' },
    tokenTtlSeconds: num(process.env.ROOM_TOKEN_TTL, 3 * 3600),
    /** TURN ديناميكي: static من TURN_URL، أو Twilio (خدمة عبور الشبكة) بنفس مفاتيح Twilio، أو Metered — وإلا none */
    turn: {
      source: (process.env.TURN_URL ? 'static'
        : process.env.TURN_SOURCE === 'static' ? 'static'
        : process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TURN_SOURCE !== 'metered' ? 'twilio'
        : process.env.METERED_API_KEY && process.env.METERED_DOMAIN ? 'metered' : 'none') as 'static' | 'twilio' | 'metered' | 'none',
      metered: { apiKey: process.env.METERED_API_KEY || '', domain: process.env.METERED_DOMAIN || '' },
      ttlSeconds: num(process.env.TURN_TTL, 3600),
    },
  },

  /** الدخول الاجتماعي: معرّفات العملاء المسموح بها (الويب أولاً) — فارغة = غير مفعّل */
  auth: {
    google: { clientIds: list(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID, []) },
    apple: { clientIds: list(process.env.APPLE_CLIENT_IDS || process.env.APPLE_CLIENT_ID, []), servicesId: process.env.APPLE_SERVICES_ID || '' },
  },

  /** الإشعارات الفورية: مفاتيح VAPID للويب (تُولَّد وتُحفَظ في DATA_DIR إن لم تُضبط) ورمز Expo اختياري */
  push: {
    vapid: vapidKeys(),
    subject: process.env.VAPID_SUBJECT || `mailto:${process.env.EMAIL_FROM || process.env.SMTP_USER || 'admin@localhost'}`.replace(/^mailto:.*<(.+)>$/, 'mailto:$1'),
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN || '',
    /** عنوان خدمة Expo Push — يُبدَّل في الاختبارات المحلية فقط */
    expoUrl: process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send',
  },

  monitoring: { sentryDsn: process.env.SENTRY_DSN || '', tracesSampleRate: num(process.env.SENTRY_TRACES, 0) },

  backups: { enabled: bool(process.env.BACKUP_ENABLED, true), keep: num(process.env.BACKUP_KEEP, 7), everyHours: num(process.env.BACKUP_EVERY_HOURS, 24) },

  mail: { receipts: bool(process.env.MAIL_RECEIPTS, true) },

  deploy: { domain: process.env.DOMAIN || '', image: process.env.GHCR_IMAGE || '' },

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
