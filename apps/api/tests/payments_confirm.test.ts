/**
 * تأكيد الدفع من المزوّد (ثواني UAT وStripe test): الجلسة تُنشأ عبر fetch مستبدل، والتأكيد يسأل المزوّد قبل التنفيذ —
 * جسم الـ webhook لا يُنفّذ طلباً ما لم يقل المزوّد «مدفوعة». المتغيّرات تُضبط قبل استيراد helpers لأن config يُقرأ مرة واحدة.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Ctx } from './helpers.ts';

Object.assign(process.env, {
  THAWANI_SECRET_KEY: 'sk', THAWANI_PUBLISHABLE_KEY: 'pk', THAWANI_MODE: 'uat',
  STRIPE_SECRET_KEY: 'sk_test_x', PAYMENT_PROVIDERS: 'thawani,stripe,wallet,manual,mock',
});
const { boot } = await import('./helpers.ts');
const { config } = await import('../src/config.ts');

/** حالة الجلسات كما «يراها» المزوّد المزيّف: order number → paid؟ */
const sessions: Record<string, { reference: string; paid: boolean; amountMinor: number }> = {};
const requests: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];
const realFetch = globalThis.fetch;
const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
let seq = 0;
function fakeFetch(input: string | URL | Request, init: RequestInit = {}) {
  const url = String(input instanceof Request ? input.url : input);
  if (!/thawani\.om|stripe\.com/.test(url)) return realFetch(input, init);
  const method = String(init.method ?? 'GET'), body = String(init.body ?? '');
  requests.push({ url, method, body, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)) });
  const m = url.match(/checkout\/sessions?\/([^/?]+)$/);
  if (url.includes('thawani.om')) {
    if (method === 'POST') {
      const j = JSON.parse(body); const id = `sess_${++seq}`;
      sessions[id] = { reference: j.client_reference_id, paid: false, amountMinor: j.products.reduce((s: number, p: any) => s + p.unit_amount * p.quantity, 0) };
      return reply(200, { success: true, code: 2004, data: { session_id: id } });
    }
    const s = m && sessions[m[1]];
    if (!s) return reply(404, { success: false, code: 4404, description: 'not found' });
    return reply(200, { success: true, data: { session_id: m![1], client_reference_id: s.reference, payment_status: s.paid ? 'paid' : 'unpaid', total_amount: s.amountMinor } });
  }
  if (method === 'POST') {
    const f = new URLSearchParams(body); const id = `cs_${++seq}`;
    sessions[id] = { reference: f.get('client_reference_id')!, paid: false, amountMinor: Number(f.get('line_items[0][price_data][unit_amount]')) };
    return reply(200, { id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  const s = m && sessions[m[1]];
  if (!s) return reply(404, { error: { type: 'invalid_request_error', message: 'No such session' } });
  return reply(200, { id: m![1], client_reference_id: s.reference, payment_status: s.paid ? 'paid' : 'unpaid', amount_total: s.amountMinor });
}

let c: Ctx;
before(async () => { c = await boot(); globalThis.fetch = fakeFetch as typeof fetch; });
after(() => { globalThis.fetch = realFetch; c.close(); });

const orderStatus = (id: number) => c.q.val<string>('SELECT status FROM orders WHERE id = ?', id);
const owns = (userId: number, bookId: number) => c.q.val<number>('SELECT COUNT(*) FROM entitlements WHERE user_id = ? AND item_id = ?', userId, bookId);
const confirm = (number: string, token: string, body?: unknown) => c.api(`/api/orders/${number}/confirm`, { method: 'POST', token, body });
const thawaniSig = (raw: string) => crypto.createHmac('sha256', 'thawani_test').update(raw).digest('hex');
const stripeSig = (raw: string) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex')}`; };

test('كتالوج الوسائل يحمل وضع البوابة: ثواني uat وStripe test والمحفظة بلا وضع', async () => {
  const s = await c.student('97000001');
  const r = await c.api('/api/checkout/methods', { token: s.token });
  assert.equal(r.status, 200);
  const modes = Object.fromEntries(r.json.map((m: any) => [m.id, m.mode]));
  assert.deepEqual(modes, { thawani: 'uat', stripe: 'test', wallet: null, manual: null, mock: null });
});

test('ثواني: الجلسة على uatcheckout؛ التأكيد غير المدفوع لا يمنح شيئاً؛ المدفوع ينفّذ مرة واحدة', async () => {
  const t = await c.teacher('97000011');
  const s = await c.student('97000012');
  const bookId = c.book(t.id, { price: 4 });
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'thawani', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(ck.status, 200); assert.equal(ck.json.requiresRedirect, true);
  assert.match(ck.json.checkoutUrl, /^https:\/\/uatcheckout\.thawani\.om\/pay\/sess_\d+\?key=pk$/);
  const created = requests.at(-1)!;
  assert.equal(created.url, 'https://uatcheckout.thawani.om/api/v1/checkout/session');
  assert.equal(created.headers['thawani-api-key'], 'sk');
  assert.deepEqual(JSON.parse(created.body).products.map((p: any) => p.unit_amount * p.quantity), [4000], 'سطر واحد بالإجمالي بالبيسة');
  const order = ck.json.order;
  const sessionId = c.q.val<string>('SELECT provider_ref FROM orders WHERE id = ?', order.id)!;

  const r1 = await confirm(order.number, s.token);
  assert.equal(r1.status, 200); assert.equal(r1.json.paid, false); assert.equal(r1.json.status, 'pending'); assert.equal(r1.json.provider, 'thawani');
  assert.equal(orderStatus(order.id), 'pending'); assert.equal(owns(s.id, bookId), 0);
  assert.equal(requests.at(-1)!.url, `https://uatcheckout.thawani.om/api/v1/checkout/session/${sessionId}`);
  assert.equal(requests.at(-1)!.method, 'GET');

  // غير المالك ممنوع
  const other = await c.student('97000013');
  assert.equal((await confirm(order.number, other.token)).status, 403);

  sessions[sessionId].paid = true;
  const r2 = await confirm(order.number, s.token);
  assert.equal(r2.json.paid, true); assert.equal(r2.json.status, 'paid'); assert.equal(r2.json.order.status, 'paid');
  assert.equal(owns(s.id, bookId), 1);
  assert.equal(c.q.val('SELECT status FROM payments WHERE order_id = ?', order.id), 'succeeded');
  assert.ok(c.q.get("SELECT 1 FROM audit_logs WHERE action = 'order.paid_confirm' AND entity_id = ?", order.id));

  const before = requests.length;
  const r3 = await confirm(order.number, s.token);
  assert.equal(r3.json.paid, true);
  assert.equal(requests.length, before, 'طلب مدفوع لا يسأل المزوّد مجدّداً');
  assert.equal(c.q.val('SELECT COUNT(*) FROM teacher_earnings WHERE order_id = ?', order.id), 1, 'التكرار لا يضاعف الأرباح');
  assert.equal(c.q.val("SELECT COUNT(*) FROM audit_logs WHERE action = 'order.paid_confirm' AND entity_id = ?", order.id), 1);
});

test('webhook ثواني يدّعي الدفع لكن المزوّد يقول غير مدفوعة → لا تنفيذ؛ وحين يؤكّد المزوّد يُنفَّذ', async () => {
  const t = await c.teacher('97000021');
  const s = await c.student('97000022');
  const bookId = c.book(t.id, { price: 2 });
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'thawani', items: [{ itemType: 'book', itemId: bookId }] } });
  const order = ck.json.order;
  const sessionId = c.q.val<string>('SELECT provider_ref FROM orders WHERE id = ?', order.id)!;
  const payload = JSON.stringify({ client_reference_id: order.number, payment_status: 'paid', session_id: sessionId });
  const hook = await c.api('/api/payments/webhook/thawani', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'thawani-signature': thawaniSig(payload) } });
  assert.equal(hook.status, 200); assert.equal(hook.json.paid, false);
  assert.equal(orderStatus(order.id), 'pending'); assert.equal(owns(s.id, bookId), 0);
  sessions[sessionId].paid = true;
  const hook2 = await c.api('/api/payments/webhook/thawani', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'thawani-signature': thawaniSig(payload) } });
  assert.equal(hook2.json.paid, true);
  assert.equal(orderStatus(order.id), 'paid'); assert.equal(owns(s.id, bookId), 1);
});

