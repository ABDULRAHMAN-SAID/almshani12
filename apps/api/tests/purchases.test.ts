import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

test('كتاب مدفوع: معاينة فقط قبل الشراء، والملف الكامل بعده برابط موقّع', async () => {
  const t = await c.teacher('93000001');
  const s = await c.student('93000002');
  const bookId = c.book(t.id, { price: 3 });
  const prev = await c.api(`/api/books/${bookId}/read`, { token: s.token });
  assert.equal(prev.status, 200); assert.equal(prev.json.kind, 'preview'); assert.equal(prev.json.watermark, null);

  const cart = await c.api('/api/cart/items', { method: 'POST', token: s.token, body: { itemType: 'book', itemId: bookId } });
  assert.equal(cart.status, 201); assert.equal(cart.json.total, 3);
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock' } });
  assert.equal(ck.status, 200); assert.equal(ck.json.paid, false); assert.ok(ck.json.checkoutUrl.includes('/pay/mock/'));
  // لم يُدفع بعد → لا يزال معاينة
  assert.equal((await c.api(`/api/books/${bookId}/read`, { token: s.token })).json.kind, 'preview');
  const ref = new URL(ck.json.checkoutUrl).searchParams.get('ref');
  const confirm = await c.api('/api/payments/mock/confirm', { method: 'POST', body: { reference: ref } });
  assert.equal(confirm.status, 200); assert.equal(confirm.json.paid, true); assert.equal(confirm.json.order.status, 'paid');

  const full = await c.api(`/api/books/${bookId}/read`, { token: s.token });
  assert.equal(full.json.kind, 'full'); assert.ok(full.json.watermark.includes('طالب'));
  const url = full.json.url.replace(/^http:\/\/[^/]+/, c.base); // PUBLIC_URL ثابت في الإعدادات؛ الخادم هنا على منفذ عشوائي
  const file = await fetch(url);
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.equal((await fetch(url + 'x')).status, 403, 'توقيع معدّل يُرفض');
  const fileId = full.json.url.match(/files\/(\d+)/)[1];
  assert.equal((await fetch(`${c.base}/api/files/public/${fileId}`)).status, 404, 'الملف الخاص لا يُخدَم كعام');
  // الملف مرتبط بالمستخدم: مستخدم آخر بالرابط نفسه لا يهم (التوقيع يحمل u) لكن قراءته المباشرة تبقى معاينة
  const other = await c.student('93000003');
  assert.equal((await c.api(`/api/books/${bookId}/read`, { token: other.token })).json.kind, 'preview');
  // الشراء المكرّر يُرفض
  const again = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(again.status, 409);
  // سجّل المبيعات والأرباح من صفوف حقيقية
  assert.equal(c.q.val('SELECT sales_count FROM books WHERE id = ?', bookId), 1);
  const earn = c.q.get<any>("SELECT * FROM teacher_earnings WHERE teacher_id = ? AND source_type = 'book'", t.id);
  assert.equal(earn.gross, 3); assert.equal(earn.commission, 0.6); assert.equal(earn.net, 2.4); assert.equal(earn.status, 'pending');
});

test('كتاب بلا معاينة → 402؛ الكتاب المجاني متاح كاملاً', async () => {
  const t = await c.teacher('93000011');
  const s = await c.student('93000012');
  const paid = c.book(t.id, { price: 2, withPreview: false });
  const r = await c.api(`/api/books/${paid}/read`, { token: s.token });
  assert.equal(r.status, 402); assert.equal(r.json.error.code, 'payment_required');
  const free = c.book(t.id, { price: 0, withPreview: false });
  assert.equal((await c.api(`/api/books/${free}/read`, { token: s.token })).json.kind, 'full');
});

