import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.ts';
import { AppError } from '../lib/errors.ts';

/**
 * وسائط الإرسال الحقيقية لرموز التحقّق — Twilio (Verify / Messages) وبوابة HTTP عامة وSMTP وResend.
 * كلها تستعمل fetch العالمي (Node 22) بمهلة ١٥ ثانية، وترمي AppError برسائل عربية بلا أي سرّ.
 * services/otp.ts يغلّفها في كائن `transports` قابل للاستبدال في الاختبارات.
 */
const TIMEOUT_MS = 15_000;
const GENERIC = 'تعذّر إرسال الرمز الآن. حاول بعد قليل';
const sendFailed = (m = GENERIC) => new AppError('otp_send_failed', m, 502);

type Reply = { status: number; ok: boolean; text: string; json: any };
/** طلب HTTP بمهلة — أخطاء الشبكة/المهلة تتحوّل إلى otp_send_failed دون تفاصيل داخلية للمستخدم */
async function call(url: string, init: RequestInit): Promise<Reply> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* ليس JSON */ }
    return { status: res.status, ok: res.ok, text, json };
  } catch (err) {
    console.error('[otp] transport error', (err as Error)?.name === 'AbortError' ? 'timeout' : (err as Error)?.message);
    throw sendFailed();
  } finally { clearTimeout(timer); }
}
const form = (fields: Record<string, string>) => new URLSearchParams(Object.entries(fields).filter(([, v]) => v !== '')).toString();

/* ---------- Twilio ---------- */
const tw = () => config.otp.sms.twilio;
const twilioHeaders = () => ({
  Authorization: `Basic ${Buffer.from(`${tw().accountSid}:${tw().authToken}`).toString('base64')}`,
  'Content-Type': 'application/x-www-form-urlencoded',
});
/** ترجمة أكواد Twilio إلى أخطاء التطبيق (body.code) */
function twilioError(reply: Reply): AppError {
  const code = Number(reply.json?.code ?? 0);
  if ([21211, 21614, 21408, 60200].includes(code)) return sendFailed('الرقم غير صالح أو لا يمكن الإرسال إليه');
  if (code === 21608) return sendFailed('حساب Twilio تجريبي: يجب تفعيل هذا الرقم في Verified Caller IDs أولاً');
  if (code === 60203) return new AppError('rate_limited', 'محاولات إرسال كثيرة. حاول بعد قليل', 429);
  if (code === 60202) return new AppError('otp_expired', 'تجاوزت عدد المحاولات. اطلب رمزاً جديداً', 400);
  if (code === 20003 || code === 20404 || reply.status === 401 || reply.status === 404) return sendFailed('إعدادات Twilio غير صحيحة (المعرّف أو المفتاح)');
  console.error('[otp] twilio', reply.status, code || reply.text.slice(0, 120));
  return sendFailed();
}

/** بدء تحقّق Twilio Verify — الرمز يولّده Twilio ويرسله بنفسه */
export async function twilioVerifyStart(to: string, via: 'sms' | 'whatsapp', locale: 'ar' | 'en' = 'ar'): Promise<void> {
  const r = await call(`https://verify.twilio.com/v2/Services/${tw().verifyServiceSid}/Verifications`,
    { method: 'POST', headers: twilioHeaders(), body: form({ To: to, Channel: via, Locale: locale }) });
  if (!r.ok || !['pending', 'approved'].includes(String(r.json?.status))) throw twilioError(r);
}

/** فحص رمز Twilio Verify: approved / pending (خاطئ) / expired (404 = لا تحقّق مفتوح) */
export async function twilioVerifyCheck(to: string, code: string): Promise<'approved' | 'pending' | 'expired'> {
  const r = await call(`https://verify.twilio.com/v2/Services/${tw().verifyServiceSid}/VerificationCheck`,
    { method: 'POST', headers: twilioHeaders(), body: form({ To: to, Code: code }) });
  if (r.status === 404 || Number(r.json?.code) === 20404) return 'expired';
  if (!r.ok) throw twilioError(r);
  return r.json?.status === 'approved' ? 'approved' : 'pending';
}

/** رسالة Twilio Messages (SMS أو واتساب) — من رقم TWILIO_FROM أو خدمة المراسلة */
export async function twilioSend(to: string, text: string, via: 'sms' | 'whatsapp'): Promise<void> {
  const t = tw();
  const fields: Record<string, string> = via === 'whatsapp'
    ? { To: `whatsapp:${to.replace(/^whatsapp:/i, '')}`, Body: text, From: `whatsapp:${t.whatsappFrom.replace(/^whatsapp:/i, '')}` }
    : { To: to, Body: text, ...(t.from ? { From: t.from } : { MessagingServiceSid: t.messagingServiceSid }) };
  const r = await call(`https://api.twilio.com/2010-04-01/Accounts/${t.accountSid}/Messages.json`,
    { method: 'POST', headers: twilioHeaders(), body: form(fields) });
  if (!r.ok) throw twilioError(r);
}

/* ---------- بوابة HTTP عامة (Unifonic / Omantel / Ooredoo …) ---------- */
/** يستبدل {to} {to_digits} {text} {code} — مُرمَّز في الرابط وفي جسم form (وإلا يصير + مسافة)، ومهرَّب في JSON، وخام فقط عند Content-Type خاص من المشغّل */
function fill(template: string, vars: Record<string, string>, mode: 'url' | 'form' | 'json' | 'raw'): string {
  const enc = (v: string) => (mode === 'url' || mode === 'form' ? encodeURIComponent(v) : mode === 'json' ? JSON.stringify(v).slice(1, -1) : v);
  return template.replace(/\{(to|to_digits|text|code)\}/g, (_, k: string) => enc(vars[k] ?? ''));
}
export async function httpSend(to: string, text: string, code: string): Promise<void> {
  const h = config.otp.sms.http;
  const vars = { to, to_digits: to.replace(/\D/g, ''), text, code };
  const url = fill(h.url, vars, 'url');
  let r: Reply;
  if (h.method === 'GET') r = await call(url, { method: 'GET', headers: h.headers });
  else {
    const isJson = /^\s*[[{]/.test(h.body);
    const customType = Object.keys(h.headers).some(k => k.toLowerCase() === 'content-type');
    const body = fill(h.body, vars, isJson ? 'json' : customType ? 'raw' : 'form');
    r = await call(url, { method: 'POST', headers: { ...(customType ? {} : { 'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded' }), ...h.headers }, body });
  }
  if (!r.ok || (h.okMatch && !r.text.includes(h.okMatch))) {
    console.error('[otp] http gateway', r.status, r.text.slice(0, 120));
    throw sendFailed();
  }
}

/* ---------- البريد ---------- */
let mailer: Transporter | null = null;
export async function smtpSend(to: string, subject: string, html: string, text: string): Promise<void> {
  const s = config.otp.email.smtp;
  mailer ??= nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, ...(s.user ? { auth: { user: s.user, pass: s.pass } } : {}), connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS });
  try { await mailer.sendMail({ from: config.otp.email.from, to, subject, text, html }); }
  catch (err) { console.error('[otp] smtp', (err as Error)?.message); throw sendFailed(); }
}

export async function resendSend(to: string, subject: string, html: string, text: string): Promise<void> {
  const r = await call('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${config.otp.email.resend.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.otp.email.from, to: [to], subject, html, text }),
  });
  if (!r.ok) { console.error('[otp] resend', r.status, String(r.json?.message ?? r.text.slice(0, 120))); throw sendFailed(r.status === 401 || r.status === 403 ? 'إعدادات Resend غير صحيحة (المفتاح)' : GENERIC); }
}
