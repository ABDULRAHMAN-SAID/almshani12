import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

/** الـ webhooks صارت مُحفِّزات: التنفيذ لا يتمّ إلا بعد سؤال المزوّد عن الجلسة — هنا مزوّد مزيّف يقول «مدفوعة» لكل جلسة */
Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_x', THAWANI_SECRET_KEY: 'sk' });
const realFetch = globalThis.fetch;
const fakeFetch = (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!/thawani\.om|stripe\.com/.test(url)) return realFetch(input, init);
  const id = url.split('/').pop()!;
  const body = url.includes('thawani') ? { success: true, data: { session_id: id, payment_status: 'paid' } } : { id, payment_status: 'paid' };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};

let c: Ctx;
before(async () => { c = await boot(); globalThis.fetch = fakeFetch as typeof fetch; });
after(() => { globalThis.fetch = realFetch; c.close(); });

const stripeSig = (raw: string) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex')}`; };

test('Stripe webhook: توقيع خاطئ يُرفض؛ الصحيح ينفّذ الطلب مرة واحدة فقط', async () => {
  const t = await c.teacher('98000001');
  const s = await c.student('98000002');
  const bookId = c.book(t.id, { price: 4 });
  const co = await import('../src/services/checkout.ts');
  const order = co.createOrder(s.id, { items: [{ type: 'book', id: bookId }] });
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 4000, metadata: { order_id: String(order.id) } } } });
  const bad = await c.api('/api/payments/webhook/stripe', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' } });
  assert.equal(bad.status, 400);
  assert.equal(c.q.val('SELECT status FROM orders WHERE id = ?', order.id), 'pending');
  const wrongAmount = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 100, metadata: { order_id: String(order.id) } } } });
  assert.equal((await c.api('/api/payments/webhook/stripe', { method: 'POST', body: wrongAmount, headers: { 'Content-Type': 'application/json', 'stripe-signature': stripeSig(wrongAmount) } })).status, 400);
  const ok = await c.api('/api/payments/webhook/stripe', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'stripe-signature': stripeSig(payload) } });
  assert.equal(ok.status, 200);
  assert.equal(c.q.val('SELECT status FROM orders WHERE id = ?', order.id), 'paid');
  assert.equal(c.q.val('SELECT COUNT(*) FROM entitlements WHERE user_id = ? AND item_id = ?', s.id, bookId), 1);
  // التكرار لا يضاعف الأرباح
  await c.api('/api/payments/webhook/stripe', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'stripe-signature': stripeSig(payload) } });
  assert.equal(c.q.val('SELECT COUNT(*) FROM teacher_earnings WHERE order_id = ?', order.id), 1);
});

test('Thawani webhook بتوقيع HMAC', async () => {
  const t = await c.teacher('98000011');
  const s = await c.student('98000012');
  const bookId = c.book(t.id, { price: 2 });
  const co = await import('../src/services/checkout.ts');
  const order = co.createOrder(s.id, { items: [{ type: 'book', id: bookId }] });
  const payload = JSON.stringify({ client_reference_id: order.number, payment_status: 'paid', session_id: 'sess_1' });
  const sig = crypto.createHmac('sha256', 'thawani_test').update(payload).digest('hex');
  assert.equal((await c.api('/api/payments/webhook/thawani', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'thawani-signature': 'bad' } })).status, 400);
  assert.equal((await c.api('/api/payments/webhook/thawani', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'thawani-signature': sig } })).status, 200);
  assert.equal(c.q.val('SELECT status FROM orders WHERE id = ?', order.id), 'paid');
});

