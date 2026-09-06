import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { config, STORAGE_DIR } from '../config.ts';
import { db } from '../db/index.ts';
import { otpMethods } from './otp.ts';
import { availableProviders } from './payments.ts';
import { getIceServers } from './turn.ts';
import { lastBackup, BACKUP_DIR } from './backups.ts';

/**
 * سجلّ التكاملات: لكل خدمة خارجية/داخلية حالة (جاهز / ناقص / غير مفعّل) تُستنتج من config بلا شبكة،
 * وقائمة المتغيّرات الناقصة، ووصف عربي بلا أسرار، وفحص اتصال حقيقي بمهلة ٨ ثوانٍ لا يرمي أبداً.
 * يغذّي GET /admin/system ولوحة «الربط والخدمات» وسكربت doctor وملخّص /api/health.
 */
export type IntegrationStatus = 'ready' | 'partial' | 'off';
export type IntegrationGroup = 'server' | 'auth' | 'messaging' | 'payments' | 'rooms' | 'push' | 'mail' | 'monitoring' | 'data';
export type CheckResult = { ok: boolean; detail: string; ms: number };
export interface Integration {
  id: string; group: IntegrationGroup; label: string;
  status(): IntegrationStatus; missing(): string[]; detail(): string;
  check(): Promise<CheckResult>;
  /** معرّف العنوان في README (ربط الخدمات) */
  docs: string;
}
export type IntegrationItem = { id: string; group: IntegrationGroup; label: string; status: IntegrationStatus; missing: string[]; detail: string; docs: string };

const TIMEOUT_MS = 8_000;
export const GROUP_LABELS: Record<IntegrationGroup, string> = {
  server: 'الخادم', data: 'البيانات', auth: 'الدخول ورموز التحقّق', messaging: 'المراسلة', payments: 'الدفع',
  rooms: 'القاعات المباشرة', push: 'الإشعارات الفورية', mail: 'البريد', monitoring: 'المراقبة',
};
const GROUP_ORDER: IntegrationGroup[] = ['server', 'data', 'auth', 'messaging', 'payments', 'rooms', 'push', 'mail', 'monitoring'];

/* ---------- أدوات ---------- */
type Reply = { status: number; ok: boolean; json: any; text: string };
/** طلب بمهلة — يرمي عند انقطاع الشبكة/المهلة (يُحوَّل أدناه إلى ok:false) */
async function probe(url: string, init: RequestInit = {}): Promise<Reply> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* ليس JSON */ }
    return { status: res.status, ok: res.ok, json, text };
  } finally { clearTimeout(timer); }
}
const reason = (err: unknown): string => {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  if (e?.name === 'AbortError') return 'انتهت مهلة الاتصال (٨ ثوانٍ)';
  return `تعذّر الاتصال (${e?.cause?.code || e?.message || 'خطأ غير معروف'})`;
};
const OFF: CheckResult = { ok: true, detail: 'غير مفعّل', ms: 0 };
const NO_CHECK: CheckResult = { ok: true, detail: 'لا يحتاج فحصاً', ms: 0 };
const basic = (user: string, pass: string) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
/** إخفاء معرّف غير سرّي لكن طويل: أول ٤ وآخر ٤ */
const mask = (v: string) => (v.length <= 10 ? '***' : `${v.slice(0, 4)}…${v.slice(-4)}`);
const fmtBytes = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const isProd = () => config.env === 'production';
const hasEnv = (name: string) => !!process.env[name];

/** يقيس المدة ويمنع أي رمي؛ العناصر غير المفعّلة لا تلمس الشبكة */
const timed = (fn: () => Promise<Omit<CheckResult, 'ms'>>) => async (): Promise<CheckResult> => {
  const t0 = Date.now();
  try { const r = await fn(); return { ...r, ms: Date.now() - t0 }; }
  catch (err) { return { ok: false, detail: reason(err), ms: Date.now() - t0 }; }
};