test('جلسة تخصّ طلباً آخر لا تنفّذ هذا الطلب؛ وجلسة غير مدفوعة أقدم من ٣٠ دقيقة تُنهي الطلب', async () => {
  const t = await c.teacher('97000031');
  const s = await c.student('97000032');
  const b1 = c.book(t.id, { price: 3 }), b2 = c.book(t.id, { price: 5 });
  const o1 = (await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'thawani', items: [{ itemType: 'book', itemId: b1 }] } })).json.order;
  const o2 = (await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'thawani', items: [{ itemType: 'book', itemId: b2 }] } })).json.order;
  const sess1 = c.q.val<string>('SELECT provider_ref FROM orders WHERE id = ?', o1.id)!;
  sessions[sess1].paid = true;
  // تزوير: مرجع الطلب ٢ مع جلسة الطلب ١ المدفوعة
  c.q.run('UPDATE payments SET provider_ref = ? WHERE order_id = ?', sess1, o2.id);
  c.q.run('UPDATE orders SET provider_ref = ? WHERE id = ?', sess1, o2.id);
  const r = await confirm(o2.number, s.token);
  assert.equal(r.json.paid, false); assert.equal(orderStatus(o2.id), 'pending'); assert.equal(owns(s.id, b2), 0);
  // انتهاء المهلة: الجلسة أُنشئت قبل ٣١ دقيقة وما زالت غير مدفوعة
  c.q.run('UPDATE payments SET provider_ref = ?, created_at = ? WHERE order_id = ?', `sess_none_${o2.id}`, new Date(Date.now() - 31 * 60_000).toISOString().replace('T', ' ').slice(0, 19), o2.id);
  sessions[`sess_none_${o2.id}`] = { reference: o2.number, paid: false, amountMinor: 5000 };
  const r2 = await confirm(o2.number, s.token);
  assert.equal(r2.json.status, 'expired'); assert.equal(r2.json.paid, false);
  assert.equal(orderStatus(o2.id), 'expired');
  assert.equal(c.q.val('SELECT status FROM payments WHERE order_id = ?', o2.id), 'failed');
  // دفع بعد انتهاء المهلة: المال أُخذ فعلاً → يُنفَّذ الطلب ويُنبَّه الماليّون (لا مال بلا مقابل)
  const finance = await c.staff('97000039', 'finance');
  sessions[`sess_none_${o2.id}`].paid = true;
  const r3 = await confirm(o2.number, s.token);
  assert.equal(r3.json.status, 'paid'); assert.equal(orderStatus(o2.id), 'paid'); assert.equal(owns(s.id, b2), 1);
  assert.match(String(c.q.val("SELECT meta FROM audit_logs WHERE action = 'order.paid_confirm' AND entity_id = ?", o2.id) ?? ''), /"afterExpiry":true/);
  assert.ok(c.q.get("SELECT 1 FROM notifications WHERE user_id = ? AND title = 'دفع بعد انتهاء مهلة الطلب'", finance.id));
  // Stripe: الجلسة نفسها تنتهي عند المزوّد بعد ٣١ دقيقة كي توافق المهلة
  const st = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'stripe', items: [{ itemType: 'book', itemId: c.book(t.id, { price: 1 }) }] } });
  assert.equal(st.status, 200);
  const exp = Number(new URLSearchParams(requests.at(-1)!.body).get('expires_at'));
  assert.ok(Math.abs(exp - (Date.now() / 1000 + 31 * 60)) < 30, String(exp));
});

