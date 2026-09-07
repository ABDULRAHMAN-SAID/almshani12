import { Router, raw, json as jsonBody } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AddToCart, ApplyCoupon, CheckoutRequest, OrderConfirmRequest, formatMoney } from '@manassah/shared';
import { config } from '../config.ts';
import { db, q, settings, nowIso } from '../db/index.ts';
import { AppError, asyncHandler, notFound, forbidden, badRequest } from '../lib/errors.ts';
import { validate, body, idParam } from '../lib/validate.ts';
import { requireAuth, attachUser } from '../lib/auth.ts';
import { money } from '../lib/helpers.ts';
import { orderView } from '../lib/views.ts';
import { resolveItem, quote, createOrder, fulfillOrder, expirePendingOrders } from '../services/checkout.ts';
import { getProvider, providerCatalog, verifyStripeSignature, verifyThawaniSignature, confirmOrderWithProvider, expectedMinor } from '../services/payments.ts';
import * as wallet from '../services/wallet.ts';
import { publicUrl } from '../services/storage.ts';
import { notifyStaff } from '../services/notifications.ts';
import { requireLearner, resolveLearner } from '../services/learners.ts';
import { audit } from '../lib/audit.ts';

/** الطلب مع المتعلّم المنسوب إليه (LearnerRef أو null) — الملكية والوصول للحساب */

/* ============ السلة ============ */
export const cartRouter = Router();
cartRouter.use(requireAuth);

function cartView(userId: number) {
  const rows = q.all<any>('SELECT * FROM cart_items WHERE user_id = ? ORDER BY id', userId);
  const items = rows.map(r => {
    const it = resolveItem(r.item_type, r.item_id);
    if (!it) { q.run('DELETE FROM cart_items WHERE id = ?', r.id); return null; }
    const teacherName = it.teacherId ? q.val<string>('SELECT display_name FROM profiles WHERE user_id = ?', it.teacherId) ?? null : null;
    return { id: r.id, itemType: r.item_type, itemId: r.item_id, title: it.title, coverUrl: publicUrl(it.coverFileId), price: it.price, listPrice: it.listPrice, teacherName };
  }).filter(Boolean) as any[];
  const couponCode = q.val<string | null>('SELECT coupon_code FROM carts WHERE user_id = ?', userId) ?? null;
  let calc = { subtotal: 0, discount: 0, tax: 0, taxRate: settings.get<number>('tax_rate'), total: 0, coupon: null as any };
  if (items.length) {
    try { calc = quote({ items: items.map(i => ({ type: i.itemType, id: i.itemId })), couponCode, userId }) as any; }
    catch { q.run('UPDATE carts SET coupon_code = NULL WHERE user_id = ?', userId); calc = quote({ items: items.map(i => ({ type: i.itemType, id: i.itemId })), userId }) as any; }
  }
  return {
    items, subtotal: money(calc.subtotal), discount: money(calc.discount), tax: money(calc.tax), taxRate: calc.taxRate, total: money(calc.total), currency: config.money.currency,
    coupon: calc.coupon ? { code: calc.coupon.code, type: calc.coupon.type, value: calc.coupon.value } : null,
  };
}
cartRouter.get('/', (req, res) => res.json(cartView(req.user!.id)));
cartRouter.post('/items', validate(AddToCart), (req, res) => {
  const { itemType, itemId } = body<typeof AddToCart>(req);
  const it = resolveItem(itemType, itemId);
  if (!it) throw notFound('العنصر غير متاح');
  q.run('INSERT OR IGNORE INTO cart_items (user_id, item_type, item_id) VALUES (?,?,?)', req.user!.id, itemType, itemId);
  q.run('INSERT INTO carts (user_id) VALUES (?) ON CONFLICT(user_id) DO UPDATE SET updated_at = ?', req.user!.id, nowIso());
  res.status(201).json(cartView(req.user!.id));
});
cartRouter.delete('/items/:id', (req, res) => {
  q.run('DELETE FROM cart_items WHERE id = ? AND user_id = ?', idParam(req), req.user!.id);
  res.json(cartView(req.user!.id));
});
cartRouter.post('/coupon', validate(ApplyCoupon), (req, res) => {
  const { code } = body<typeof ApplyCoupon>(req);
  const uid = req.user!.id;
  if (code) {
    const items = q.all<any>('SELECT item_type AS type, item_id AS id FROM cart_items WHERE user_id = ?', uid);
    if (!items.length) throw badRequest('السلة فارغة');
    quote({ items, couponCode: code, userId: uid }); // يرمي خطأً واضحاً إن كان الرمز غير صالح
  }
  q.run('INSERT INTO carts (user_id, coupon_code) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET coupon_code = excluded.coupon_code, updated_at = ?', uid, code ? code.toUpperCase() : null, nowIso());
  res.json(cartView(uid));
});

