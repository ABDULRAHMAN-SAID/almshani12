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

test('تجديد الجلسة يدوّر الرمز؛ إعادة استخدام رمز قديم تُنهي سلسلة جهازه', async () => {
  const s = await c.login('92000003');
  const r1 = await c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } });
  assert.equal(r1.status, 200); assert.notEqual(r1.json.refreshToken, s.refreshToken);
  // خارج مهلة السماح القصيرة: إعادة التقديم تُقرأ سرقةً لا ردّاً ضائعاً
  c.db.prepare('UPDATE refresh_tokens SET rotated_at = 1 WHERE rotated_at IS NOT NULL').run();
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

/* ---------- كلمة المرور ---------- */
/** التسجيل يتطلّب رمزاً على البريد أولاً (checkOtp داخل /auth/register) — يطلبه هنا بالنيابة عن كل اختبار */
async function register(body: Record<string, unknown>) {
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'email', target: body.email } });
  return c.api('/api/auth/register', { method: 'POST', body: { code: '000000', ...body } });
}

test('تسجيل بكلمة مرور: رمز على البريد أولاً، ثم الدخول لاحقاً بالهاتف أو البريد', async () => {
  const r = await register({ displayName: 'عبدالرحمن سعيد المعشني', phone: '92100001', email: 'abdulrahman@example.com', password: 'حرف-مرور-قوي1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.isNew, true);
  assert.equal(r.json.user.phone, '+96892100001');
  assert.equal(r.json.user.email, 'abdulrahman@example.com');

  const byPhone = await c.api('/api/auth/login', { method: 'POST', body: { channel: 'phone', target: '92100001', password: 'حرف-مرور-قوي1' } });
  assert.equal(byPhone.status, 200);
  const byEmail = await c.api('/api/auth/login', { method: 'POST', body: { channel: 'email', target: 'ABDULRAHMAN@example.com', password: 'حرف-مرور-قوي1' } });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.json.user.id, byPhone.json.user.id);
});

test('رمز خاطئ أو مفقود على التسجيل: يُرفض ولا يُنشأ حساب', async () => {
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'email', target: 'noaccount@example.com' } });
  const bad = await c.api('/api/auth/register', { method: 'POST', body: { displayName: 'رمز خاطئ', phone: '92100009', email: 'noaccount@example.com', password: 'كلمة-مرور-ب', code: '111111' } });
  assert.equal(bad.status, 400); assert.equal(bad.json.error.code, 'otp_invalid');
  const login = await c.api('/api/auth/login', { method: 'POST', body: { channel: 'phone', target: '92100009', password: 'كلمة-مرور-ب' } });
  assert.equal(login.status, 401, 'لم يُنشأ حساب فلا يوجد ما يُدخَل إليه');
});

test('كلمة مرور خاطئة أو حساب غير موجود: نفس الرسالة الموحّدة، وتسجيل مكرّر على حساب له كلمة مرور يُرفض', async () => {
  await register({ displayName: 'سالم راشد', phone: '92100002', email: 'salim2@example.com', password: 'كلمة-مرور-2' });
  const wrongPw = await c.api('/api/auth/login', { method: 'POST', body: { channel: 'phone', target: '92100002', password: 'غلط' } });
  assert.equal(wrongPw.status, 401); assert.equal(wrongPw.json.error.code, 'invalid_credentials');
  const noAccount = await c.api('/api/auth/login', { method: 'POST', body: { channel: 'phone', target: '92199999', password: 'أي-شيء' } });
  assert.equal(noAccount.status, 401); assert.equal(noAccount.json.error.code, 'invalid_credentials');
  const dup = await register({ displayName: 'محاولة تكرار', phone: '92100002', email: 'other@example.com', password: 'كلمة-مرور-3' });
  assert.equal(dup.status, 409); assert.equal(dup.json.error.code, 'account_exists');
});

test('حساب أُنشئ برمز تحقّق بلا كلمة مرور: التسجيل بكلمة مرور على نفس الرقم يُرقّيه لا يكرّره', async () => {
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: '92100003' } });
  const otpUser = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: '92100003', code: '000000' } });
  assert.equal(otpUser.status, 200);
  const upgraded = await register({ displayName: 'ترقية الحساب', phone: '92100003', email: 'upgraded@example.com', password: 'كلمة-مرور-جديدة' });
  assert.equal(upgraded.status, 200);
  assert.equal(upgraded.json.isNew, false);
  assert.equal(upgraded.json.user.id, otpUser.json.user.id, 'نفس الحساب لا حساب جديد');
  const login = await c.api('/api/auth/login', { method: 'POST', body: { channel: 'phone', target: '92100003', password: 'كلمة-مرور-جديدة' } });
  assert.equal(login.status, 200);
});

