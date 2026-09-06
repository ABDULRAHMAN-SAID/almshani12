/**
 * إرسال حقيقي: Twilio Verify للهاتف/واتساب وSMTP للبريد (كلاهما مستبدل)، مع بقاء حسابات العرض وأهداف الاختبار على الرمز الثابت.
 * المتغيّرات تُضبط قبل استيراد helpers لأن config يُقرأ مرة واحدة عند الاستيراد.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Ctx } from './helpers.ts';

Object.assign(process.env, {
  TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_VERIFY_SERVICE_SID: 'VAtest',
  SMTP_HOST: 'smtp.test', SMTP_USER: 'u', SMTP_PASS: 'p', EMAIL_FROM: 'x@test',
  ALLOW_DEMO_SEED: '1', OTP_TEST_TARGETS: '+96899000000',
});
const { boot } = await import('./helpers.ts');
const { transports } = await import('../src/services/otp.ts');

type Req = { url: string; method: string; headers: Record<string, string>; body: string; form: URLSearchParams };
const requests: Req[] = [];
const realFetch = globalThis.fetch;
/** ردّ Twilio المزيّف: البدء pending، والفحص approved للرمز 123456 فقط؛ رقم واحد يعيد خطأ الحساب التجريبي، وآخر يتأخّر ١٠٠ م.ث (لاختبار التزامن) */
const TRIAL_ONLY = '+96891234570';
const SLOW = '+96891234571';
const delay = <T,>(v: T, ms: number) => new Promise<T>(r => setTimeout(() => r(v), ms));
function fakeFetch(input: string | URL | Request, init: RequestInit = {}) {
  const url = String(input instanceof Request ? input.url : input);
  if (!/twilio\.com/.test(url)) return realFetch(input, init);
  const body = String(init.body ?? '');
  const form = new URLSearchParams(body);
  requests.push({ url, method: String(init.method ?? 'GET'), headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body, form });
  const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/Verifications')) {
    if (form.get('To') === TRIAL_ONLY) return reply(400, { code: 21608, message: 'trial' });
    return form.get('To') === SLOW ? delay(reply(201, { status: 'pending' }), 100) : reply(201, { status: 'pending' });
  }
  if (url.endsWith('/VerificationCheck')) return reply(200, { status: form.get('Code') === '123456' ? 'approved' : 'pending' });
  return reply(404, { code: 20404 });
}
const mails: { to: string; subject: string; text: string; html: string }[] = [];

let c: Ctx;
before(async () => {
  c = await boot();
  globalThis.fetch = fakeFetch as typeof fetch;
  transports.smtpSend = async (to, subject, html, text) => { mails.push({ to, subject, text, html }); };
});
after(() => { globalThis.fetch = realFetch; c.close(); });

const request = (body: unknown) => c.api('/api/auth/otp/request', { method: 'POST', body });
const verify = (target: string, code: string, channel = 'phone') => c.api('/api/auth/otp/verify', { method: 'POST', body: { channel, target, code } });
const lastRow = (target: string) => c.q.get<any>('SELECT * FROM otp_codes WHERE target = ? ORDER BY id DESC LIMIT 1', target);

test('طرق الدخول: هاتف وواتساب وبريد حقيقية مع بقاء الرمز الثابت لأهداف الاختبار', async () => {
  assert.deepEqual((await c.api('/api/auth/methods')).json, { phone: true, whatsapp: true, email: true, testCode: true, google: false, apple: false });
});

test('حساب العرض وهدف الاختبار الصريح يأخذان الرمز الثابت دون أي اتصال بالمزوّد', async () => {
  for (const target of ['+96890000010', '+96899000000']) {
    const r = await request({ channel: 'phone', target });
    assert.equal(r.status, 200); assert.equal(r.json.delivery, 'test'); assert.equal(r.json.devCode, '000000');
    assert.equal((await verify(target, '000000')).status, 200);
  }
  assert.equal(requests.length, 0, 'لا طلبات إلى Twilio');
  assert.equal(mails.length, 0);
});

