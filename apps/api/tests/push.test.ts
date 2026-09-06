/**
 * الإشعارات الفورية: تسجيل جهاز متصفح وجهاز Expo، notify() يصل إلى الناقلَين المستبدلَين بالحمولة الصحيحة،
 * 410 من المتصفح وDeviceNotRegistered من Expo يحذفان الجهاز، DELETE يزيل، إعادة التسجيل تنقل الرمز لحساب آخر،
 * والمفتاح العام VAPID متاح بلا دخول ومحفوظ في DATA_DIR.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
import type { WebSubscription, ExpoMessage } from '../src/services/push.ts';
let push: typeof import('../src/services/push.ts');
let notifications: typeof import('../src/services/notifications.ts');
type WebCall = { sub: WebSubscription; payload: any };
const webCalls: WebCall[] = [];
const expoCalls: ExpoMessage[][] = [];
before(async () => {
  c = await boot();
  push = await import('../src/services/push.ts');
  notifications = await import('../src/services/notifications.ts');
  push.pushTransports.web = async (sub, payload) => { webCalls.push({ sub, payload: JSON.parse(payload) }); };
  push.pushTransports.expo = async messages => { expoCalls.push(messages); return messages.map(() => ({ status: 'ok' as const })); };
});
after(() => c.close());
const tick = () => new Promise(r => setTimeout(r, 30));
const reset = () => { webCalls.length = 0; expoCalls.length = 0; };

const SUB = { endpoint: 'https://push.example.com/sub/abc123', keys: { p256dh: 'BPxq_p256dh_key_material_0123456789', auth: 'auth-secret-16' } };
const EXPO = 'ExponentPushToken[abcdef123456]';

test('المفتاح العام VAPID: عام بلا دخول ومطابق للملف المولَّد في DATA_DIR', async () => {
  const r = await c.api('/api/push/public-key');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.key, 'string'); assert.ok(r.json.key.length > 60);
  const file = path.join(process.env.DATA_DIR!, '.vapid.json');
  assert.ok(fs.existsSync(file), 'مفاتيح VAPID مولَّدة ومحفوظة');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).publicKey, r.json.key);
  assert.equal((await c.api('/api/config')).json.push.web, r.json.key);
});

test('عنوان الاشتراك: https إلى مضيف عام فقط — لا http ولا IP ولا شبكات داخلية؛ وأقصى ١٠ أجهزة لكل حساب', async () => {
  const s = await c.login('94000009');
  for (const endpoint of ['http://push.example.com/sub/x1', 'https://127.0.0.1/sub/x2', 'https://[::1]/sub/x3', 'https://localhost/sub/x4', 'https://metadata.internal/sub/x5', 'https://intranet/sub/x6', 'https://u:p@push.example.com/sub/x7']) {
    const r = await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'web', subscription: { ...SUB, endpoint } } });
    assert.equal(r.status, 400, endpoint); assert.equal(r.json.error.code, 'validation_error');
  }
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', s.id), 0);
  for (let i = 0; i < 12; i++) assert.equal((await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'expo', token: `ExponentPushToken[cap${String(i).padStart(6, '0')}]` } })).status, 200);
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', s.id), 10, 'الأقدم يُزاح');
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ? AND token = ?', s.id, 'ExponentPushToken[cap000000]'), 0);
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ? AND token = ?', s.id, 'ExponentPushToken[cap000011]'), 1);
});

test('التسجيل يتطلّب دخولاً وجسماً صالحاً', async () => {
  assert.equal((await c.api('/api/me/push', { method: 'POST', body: { kind: 'expo', token: EXPO } })).status, 401);
  const s = await c.login('94000001');
  const bad = await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'web', subscription: { endpoint: 'not-a-url', keys: {} } } });
  assert.equal(bad.status, 422);
  const badKind = await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'sms', token: EXPO } });
  assert.equal(badKind.status, 422);
});

test('تسجيل متصفح + Expo ثم notify() → الناقلان يُستدعيان بالحمولة الصحيحة والجهازان يُحدَّثان', async () => {
  const s = await c.login('94000002');
  const w = await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'web', subscription: SUB } });
  assert.equal(w.status, 200); assert.equal(w.json.kind, 'web');
  const e = await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'expo', token: EXPO, platform: 'android' } });
  assert.equal(e.status, 200);
  // إعادة التسجيل نفسها لا تكرّر الصف
  await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'web', subscription: SUB } });
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', s.id), 2);
  assert.deepEqual(c.q.get('SELECT kind, token, auth, p256dh, platform FROM push_devices WHERE user_id = ? AND kind = ?', s.id, 'web'),
    { kind: 'web', token: SUB.endpoint, auth: SUB.keys.auth, p256dh: SUB.keys.p256dh, platform: 'web' });

  reset();
  const row = notifications.notify(s.id, { type: 'booking.confirmed', title: 'تأكّد حجزك', body: 'غداً ٤ مساءً', data: { url: '/bookings/7', bookingId: 7 } });
  assert.ok(row?.id);
  await tick();
  assert.equal(webCalls.length, 1);
  assert.deepEqual(webCalls[0].sub, SUB);
  assert.equal(webCalls[0].payload.title, 'تأكّد حجزك'); assert.equal(webCalls[0].payload.body, 'غداً ٤ مساءً');
  assert.equal(webCalls[0].payload.url, '/bookings/7'); assert.equal(webCalls[0].payload.data.bookingId, 7);
  assert.equal(webCalls[0].payload.data.type, 'booking.confirmed'); assert.equal(webCalls[0].payload.data.notificationId, row.id);
  assert.equal(expoCalls.length, 1); assert.equal(expoCalls[0].length, 1);
  const m = expoCalls[0][0];
  assert.equal(m.to, EXPO); assert.equal(m.title, 'تأكّد حجزك'); assert.equal(m.body, 'غداً ٤ مساءً'); assert.equal(m.sound, 'default');
  assert.equal(m.data?.bookingId, 7); assert.equal(m.data?.url, '/bookings/7');
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ? AND last_used_at IS NOT NULL', s.id), 2);
  // الإشعار نفسه محفوظ في الجدول كما كان
  const list = await c.api('/api/me/notifications', { token: s.token });
  assert.equal(list.json.data[0].title, 'تأكّد حجزك');
});

test('403 من خدمة الدفع (مفاتيح VAPID قديمة) → يُحذف الاشتراك نهائياً', async () => {
  const s = await c.login('94000008');
  await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'web', subscription: { ...SUB, endpoint: 'https://push.example.com/sub/oldkeys' } } });
  push.pushTransports.web = async () => { throw Object.assign(new Error('VapidPkHashMismatch'), { statusCode: 403 }); };
  assert.deepEqual(await push.sendPush(s.id, { title: 'x' }), { sent: 0, removed: 1 });
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', s.id), 0);
  push.pushTransports.web = async (sub, payload) => { webCalls.push({ sub, payload: JSON.parse(payload) }); };
});

test('410 من المتصفح وDeviceNotRegistered من Expo → يُحذف الجهاز؛ خطأ آخر يبقيه؛ لا رمي للمستدعي', async () => {
  const s = await c.login('94000003');
  await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'web', subscription: { ...SUB, endpoint: 'https://push.example.com/sub/gone' } } });
  await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'expo', token: 'ExponentPushToken[gone000000]' } });
  push.pushTransports.web = async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); };
  push.pushTransports.expo = async messages => messages.map(() => ({ status: 'error' as const, message: 'not registered', details: { error: 'DeviceNotRegistered' } }));
  const r1 = await push.sendPush(s.id, { title: 'x' });
  assert.deepEqual(r1, { sent: 0, removed: 2 });
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', s.id), 0);

  await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'web', subscription: { ...SUB, endpoint: 'https://push.example.com/sub/flaky' } } });
  push.pushTransports.web = async () => { throw Object.assign(new Error('Server error'), { statusCode: 500 }); };
  push.pushTransports.expo = async () => { throw new Error('network down'); };
  const r2 = await push.sendPush(s.id, { title: 'y' });
  assert.deepEqual(r2, { sent: 0, removed: 0 });
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', s.id), 1, 'الخطأ المؤقت لا يحذف الجهاز');
  // إعادة الناقلَين المسجّلَين
  push.pushTransports.web = async (sub, payload) => { webCalls.push({ sub, payload: JSON.parse(payload) }); };
  push.pushTransports.expo = async messages => { expoCalls.push(messages); return messages.map(() => ({ status: 'ok' as const })); };
});

test('DELETE /me/push يزيل الجهاز (بالرمز أو بالعنوان) ولا يمسّ أجهزة غيره', async () => {
  const s = await c.login('94000004');
  await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'expo', token: 'ExponentPushToken[del0000000]' } });
  await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'web', subscription: { ...SUB, endpoint: 'https://push.example.com/sub/del' } } });
  const noRef = await c.api('/api/me/push', { method: 'DELETE', token: s.token, body: { kind: 'expo' } });
  assert.equal(noRef.status, 422);
  const d1 = await c.api('/api/me/push', { method: 'DELETE', token: s.token, body: { kind: 'expo', token: 'ExponentPushToken[del0000000]' } });
  assert.equal(d1.status, 200); assert.equal(d1.json.removed, 1);
  const d2 = await c.api('/api/me/push', { method: 'DELETE', token: s.token, body: { kind: 'web', endpoint: 'https://push.example.com/sub/del' } });
  assert.equal(d2.json.removed, 1);
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', s.id), 0);
  const other = await c.login('94000005');
  await c.api('/api/me/push', { method: 'POST', token: other.token, body: { kind: 'expo', token: 'ExponentPushToken[other00000]' } });
  const d3 = await c.api('/api/me/push', { method: 'DELETE', token: s.token, body: { kind: 'expo', token: 'ExponentPushToken[other00000]' } });
  assert.equal(d3.json.removed, 0);
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', other.id), 1);
});

test('إعادة تسجيل الرمز نفسه من حساب آخر تنقله إليه (جهاز مشترك)', async () => {
  const a = await c.login('94000006');
  const b = await c.login('94000007');
  const token = 'ExponentPushToken[shared0000]';
  await c.api('/api/me/push', { method: 'POST', token: a.token, body: { kind: 'expo', token, platform: 'ios' } });
  assert.equal(c.q.val('SELECT user_id FROM push_devices WHERE kind = ? AND token = ?', 'expo', token), a.id);
  await c.api('/api/me/push', { method: 'POST', token: b.token, body: { kind: 'expo', token } });
  assert.equal(c.q.val('SELECT user_id FROM push_devices WHERE kind = ? AND token = ?', 'expo', token), b.id);
  assert.equal(c.q.val('SELECT platform FROM push_devices WHERE kind = ? AND token = ?', 'expo', token), 'ios', 'المنصّة السابقة تبقى حين لا تُرسل');
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', a.id), 0);
  reset();
  notifications.notify(a.id, { type: 'x', title: 'للحساب أ' });
  notifications.notify(b.id, { type: 'x', title: 'للحساب ب' });
  await tick();
  assert.equal(expoCalls.length, 1); assert.equal(expoCalls[0][0].title, 'للحساب ب');
});

test('الحساب الموقوف أو المحذوف لا يُدفع له شيء، وحذف الحساب يمسح أجهزته', async () => {
  const s = await c.login('94000008');
  await c.api('/api/me/push', { method: 'POST', token: s.token, body: { kind: 'expo', token: 'ExponentPushToken[susp000000]' } });
  c.q.run("UPDATE users SET status = 'suspended' WHERE id = ?", s.id);
  reset();
  assert.deepEqual(await push.sendPush(s.id, { title: 'x' }), { sent: 0, removed: 0 });
  assert.equal(expoCalls.length, 0);
  c.q.run("UPDATE users SET status = 'active' WHERE id = ?", s.id);
  const del = await c.api('/api/me', { method: 'DELETE', token: s.token });
  assert.equal(del.status, 200);
  assert.equal(c.q.val('SELECT COUNT(*) FROM push_devices WHERE user_id = ?', s.id), 0);
});
