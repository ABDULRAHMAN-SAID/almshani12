/** رموز التحقّق في البيئة الافتراضية (بلا مزوّد): الرمز الثابت للجميع، وطرق الدخول، وحالة النظام للإدارة بلا أسرار */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AuthMethods, OtpRequestResult, SystemInfo } from '@manassah/shared';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

test('GET /auth/methods: بلا مزوّد يبقى الهاتف والبريد متاحين بالرمز الثابت، وواتساب غير متاح', async () => {
  const r = await c.api('/api/auth/methods');
  assert.equal(r.status, 200);
  assert.deepEqual(AuthMethods.parse(r.json), { phone: true, whatsapp: false, email: true, testCode: true, google: false, apple: false });
});

test('الطلب يعيد delivery=test مع الرمز الثابت؛ التحقّق به يعمل والخاطئ يُرفض', async () => {
  const r = await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: '92100001', via: 'whatsapp' } });
  assert.equal(r.status, 200);
  const parsed = OtpRequestResult.parse(r.json);
  assert.equal(parsed.delivery, 'test'); assert.equal(parsed.devCode, '000000'); assert.equal(parsed.target, '+96892100001');
  assert.equal(c.q.get<any>('SELECT provider, via FROM otp_codes WHERE target = ? ORDER BY id DESC', '+96892100001')?.via, 'test');
  const bad = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '92100001', code: '123456' } });
  assert.equal(bad.status, 400); assert.equal(bad.json.error.code, 'otp_invalid');
  const ok = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '92100001', code: '000000' } });
  assert.equal(ok.status, 200); assert.equal(ok.json.user.phone, '+96892100001');
  const e = await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'email', target: 'otp@example.com' } });
  assert.equal(e.status, 200); assert.equal(e.json.delivery, 'test'); assert.equal(e.json.devCode, '000000');
});

test('/api/health يعلن طرق الدخول و/api/config يعلن الرمز الثابت', async () => {
  const h = await c.api('/api/health');
  assert.equal(h.status, 200);
  assert.deepEqual(h.json.otp, { phone: true, whatsapp: false, email: true, testCode: true });
  assert.equal((await c.api('/api/config')).json.devOtp, true);
});

test('GET /admin/system: للمدير فقط، بالشكل المتّفق عليه، وبلا أسرار', async () => {
  const s = await c.student('92100002');
  const support = await c.staff('92100003', 'support');
  const admin = await c.staff('92100004', 'admin');
  assert.equal((await c.api('/api/admin/system')).status, 401);
  assert.equal((await c.api('/api/admin/system', { token: s.token })).status, 403);
  assert.equal((await c.api('/api/admin/system', { token: support.token })).status, 403);
  const r = await c.api('/api/admin/system', { token: admin.token });
  assert.equal(r.status, 200);
  const info = SystemInfo.parse(r.json);
  assert.equal(info.otp.smsProvider, 'log'); assert.equal(info.otp.emailProvider, 'log'); assert.equal(info.otp.testCode, true);
  assert.deepEqual(info.otp.allowedCountries, ['+968']); assert.equal(info.otp.testTargets, 0);
  assert.equal(info.bootstrap.adminPhone, false); assert.equal(typeof info.rooms.turn, 'boolean');
  assert.deepEqual(info.payments.providers, ['mock', 'wallet', 'manual']);
  // أسماء المتغيّرات الناقصة في قسم الربط (مثل TWILIO_AUTH_TOKEN) ليست أسراراً — تُستثنى من فحص الكلمات
  const text = JSON.stringify({ ...r.json, integrations: undefined }).toLowerCase();
  for (const word of ['secret', 'token', 'pass', 'apikey', 'sid', 'test-jwt']) assert.equal(text.includes(word), false, `لا يظهر ${word}`);
  assert.equal(info.integrations.length > 0, true); assert.equal(info.summary.total, info.integrations.flatMap(g => g.items).length);
  assert.equal(info.integrations.flatMap(g => g.items).some(i => JSON.stringify(i).toLowerCase().includes('test-jwt')), false);
});
