/**
 * سجلّ التكاملات: الحالات تُستنتج من المتغيّرات (مضبوطة هنا لثواني وStripe وGoogle وTwilio وResend، وغير مضبوطة لـ Apple وSentry وLiveKit)،
 * والفحوصات تعمل على fetch مستبدل (ثواني 200/401، Stripe balance، انقطاع الشبكة) ولا ترمي أبداً، ومسارات الإدارة تحدّ الفحص مرة كل ١٠ ثوانٍ.
 * المتغيّرات تُضبط قبل استيراد helpers (config يُقرأ مرة واحدة)؛ PAYMENT_PROVIDERS يُضبط بعده لأن helpers يثبّته.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Ctx } from './helpers.ts';

Object.assign(process.env, {
  PUBLIC_URL: 'https://app.test', THAWANI_SECRET_KEY: 'thw_secret_key_1234567890', THAWANI_PUBLISHABLE_KEY: 'thw_pub_1234567890', THAWANI_MODE: 'uat',
  STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop', GOOGLE_CLIENT_IDS: '1234567890-web.apps.googleusercontent.com,1234567890-ios.apps.googleusercontent.com',
  TWILIO_ACCOUNT_SID: 'ACintegrations', TWILIO_AUTH_TOKEN: 'twtok', TWILIO_VERIFY_SERVICE_SID: 'VAintegrations',
  RESEND_API_KEY: 're_integrations_key', EMAIL_FROM: 'no-reply@app.test',
  // أرقام هذا الملف أهداف اختبار حتى يعمل الدخول بالرمز الثابت رغم وجود Twilio
  OTP_TEST_TARGETS: '+968924*',
});
const { boot } = await import('./helpers.ts');
process.env.PAYMENT_PROVIDERS = 'thawani,stripe,wallet,manual,mock';
const { listIntegrations, runChecks, summary } = await import('../src/services/integrations.ts');
const { SystemInfo, SystemCheckResult } = await import('@manassah/shared');

const realFetch = globalThis.fetch;
let calls: string[] = [];
let thawaniStatus = 200;
let network: 'ok' | 'down' = 'ok';
const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
function fakeFetch(input: string | URL | Request, init: RequestInit = {}) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
  calls.push(url);
  if (network === 'down') return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
  if (url.startsWith('https://uatcheckout.thawani.om/api/v1/checkout/session?limit=1')) {
    assert.equal((init.headers as Record<string, string>)['thawani-api-key'], 'thw_secret_key_1234567890');
    return Promise.resolve(thawaniStatus === 200 ? reply({ success: true, code: 2000, data: null }) : thawaniStatus === 404 ? reply({ success: false, code: 4041, description: 'not found' }, 404) : reply({ success: false, code: 4011 }, thawaniStatus));
  }
  if (url === 'https://api.stripe.com/v1/balance') return Promise.resolve((init.headers as Record<string, string>).Authorization === 'Bearer sk_test_abcdefghijklmnop' ? reply({ object: 'balance', livemode: false }) : reply({ error: {} }, 401));
  if (url === 'https://api.twilio.com/2010-04-01/Accounts/ACintegrations.json') return Promise.resolve(reply({ status: 'active', type: 'Trial' }));
  if (url === 'https://api.resend.com/domains') return Promise.resolve(reply({ data: [{ id: 'd1' }] }));
  if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Promise.resolve(reply({ keys: [{ kid: 'a' }, { kid: 'b' }] }));
  if (url === 'https://app.test/api/health') return Promise.resolve(reply({ ok: true }));
  if (url === 'https://exp.host/--/api/v2/push/send') return Promise.resolve(reply({ data: [] }));
  return Promise.resolve(reply({ error: 'unexpected' }, 500));
}

let c: Ctx;
before(async () => { c = await boot(); globalThis.fetch = fakeFetch as typeof fetch; });
after(() => { globalThis.fetch = realFetch; c.close(); });

const flat = () => listIntegrations().flatMap(g => g.items);
const item = (id: string) => { const i = flat().find(x => x.id === id); assert.ok(i, `العنصر ${id}`); return i; };

test('الحالات تُستنتج من المتغيّرات: جاهز لما ضُبط، ناقص/غير مفعّل لما لم يُضبط، مع أسماء المتغيّرات الناقصة وبلا أسرار', () => {
  assert.equal(item('payments.thawani').status, 'ready'); assert.match(item('payments.thawani').detail, /UAT/);
  assert.equal(item('payments.stripe').status, 'ready'); assert.match(item('payments.stripe').detail, /test/);
  assert.equal(item('payments.mock').status, 'ready'); assert.equal(item('payments.wallet').status, 'ready');
  assert.equal(item('auth.google').status, 'ready'); assert.match(item('auth.google').detail, /2 معرّف/);
  assert.equal(item('auth.apple').status, 'off'); assert.deepEqual(item('auth.apple').missing, ['APPLE_CLIENT_IDS', 'APPLE_SERVICES_ID']);
  assert.equal(item('auth.otp_sms').status, 'ready'); assert.match(item('auth.otp_sms').detail, /Twilio Verify/);
  assert.equal(item('auth.otp_whatsapp').status, 'ready');
  assert.equal(item('auth.otp_email').status, 'ready'); assert.equal(item('mail.transactional').status, 'ready'); assert.match(item('mail.transactional').detail, /Resend/);
  assert.equal(item('monitoring.sentry').status, 'off'); assert.deepEqual(item('monitoring.sentry').missing, ['SENTRY_DSN']);
  assert.equal(item('rooms.livekit').status, 'off'); assert.equal(item('rooms.webrtc').status, 'ready');
  assert.equal(item('server.public_url').status, 'ready'); assert.equal(item('data.sqlite').status, 'ready');
  assert.equal(item('data.backups').status, 'off'); assert.equal(item('push.web').status, 'ready'); assert.equal(item('push.expo').status, 'ready');
  for (const i of flat()) if (i.status === 'ready') assert.deepEqual(i.missing, [], `جاهز بلا ناقص: ${i.id}`);
  const text = JSON.stringify(flat()).toLowerCase();
  for (const secret of ['thw_secret_key', 'sk_test_abc', 'twtok', 're_integrations', 'acintegrations', 'vaintegrations']) assert.equal(text.includes(secret), false, `لا يظهر ${secret}`);
  const s = summary();
  assert.equal(s.total, flat().length); assert.equal(s.ready + s.partial + s.off, s.total);
  assert.deepEqual(listIntegrations().map(g => g.group), ['server', 'data', 'auth', 'payments', 'rooms', 'push', 'mail', 'monitoring']);
});

test('runChecks: ثواني 200 → مقبول، 404 بحقل success → مقبول، 401 → «المفتاح مرفوض»؛ Stripe balance يعمل؛ غير المفعّل لا يلمس الشبكة', async () => {
  calls = [];
  let r = await runChecks(['payments.thawani', 'payments.stripe', 'monitoring.sentry', 'payments.wallet']);
  assert.equal(r['payments.thawani'].ok, true); assert.equal(r['payments.stripe'].ok, true);
  assert.deepEqual(r['monitoring.sentry'], { ok: true, detail: 'غير مفعّل', ms: 0 });
  assert.equal(r['payments.wallet'].ok, true);
  assert.equal(calls.filter(u => u.includes('thawani')).length, 1); assert.equal(calls.filter(u => u.includes('stripe')).length, 1);
  assert.equal(calls.some(u => u.includes('sentry')), false);
  thawaniStatus = 404; r = await runChecks(['payments.thawani']); assert.equal(r['payments.thawani'].ok, true);
  thawaniStatus = 401; r = await runChecks(['payments.thawani']); assert.equal(r['payments.thawani'].ok, false); assert.equal(r['payments.thawani'].detail, 'المفتاح مرفوض');
  thawaniStatus = 200;
});

test('runChecks لا يرمي أبداً: انقطاع الشبكة يعطي ok:false بسبب عربي لكل العناصر، والزمن مُقاس', async () => {
  network = 'down';
  const r = await runChecks();
  network = 'ok';
  for (const [id, c] of Object.entries(r)) { assert.equal(typeof c.ok, 'boolean', id); assert.equal(typeof c.ms, 'number', id); assert.equal(c.detail.length > 0, true, id); }
  for (const id of ['payments.thawani', 'payments.stripe', 'auth.google', 'auth.otp_sms', 'auth.otp_email', 'server.public_url']) { assert.equal(r[id].ok, false, id); assert.match(r[id].detail, /تعذّر الاتصال/, id); }
  assert.equal(r['data.sqlite'].ok, true); assert.equal(r['data.storage'].ok, true); assert.equal(r['monitoring.sentry'].ok, true);
});

test('الفحوصات الحقيقية على fetch المستبدل: Twilio وResend وGoogle والعنوان العام وExpo', async () => {
  const r = await runChecks(['auth.otp_sms', 'auth.otp_whatsapp', 'auth.otp_email', 'mail.transactional', 'auth.google', 'server.public_url', 'push.expo', 'rooms.turn']);
  assert.equal(r['auth.otp_sms'].ok, true); assert.match(r['auth.otp_sms'].detail, /تجريبي/);
  assert.equal(r['auth.otp_whatsapp'].ok, true);
  assert.equal(r['auth.otp_email'].ok, true); assert.match(r['auth.otp_email'].detail, /1 نطاق/);
  assert.equal(r['mail.transactional'].ok, true);
  assert.equal(r['auth.google'].ok, true); assert.match(r['auth.google'].detail, /\(2\)/);
  assert.equal(r['server.public_url'].ok, true);
  assert.equal(r['push.expo'].ok, true);
  assert.equal(r['rooms.turn'].ok, true); // خارج الإنتاج: المرحّل العام في القائمة الثابتة
});

test('GET /admin/system يضمّ الربط والملخّص والنشر؛ POST /system/check للمدير مع حدّ ١٠ ثوانٍ (429)', async () => {
  const s = await c.student('92400001');
  const admin = await c.staff('92400002', 'admin');
  const sys = await c.api('/api/admin/system', { token: admin.token });
  assert.equal(sys.status, 200);
  const info = SystemInfo.parse(sys.json);
  assert.equal(info.summary.total, info.integrations.flatMap(g => g.items).length);
  assert.deepEqual(info.deploy, { domain: null, image: null });
  assert.deepEqual(info.payments.providers, ['thawani', 'stripe', 'wallet', 'manual', 'mock']);
  assert.equal(sys.text.includes('thw_secret_key'), false);
  assert.equal((await c.api('/api/admin/system/check', { method: 'POST', body: { ids: ['payments.thawani'] }, token: s.token })).status, 403);
  const r = await c.api('/api/admin/system/check', { method: 'POST', body: { ids: ['payments.thawani', 'payments.stripe'] }, token: admin.token });
  assert.equal(r.status, 200);
  const parsed = SystemCheckResult.parse(r.json);
  assert.deepEqual(Object.keys(parsed).sort(), ['payments.stripe', 'payments.thawani']);
  assert.equal(parsed['payments.thawani'].ok, true);
  const again = await c.api('/api/admin/system/check', { method: 'POST', body: {}, token: admin.token });
  assert.equal(again.status, 429); assert.equal(again.json.error.code, 'rate_limited');
  assert.equal(c.q.val<number>("SELECT COUNT(*) FROM audit_logs WHERE action = 'system.check'"), 1);
});

test('/api/health يعلن ملخّص الربط و/api/config يعلن المعرّفات العامة فقط', async () => {
  const h = await c.api('/api/health');
  assert.deepEqual(h.json.integrations, summary());
  const cfg = (await c.api('/api/config')).json;
  assert.equal(cfg.auth.google, '1234567890-web.apps.googleusercontent.com');
  assert.deepEqual(cfg.auth.apple, { servicesId: null, native: false });
  assert.equal(typeof cfg.push.web, 'string');
  assert.deepEqual(cfg.payments, { providers: ['thawani', 'stripe', 'wallet', 'manual', 'mock'], thawaniMode: 'uat' });
  assert.equal(JSON.stringify(cfg).includes('thw_secret_key'), false);
});