test('كوبون + ضريبة: البوابة تتلقّى إجمالي الطلب لا أسعار العناصر، والتأكيد ينفّذ', async () => {
  const t = await c.teacher('97000051');
  const s = await c.student('97000052');
  const b1 = c.book(t.id, { price: 10 }), b2 = c.book(t.id, { price: 6 });
  c.q.run("INSERT INTO coupons (code, type, value, scope, user_limit) VALUES ('HALF','percentage',50,'{}', NULL)");
  c.settings.set('tax_rate', 0.05);
  try {
    for (const provider of ['thawani', 'stripe'] as const) {
      const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider, items: [{ itemType: 'book', itemId: b1 }, { itemType: 'book', itemId: b2 }], couponCode: 'HALF' } });
      assert.equal(ck.status, 200, ck.text);
      const order = ck.json.order;
      assert.equal(order.total, 8.4, 'الإجمالي = (16 - 8) × 1.05');
      const sessionId = c.q.val<string>('SELECT provider_ref FROM orders WHERE id = ?', order.id)!;
      assert.equal(sessions[sessionId].amountMinor, 8400, `${provider}: المبلغ المرسل للبوابة = الإجمالي بالبيسة`);
      sessions[sessionId].paid = true;
      const r = await confirm(order.number, s.token, provider === 'stripe' ? { sessionId } : undefined);
      assert.equal(r.json.paid, true, provider); assert.equal(orderStatus(order.id), 'paid');
      c.q.run('DELETE FROM entitlements WHERE user_id = ?', s.id); // كي يُشترى الكتابان مجدّداً بالمزوّد التالي
    }
  } finally { c.settings.set('tax_rate', 0); }
});