test('التحويل البنكي: ينتظر تأكيد المالية؛ الاسترجاع يسحب الوصول ويعكس الربح ويقيّد المحفظة', async () => {
  const t = await c.teacher('98000021');
  const s = await c.student('98000022');
  const finance = await c.staff('98000023', 'finance');
  const bookId = c.book(t.id, { price: 6 });
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'manual', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(ck.json.awaitingReview, true); assert.ok(ck.json.instructions.iban);
  assert.equal((await c.api(`/api/books/${bookId}/read`, { token: s.token })).json.kind, 'preview');
  const orderId = ck.json.order.id;
  assert.equal((await c.api(`/api/admin/orders/${orderId}/confirm-manual`, { method: 'POST', token: s.token })).status, 403);
  const conf = await c.api(`/api/admin/orders/${orderId}/confirm-manual`, { method: 'POST', token: finance.token, body: { reference: 'TRX123' } });
  assert.equal(conf.status, 200); assert.equal(conf.json.status, 'paid');
  assert.equal((await c.api(`/api/books/${bookId}/read`, { token: s.token })).json.kind, 'full');
  const earnings = await import('../src/services/earnings.ts');
  assert.equal(earnings.releaseEarnings(), 0, 'لم تمرّ نافذة الاحتجاز بعد');
  c.q.run("UPDATE teacher_earnings SET available_at = ? WHERE order_id = ?", new Date(Date.now() - 1000).toISOString(), orderId);
  assert.equal(earnings.releaseEarnings(), 1);
  assert.equal(c.q.val('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', t.id), 4.8);
  const refund = await c.api(`/api/admin/orders/${orderId}/refund`, { method: 'POST', token: finance.token, body: { reason: 'طلب العميل' } });
  assert.equal(refund.status, 200); assert.equal(refund.json.status, 'refunded');
  assert.equal((await c.api(`/api/books/${bookId}/read`, { token: s.token })).json.kind, 'preview');
  const w = await import('../src/services/wallet.ts');
  assert.equal(w.balance(s.id), 6);
  assert.equal(c.q.val('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', t.id), 0);
  assert.equal(c.q.val("SELECT status FROM teacher_earnings WHERE order_id = ?", orderId), 'reversed');
  assert.ok(c.q.get("SELECT 1 FROM audit_logs WHERE action = 'order.refund' AND entity_id = ?", orderId));
});

test('طلب السحب: الحدّ الأدنى والرصيد، ثم صرفه من المالية', async () => {
  const t = await c.teacher('98000031');
  const finance = await c.staff('98000032', 'finance');
  c.q.run('UPDATE teacher_profiles SET available_balance = 25 WHERE user_id = ?', t.id);
  c.q.run("INSERT INTO teacher_earnings (teacher_id, source_type, source_id, gross, commission, net, status) VALUES (?,?,1,31.25,6.25,25,'available')", t.id, 'book');
  assert.equal((await c.api('/api/teacher/payouts', { method: 'POST', token: t.token, body: { amount: 5 } })).status, 400, 'أقل من الحدّ الأدنى');
  assert.equal((await c.api('/api/teacher/payouts', { method: 'POST', token: t.token, body: { amount: 40 } })).status, 400, 'أكثر من الرصيد');
  const ok = await c.api('/api/teacher/payouts', { method: 'POST', token: t.token, body: { amount: 20, method: 'bank', details: { iban: 'OM00' } } });
  assert.equal(ok.status, 201);
  assert.equal(c.q.val('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', t.id), 5);
  assert.equal((await c.api('/api/teacher/payouts', { method: 'POST', token: t.token, body: { amount: 12 } })).status, 409, 'طلب قيد المعالجة');
  const paid = await c.api(`/api/admin/payouts/${ok.json.id}/decision`, { method: 'POST', token: finance.token, body: { decision: 'paid' } });
  assert.equal(paid.status, 200);
  assert.equal(c.q.val("SELECT status FROM teacher_earnings WHERE teacher_id = ?", t.id), 'paid');
  const e = await c.api('/api/teacher/earnings', { token: t.token });
  assert.equal(e.json.payouts[0].status, 'paid');
});

test('طلب بقيمة صفر (كوبون كامل) يُنفَّذ بلا بوابة؛ الطلبات المنتهية تُغلق', async () => {
  const t = await c.teacher('98000041');
  const s = await c.student('98000042');
  const bookId = c.book(t.id, { price: 3 });
  c.q.run("INSERT INTO coupons (code, type, value, scope) VALUES ('FULL','percentage',100,'{}')");
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', items: [{ itemType: 'book', itemId: bookId }], couponCode: 'FULL' } });
  assert.equal(ck.json.paid, true); assert.equal(ck.json.order.total, 0);
  const b2 = c.book(t.id, { price: 2 });
  const co = await import('../src/services/checkout.ts');
  const order = co.createOrder(s.id, { items: [{ type: 'book', id: b2 }] });
  c.q.run('UPDATE orders SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), order.id);
  assert.equal(co.expirePendingOrders(), 1);
  assert.equal(c.q.val('SELECT status FROM orders WHERE id = ?', order.id), 'expired');
});