test('الدفع بالمحفظة يخصم فوراً ويمنح الوصول؛ الرصيد غير الكافي يُرفض', async () => {
  const t = await c.teacher('93000021');
  const s = await c.student('93000022');
  const bookId = c.book(t.id, { price: 5 });
  const poor = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(poor.status, 400); assert.equal(poor.json.error.code, 'insufficient_funds');
  const w = await import('../src/services/wallet.ts');
  w.credit(s.id, 10, { note: 'test' });
  const ok = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(ok.status, 200); assert.equal(ok.json.paid, true);
  assert.equal(w.balance(s.id), 5);
  assert.equal((await c.api(`/api/books/${bookId}/read`, { token: s.token })).json.kind, 'full');
});

test('الكوبون يخصم ويُحتسب مرة واحدة لكل مستخدم', async () => {
  const t = await c.teacher('93000031');
  const s = await c.student('93000032');
  const bookId = c.book(t.id, { price: 10 });
  c.q.run("INSERT INTO coupons (code, type, value, user_limit, scope) VALUES ('HALF','percentage',50,1,'{}')");
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 20, {});
  const quote = await c.api('/api/checkout/quote', { method: 'POST', token: s.token, body: { items: [{ itemType: 'book', itemId: bookId }], couponCode: 'half' } });
  assert.equal(quote.json.total, 5);
  const ok = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', items: [{ itemType: 'book', itemId: bookId }], couponCode: 'HALF' } });
  assert.equal(ok.json.order.total, 5);
  const b2 = c.book(t.id, { price: 4 });
  const again = await c.api('/api/checkout/quote', { method: 'POST', token: s.token, body: { items: [{ itemType: 'book', itemId: b2 }], couponCode: 'HALF' } });
  assert.equal(again.status, 400);
});

test('الدورة: درس المعاينة مفتوح، الدرس المقفل 402 قبل الاشتراك، وتقدّم الدورة يُحسب من الدروس المكتملة', async () => {
  const t = await c.teacher('93000041');
  const s = await c.student('93000042');
  const { id, previewLessonId, lockedLessonId } = c.course(t.id, { price: 9 });
  const detail = await c.api(`/api/courses/${id}`, { token: s.token });
  assert.equal(detail.json.enrolled, false);
  assert.deepEqual(detail.json.sections[0].lessons.map((l: any) => l.locked), [false, true]);
  assert.equal((await c.api(`/api/courses/${id}/lessons/${previewLessonId}`, { token: s.token })).status, 200);
  assert.equal((await c.api(`/api/courses/${id}/lessons/${lockedLessonId}`, { token: s.token })).status, 402);
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 10, {});
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', items: [{ itemType: 'course', itemId: id }] } });
  assert.equal((await c.api(`/api/courses/${id}/lessons/${lockedLessonId}`, { token: s.token })).status, 200);
  await c.api(`/api/courses/lessons/${previewLessonId}/progress`, { method: 'PUT', token: s.token, body: { positionSeconds: 590 } });
  const after = await c.api(`/api/courses/${id}`, { token: s.token });
  assert.equal(after.json.progressPercent, 50);
  assert.equal(after.json.sections[0].lessons[0].completed, true);
});

test('التقييم مقفل بتجربة حقيقية', async () => {
  const t = await c.teacher('93000051');
  const s = await c.student('93000052');
  const bookId = c.book(t.id, { price: 1 });
  const denied = await c.api('/api/reviews', { method: 'POST', token: s.token, body: { targetType: 'book', targetId: bookId, rating: 5 } });
  assert.equal(denied.status, 403);
  const denied2 = await c.api('/api/reviews', { method: 'POST', token: s.token, body: { targetType: 'teacher', targetId: t.id, rating: 5 } });
  assert.equal(denied2.status, 403);
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 5, {});
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', items: [{ itemType: 'book', itemId: bookId }] } });
  const ok = await c.api('/api/reviews', { method: 'POST', token: s.token, body: { targetType: 'book', targetId: bookId, rating: 4, comment: 'جيد' } });
  assert.equal(ok.status, 201);
  assert.equal(c.q.val('SELECT rating_avg FROM books WHERE id = ?', bookId), 4);
  const dup = await c.api('/api/reviews', { method: 'POST', token: s.token, body: { targetType: 'book', targetId: bookId, rating: 5 } });
  assert.equal(dup.status, 409);
});
