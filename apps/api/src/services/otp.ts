import { config } from '../config.ts';
import { q, tx, nowIso } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import { sha256, safeEqual, randomDigits } from '../lib/helpers.ts';
import * as impl from './otp-transports.ts';

/**
 * رموز التحقّق: توليد/إرسال/فحص.
 * - أهداف الاختبار (حسابات العرض + OTP_TEST_TARGETS) تأخذ الرمز الثابت دائماً — حتى مع مزوّد حقيقي.
 * - بلا مزوّد: الرمز الثابت للجميع (تطوير)، أو 503 إن عُطّل بـ OTP_FIXED_CODE=none.
 * - مزوّد حقيقي: قائمة الدول + سقوف الإرسال، ثم Twilio Verify (يولّد الرمز عنده) أو إرسال رمز محلي عبر الوسيط.
 * الرمز الثابت لا يُقبل أبداً لهدف غير اختباري عندما يوجد مزوّد حقيقي؛ الرموز الحقيقية لا تُسجَّل ولا تُعاد.
 */
export type OtpChannel = 'phone' | 'email';
export type OtpVia = 'sms' | 'whatsapp';
export type OtpDelivery = OtpVia | 'email' | 'test';

/** الوسائط — كائن قابل للتعديل كي تستبدله الاختبارات */
export const transports = { ...impl };

const otp = () => config.otp;

export function otpMethods(): { phone: boolean; whatsapp: boolean; email: boolean; testCode: boolean } {
  const { sms, email, fixedCode } = otp();
  return {
    phone: sms.provider !== 'log' || !!fixedCode,
    whatsapp: sms.whatsapp && sms.provider !== 'log',
    email: email.provider !== 'log' || !!fixedCode,
    testCode: !!fixedCode,
  };
}

/** مطابقة تامة، أو بادئة عندما ينتهي النمط بـ * */
export function isTestTarget(target: string): boolean {
  const t = target.toLowerCase();
  return otp().testTargets.some(p => (p.endsWith('*') ? t.startsWith(p.slice(0, -1).toLowerCase()) : t === p.toLowerCase()));
}

/** إخفاء الهدف في السجلّ: آخر رقمين فقط / أول حرفين من البريد */
const mask = (target: string): string => {
  const at = target.indexOf('@');
  if (at > 0) return `${target.slice(0, 2)}***${target.slice(at)}`;
  return `${target.slice(0, 4)}${'*'.repeat(Math.max(0, target.length - 6))}${target.slice(-2)}`;
};