test('استعادة كلمة المرور: رمز صحيح يضبط كلمة جديدة ويُدخل مباشرة؛ الرمز القديم لا يُستخدم مرتين', async () => {
  await register({ displayName: 'هدى خالد', phone: '92100004', email: 'huda@example.com', password: 'كلمة-قديمة' });
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: '92100004' } });
  const reset = await c.api('/api/auth/password/reset', { method: 'POST', body: { channel: 'phone', target: '92100004', code: '000000', newPassword: 'كلمة-جديدة-جداً' } });
  assert.equal(reset.status, 200);
  const oldPw = await c.api('/api/auth/login', { method: 'POST', body: { channel: 'phone', target: '92100004', password: 'كلمة-قديمة' } });
  assert.equal(oldPw.status, 401);
  const newPw = await c.api('/api/auth/login', { method: 'POST', body: { channel: 'phone', target: '92100004', password: 'كلمة-جديدة-جداً' } });
  assert.equal(newPw.status, 200);
  const reuseCode = await c.api('/api/auth/password/reset', { method: 'POST', body: { channel: 'phone', target: '92100004', code: '000000', newPassword: 'محاولة-أخرى' } });
  assert.equal(reuseCode.status, 400); assert.equal(reuseCode.json.error.code, 'otp_expired');
});

/* ---------- سلاسل رموز التجديد ---------- */
/** يسجّل دخولاً مستقلّاً (سلسلة جديدة) ويعيد رمز التجديد */
async function login(c: Ctx, target: string): Promise<string> {
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target } });
  const v = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target, code: '000000' } });
  assert.equal(v.status, 200);
  return v.json.refreshToken as string;
}
const refresh = (c: Ctx, refreshToken: string) => c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });

test('التجديد: إعادة استخدام رمز مُدوَّر تُنهي سلسلة جهازه وحدها ولا تمسّ أجهزته الأخرى', async () => {
  const phone = '92000077';
  const a = await login(c, phone);          // الجهاز الأول
  const b = await login(c, phone);          // الجهاز الثاني — سلسلة مستقلّة

  const rotated = await refresh(c, a);
  assert.equal(rotated.status, 200);
  const a2 = rotated.json.refreshToken as string;

  // خارج مهلة السماح تُعامَل إعادة التقديم سرقةً: نُزوّر التدوير إلى الماضي البعيد
  c.db.prepare("UPDATE refresh_tokens SET rotated_at = 1 WHERE rotated_at IS NOT NULL").run();

  const replay = await refresh(c, a);
  assert.equal(replay.status, 401, 'الرمز القديم مرفوض');

  const sameChain = await refresh(c, a2);
  assert.equal(sameChain.status, 401, 'سلسلة الجهاز المسروق انتهت كلّها');

  const otherDevice = await refresh(c, b);
  assert.equal(otherDevice.status, 200, 'الجهاز الآخر لم يُمسّ — كان يُطرد معه');
});

test('التجديد: إعادة تقديم رمز دُوِّر للتوّ ردّ ضائع لا سرقة — يُصدر رمزاً جديداً بلا إنهاء السلسلة', async () => {
  const phone = '92000078';
  const a = await login(c, phone);
  const first = await refresh(c, a);
  assert.equal(first.status, 200);
  const a2 = first.json.refreshToken as string;

  const retry = await refresh(c, a);                 // داخل مهلة السماح القصيرة
  assert.equal(retry.status, 200, 'إعادة المحاولة البريئة تنجح');
  assert.ok(retry.json.refreshToken && retry.json.refreshToken !== a2);

  const stillValid = await refresh(c, a2);
  assert.equal(stillValid.status, 200, 'الرمز الذي وصل الجهاز فعلاً ما زال صالحاً');
});

test('الخروج برمز التجديد يُنهي سلسلة ذلك الجهاز كلّها', async () => {
  const phone = '92000079';
  const a = await login(c, phone);
  const rotated = await refresh(c, a);
  const a2 = rotated.json.refreshToken as string;
  const access = rotated.json.accessToken as string;

  const out = await c.api('/api/auth/logout', { method: 'POST', token: access, body: { refreshToken: a2 } });
  assert.equal(out.status, 200);
  assert.equal((await refresh(c, a2)).status, 401);
  assert.equal((await refresh(c, a)).status, 401, 'سابقات السلسلة أُبطلت أيضاً');
});
