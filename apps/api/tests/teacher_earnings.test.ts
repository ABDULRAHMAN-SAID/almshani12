import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

/** «متاح للسحب» في /teacher/earnings يجب أن يطابق الرصيد الذي يخصم منه طلب السحب ويتحقّق منه الخادم */
test('طلب السحب يخصم من «متاح للسحب» ويظهر في «قيد السحب»', async () => {
  const t = await c.teacher('94100001');
  c.q.run("INSERT OR REPLACE INTO teacher_profiles (user_id, headline, bio, years_exp, verification_status, verified_at, available_balance) VALUES (?,?,?,?,'verified',?,?)",
    t.id, 'معلّم اختبار', 'سيرة', 5, new Date().toISOString(), 20);
  c.settings.set('min_payout', 5);

  const before = await c.api('/api/teacher/earnings', { token: t.token });
  assert.equal(before.status, 200);
  assert.equal(before.json.available, 20);
  assert.equal(before.json.requested, 0);

  const req = await c.api('/api/teacher/payouts', { method: 'POST', token: t.token, body: { amount: 12, method: 'bank', details: { iban: 'OM00' } } });
  assert.equal(req.status, 201);

  const after = await c.api('/api/teacher/earnings', { token: t.token });
  assert.equal(after.json.available, 8, 'المتاح ينقص بمقدار الطلب فلا يُدعى المعلّم لطلب مبلغ سيُرفض');
  assert.equal(after.json.requested, 12, 'الطلب المعلّق يظهر في «قيد السحب»');
  assert.equal(after.json.paid, 0, '«مصروف» لا يشمل الطلبات قبل صرفها');
  assert.equal(after.json.payouts[0].status, 'pending');

  // طلب يتجاوز المتاح الجديد يُرفض — وهو ما تعرضه الشاشة الآن بالحدّ نفسه
  c.q.run("UPDATE teacher_payouts SET status = 'paid', processed_at = ? WHERE teacher_id = ?", new Date().toISOString(), t.id);
  const paid = await c.api('/api/teacher/earnings', { token: t.token });
  assert.equal(paid.json.requested, 0);
  assert.equal(paid.json.paid, 12, 'بعد الصرف ينتقل المبلغ إلى «مصروف»');

  const tooMuch = await c.api('/api/teacher/payouts', { method: 'POST', token: t.token, body: { amount: 50, method: 'wallet' } });
  assert.equal(tooMuch.status, 400);
  assert.equal(tooMuch.json.error?.code ?? tooMuch.json.code, 'insufficient_funds');
});

/** الأوقات تُتحقّق في العقد: «99:00» أو «24:30» كانت تُخزَّن فتختفي مواعيد اليوم كلّه */
test('توفّر المعلّم يرفض وقتاً خارج اليوم (99:00 / 24:30)', async () => {
  const t = await c.teacher('94100002', { allDay: false });
  const bad = await c.api('/api/teacher/availability', { method: 'PUT', token: t.token, body: [{ weekday: 0, startTime: '16:00', endTime: '99:00', slotMinutes: 60, breakMinutes: 0 }] });
  assert.equal(bad.status, 422, 'العقد يرفض الوقت قبل أن يصل قاعدة البيانات');
  const bad2 = await c.api('/api/teacher/availability', { method: 'PUT', token: t.token, body: [{ weekday: 0, startTime: '24:30', endTime: '25:00', slotMinutes: 60, breakMinutes: 0 }] });
  assert.equal(bad2.status, 422);
  const ok = await c.api('/api/teacher/availability', { method: 'PUT', token: t.token, body: [{ weekday: 0, startTime: '16:00', endTime: '21:00', slotMinutes: 60, breakMinutes: 0 }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.count, 1);
});

/** إشعار البيع يصل البائع بعلامة teacherSale ليفتح أرباحه لا «مشترياتي» الفارغة */
test('إشعار «عملية بيع جديدة» يحمل teacherSale', async () => {
  const t = await c.teacher('94100003');
  const s = await c.student('94100004');
  const bookId = c.book(t.id, { price: 3 });
  await c.api('/api/cart/items', { method: 'POST', token: s.token, body: { itemType: 'book', itemId: bookId } });
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock' } });
  const ref = new URL(ck.json.checkoutUrl).searchParams.get('ref');
  assert.equal((await c.api('/api/payments/mock/confirm', { method: 'POST', body: { reference: ref } })).status, 200);

  const notifs = await c.api('/api/me/notifications', { token: t.token });
  const sale = notifs.json.data.find((n: any) => n.title === 'عملية بيع جديدة');
  assert.ok(sale, 'البائع يتلقّى إشعار البيع');
  assert.equal(sale.data.teacherSale, true);
  assert.ok(sale.data.orderId > 0);

  // المشتري لا يحمل إشعاره العلامة نفسها
  const mine = await c.api('/api/me/notifications', { token: s.token });
  assert.ok(!mine.json.data.some((n: any) => n.data?.teacherSale));
});
