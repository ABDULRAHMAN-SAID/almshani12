/** بوابة HTTP عامة للرسائل مع تعطيل الرمز الثابت (OTP_FIXED_CODE=none) وبلا مزوّد بريد */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Ctx } from './helpers.ts';

Object.assign(process.env, {
  SMS_PROVIDER: 'http', SMS_HTTP_URL: 'https://gw.test/send', SMS_HTTP_METHOD: 'POST',
  SMS_HTTP_BODY: '{"to":"{to_digits}","msg":"{text}"}', SMS_HTTP_OK: 'OK', SMS_HTTP_HEADERS: '{"X-Api-Key":"k"}',
  OTP_FIXED_CODE: 'none',
});
const { boot } = await import('./helpers.ts');

const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
const realFetch = globalThis.fetch;
let gatewayReply = 'OK:sent';
function fakeFetch(input: string | URL | Request, init: RequestInit = {}) {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('https://gw.test/')) return realFetch(input, init);
  requests.push({ url, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body: String(init.body ?? '') });
  return new Response(gatewayReply, { status: 200 });
}

let c: Ctx;
before(async () => { c = await boot(); globalThis.fetch = fakeFetch as typeof fetch; });
after(() => { globalThis.fetch = realFetch; c.close(); });

test('طرق الدخول: هاتف فقط — لا بريد ولا رمز ثابت', async () => {
  assert.deepEqual((await c.api('/api/auth/methods')).json, { phone: true, whatsapp: false, email: false, testCode: false, google: false, apple: false });
});

test('البوابة تستقبل JSON بالرقم بلا + والرمز داخل النص؛ التحقّق بالرمز المرسل ينجح', async () => {
  const r = await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: '91234567' } });
  assert.equal(r.status, 200); assert.equal(r.json.delivery, 'sms'); assert.equal(r.json.devCode, undefined);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://gw.test/send');
  assert.equal(requests[0].headers['Content-Type'], 'application/json'); assert.equal(requests[0].headers['X-Api-Key'], 'k');
  const sent = JSON.parse(requests[0].body);
  assert.equal(sent.to, '96891234567');
  const code = sent.msg.match(/\b(\d{6})\b/)?.[1];
  assert.ok(code, 'رمز من ٦ أرقام'); assert.ok(sent.msg.includes('رمز الدخول'));
  assert.equal((await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '91234567', code: '000000' } })).json.error.code, 'otp_invalid');
  const ok = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '91234567', code } });
  assert.equal(ok.status, 200); assert.equal(ok.json.user.phone, '+96891234567');
});

test('ردّ بلا SMS_HTTP_OK → otp_send_failed 502 ولا صف رمز', async () => {
  gatewayReply = 'ERR:balance';
  const r = await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: '91234568' } });
  assert.equal(r.status, 502); assert.equal(r.json.error.code, 'otp_send_failed');
  assert.equal(c.q.get('SELECT 1 FROM otp_codes WHERE target = ?', '+96891234568'), undefined);
  gatewayReply = 'OK:sent';
});

test('بلا مزوّد بريد ورمز ثابت معطّل: طلب البريد يُرفض بـ 503 otp_delivery_unavailable', async () => {
  const r = await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'email', target: 'a@b.co' } });
  assert.equal(r.status, 503); assert.equal(r.json.error.code, 'otp_delivery_unavailable');
  assert.ok(r.json.error.message.includes('البريد'));
  assert.equal((await c.api('/api/config')).json.devOtp, false);
});