const smsText = (code: string) => `${config.brand.name.ar}: رمز الدخول ${code}\nصالح لمدة ${Math.round(otp().ttlSeconds / 60)} دقائق. لا تشاركه مع أحد.`;
function emailContent(code: string) {
  const name = config.brand.name.ar, minutes = Math.round(otp().ttlSeconds / 60);
  return {
    subject: `رمز الدخول إلى ${name}`,
    text: `${name}\nرمز الدخول: ${code}\nصالح لمدة ${minutes} دقائق. لا تشاركه مع أحد.\nإذا لم تطلب هذا الرمز فتجاهل الرسالة.`,
    html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
  <h2 style="margin:0 0 16px;font-size:20px">${name}</h2>
  <p style="margin:0 0 12px">رمز الدخول الخاص بك:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;direction:ltr;text-align:center;margin:8px 0 16px">${code}</p>
  <p style="margin:0 0 8px;color:#4b5563">صالح لمدة ${minutes} دقائق. لا تشاركه مع أحد.</p>
  <p style="margin:0;color:#6b7280;font-size:13px">إذا لم تطلب هذا الرمز فتجاهل الرسالة.</p>
</div>`,
  };
}

/* ---------- الصفوف ---------- */
/** يستهلك الصفوف المفتوحة الأقدم لنفس الهدف ثم يُدرج صفاً جديداً ويعيد معرّفه */
function insertRow(channel: OtpChannel, target: string, codeHash: string, provider: 'local' | 'twilio_verify', via: OtpDelivery): number {
  q.run('UPDATE otp_codes SET consumed_at = ? WHERE target = ? AND channel = ? AND consumed_at IS NULL', nowIso(), target, channel);
  return Number(q.run('INSERT INTO otp_codes (channel, target, code_hash, expires_at, provider, via) VALUES (?,?,?,?,?,?)',
    channel, target, codeHash, Math.floor(Date.now() / 1000) + otp().ttlSeconds, provider, via).lastInsertRowid);
}
/** الإرسال الحقيقي = كل صف via ≠ test (الصفوف المحجوزة أثناء الإرسال تُحتسب أيضاً) */
const realSends = (where: string, window: string, ...p: unknown[]) =>
  q.val<number>(`SELECT COUNT(*) FROM otp_codes WHERE ${where} AND via IS NOT NULL AND via <> 'test' AND created_at >= datetime('now', ?)`, ...p, window) ?? 0;

let dayCapLogged = false;
/** حماية الرصيد من ضخّ الرسائل: مهلة إعادة الإرسال، سقف الهدف بالساعة، سقف يومي عام */
function enforceCaps(channel: OtpChannel, target: string) {
  const { resendCooldownSeconds, sendPerTargetPerHour, sendPerDay } = otp();
  if (resendCooldownSeconds > 0 && realSends('target = ? AND channel = ?', `-${resendCooldownSeconds} seconds`, target, channel) > 0)
    throw new AppError('rate_limited', 'انتظر قليلاً قبل طلب رمز آخر', 429);
  if (realSends('target = ? AND channel = ?', '-1 hours', target, channel) >= sendPerTargetPerHour)
    throw new AppError('rate_limited', 'تجاوزت عدد الرموز المسموح بها لهذا الرقم. حاول بعد ساعة', 429);
  if (realSends('1=1', '-1 days') >= sendPerDay) {
    if (!dayCapLogged) { dayCapLogged = true; console.error(`[otp] daily send cap reached (${sendPerDay}) — real delivery paused`); }
    throw new AppError('otp_delivery_unavailable', 'الإرسال متوقف مؤقتاً. حاول لاحقاً', 503);
  }
  dayCapLogged = false;
}
/**
 * حجز الصف قبل الاتصال بالمزوّد: فحص السقوف والإدراج في معاملة واحدة متزامنة (بلا await بينهما)،
 * فالطلبات المتزامنة لنفس الهدف ترى الحجز وتُرفض بدل أن تمرّ كلها بعدّاد صفري وتحرق الرصيد.
 * عند فشل الإرسال يُحذف الصف (لا صف بلا رسالة)، وعند نجاح الإرسال المحلي يُكتب تجزئة الرمز.
 */
const reserveRow = (channel: OtpChannel, target: string, provider: 'local' | 'twilio_verify', via: OtpDelivery): number =>
  tx(() => { enforceCaps(channel, target); return insertRow(channel, target, '', provider, via); });

export type StartInput = { channel: OtpChannel; target: string; via?: OtpVia; ip?: string; locale?: 'ar' | 'en' };
export type StartResult = { delivery: OtpDelivery; ttlSeconds: number; devCode?: string };

export async function startOtp(input: StartInput): Promise<StartResult> {
  const { channel, target } = input;
  const { fixedCode, sms, email, ttlSeconds } = otp();
  const provider = channel === 'phone' ? sms.provider : email.provider;

  // ١) هدف اختبار مع رمز ثابت، أو ٢) لا مزوّد: الرمز الثابت للجميع (بلا سقوف غير محدّد express)
  if (fixedCode && (isTestTarget(target) || provider === 'log')) {
    insertRow(channel, target, sha256(fixedCode), 'local', 'test');
    if (!config.isTest) console.log(`[otp] delivery=test to=${mask(target)}`);
    return { delivery: 'test', ttlSeconds, devCode: fixedCode };
  }
  if (provider === 'log') {
    throw new AppError('otp_delivery_unavailable', channel === 'phone'
      ? 'الدخول بالهاتف غير متاح على هذا الخادم بعد — استخدم البريد الإلكتروني'
      : 'الدخول بالبريد غير متاح على هذا الخادم بعد — استخدم الهاتف', 503);
  }

  // ٣) إرسال حقيقي
  let via: OtpDelivery = 'email';
  if (channel === 'phone') {
    if (!sms.allowedCountries.includes('*') && !sms.allowedCountries.some(c => target.startsWith(c)))
      throw new AppError('otp_country_not_allowed', 'الخدمة متاحة حالياً لأرقام سلطنة عُمان (+968)', 400);
    via = input.via === 'whatsapp' && sms.whatsapp ? 'whatsapp' : 'sms';
  }
  const verifyFlow = channel === 'phone' && provider === 'twilio_verify';
  const id = reserveRow(channel, target, verifyFlow ? 'twilio_verify' : 'local', via);
  try {
    if (verifyFlow) {
      await transports.twilioVerifyStart(target, via as OtpVia, input.locale ?? 'ar');
    } else {
      const code = randomDigits(6);
      if (channel === 'phone') {
        if (provider === 'twilio') await transports.twilioSend(target, smsText(code), via as OtpVia);
        else await transports.httpSend(target, smsText(code), code);
      } else {
        const m = emailContent(code);
        if (provider === 'smtp') await transports.smtpSend(target, m.subject, m.html, m.text);
        else await transports.resendSend(target, m.subject, m.html, m.text);
      }
      q.run('UPDATE otp_codes SET code_hash = ? WHERE id = ?', sha256(code), id);
    }
  } catch (err) {
    q.run('DELETE FROM otp_codes WHERE id = ?', id);
    throw err;
  }
  if (!config.isTest) console.log(`[otp] sent via=${via} provider=${provider} to=${mask(target)}`);
  return { delivery: via, ttlSeconds };
}

type OtpRow = { id: number; code_hash: string; attempts: number; expires_at: number; provider: string; via: string | null };
export async function checkOtp(input: { channel: OtpChannel; target: string; code: string }): Promise<void> {
  const { channel, target, code } = input;
  const row = q.get<OtpRow>('SELECT * FROM otp_codes WHERE target = ? AND channel = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1', target, channel);
  if (!row) throw new AppError('otp_expired', 'اطلب رمزاً جديداً', 400);
  if (row.expires_at < Math.floor(Date.now() / 1000)) throw new AppError('otp_expired', 'انتهت صلاحية الرمز', 400);
  if (row.attempts >= otp().maxAttempts) throw new AppError('otp_expired', 'تجاوزت عدد المحاولات. اطلب رمزاً جديداً', 400);

  if (row.provider === 'twilio_verify') {
    // المحاولة تُحتسب قبل سؤال Twilio كي تبقى محدودة حتى لو فشل الاتصال
    q.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    const status = await transports.twilioVerifyCheck(target, code);
    if (status === 'expired') { q.run('UPDATE otp_codes SET consumed_at = ? WHERE id = ?', nowIso(), row.id); throw new AppError('otp_expired', 'انتهت صلاحية الرمز', 400); }
    if (status !== 'approved') throw new AppError('otp_invalid', 'رمز التحقّق غير صحيح', 400);
  } else if (!row.code_hash || !safeEqual(row.code_hash, sha256(code))) {
    q.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw new AppError('otp_invalid', 'رمز التحقّق غير صحيح', 400);
  }
  q.run('UPDATE otp_codes SET consumed_at = ? WHERE id = ?', nowIso(), row.id);
}