test('webhook ثواني بلا THAWANI_WEBHOOK_SECRET: يُقبل كمُحفِّز والحقيقة من المزوّد', async () => {
  const t = await c.teacher('97000061');
  const s = await c.student('97000062');
  const bookId = c.book(t.id, { price: 2 });
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'thawani', items: [{ itemType: 'book', itemId: bookId }] } });
  const order = ck.json.order;
  const sessionId = c.q.val<string>('SELECT provider_ref FROM orders WHERE id = ?', order.id)!;
  const payload = JSON.stringify({ client_reference_id: order.number, payment_status: 'paid', session_id: sessionId });
  const thawani = config.payments.thawani as { webhookSecret: string };
  const saved = thawani.webhookSecret; thawani.webhookSecret = '';
  try {
    const h1 = await c.api('/api/payments/webhook/thawani', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' } });
    assert.equal(h1.status, 200); assert.equal(h1.json.paid, false); assert.equal(orderStatus(order.id), 'pending');
    sessions[sessionId].paid = true;
    const h2 = await c.api('/api/payments/webhook/thawani', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' } });
    assert.equal(h2.json.paid, true); assert.equal(orderStatus(order.id), 'paid'); assert.equal(owns(s.id, bookId), 1);
  } finally { thawani.webhookSecret = saved; }
  // مع سرّ مضبوط يبقى التوقيع إلزامياً
  const bad = await c.api('/api/payments/webhook/thawani', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' } });
  assert.equal(bad.status, 400);
});

test('Stripe (sk_test_): success_url يحمل session_id؛ التأكيد بتلميح الجلسة؛ webhook مزيّف لا ينفّذ', async () => {
  const t = await c.teacher('97000041');
  const s = await c.student('97000042');
  const bookId = c.book(t.id, { price: 4 });
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'stripe', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(ck.status, 200);
  assert.match(ck.json.checkoutUrl, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_\d+$/);
  const created = requests.at(-1)!;
  assert.equal(created.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(created.headers.Authorization, 'Bearer sk_test_x');
  const order = ck.json.order;
  const successUrl = new URLSearchParams(created.body).get('success_url')!;
  assert.ok(successUrl.endsWith(`/pay/success?order=${order.number}&session_id={CHECKOUT_SESSION_ID}`), successUrl);
  const sessionId = c.q.val<string>('SELECT provider_ref FROM orders WHERE id = ?', order.id)!;

  assert.equal((await confirm(order.number, s.token, { sessionId })).json.paid, false);
  assert.equal(owns(s.id, bookId), 0);
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: sessionId, amount_total: 4000, client_reference_id: order.number, metadata: { order_id: String(order.id) } } } });
  const hook = await c.api('/api/payments/webhook/stripe', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'stripe-signature': stripeSig(payload) } });
  assert.equal(hook.status, 200); assert.equal(hook.json.paid, false);
  assert.equal(orderStatus(order.id), 'pending');

  sessions[sessionId].paid = true;
  const r = await confirm(order.number, s.token, { sessionId });
  assert.equal(r.json.paid, true); assert.equal(r.json.provider, 'stripe');
  assert.equal(owns(s.id, bookId), 1);
  assert.equal(requests.at(-1)!.url, `https://api.stripe.com/v1/checkout/sessions/${sessionId}`);
  assert.equal(requests.at(-1)!.method, 'GET');
});

test('/config يعرض المزوّدات المتاحة ووضع ثواني دون أي سرّ', async () => {
  const r = await c.api('/api/config');
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.json);
  assert.ok(!text.includes('sk_test_x') && !/"sk"/.test(text));
});
