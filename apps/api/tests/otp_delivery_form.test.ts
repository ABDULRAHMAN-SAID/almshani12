/** بوابة HTTP بجسم form: القيم تُرمَّز (+ في الرقم يبقى سليماً)، وTWILIO_WHATSAPP_FROM بصيغة whatsapp:+1… لا يتكرّر بادئتها */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

Object.assign(process.env, {
  SMS_PROVIDER: 'http', SMS_HTTP_URL: 'https://gw.test/send', SMS_HTTP_METHOD: 'POST', SMS_HTTP_BODY: 'to={to}&msg={text}&c={code}',
  TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok', TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886',
});
await import('./helpers.ts'); // يضبط بيئة الاختبار (DATA_DIR…) دون إقلاع الخادم
const tr = await import('../src/services/otp-transports.ts');

const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init: RequestInit = {}) => {
  requests.push({ url: String(input instanceof Request ? input.url : input), headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body: String(init.body ?? '') });
  return Promise.resolve(new Response('{"sid":"SM1"}', { status: 201 }));
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; try { fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true }); } catch { /* تجاهل */ } });

test('جسم form: الرقم والنص مُرمَّزان فيقرأهما محلّل form كما هما', async () => {
  const text = 'منصّة: رمز الدخول 123456\nلا تشاركه';
  await tr.httpSend('+96891234567', text, '123456');
  const r = requests.at(-1)!;
  assert.equal(r.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(r.body, `to=%2B96891234567&msg=${encodeURIComponent(text)}&c=123456`);
  const parsed = new URLSearchParams(r.body);
  assert.equal(parsed.get('to'), '+96891234567'); assert.equal(parsed.get('msg'), text); assert.equal(parsed.get('c'), '123456');
});

test('واتساب عبر Twilio Messages: بادئة whatsapp: لا تتكرّر في From', async () => {
  await tr.twilioSend('+96891234567', 'x', 'whatsapp');
  const f = new URLSearchParams(requests.at(-1)!.body);
  assert.equal(f.get('From'), 'whatsapp:+14155238886'); assert.equal(f.get('To'), 'whatsapp:+96891234567');
});
