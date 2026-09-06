import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.ts';
import { q } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import { money } from '../lib/helpers.ts';
import { learnerRefById } from './learners.ts';

/**
 * البريد المعاملاتي: مرسِلان حقيقيان (SMTP عبر nodemailer، وResend عبر fetch) + قوالب عربية RTL.
 * المزوّد من config.otp.email (المزوّد نفسه الذي يرسل رموز التحقّق) — 'log' = لا إرسال، تُطبع الرسالة في السجلّ فقط.
 * القوالب لا ترمي أبداً ولا تُنفَّذ إلا حين يكون للمستلم بريد ومزوّد حقيقي (fire-and-forget من مواضع الأحداث).
 * الاختبارات تستبدل `mailer.smtpSend` / `mailer.resendSend` (وotp-transports يغلّفهما لرموز التحقّق).
 */
const TIMEOUT_MS = 15_000;
const sendFailed = (m = 'تعذّر إرسال البريد الآن') => new AppError('mail_send_failed', m, 502);

export type MailMessage = { to: string; subject: string; html: string; text: string };
type Reply = { status: number; ok: boolean; text: string; json: any };

async function call(url: string, init: RequestInit): Promise<Reply> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* ليس JSON */ }
    return { status: res.status, ok: res.ok, text, json };
  } catch (err) {
    console.error('[mail] transport error', (err as Error)?.name === 'AbortError' ? 'timeout' : (err as Error)?.message);
    throw sendFailed();
  } finally { clearTimeout(timer); }
}

/* ---------- المرسِلان ---------- */
let transporter: Transporter | null = null;
/** ناقل SMTP الوحيد للعملية (يُستعمل أيضاً في فحص الاتصال transporter.verify()) */
export function smtpTransporter(): Transporter {
  const s = config.otp.email.smtp;
  transporter ??= nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, ...(s.user ? { auth: { user: s.user, pass: s.pass } } : {}), connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS });
  return transporter;
}
export async function smtpSend(to: string, subject: string, html: string, text: string): Promise<void> {
  try { await smtpTransporter().sendMail({ from: config.otp.email.from, to, subject, text, html }); }
  catch (err) { console.error('[mail] smtp', (err as Error)?.message); throw sendFailed(); }
}
export async function resendSend(to: string, subject: string, html: string, text: string): Promise<void> {
  const r = await call('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${config.otp.email.resend.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.otp.email.from, to: [to], subject, html, text }),
  });
  if (!r.ok) { console.error('[mail] resend', r.status, String(r.json?.message ?? r.text.slice(0, 120))); throw sendFailed(r.status === 401 || r.status === 403 ? 'إعدادات Resend غير صحيحة (المفتاح)' : undefined); }
}

/** المرسِلان ككائن قابل للاستبدال في الاختبارات */
export const mailer = { smtpSend, resendSend };

export const mailEnabled = (): boolean => config.otp.email.provider !== 'log';

/** إرسال عام: true عند الإرسال الفعلي، false عندما لا مزوّد (تُسجَّل الرسالة دون محتوى حسّاس) */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const provider = config.otp.email.provider;
  if (provider === 'log') { console.log(`[mail] (log) → ${maskEmail(msg.to)}: ${msg.subject}`); return false; }
  if (provider === 'smtp') await mailer.smtpSend(msg.to, msg.subject, msg.html, msg.text);
  else await mailer.resendSend(msg.to, msg.subject, msg.html, msg.text);
  return true;
}

const maskEmail = (e: string) => { const at = e.indexOf('@'); return at > 0 ? `${e.slice(0, 2)}***${e.slice(at)}` : '***'; };
const userEmail = (userId: number): string | null => q.val<string | null>('SELECT email FROM users WHERE id = ?', userId) ?? null;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('ar-OM', { timeZone: config.brand.timezone, dateStyle: 'full', timeStyle: 'short' });