/* ============ الدفع ============ */
export const checkoutRouter = Router();
checkoutRouter.get('/methods', requireAuth, (req, res) => {
  const methods = providerCatalog().map(m => m.id === 'wallet' ? { ...m, description: `الرصيد المتاح: ${formatMoney(wallet.balance(req.user!.id))}` } : m);
  res.json(methods);
});

checkoutRouter.post('/', requireAuth, validate(CheckoutRequest), asyncHandler(async (req, res) => {
  const c = body<typeof CheckoutRequest>(req);
  const uid = req.user!.id;
  // نسبة الطلب لمتعلّم: صريح (يجب أن يكون في الحساب) وإلا النشط إن وُجد
  const learnerId = c.learnerId ? requireLearner(req, c.learnerId).id : resolveLearner(req)?.id ?? null;
  let order: any;
  if (c.bookingId) {
    const b = q.get<any>('SELECT * FROM bookings WHERE id = ?', c.bookingId);
    if (!b || b.student_id !== uid) throw notFound('الحجز غير موجود');
    if (b.status !== 'pending_payment') throw new AppError('conflict', 'هذا الحجز لا ينتظر دفعاً', 409);
    if (b.expires_at && b.expires_at < nowIso()) throw new AppError('slot_expired', 'انتهت مهلة إتمام الحجز', 409);
    // طلب فشلت بوابته يُعاد فتحه للمحاولة ما دام الحجز نفسه قائماً
    order = q.get<any>("SELECT * FROM orders WHERE id = ? AND status IN ('pending','failed')", b.order_id);
    if (!order) throw new AppError('slot_expired', 'انتهت مهلة إتمام الحجز', 409);
    if (order.status === 'failed') {
      q.run("UPDATE orders SET status = 'pending', expires_at = ? WHERE id = ?", b.expires_at, order.id);
      order = q.get<any>('SELECT * FROM orders WHERE id = ?', order.id);
    }
  } else if (c.items?.length) {
    order = createOrder(uid, { items: c.items.map(i => ({ type: i.itemType as any, id: i.itemId })), couponCode: c.couponCode ?? null, learnerId });
  } else {
    const items = q.all<any>('SELECT item_type AS type, item_id AS id FROM cart_items WHERE user_id = ?', uid);
    if (!items.length) throw badRequest('السلة فارغة');
    const couponCode = c.couponCode ?? q.val<string | null>('SELECT coupon_code FROM carts WHERE user_id = ?', uid) ?? null;
    order = createOrder(uid, { items, couponCode, learnerId });
  }

  // طلب بقيمة صفر (كوبون كامل / محتوى مجاني) يُنفَّذ فوراً
  if (money(order.total) <= 0) {
    const { order: paid } = fulfillOrder(order.id, { provider: 'free' });
    return res.json({ order: orderView(paid), paid: true, requiresRedirect: false, checkoutUrl: null, awaitingReview: false });
  }
  const provider = getProvider(c.provider);
  let session;
  try {
    session = await provider.createCheckout(order);
  } catch (err) {
    // لا نترك طلباً معلّقاً بلا مزوّد: يُعلَّم «فاشلاً» فوراً ليعرضه التطبيق مع «حاول مجدداً» أو «إلغاء»
    q.run("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'", order.id);
    q.run("UPDATE payments SET status = 'failed' WHERE order_id = ? AND status = 'pending'", order.id);
    throw err;
  }
  // رابط البوابة يُحفَظ مع الدفعة كي تعرضه صفحة الطلب لاحقاً («افتح بوابة الدفع») بدل ضياعه مع الاستجابة
  if (session.checkoutUrl) q.run("UPDATE payments SET raw = json_set(COALESCE(raw, '{}'), '$.checkoutUrl', ?) WHERE order_id = ? AND status = 'pending'", session.checkoutUrl, order.id);
  if (session.settleImmediately) {
    const paid = db.transaction(() => {
      wallet.debit(uid, order.total, { type: 'purchase', refType: 'order', refId: order.id, note: `شراء ${order.number}` });
      return fulfillOrder(order.id, { provider: provider.id, providerRef: session.reference }).order;
    })();
    audit(req, 'order.paid_wallet', 'orders', order.id, { total: order.total });
    return res.json({ order: orderView(paid), paid: true, requiresRedirect: false, checkoutUrl: null, awaitingReview: false });
  }
  if (session.awaitingReview) {
    q.run('UPDATE orders SET expires_at = NULL WHERE id = ?', order.id);
    q.run("UPDATE bookings SET expires_at = NULL WHERE order_id = ? AND status = 'pending_payment'", order.id);
    notifyStaff(['finance', 'admin'], { type: 'system', title: 'تحويل بنكي بانتظار التأكيد', body: order.number, data: { orderId: order.id } });
    return res.json({ order: orderView(q.get<any>('SELECT * FROM orders WHERE id = ?', order.id)), paid: false, requiresRedirect: false, checkoutUrl: null, awaitingReview: true, instructions: session.instructions ?? null });
  }
  res.json({ order: orderView(q.get<any>('SELECT * FROM orders WHERE id = ?', order.id)), paid: false, requiresRedirect: true, checkoutUrl: session.checkoutUrl, awaitingReview: false });
}));

