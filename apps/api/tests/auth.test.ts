import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

test('OTP: طلب الرمز ثم التحقّق يُنشئ حساباً جديداً بدور طالب', async () => {
  const r = await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: '92000001' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.target, '+96892000001');
  assert.equal(r.json.devCode, '000000');
  const v = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '+968 9200 0001', code: '000000' } });
  assert.equal(v.status, 200);
  assert.equal(v.json.isNew, true);
  assert.deepEqual(v.json.user.roles, ['student']);
  assert.equal(v.json.user.onboardingCompleted, false);
  assert.ok(v.json.accessToken && v.json.refreshToken);
});

test('OTP: رمز خاطئ يُرفض ويُحتسب محاولة؛ الرمز لا يُستخدم مرّتين', async () => {
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'email', target: 'Test@Example.com' } });
  const bad = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'email', target: 'test@example.com', code: '123456' } });
  assert.equal(bad.status, 400); assert.equal(bad.json.error.code, 'otp_invalid');
  const ok = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'email', target: 'test@example.com', code: '000000' } });
  assert.equal(ok.status, 200);
  const reuse = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'email', target: 'test@example.com', code: '000000' } });
  assert.equal(reuse.status, 400); assert.equal(reuse.json.error.code, 'otp_expired');
});

test('OTP: بعد ٥ محاولات خاطئة يُقفل الرمز', async () => {
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: '92000002' } });
  for (let i = 0; i < 5; i++) await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '92000002', code: '111111' } });
  const r = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '92000002', code: '000000' } });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, 'otp_expired');
});

test('المسارات المحمية ترفض بلا رمز وبرمز تالف', async () => {
  assert.equal((await c.api('/api/home')).status, 401);
  const bad = await c.api('/api/home', { token: 'abc.def.ghi' });
  assert.equal(bad.status, 401); assert.equal(bad.json.error.code, 'auth_expired');
});

test('تجديد الجلسة يدوّر الرمز؛ إعادة استخدام رمز قديم تُنهي كل الجلسات', async () => {
  const s = await c.login('92000003');
  const r1 = await c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } });
  assert.equal(r1.status, 200); assert.notEqual(r1.json.refreshToken, s.refreshToken);
  const reuse = await c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } });
  assert.equal(reuse.status, 401);
  const afterReuse = await c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: r1.json.refreshToken } });
  assert.equal(afterReuse.status, 401, 'الرمز الجديد أُلغي أيضاً بعد كشف إعادة الاستخدام');
});

test('إعداد الطالب يثبّت الصف والمواد ويُكمل التهيئة', async () => {
  const s = await c.login('92000004');
  const r = await c.api('/api/me/student-setup', { method: 'POST', token: s.token, body: { displayName: 'سالم', curriculumId: c.cat.curriculumId, gradeId: c.cat.grades[12], semesterId: c.cat.semesters[1], subjectIds: [c.cat.subjects.physics, c.cat.subjects.chemistry] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.onboardingCompleted, true);
  assert.equal(r.json.student.gradeId, c.cat.grades[12]);
  assert.deepEqual(r.json.student.subjectIds.sort(), [c.cat.subjects.physics, c.cat.subjects.chemistry].sort());
  const wrong = await c.api('/api/me/student-setup', { method: 'POST', token: s.token, body: { displayName: 'سالم', curriculumId: c.cat.curriculumId, gradeId: 9999, semesterId: c.cat.semesters[1], subjectIds: [c.cat.subjects.physics] } });
  assert.equal(wrong.status, 400);
});

test('الحساب الموقوف لا يستطيع الدخول', async () => {
  const s = await c.login('92000005');
  c.q.run("UPDATE users SET status = 'suspended' WHERE id = ?", s.id);
  assert.equal((await c.api('/api/home', { token: s.token })).status, 401);
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: '92000005' } });
  const v = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '92000005', code: '000000' } });
  assert.equal(v.status, 403);
});