test('رقم حقيقي: Twilio Verify يبدأ بقناة sms بلا devCode؛ الرمز الثابت يُرفض والصحيح يُنشئ الحساب', async () => {
  const target = '+96891234567';
  const r = await request({ channel: 'phone', target, via: 'sms' });
  assert.equal(r.status, 200); assert.equal(r.json.delivery, 'sms'); assert.equal(r.json.devCode, undefined);
  assert.equal(r.text.includes('000000'), false);
  const start = requests.at(-1)!;
  assert.equal(start.url, 'https://verify.twilio.com/v2/Services/VAtest/Verifications');
  assert.equal(start.form.get('To'), target); assert.equal(start.form.get('Channel'), 'sms'); assert.equal(start.form.get('Locale'), 'ar');
  assert.equal(start.headers.Authorization, `Basic ${Buffer.from('ACtest:tok').toString('base64')}`);
  assert.equal(lastRow(target).provider, 'twilio_verify'); assert.equal(lastRow(target).code_hash, '');

  const fixed = await verify(target, '000000');
  assert.equal(fixed.status, 400); assert.equal(fixed.json.error.code, 'otp_invalid');
  assert.equal(lastRow(target).attempts, 1, 'المحاولة تُحتسب');
  const check = requests.at(-1)!;
  assert.equal(check.url, 'https://verify.twilio.com/v2/Services/VAtest/VerificationCheck');
  assert.equal(check.form.get('Code'), '000000');

  const ok = await verify(target, '123456');
  assert.equal(ok.status, 200); assert.equal(ok.json.isNew, true); assert.equal(ok.json.user.phone, target);
  assert.ok(lastRow(target).consumed_at);
  assert.equal((await verify(target, '123456')).json.error.code, 'otp_expired', 'الصف مستهلك');
});

test('via=whatsapp يبدأ Verify بقناة whatsapp ويعيد delivery=whatsapp', async () => {
  const r = await request({ channel: 'phone', target: '+96891234568', via: 'whatsapp', locale: 'en' });
  assert.equal(r.status, 200); assert.equal(r.json.delivery, 'whatsapp');
  assert.equal(requests.at(-1)!.form.get('Channel'), 'whatsapp'); assert.equal(requests.at(-1)!.form.get('Locale'), 'en');
  assert.equal(lastRow('+96891234568').via, 'whatsapp');
});

test('رقم خارج الدول المسموحة يُرفض قبل أي اتصال', async () => {
  const n = requests.length;
  const r = await request({ channel: 'phone', target: '+971501234567' });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, 'otp_country_not_allowed');
  assert.equal(requests.length, n);
});

test('طلب ثانٍ خلال مهلة إعادة الإرسال يُرفض بـ 429', async () => {
  assert.equal((await request({ channel: 'phone', target: '+96891234569' })).status, 200);
  const r = await request({ channel: 'phone', target: '+96891234569' });
  assert.equal(r.status, 429); assert.equal(r.json.error.code, 'rate_limited');
});

test('طلبات متزامنة لنفس الرقم: الحجز قبل الاتصال يمرّر إرسالاً واحداً إلى Twilio والبقية 429', async () => {
  const n = requests.length;
  const rs = await Promise.all(Array.from({ length: 8 }, () => request({ channel: 'phone', target: SLOW, via: 'sms' })));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 429, 429, 429, 429, 429, 429, 429]);
  assert.ok(rs.filter(r => r.status === 429).every(r => r.json.error.code === 'rate_limited'));
  assert.equal(requests.slice(n).filter(r => r.form.get('To') === SLOW).length, 1, 'طلب Verify واحد فقط');
  assert.equal(c.q.val('SELECT COUNT(*) FROM otp_codes WHERE target = ?', SLOW), 1, 'صف واحد لا غير');
});

test('بريد حقيقي عبر SMTP: الرمز في الرسالة فقط، والتحقّق به ينجح', async () => {
  const r = await request({ channel: 'email', target: 'Real@Example.com' });
  assert.equal(r.status, 200); assert.equal(r.json.delivery, 'email'); assert.equal(r.json.devCode, undefined);
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.to, 'real@example.com'); assert.ok(m.subject.includes('رمز الدخول'));
  const code = m.text.match(/\b(\d{6})\b/)?.[1];
  assert.ok(code, 'رمز من ٦ أرقام في النص'); assert.ok(m.html.includes(code!)); assert.ok(m.html.includes('dir="rtl"'));
  assert.equal((await verify('real@example.com', '000000', 'email')).json.error.code, 'otp_invalid', 'الرمز الثابت مرفوض');
  const ok = await verify('real@example.com', code!, 'email');
  assert.equal(ok.status, 200); assert.equal(ok.json.user.email, 'real@example.com');
});

test('خطأ Twilio 21608 (حساب تجريبي) → otp_send_failed 502 برسالة واضحة وبلا صف جديد', async () => {
  const r = await request({ channel: 'phone', target: TRIAL_ONLY });
  assert.equal(r.status, 502); assert.equal(r.json.error.code, 'otp_send_failed');
  assert.ok(r.json.error.message.includes('Verified Caller IDs'), r.json.error.message);
  assert.equal(lastRow(TRIAL_ONLY), undefined);
});