/** عرض السعر قبل الدفع (لصفحة تأكيد الحجز/الباقة) */
const QuoteBody = z.object({ items: z.array(z.object({ itemType: z.enum(['book', 'course', 'lesson', 'package']), itemId: z.number().int().positive() })).min(1), couponCode: z.string().max(40).nullable().optional() });
checkoutRouter.post('/quote', requireAuth, validate(QuoteBody), (req, res) => {
  const b = body<typeof QuoteBody>(req);
  const qu = quote({ items: b.items.map(i => ({ type: i.itemType, id: i.itemId })), couponCode: b.couponCode ?? null, userId: req.user!.id });
  res.json({ items: qu.items.map(i => ({ itemType: i.type, itemId: i.id, title: i.title, price: i.price, listPrice: i.listPrice })), subtotal: qu.subtotal, discount: qu.discount, tax: qu.tax, total: qu.total, currency: config.money.currency });
});

/* ============ الطلبات ============ */
export const ordersRouter = Router();
ordersRouter.use(requireAuth);
ordersRouter.get('/', (req, res) => res.json(q.all<any>('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user!.id).map(orderView)));
ordersRouter.get('/:number', (req, res) => {
  const o = q.get<any>('SELECT * FROM orders WHERE number = ? OR id = ?', req.params.number, Number(req.params.number) || 0);
  if (!o) throw notFound('الطلب غير موجود');
  if (o.user_id !== req.user!.id && !req.user!.roles.some(r => ['admin', 'super_admin', 'finance', 'support'].includes(r))) throw forbidden();
  res.json(orderView(o));
});
/** إلغاء طلب لم يُدفع (فشل التحويل للبوابة أو عدول المستخدم) — يحرّر الحصة المعلّقة معه */
ordersRouter.post('/:number/cancel', (req, res) => {
  const o = q.get<any>('SELECT * FROM orders WHERE number = ?', req.params.number);
  if (!o) throw notFound('الطلب غير موجود');
  if (o.user_id !== req.user!.id) throw forbidden();
  if (!['pending', 'failed'].includes(o.status)) throw new AppError('conflict', 'لا يمكن إلغاء هذا الطلب', 409);
  db.transaction(() => {
    q.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", o.id);
    q.run("UPDATE payments SET status = 'failed' WHERE order_id = ? AND status = 'pending'", o.id);
    q.run("UPDATE bookings SET status = 'expired' WHERE order_id = ? AND status = 'pending_payment'", o.id);
  })();
  audit(req, 'order.cancelled', 'orders', o.id, { status: o.status });
  res.json(orderView(q.get<any>('SELECT * FROM orders WHERE id = ?', o.id)));
});

/** كل تأكيد قد يسأل البوابة فعلاً — حدّ لكل مستخدم (التطبيق يستطلع كل ٤ ثوانٍ) كي لا يُخنق مفتاح التاجر عند المزوّد */
const confirmLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => `u:${req.user?.id ?? 0}`, skip: () => !config.rateLimit.enabled,
  message: { error: { code: 'rate_limited', message: 'محاولات كثيرة — انتظر قليلاً' } } });
/** تأكيد الدفع من المزوّد (صفحات العودة والاستطلاع من التطبيق) — المالك فقط؛ sessionId تلميح اختياري من صفحة عودة Stripe */
ordersRouter.post('/:number/confirm', confirmLimiter, asyncHandler(async (req, res) => {
  const { sessionId } = OrderConfirmRequest.parse(req.body ?? {}); // الجسم اختياري (صفحات العودة قد لا ترسل شيئاً)
  const r = await confirmOrderWithProvider(req.params.number, { userId: req.user!.id, sessionId: sessionId ?? null });
  res.json({ ...r, order: orderView(q.get<any>('SELECT * FROM orders WHERE number = ?', req.params.number)) });
}));

/* ============ ردود بوابات الدفع (webhooks) ============ */
export const paymentsRouter = Router();
/**
 * الـ webhook مجرّد مُحفِّز: نتحقّق من التوقيع (حين يوجد سرّ)، ثم نسأل المزوّد عن الجلسة قبل أي تنفيذ —
 * جسم الطلب لا يُوثَق به وحده. نردّ 200 دائماً بعد التحقّق، وأي فشل يُسجَّل فقط (المزوّد يعيد المحاولة).
 */
const confirmFromWebhook = async (orderNumber: string, sessionId: string | null, provider: 'thawani' | 'stripe') => {
  try { const r = await confirmOrderWithProvider(orderNumber, { sessionId, provider }); return r.paid; }
  catch (err) { console.error(`[payments] webhook ${provider}`, orderNumber, (err as Error)?.message); return false; }
};

/** Stripe: التوقيع إلزامي؛ نقبل checkout.session.completed فقط */
paymentsRouter.post('/webhook/stripe', raw({ type: '*/*' }), asyncHandler(async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'] as string | undefined)) return res.status(400).json({ error: { code: 'forbidden', message: 'توقيع غير صالح' } });
  const event = JSON.parse(rawBody);
  if (event.type === 'checkout.session.completed') {
    const s = event.data?.object ?? {};
    const orderId = Number(s.metadata?.order_id);
    const order = q.get<any>('SELECT id, number, total, currency FROM orders WHERE id = ? OR number = ?', orderId || 0, String(s.client_reference_id ?? ''));
    if (!order) return res.status(404).json({ received: true });
    if (s.amount_total != null && expectedMinor(order, 'stripe') !== Number(s.amount_total)) return res.status(400).json({ error: { code: 'payment_failed', message: 'المبلغ لا يطابق الطلب' } });
    const paid = await confirmFromWebhook(order.number, typeof s.id === 'string' ? s.id : null, 'stripe');
    return res.json({ received: true, paid });
  }
  res.json({ received: true });
}));