/* ---------- الفحوصات المشتركة (البريد ورسائل OTP) ---------- */
async function checkTwilioAccount(): Promise<Omit<CheckResult, 'ms'>> {
  const { accountSid, authToken } = config.otp.sms.twilio;
  const r = await probe(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, { headers: basic(accountSid, authToken) });
  if (r.status === 401 || r.status === 403 || r.status === 404) return { ok: false, detail: 'المعرّف أو المفتاح مرفوض من Twilio' };
  if (!r.ok) return { ok: false, detail: `ردّ غير متوقّع من Twilio (${r.status})` };
  return { ok: true, detail: `الحساب ${r.json?.status === 'active' ? 'نشط' : String(r.json?.status ?? 'موجود')}${r.json?.type === 'Trial' ? ' (تجريبي)' : ''}` };
}
async function checkSmtp(): Promise<Omit<CheckResult, 'ms'>> {
  const s = config.otp.email.smtp;
  const t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, ...(s.user ? { auth: { user: s.user, pass: s.pass } } : {}), connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS });
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([t.verify(), new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'AbortError' })), TIMEOUT_MS); })]);
    return { ok: true, detail: `SMTP ${s.host}:${s.port} يقبل الاتصال` };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    return { ok: false, detail: `رفض SMTP: ${String((err as { code?: string })?.code ?? (err as Error)?.message ?? '').slice(0, 60)}` };
  } finally { clearTimeout(timer); t.close(); }
}
async function checkResend(): Promise<Omit<CheckResult, 'ms'>> {
  const r = await probe('https://api.resend.com/domains', { headers: bearer(config.otp.email.resend.apiKey) });
  if (r.status === 401 || r.status === 403) return { ok: false, detail: 'مفتاح Resend مرفوض' };
  if (!r.ok) return { ok: false, detail: `ردّ غير متوقّع من Resend (${r.status})` };
  const n = Array.isArray(r.json?.data) ? r.json.data.length : 0;
  return { ok: true, detail: n ? `${n} نطاق مسجّل` : 'المفتاح صالح — لا نطاقات بعد (يمكن الإرسال من onboarding@resend.dev فقط)' };
}
async function checkHttpGateway(): Promise<Omit<CheckResult, 'ms'>> {
  const url = config.otp.sms.http.url.replace(/\{(to|to_digits|text|code)\}/g, '');
  let r: Reply;
  try { r = await probe(url, { method: 'HEAD' }); } catch { r = await probe(url, { method: 'GET' }); }
  return { ok: true, detail: `البوابة تردّ (${r.status})` };
}
const emailCheck = () => (config.otp.email.provider === 'smtp' ? checkSmtp() : config.otp.email.provider === 'resend' ? checkResend() : Promise.resolve(OFF));
const emailMissing = () => (config.otp.email.provider !== 'log' ? [] : ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']);
const emailDetail = () => ({ smtp: `SMTP عبر ${config.otp.email.smtp.host}`, resend: 'Resend', log: 'لا مزوّد — الرسائل تُطبع في السجلّ' }[config.otp.email.provider]);
const jwks = (url: string, name: string) => async (): Promise<Omit<CheckResult, 'ms'>> => {
  const r = await probe(url);
  const n = Array.isArray(r.json?.keys) ? r.json.keys.length : 0;
  return n ? { ok: true, detail: `مفاتيح ${name} متاحة (${n})` } : { ok: false, detail: `تعذّر قراءة مفاتيح ${name} (${r.status})` };
};

/* ---------- العناصر ---------- */
const item = (i: Omit<Integration, 'check'> & { check?: () => Promise<Omit<CheckResult, 'ms'>> }): Integration => ({
  ...i,
  check: async () => (i.status() === 'off' ? OFF : i.check ? timed(i.check)() : NO_CHECK),
});

const items: Integration[] = [
  item({
    id: 'server.public_url', group: 'server', label: 'العنوان العام (HTTPS)', docs: 'النطاق-وhttps',
    status: () => (config.publicUrl.startsWith('https://') ? 'ready' : 'partial'),
    missing: () => (hasEnv('PUBLIC_URL') || hasEnv('RENDER_EXTERNAL_URL') || hasEnv('FLY_APP_NAME') ? [] : ['PUBLIC_URL']),
    detail: () => `${config.publicUrl}${config.publicUrl.startsWith('https://') ? '' : ' — بلا HTTPS (الكاميرا والمايك يتطلّبانه على الجوال)'}`,
    check: async () => { const r = await probe(`${config.publicUrl}/api/health`); return r.ok && r.json?.ok ? { ok: true, detail: 'الخادم يردّ من عنوانه العام' } : { ok: false, detail: `الخادم لا يردّ من عنوانه العام (${r.status})` }; },
  }),
  item({
    id: 'server.cors', group: 'server', label: 'مصادر CORS', docs: 'النطاق-وhttps',
    status: () => (!isProd() || config.security.corsOrigins.length ? 'ready' : 'partial'),
    missing: () => (isProd() && !config.security.corsOrigins.length ? ['CORS_ORIGINS'] : []),
    detail: () => (config.security.corsOrigins.length ? `${config.security.corsOrigins.length} مصدر مسموح` : isProd() ? 'مفتوح لكل المصادر — حدّده في الإنتاج' : 'مفتوح لكل المصادر (خارج الإنتاج)'),
  }),
  item({
    id: 'data.sqlite', group: 'data', label: 'قاعدة البيانات SQLite', docs: 'النسخ-الاحتياطية',
    status: () => 'ready', missing: () => [],
    detail: () => {
      const mode = String(db.pragma('journal_mode', { simple: true }));
      if (config.db.file === ':memory:') return `في الذاكرة (${mode})`;
      try { return `${fmtBytes(fs.statSync(config.db.file).size)} — ${mode}`; } catch { return `${config.db.file} (${mode})`; }
    },
    check: async () => { const r = String(db.pragma('quick_check', { simple: true })); return r === 'ok' ? { ok: true, detail: 'سلامة القاعدة: ok' } : { ok: false, detail: `فحص السلامة: ${r.slice(0, 80)}` }; },
  }),
  item({
    id: 'data.backups', group: 'data', label: 'النسخ الاحتياطية', docs: 'النسخ-الاحتياطية',
    status: () => {
      if (!config.backups.enabled || config.db.file === ':memory:') return 'off';
      const last = lastBackup();
      return last && Date.now() - new Date(last.at).getTime() < config.backups.everyHours * 2 * 3_600_000 ? 'ready' : 'partial';
    },
    missing: () => [],
    detail: () => {
      if (config.db.file === ':memory:') return 'لا نسخ لقاعدة في الذاكرة';
      if (!config.backups.enabled) return 'معطّلة (BACKUP_ENABLED=0)';
      const last = lastBackup();
      return last ? `آخر نسخة ${last.at.slice(0, 16).replace('T', ' ')} (${fmtBytes(last.bytes)}) — كل ${config.backups.everyHours} س، نحتفظ بـ ${config.backups.keep}` : `لا نسخة بعد — ستُنشأ تلقائياً كل ${config.backups.everyHours} س`;
    },
    check: async () => { fs.mkdirSync(BACKUP_DIR, { recursive: true }); fs.accessSync(BACKUP_DIR, fs.constants.W_OK); return { ok: true, detail: `المجلّد قابل للكتابة: ${BACKUP_DIR}` }; },
  }),
  item({
    id: 'data.storage', group: 'data', label: 'مخزن الملفات', docs: 'النسخ-الاحتياطية',
    status: () => { try { fs.accessSync(STORAGE_DIR, fs.constants.W_OK); return 'ready'; } catch { return 'partial'; } },
    missing: () => [],
    detail: () => { try { const s = fs.statfsSync(STORAGE_DIR); return `${STORAGE_DIR} — متاح ${fmtBytes(s.bavail * s.bsize)}`; } catch { return `${STORAGE_DIR} — غير قابل للكتابة`; } },
    check: async () => { const f = path.join(STORAGE_DIR, `.doctor-${process.pid}`); fs.writeFileSync(f, 'ok'); fs.unlinkSync(f); return { ok: true, detail: 'الكتابة والحذف يعملان' }; },
  }),
  item({
    id: 'auth.otp_sms', group: 'auth', label: 'رموز التحقّق عبر SMS', docs: 'رموز-تحقق-حقيقية',
    status: () => (config.otp.sms.provider !== 'log' ? 'ready' : 'off'),
    missing: () => (config.otp.sms.provider !== 'log' ? [] : ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID']),
    detail: () => ({ twilio_verify: 'Twilio Verify', twilio: 'Twilio Messages', http: 'بوابة HTTP', log: 'لا مزوّد' }[config.otp.sms.provider] + (otpMethods().testCode ? ' — الرمز الثابت مفعّل' : '') + ` — الدول: ${config.otp.sms.allowedCountries.join(' ')}`),
    check: () => (config.otp.sms.provider === 'http' ? checkHttpGateway() : checkTwilioAccount()),
  }),
  item({
    id: 'auth.otp_whatsapp', group: 'auth', label: 'رموز التحقّق عبر واتساب', docs: 'رموز-تحقق-حقيقية',
    status: () => (otpMethods().whatsapp ? 'ready' : config.otp.sms.provider === 'twilio' ? 'partial' : 'off'),
    missing: () => (otpMethods().whatsapp ? [] : config.otp.sms.provider === 'twilio' ? ['TWILIO_WHATSAPP_FROM'] : ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID']),
    detail: () => (otpMethods().whatsapp ? (config.otp.sms.provider === 'twilio_verify' ? 'عبر مرسل Twilio Verify المشترك' : 'عبر رقم واتساب في Twilio') : config.otp.sms.provider === 'twilio' ? 'يحتاج رقم واتساب معتمداً' : 'يتطلّب Twilio'),
    check: checkTwilioAccount,
  }),
  item({
    id: 'auth.otp_email', group: 'auth', label: 'رموز التحقّق عبر البريد', docs: 'رموز-تحقق-حقيقية',
    status: () => (config.otp.email.provider !== 'log' ? 'ready' : 'off'), missing: emailMissing,
    detail: () => `${emailDetail()}${otpMethods().testCode ? ' — الرمز الثابت مفعّل' : ''}`,
    check: emailCheck,
  }),
  item({
    id: 'auth.google', group: 'auth', label: 'الدخول بحساب Google', docs: 'google-sign-in',
    status: () => (config.auth.google.clientIds.length ? 'ready' : 'off'),
    missing: () => (config.auth.google.clientIds.length ? [] : ['GOOGLE_CLIENT_IDS']),
    detail: () => (config.auth.google.clientIds.length ? `${config.auth.google.clientIds.length} معرّف عميل — الويب: ${mask(config.auth.google.clientIds[0])}` : 'غير مضبوط'),
    check: jwks('https://www.googleapis.com/oauth2/v3/certs', 'Google'),
  }),
  item({
    id: 'auth.apple', group: 'auth', label: 'الدخول بحساب Apple', docs: 'apple-sign-in',
    status: () => (config.auth.apple.clientIds.length ? 'ready' : 'off'),
    missing: () => (config.auth.apple.clientIds.length ? [] : ['APPLE_CLIENT_IDS', 'APPLE_SERVICES_ID']),
    detail: () => (config.auth.apple.clientIds.length ? `${config.auth.apple.clientIds.length} معرّف — الويب: ${config.auth.apple.servicesId ? mask(config.auth.apple.servicesId) : 'بلا Services ID'}` : 'غير مضبوط'),
    check: jwks('https://appleid.apple.com/auth/keys', 'Apple'),
  }),
  item({
    id: 'payments.thawani', group: 'payments', label: 'ثواني (بطاقات عُمانية)', docs: 'ثواني',
    status: () => { const t = config.payments.thawani, listed = config.payments.providers.includes('thawani'); return t.secretKey && t.publishableKey && listed ? 'ready' : t.secretKey || listed ? 'partial' : 'off'; },
    missing: () => { const t = config.payments.thawani; return [...(t.secretKey ? [] : ['THAWANI_SECRET_KEY']), ...(t.publishableKey ? [] : ['THAWANI_PUBLISHABLE_KEY']), ...(config.payments.providers.includes('thawani') ? [] : ['PAYMENT_PROVIDERS'])]; },
    detail: () => { const t = config.payments.thawani; return `${t.mode === 'uat' ? 'وضع التجربة (UAT)' : 'وضع الإنتاج (live)'}${config.payments.providers.includes('thawani') ? '' : ' — أضف thawani إلى PAYMENT_PROVIDERS'}${t.secretKey && !t.webhookSecret ? ' — بلا سرّ webhook (التأكيد بالاستعلام فقط)' : ''}`; },
    check: async () => {
      const t = config.payments.thawani;
      if (!t.secretKey) return { ok: false, detail: 'لا مفتاح سرّي' };
      // قائمة الجلسات مسار موثّق يردّ 200 مع success لأي مفتاح صحيح (بلا إنشاء جلسة)؛ 404 بجسم success = مسار قديم لكن المفتاح مقبول
      const r = await probe(`${t.baseUrl}/api/v1/checkout/session?limit=1&skip=0`, { headers: { 'thawani-api-key': t.secretKey } });
      if (r.status === 401 || r.status === 403) return { ok: false, detail: 'المفتاح مرفوض' };
      if ((r.status === 200 || r.status === 404) && r.json && 'success' in r.json) return { ok: true, detail: `المفتاح مقبول (${t.mode})` };
      return { ok: false, detail: `ردّ غير متوقّع من ثواني (${r.status})` };
    },
  }),
  item({
    id: 'payments.stripe', group: 'payments', label: 'Stripe', docs: 'stripe',
    status: () => { const listed = config.payments.providers.includes('stripe'), k = !!config.payments.stripe.secretKey; return k && listed ? 'ready' : k || listed ? 'partial' : 'off'; },
    missing: () => [...(config.payments.stripe.secretKey ? [] : ['STRIPE_SECRET_KEY']), ...(config.payments.providers.includes('stripe') ? [] : ['PAYMENT_PROVIDERS'])],
    detail: () => `${config.payments.stripe.mode === 'live' ? 'وضع الإنتاج (live)' : 'وضع التجربة (test)'}${config.payments.providers.includes('stripe') ? '' : ' — أضف stripe إلى PAYMENT_PROVIDERS'}`,
    check: async () => {
      const r = await probe('https://api.stripe.com/v1/balance', { headers: bearer(config.payments.stripe.secretKey) });
      if (r.status === 401 || r.status === 403) return { ok: false, detail: 'المفتاح مرفوض' };
      return r.ok ? { ok: true, detail: `الحساب يردّ (${config.payments.stripe.mode})` } : { ok: false, detail: `ردّ غير متوقّع من Stripe (${r.status})` };
    },
  }),
  ...(['wallet', 'manual', 'mock'] as const).map(id => item({
    id: `payments.${id}`, group: 'payments', label: { wallet: 'المحفظة', manual: 'التحويل البنكي', mock: 'بطاقة تجريبية (mock)' }[id], docs: 'ثواني',
    status: () => (!config.payments.providers.includes(id) ? 'off' : id === 'mock' && isProd() ? 'partial' : 'ready'),
    missing: () => (config.payments.providers.includes(id) ? [] : ['PAYMENT_PROVIDERS']),
    detail: () => (id === 'mock' && isProd() && config.payments.providers.includes(id) ? 'أزل mock من PAYMENT_PROVIDERS' : config.payments.providers.includes(id) ? (id === 'manual' ? `حساب ${config.payments.manual.bankName}` : 'مفعّل') : 'غير مدرج في PAYMENT_PROVIDERS'),
  })),
  item({
    id: 'rooms.webrtc', group: 'rooms', label: 'القاعة الداخلية (WebRTC)', docs: 'turn',
    status: () => 'ready', missing: () => [], detail: () => (config.rooms.provider === 'internal' ? 'المزوّد الحالي — دردشة وحضور وفيديو نظير لنظير' : `متاح احتياطاً (المزوّد الحالي ${config.rooms.provider})`),
  }),
  item({
    id: 'rooms.turn', group: 'rooms', label: 'خوادم TURN', docs: 'turn',
    status: () => (config.rooms.turn.source !== 'none' ? 'ready' : isProd() ? 'partial' : 'off'),
    missing: () => (config.rooms.turn.source !== 'none' ? [] : ['TURN_URL', 'METERED_API_KEY', 'METERED_DOMAIN']),
    detail: () => ({ static: 'قائمة ثابتة (TURN_URL)', twilio: 'بيانات مؤقّتة من Twilio', metered: `Metered (${config.rooms.turn.metered.domain})`, none: isProd() ? 'لا TURN — قد يفشل الفيديو عبر شبكات الجوال' : 'مرحّل عام مجاني (خارج الإنتاج فقط)' }[config.rooms.turn.source]),
    check: async () => {
      const servers = await getIceServers();
      const turn = servers.filter(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith('turn')));
      return turn.length ? { ok: true, detail: `${turn.length} خادم TURN جاهز` } : { ok: false, detail: 'لم تُجلب أي بيانات TURN' };
    },
  }),
  item({
    id: 'rooms.livekit', group: 'rooms', label: 'LiveKit (فيديو جماعي)', docs: 'livekit',
    status: () => { const l = config.rooms.livekit, keys = !!(l.url && l.apiKey && l.apiSecret); return config.rooms.provider === 'livekit' ? (keys ? 'ready' : 'partial') : keys ? 'partial' : 'off'; },
    missing: () => { const l = config.rooms.livekit; return [...(l.url ? [] : ['LIVEKIT_URL']), ...(l.apiKey ? [] : ['LIVEKIT_API_KEY']), ...(l.apiSecret ? [] : ['LIVEKIT_API_SECRET']), ...(config.rooms.provider === 'livekit' ? [] : ['ROOM_PROVIDER'])]; },
    detail: () => (config.rooms.provider === 'livekit' ? `المزوّد الحالي — ${config.rooms.livekit.url || 'بلا عنوان'}` : config.rooms.livekit.url ? 'المفاتيح موجودة — اضبط ROOM_PROVIDER=livekit' : 'غير مضبوط'),
    check: async () => {
      const { url, apiKey, apiSecret } = config.rooms.livekit;
      if (!url || !apiKey || !apiSecret) return { ok: false, detail: 'المفاتيح ناقصة' };
      jwt.sign({ iss: apiKey, sub: 'doctor', video: { roomJoin: false } }, apiSecret, { algorithm: 'HS256', expiresIn: 60 });
      const r = await probe(url.replace(/^wss?:\/\//, m => (m === 'wss://' ? 'https://' : 'http://')));
      return { ok: true, detail: `الخادم يردّ (${r.status}) والتوقيع يعمل` };
    },
  }),
  item({
    id: 'push.web', group: 'push', label: 'إشعارات المتصفح (Web Push)', docs: 'web-push',
    status: () => (config.push.vapid.publicKey && config.push.vapid.privateKey ? 'ready' : 'partial'),
    missing: () => (config.push.vapid.publicKey ? [] : ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']),
    detail: () => (hasEnv('VAPID_PUBLIC_KEY') ? 'مفاتيح VAPID من البيئة' : 'مفاتيح VAPID مولَّدة تلقائياً ومحفوظة في DATA_DIR') + ` — ${config.push.subject}`,
  }),
  item({
    id: 'push.expo', group: 'push', label: 'إشعارات التطبيق (Expo)', docs: 'expo-push',
    status: () => 'ready', missing: () => [],
    detail: () => (config.push.expoAccessToken ? 'مع رمز وصول Expo' : 'بلا رمز وصول (يكفي للتطبيقات غير المقيّدة)'),
    check: async () => {
      const r = await probe('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.push.expoAccessToken ? bearer(config.push.expoAccessToken) : {}) }, body: '[]' });
      return r.json ? { ok: true, detail: `خدمة Expo تردّ (${r.status})` } : { ok: false, detail: `ردّ غير متوقّع من Expo (${r.status})` };
    },
  }),
  item({
    id: 'mail.transactional', group: 'mail', label: 'البريد (الإيصالات والتأكيدات)', docs: 'رموز-تحقق-حقيقية',
    status: () => (config.otp.email.provider !== 'log' ? 'ready' : 'off'), missing: emailMissing,
    detail: () => `${emailDetail()} — من ${config.otp.email.from}${config.mail.receipts ? '' : ' — الإيصالات معطّلة'}`,
    check: emailCheck,
  }),
  item({
    id: 'monitoring.sentry', group: 'monitoring', label: 'تتبّع الأخطاء (Sentry)', docs: 'sentry',
    status: () => (config.monitoring.sentryDsn ? 'ready' : 'off'),
    missing: () => (config.monitoring.sentryDsn ? [] : ['SENTRY_DSN']),
    detail: () => (config.monitoring.sentryDsn ? `مفعّل — بيئة ${config.env}، عيّنة التتبّع ${config.monitoring.tracesSampleRate}` : 'غير مضبوط'),
  }),
];

/* ---------- الواجهة ---------- */
export const integrations = (): readonly Integration[] => items;
const toItem = (i: Integration): IntegrationItem => ({ id: i.id, group: i.group, label: i.label, status: i.status(), missing: i.missing(), detail: i.detail(), docs: i.docs });

export function listIntegrations(): { group: IntegrationGroup; label: string; items: IntegrationItem[] }[] {
  return GROUP_ORDER.map(group => ({ group, label: GROUP_LABELS[group], items: items.filter(i => i.group === group).map(toItem) })).filter(g => g.items.length);
}

/** يشغّل الفحوصات بالتوازي (كلها تُستكمل — لا رمي) */
export async function runChecks(ids?: string[]): Promise<Record<string, CheckResult>> {
  const wanted = ids?.length ? items.filter(i => ids.includes(i.id)) : items;
  const results = await Promise.all(wanted.map(async i => [i.id, await i.check().catch((err): CheckResult => ({ ok: false, detail: reason(err), ms: 0 }))] as const));
  return Object.fromEntries(results);
}

export function summary(): { ready: number; partial: number; off: number; total: number } {
  const s = { ready: 0, partial: 0, off: 0, total: items.length };
  for (const i of items) s[i.status()]++;
  return s;
}

/** وسائل الدفع المتاحة فعلاً (للعميل) */
export { availableProviders };