/** إطار موحّد للقوالب: اسم العلامة، عنوان، محتوى، تذييل */
function layout(title: string, bodyHtml: string): string {
  const name = config.brand.name.ar;
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937">
  <h2 style="margin:0 0 4px;font-size:20px;color:${config.brand.colors.primary}">${esc(name)}</h2>
  <h3 style="margin:0 0 16px;font-size:17px">${esc(title)}</h3>
  ${bodyHtml}
  <p style="margin:24px 0 0;color:#6b7280;font-size:12px">هذه رسالة تلقائية من ${esc(name)} — للمساعدة: ${esc(config.brand.support.email)}</p>
</div>`;
}

/** غلاف القوالب: لا ترمي أبداً؛ تتخطّى بلا بريد أو بلا مزوّد */
async function deliver(to: string | null | undefined, build: () => Omit<MailMessage, 'to'>): Promise<boolean> {
  if (!to || !mailEnabled()) return false;
  try { return await sendMail({ to, ...build() }); }
  catch (err) { console.error('[mail] template', (err as Error)?.message); return false; }
}

/* ---------- القوالب ---------- */
export interface ReceiptOrder { id: number; number: string; user_id: number; total: number; currency: string; subtotal?: number; discount?: number; tax?: number }

/** إيصال الشراء بعد تنفيذ الطلب — العناصر والإجمالي ورقم الطلب ورابط صفحته */
export function sendReceipt(order: ReceiptOrder): Promise<boolean> {
  if (!config.mail.receipts) return Promise.resolve(false);
  return deliver(userEmail(order.user_id), () => {
    const items = q.all<{ title: string; unit_price: number; quantity: number }>('SELECT title, unit_price, quantity FROM order_items WHERE order_id = ?', order.id);
    const cur = order.currency, total = money(order.total);
    const link = `${config.publicUrl}/order/${order.number}`;
    const lines = items.map(i => `${i.title}${i.quantity > 1 ? ` ×${i.quantity}` : ''} — ${money(i.unit_price * i.quantity)} ${cur}`);
    const discount = money(order.discount ?? 0), tax = money(order.tax ?? 0);
    return {
      subject: `إيصال الطلب ${order.number} — ${config.brand.name.ar}`,
      text: [`إيصال الطلب ${order.number}`, ...lines, ...(discount > 0 ? [`الخصم: -${discount} ${cur}`] : []), ...(tax > 0 ? [`الضريبة: ${tax} ${cur}`] : []), `الإجمالي: ${total} ${cur}`, `تفاصيل الطلب: ${link}`].join('\n'),
      html: layout(`إيصال الطلب ${order.number}`, `
  <table style="width:100%;border-collapse:collapse;font-size:14px">${items.map(i => `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb">${esc(i.title)}${i.quantity > 1 ? ` ×${i.quantity}` : ''}</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:left;direction:ltr">${money(i.unit_price * i.quantity)} ${esc(cur)}</td></tr>`).join('')}
  ${discount > 0 ? `<tr><td style="padding:6px 0;color:#4b5563">الخصم</td><td style="text-align:left;direction:ltr">-${discount} ${esc(cur)}</td></tr>` : ''}
  ${tax > 0 ? `<tr><td style="padding:6px 0;color:#4b5563">الضريبة</td><td style="text-align:left;direction:ltr">${tax} ${esc(cur)}</td></tr>` : ''}
  <tr><td style="padding:10px 0;font-weight:700">الإجمالي</td><td style="padding:10px 0;font-weight:700;text-align:left;direction:ltr">${total} ${esc(cur)}</td></tr></table>
  <p style="margin:16px 0 0"><a href="${esc(link)}" style="color:${config.brand.colors.primary}">عرض تفاصيل الطلب</a></p>`),
    };
  });
}

export interface BookingMailRow { id: number; student_id: number; duration_minutes: number; mode: string; subject_id?: number }

/** تأكيد حجز حصة للحساب الدافع (وليّ الأمر أو الطالب) */
export function sendBookingConfirmation(booking: BookingMailRow, learnerName: string, teacherName: string, startsAt: string): Promise<boolean> {
  return deliver(userEmail(booking.student_id), () => {
    const subject = booking.subject_id ? q.val<string>('SELECT name FROM subjects WHERE id = ?', booking.subject_id) ?? '' : '';
    const when = fmtWhen(startsAt);
    const link = `${config.publicUrl}/booking/${booking.id}`;
    const rows: [string, string][] = [['المتعلّم', learnerName], ['المعلّم', teacherName], ...(subject ? [['المادة', subject] as [string, string]] : []), ['الموعد', when], ['المدة', `${booking.duration_minutes} دقيقة`]];
    return {
      subject: `تأكيد حجز حصة — ${when}`,
      text: ['تم تأكيد حجز الحصة', ...rows.map(([k, v]) => `${k}: ${v}`), `رابط الحصة: ${link}`].join('\n'),
      html: layout('تم تأكيد حجز الحصة', `
  <table style="font-size:14px;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#4b5563">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table>
  <p style="margin:16px 0 0"><a href="${esc(link)}" style="color:${config.brand.colors.primary}">فتح الحصة في التطبيق</a></p>`),
    };
  });
}

/** يجمع بيانات الحجز المؤكَّد ويرسل التأكيد — يُستدعى من مواضع التأكيد (تنفيذ الطلب / حجز بباقة) */
export function notifyBookingConfirmed(bookingId: number): Promise<boolean> {
  const b = q.get<BookingMailRow & { teacher_id: number; learner_id: number | null; starts_at: string }>('SELECT id, student_id, teacher_id, learner_id, subject_id, duration_minutes, mode, starts_at FROM bookings WHERE id = ?', bookingId);
  if (!b) return Promise.resolve(false);
  const learnerName = learnerRefById(b.learner_id)?.displayName ?? q.val<string>('SELECT display_name FROM profiles WHERE user_id = ?', b.student_id) ?? '';
  const teacherName = q.val<string>('SELECT display_name FROM profiles WHERE user_id = ?', b.teacher_id) ?? '';
  return sendBookingConfirmation(b, learnerName, teacherName, b.starts_at);
}