/** Thawani (عُمان): التوقيع يُتحقّق حين يوجد THAWANI_WEBHOOK_SECRET؛ وبدونه الجسم مُحفِّز فقط والحقيقة من استعلام المزوّد */
paymentsRouter.post('/webhook/thawani', raw({ type: '*/*' }), asyncHandler(async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  if (!verifyThawaniSignature(rawBody, req.headers['thawani-signature'] as string | undefined)) return res.status(400).json({ error: { code: 'forbidden', message: 'توقيع غير صالح' } });
  const data = JSON.parse(rawBody);
  const ref = data?.client_reference_id ?? data?.data?.client_reference_id;
  const sessionId = data?.session_id ?? data?.data?.session_id ?? null;
  let paid = false;
  if (ref && q.get('SELECT 1 FROM orders WHERE number = ?', String(ref))) paid = await confirmFromWebhook(String(ref), typeof sessionId === 'string' ? sessionId : null, 'thawani');
  res.json({ received: true, paid });
}));

/** بوابة تجريبية (غير الإنتاج): تأكيد بالمرجع فقط */
const MockConfirm = z.object({ reference: z.string().min(4), outcome: z.enum(['success', 'fail']).default('success') });
paymentsRouter.post('/mock/confirm', jsonBody(), validate(MockConfirm), (req, res) => {
  if (config.env === 'production') throw notFound();
  const { reference, outcome } = body<typeof MockConfirm>(req);
  const p = q.get<any>("SELECT * FROM payments WHERE provider = 'mock' AND provider_ref = ?", reference);
  if (!p) throw notFound('مرجع الدفع غير موجود');
  if (outcome === 'fail') {
    q.run("UPDATE payments SET status = 'failed' WHERE id = ?", p.id);
    return res.json({ paid: false });
  }
  const { order } = fulfillOrder(p.order_id, { provider: 'mock', providerRef: reference });
  res.json({ paid: true, order: orderView(order) });
});

