/**
 * الدخول بحساب Google/Apple: رموز موقّعة بمفتاح RSA محلي تُحقن مجموعته في lib/social.ts (بلا شبكة).
 * حساب جديد بالبريد الموثّق، الهوية نفسها → الحساب نفسه، جمهور خاطئ → 401، اسم Apple يُحفظ،
 * ربط بحساب OTP قديم بالبريد نفسه، الموقوف 403، والمزوّد غير المضبوط → 501.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWTPayload } from 'jose';
import type { Ctx } from './helpers.ts';

process.env.GOOGLE_CLIENT_IDS = 'web-client.apps.googleusercontent.com,ios-client.apps.googleusercontent.com';
process.env.APPLE_CLIENT_IDS = 'om.manassah.app,om.manassah.web';
process.env.APPLE_SERVICES_ID = 'om.manassah.web';
const { boot } = await import('./helpers.ts');
const social = await import('../src/lib/social.ts');
const { config } = await import('../src/config.ts');

const GOOGLE_ISS = 'https://accounts.google.com', APPLE_ISS = 'https://appleid.apple.com';
let c: Ctx;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
before(async () => {
  c = await boot();
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' };
  const local = createLocalJWKSet({ keys: [jwk] });
  social.jwksResolvers.google = () => local;
  social.jwksResolvers.apple = () => local;
});
after(() => c.close());

const sign = (claims: JWTPayload, { iss, aud, exp = '5m' }: { iss: string; aud: string | string[]; exp?: string }) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-kid' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(privateKey);
const googleToken = (sub: string, email: string, extra: JWTPayload = {}, aud = 'web-client.apps.googleusercontent.com') =>
  sign({ sub, email, email_verified: true, name: 'سالم الهنائي', picture: 'https://lh3.example/p.jpg', ...extra }, { iss: GOOGLE_ISS, aud });
const appleToken = (sub: string, email: string, extra: JWTPayload = {}, aud = 'om.manassah.app') =>
  sign({ sub, email, email_verified: 'true', ...extra }, { iss: APPLE_ISS, aud });

test('GET /auth/methods يعلن google/apple عند ضبط المعرّفات', async () => {
  const r = await c.api('/api/auth/methods');
  assert.equal(r.status, 200); assert.equal(r.json.google, true); assert.equal(r.json.apple, true);
});

test('Google: رمز صالح → حساب جديد بدور طالب ببريد موثّق واسم من المزوّد، والهوية نفسها → الحساب نفسه', async () => {
  const r = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await googleToken('g-1001', 'Salem@Example.com') } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.isNew, true);
  assert.ok(r.json.accessToken && r.json.refreshToken);
  assert.equal(r.json.user.email, 'salem@example.com');
  assert.equal(r.json.user.displayName, 'سالم الهنائي');
  assert.deepEqual(r.json.user.roles, ['student']);
  assert.equal(c.q.val('SELECT COUNT(*) FROM auth_identities WHERE provider = ? AND provider_uid = ?', 'google', 'g-1001'), 1);
  // الرمز يعمل على المسارات المحمية
  assert.equal((await c.api('/api/auth/me', { token: r.json.accessToken })).status, 200);

  const again = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await googleToken('g-1001', 'salem@example.com', { name: 'اسم آخر' }) } });
  assert.equal(again.status, 200);
  assert.equal(again.json.isNew, false);
  assert.equal(again.json.user.id, r.json.user.id);
  assert.equal(again.json.user.displayName, 'سالم الهنائي', 'الاسم المحفوظ لا يُستبدل');
  assert.equal(c.q.val('SELECT COUNT(*) FROM users WHERE email = ?', 'salem@example.com'), 1);
});

test('Google: الدور المطلوب (parent) يُمنح عند الإنشاء، والمعرّف الثاني (iOS) مقبول', async () => {
  const r = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await googleToken('g-1002', 'parent@example.com', {}, 'ios-client.apps.googleusercontent.com'), role: 'parent', locale: 'en' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.user.roles, ['parent']);
  assert.equal(r.json.user.locale, 'en');
});

test('Google: جمهور خاطئ أو مُصدر خاطئ أو رمز منتهٍ → 401 unauthorized', async () => {
  const badAud = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await googleToken('g-1003', 'x@example.com', {}, 'someone-else.apps.googleusercontent.com') } });
  assert.equal(badAud.status, 401); assert.equal(badAud.json.error.code, 'unauthorized'); assert.equal(badAud.json.error.message, 'رمز الدخول غير صالح');
  const badIss = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await sign({ sub: 'g-1003', email: 'x@example.com', email_verified: true }, { iss: 'https://evil.example', aud: 'web-client.apps.googleusercontent.com' }) } });
  assert.equal(badIss.status, 401);
  const expired = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await sign({ sub: 'g-1003', email: 'x@example.com', email_verified: true }, { iss: GOOGLE_ISS, aud: 'web-client.apps.googleusercontent.com', exp: '-10m' }) } });
  assert.equal(expired.status, 401);
  const garbage = await c.api('/api/auth/google', { method: 'POST', body: { idToken: 'not.a.token-at-all-really' } });
  assert.equal(garbage.status, 401);
  assert.equal(c.q.val('SELECT COUNT(*) FROM users WHERE email = ?', 'x@example.com'), 0, 'لا يُنشأ حساب من رمز مرفوض');
});

test('Google: بريد غير موثّق لا يُنشئ حساباً (400) ولا يربط بحساب قائم', async () => {
  const s = await c.login('93000001');
  c.q.run('UPDATE users SET email = ? WHERE id = ?', 'victim@example.com', s.id);
  const r = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await googleToken('g-1004', 'victim@example.com', { email_verified: false }) } });
  assert.equal(r.status, 400);
  assert.equal(c.q.val('SELECT COUNT(*) FROM auth_identities WHERE user_id = ?', s.id), 1, 'لم تُضف هوية للحساب القائم');
});

test('Apple: fullName عند أول تفويض يصبح اسم العرض، ثم الدخول بلا اسم يعيد الحساب نفسه', async () => {
  const r = await c.api('/api/auth/apple', { method: 'POST', body: { identityToken: await appleToken('apple-2001', 'hidden@privaterelay.appleid.com'), fullName: { givenName: 'مريم', familyName: 'البلوشية' } } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.isNew, true);
  assert.equal(r.json.user.displayName, 'مريم البلوشية');
  assert.equal(r.json.user.email, 'hidden@privaterelay.appleid.com');
  const again = await c.api('/api/auth/apple', { method: 'POST', body: { identityToken: await appleToken('apple-2001', 'hidden@privaterelay.appleid.com', {}, 'om.manassah.web') } });
  assert.equal(again.status, 200); assert.equal(again.json.isNew, false); assert.equal(again.json.user.id, r.json.user.id);
});

test('Apple: بريد موثّق مطابق لحساب OTP قديم → يُربط بالحساب نفسه (هويتان) ولا حساب جديد', async () => {
  await c.api('/api/auth/otp/request', { method: 'POST', body: { channel: 'email', target: 'old@example.com' } });
  const otp = await c.api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'email', target: 'old@example.com', code: '000000' } });
  assert.equal(otp.status, 200);
  const r = await c.api('/api/auth/apple', { method: 'POST', body: { identityToken: await appleToken('apple-2002', 'Old@Example.com'), fullName: { givenName: 'خالد' } } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.isNew, false);
  assert.equal(r.json.user.id, otp.json.user.id);
  assert.equal(r.json.user.displayName, 'خالد', 'الاسم الفارغ يُستكمل من المزوّد');
  assert.deepEqual(c.q.all<{ provider: string }>('SELECT provider FROM auth_identities WHERE user_id = ? ORDER BY provider', otp.json.user.id).map(x => x.provider), ['apple', 'email_otp']);
  assert.equal(c.q.val('SELECT COUNT(*) FROM users WHERE email = ?', 'old@example.com'), 1);
});

test('الحساب الموقوف يُرفض 403 كما في OTP', async () => {
  const r = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await googleToken('g-1005', 'sus@example.com') } });
  assert.equal(r.status, 200);
  c.q.run("UPDATE users SET status = 'suspended' WHERE id = ?", r.json.user.id);
  const again = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await googleToken('g-1005', 'sus@example.com') } });
  assert.equal(again.status, 403); assert.equal(again.json.error.code, 'forbidden');
});

test('التحقّق من الجسم: idToken مفقود → 422', async () => {
  const r = await c.api('/api/auth/google', { method: 'POST', body: { role: 'student' } });
  assert.equal(r.status, 422); assert.equal(r.json.error.code, 'validation_error');
});

test('مزوّد غير مضبوط → 501 content_unavailable قبل أي تحقّق، و/auth/methods يعلنه false', async () => {
  const ids = config.auth.apple.clientIds as string[];
  const apple = config.auth.apple as { servicesId: string };
  const saved = ids.splice(0, ids.length), savedServices = apple.servicesId; // تفريغ المعرّفات مؤقتاً (الضبط يُقرأ عند كل طلب)
  apple.servicesId = '';
  try {
    const r = await c.api('/api/auth/apple', { method: 'POST', body: { identityToken: await appleToken('apple-2003', 'z@example.com') } });
    assert.equal(r.status, 501); assert.equal(r.json.error.code, 'content_unavailable');
    assert.ok(r.json.error.message.includes('Apple'));
    const m = await c.api('/api/auth/methods');
    assert.equal(m.json.apple, false); assert.equal(m.json.google, true);
  } finally { ids.push(...saved); apple.servicesId = savedServices; }
});

test('Apple: رمز الويب (aud = Services ID) مقبول حتى لو لم يُكرَّر في APPLE_CLIENT_IDS', async () => {
  const ids = config.auth.apple.clientIds as string[];
  const saved = ids.splice(0, ids.length, 'om.manassah.app'); // معرّف التطبيق فقط؛ Services ID من APPLE_SERVICES_ID
  try {
    const r = await c.api('/api/auth/apple', { method: 'POST', body: { identityToken: await appleToken('apple-2004', 'web@example.com', {}, 'om.manassah.web') } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.isNew, true);
    assert.equal((await c.api('/api/auth/methods')).json.apple, true);
    const bad = await c.api('/api/auth/apple', { method: 'POST', body: { identityToken: await appleToken('apple-2005', 'x@example.com', {}, 'om.other.app') } });
    assert.equal(bad.status, 401);
  } finally { ids.splice(0, ids.length, ...saved); }
});

test('الدخول الاجتماعي لا يمنح دور معلّم ذاتياً — يُنشأ طالباً ويتقدّم عبر /teachers', async () => {
  const r = await c.api('/api/auth/google', { method: 'POST', body: { idToken: await googleToken('g-1009', 'wannabe@example.com'), role: 'teacher' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.user.roles, ['student']);
  assert.equal(c.q.val('SELECT COUNT(*) FROM teacher_profiles WHERE user_id = ?', r.json.user.id), 0);
});