/** صفحة الدفع التجريبية — تُحاكي بوابة خارجية ثم تعود للتطبيق */
export const mockPayPage = Router();
mockPayPage.get('/pay/mock/:number', attachUser, (req, res) => {
  if (config.env === 'production') return res.status(404).end();
  const o = q.get<any>('SELECT id, number, total, currency, status FROM orders WHERE number = ?', req.params.number);
  if (!o) return res.status(404).send('الطلب غير موجود');
  // المرجع يُقرأ من دفعة الطلب لا من ?ref — أي انعكاس لمُدخل المستخدم داخل الصفحة كان ثغرة XSS
  const ref = q.val<string>("SELECT provider_ref FROM payments WHERE order_id = ? AND provider = 'mock' ORDER BY id DESC LIMIT 1", o.id) ?? '';
  const back = `${config.brand.scheme}://pay/success?order=${o.number}`;
  res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>بوابة دفع تجريبية</title>
<style>body{font-family:system-ui,'IBM Plex Sans Arabic',sans-serif;background:#F8F6F1;color:#171717;margin:0;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;border:1px solid #E6E1D6;border-radius:16px;padding:28px;width:min(420px,92vw)}h1{font-size:20px;margin:0 0 8px}p{color:#686868;margin:0 0 16px}
.amt{font-size:28px;font-weight:700;color:#9E1B32;margin:12px 0 20px}button{width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer}
.pay{background:#9E1B32;color:#fff}.fail{background:#F1EEE7;color:#171717;margin-top:8px}.note{font-size:12px;color:#9A9A9A;margin-top:16px}.ok{color:#287A59;font-weight:600}</style>
<div class="card"><h1>بوابة دفع تجريبية</h1><p>لا تُخصم أموال حقيقية — للتطوير فقط</p>
<div>الطلب <b>${o.number}</b></div><div class="amt">${o.total} ${o.currency}</div>
<div id="r"></div>
<button class="pay" onclick="go('success')">ادفع الآن</button><button class="fail" onclick="go('fail')">محاكاة فشل الدفع</button>
<div class="note">بعد الدفع ارجع للتطبيق — سيتحقّق من حالة الطلب تلقائياً.</div></div>
<script>
async function go(outcome){const r=await fetch('/api/payments/mock/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:${JSON.stringify(ref)},outcome})});
const j=await r.json();document.getElementById('r').innerHTML=j.paid?'<p class="ok">تم الدفع ✓ — يمكنك العودة للتطبيق</p>':'<p>فشل الدفع (محاكاة)</p>';
if(j.paid){setTimeout(()=>{try{window.location.href=${JSON.stringify(back)}}catch(e){}},600)}}
</script></html>`);
});

export { expirePendingOrders };
