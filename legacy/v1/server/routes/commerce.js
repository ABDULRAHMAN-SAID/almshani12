import express from 'express';
import config from '../config.js';
import { db, q } from '../db/database.js';
import { asyncHandler, AppError, notFound, forbidden } from '../middleware/error.js';
import { validate, z, priceField } from '../middleware/validate.js';
import { attachUser, requireAuth } from '../middleware/auth.js';
import { paginate, pageMeta, money, json } from '../utils/helpers.js';
import { quote, createOrder, fulfillOrder, refundOrder, resolveItem, activateSubscription } from '../services/checkout.js';
import * as walletSvc from '../services/wallet.js';
import { getProvider, providerCatalog, verifyStripeSignature } from '../services/payments.js';
import { notifyAdmins, notify } from '../services/notifications.js';
import { checkAccess } from '../services/access.js';

const router = express.Router();
const itemTypes = z.enum(['course', 'summary', 'live_session', 'bundle', 'plan']);

/* ============================ السلة ============================ */
function cartOf(userId) {
  const rows = q.all('SELECT * FROM cart_items WHERE user_id = ? ORDER BY id', userId);
  const items = [];
  for (const row of rows) {
    const item = resolveItem(row.item_type, row.item_id);
    if (item) items.push({ ...item, cart_item_id: row.id });
    else q.run('DELETE FROM cart_items WHERE id = ?', row.id); // تنظيف العناصر التي لم تعد متاحة
  }
  return items;
}

router.get('/cart', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const items = cartOf(req.user.id);
  const subtotal = money(items.reduce((s, i) => s + i.price, 0));
  res.json({
    items, subtotal,
    tax: money(subtotal * config.money.taxRate),
    total: money(subtotal * (1 + config.money.taxRate)),
    currency: config.money.currency,
  });
}));

router.post('/cart', attachUser, requireAuth, validate(z.object({
  item_type: itemTypes, item_id: z.coerce.number().int().positive(),
})), asyncHandler(async (req, res) => {
  const { item_type, item_id } = req.body;
  const item = resolveItem(item_type, item_id);
  if (!item) throw notFound('العنصر غير متاح للشراء');

  if (item_type !== 'plan') {
    const access = checkAccess(req.user.id, item_type, item_id, { user: req.user });
    if (access.allowed && ['purchase', 'owner', 'admin', 'bundle'].includes(access.reason)) {
      throw new AppError('تملك هذا المحتوى بالفعل', 409, 'already_owned');
    }
  }
  if (item_type === 'live_session') {
    const session = q.get('SELECT capacity FROM live_sessions WHERE id = ?', item_id);
    const booked = q.val("SELECT COUNT(*) AS c FROM live_bookings WHERE session_id = ? AND status NOT IN ('cancelled','refunded')", item_id);
    if (booked >= session.capacity) throw new AppError('اكتمل العدد في هذه الحصة', 409, 'session_full');
  }

  q.run('INSERT INTO cart_items (user_id, item_type, item_id) VALUES (?,?,?) ON CONFLICT DO NOTHING',
    req.user.id, item_type, item_id);
  res.status(201).json({ ok: true, count: q.val('SELECT COUNT(*) AS c FROM cart_items WHERE user_id = ?', req.user.id) });
}));

router.delete('/cart/:id', attachUser, requireAuth, asyncHandler(async (req, res) => {
  q.run('DELETE FROM cart_items WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));

router.delete('/cart', attachUser, requireAuth, asyncHandler(async (req, res) => {
  q.run('DELETE FROM cart_items WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
}));

/* ============================ قائمة الأمنيات ============================ */
router.get('/wishlist', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const rows = q.all('SELECT * FROM wishlist WHERE user_id = ? ORDER BY id DESC', req.user.id);
  res.json({ data: rows.map(r => ({ ...r, item: resolveItem(r.item_type, r.item_id) })).filter(r => r.item) });
}));

router.post('/wishlist', attachUser, requireAuth, validate(z.object({
  item_type: itemTypes, item_id: z.coerce.number().int().positive(),
})), asyncHandler(async (req, res) => {
  q.run('INSERT INTO wishlist (user_id, item_type, item_id) VALUES (?,?,?) ON CONFLICT DO NOTHING',
    req.user.id, req.body.item_type, req.body.item_id);
  res.status(201).json({ ok: true });
}));

router.delete('/wishlist/:type/:id', attachUser, requireAuth, asyncHandler(async (req, res) => {
  q.run('DELETE FROM wishlist WHERE user_id = ? AND item_type = ? AND item_id = ?',
    req.user.id, req.params.type, Number(req.params.id));
  res.json({ ok: true });
}));

/* ============================ التسعير والكوبون ============================ */
router.post('/quote', attachUser, requireAuth, validate(z.object({
  items: z.array(z.object({ item_type: itemTypes, item_id: z.coerce.number().int().positive() })).optional(),
  coupon: z.string().trim().max(40).optional().nullable(),
})), asyncHandler(async (req, res) => {
  const items = req.body.items?.length ? req.body.items : cartOf(req.user.id).map(i => ({ item_type: i.type, item_id: i.id }));
  if (!items.length) throw new AppError('السلة فارغة', 400, 'empty_cart');
  const result = quote({ items, couponCode: req.body.coupon, userId: req.user.id });
  res.json({ ...result, coupon: result.coupon ? { code: result.coupon.code, type: result.coupon.type, value: result.coupon.value } : null });
}));

/* ============================ إنشاء الطلب والدفع ============================ */
router.get('/payment-methods', asyncHandler(async (_req, res) => {
  res.json({ providers: providerCatalog(), currency: config.money.currency, symbol: config.money.symbol });
}));

router.post('/checkout', attachUser, requireAuth, validate(z.object({
  items: z.array(z.object({ item_type: itemTypes, item_id: z.coerce.number().int().positive() })).optional(),
  coupon: z.string().trim().max(40).optional().nullable(),
  provider: z.string().trim().min(2).max(20).default('mock'),
})), asyncHandler(async (req, res) => {
  const fromCart = !req.body.items?.length;
  const items = fromCart ? cartOf(req.user.id).map(i => ({ item_type: i.type, item_id: i.id })) : req.body.items;
  if (!items.length) throw new AppError('السلة فارغة', 400, 'empty_cart');

  const order = createOrder(req.user.id, { items, couponCode: req.body.coupon });

  // الطلبات المجانية (خصم ١٠٠٪ مثلاً) تُعتمد فوراً بلا بوابة
  if (order.total <= 0) {
    const result = fulfillOrder(order.id, { provider: 'free' });
    if (fromCart) q.run('DELETE FROM cart_items WHERE user_id = ?', req.user.id);
    return res.json({ order: result.order, paid: true, provider: 'free' });
  }

  const provider = getProvider(req.body.provider);
  const checkout = await provider.createCheckout(order);

  // الدفع من المحفظة يُسوّى فوراً
  if (checkout.settleImmediately) {
    const balance = walletSvc.balance(req.user.id);
    if (balance < order.total) {
      q.run("UPDATE orders SET status = 'failed' WHERE id = ?", order.id);
      q.run("UPDATE payments SET status = 'failed' WHERE order_id = ?", order.id);
      throw new AppError(`الرصيد غير كافٍ. رصيدك ${balance} ${config.money.symbol} والمطلوب ${order.total}`, 400, 'insufficient_funds');
    }
    walletSvc.debit(req.user.id, order.total, { type: 'purchase', refType: 'order', refId: order.id, note: `شراء الطلب ${order.number}` });
    const result = fulfillOrder(order.id, { provider: 'wallet', providerRef: checkout.reference });
    if (fromCart) q.run('DELETE FROM cart_items WHERE user_id = ?', req.user.id);
    return res.json({ order: result.order, paid: true, provider: 'wallet' });
  }

  if (checkout.awaitingReview) {
    notifyAdmins({ type: 'manual_payment', title: 'طلب بانتظار تأكيد التحويل',
      body: `الطلب ${order.number} بمبلغ ${order.total} ${config.money.symbol}`, link: '#/admin/orders' });
  }

  res.json({ order, paid: false, ...checkout });
}));

/* ---------------------- تأكيد البوابة التجريبية ---------------------- */
router.post('/checkout/mock/confirm', attachUser, requireAuth, validate(z.object({
  order_number: z.string().min(5),
  outcome: z.enum(['success', 'failure']).default('success'),
})), asyncHandler(async (req, res) => {
  const order = q.get('SELECT * FROM orders WHERE number = ?', req.body.order_number);
  if (!order) throw notFound('الطلب غير موجود');
  if (order.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  if (order.provider !== 'mock') throw new AppError('هذا الطلب ليس عبر البوابة التجريبية', 400, 'wrong_provider');

  if (req.body.outcome === 'failure') {
    q.run("UPDATE orders SET status = 'failed' WHERE id = ?", order.id);
    q.run("UPDATE payments SET status = 'failed' WHERE order_id = ?", order.id);
    return res.json({ ok: false, status: 'failed', message: 'فشلت عملية الدفع (محاكاة)' });
  }

  const result = fulfillOrder(order.id, { provider: 'mock', providerRef: order.provider_ref });
  q.run('DELETE FROM cart_items WHERE user_id = ?', order.user_id);
  res.json({ ok: true, status: 'paid', order: result.order, alreadyPaid: result.alreadyPaid });
}));

/* ---------------------- webhook سترايب ---------------------- */
router.post('/webhooks/stripe', asyncHandler(async (req, res) => {
  const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body);
  const check = verifyStripeSignature(raw, req.headers['stripe-signature']);
  if (!check.ok) return res.status(400).json({ error: { code: 'invalid_signature', message: check.reason } });

  const event = typeof req.body === 'object' ? req.body : JSON.parse(raw);
  if (event.type === 'checkout.session.completed') {
    const sessionId = event.data?.object?.id;
    const order = q.get('SELECT * FROM orders WHERE provider_ref = ?', sessionId);
    if (order) {
      fulfillOrder(order.id, { provider: 'stripe', providerRef: sessionId });
      q.run('DELETE FROM cart_items WHERE user_id = ?', order.user_id);
    }
  } else if (event.type === 'charge.refunded') {
    const order = q.get('SELECT * FROM orders WHERE provider_ref = ?', event.data?.object?.payment_intent);
    if (order && order.status === 'paid') refundOrder(order.id, { reason: 'استرجاع عبر البوابة', toWallet: false });
  }
  res.json({ received: true });
}));

/* ============================ الطلبات ============================ */
router.get('/orders', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const total = q.val('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?', req.user.id);
  const orders = q.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', req.user.id, limit, offset);
  res.json({
    data: orders.map(o => ({ ...o, items: q.all('SELECT * FROM order_items WHERE order_id = ?', o.id), meta: json(o.meta) })),
    meta: pageMeta(total, { page, limit }),
  });
}));

router.get('/orders/:number', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const order = q.get('SELECT * FROM orders WHERE number = ?', req.params.number);
  if (!order) throw notFound('الطلب غير موجود');
  if (order.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  res.json({
    order, items: q.all('SELECT * FROM order_items WHERE order_id = ?', order.id),
    payments: q.all('SELECT id, provider, status, amount, created_at FROM payments WHERE order_id = ?', order.id),
    invoice: {
      number: order.number, issuedTo: req.user.name, date: order.created_at,
      platform: config.platform.name, currency: order.currency, taxRate: config.money.taxRate,
    },
  });
}));

/* ============================ المحفظة ============================ */
router.get('/wallet', attachUser, requireAuth, asyncHandler(async (req, res) => {
  res.json({
    balance: walletSvc.balance(req.user.id),
    currency: config.money.currency, symbol: config.money.symbol,
    transactions: walletSvc.history(req.user.id, 60),
  });
}));

router.post('/wallet/topup', attachUser, requireAuth, validate(z.object({
  amount: priceField.refine(v => v > 0, 'أدخل مبلغاً أكبر من صفر'),
  provider: z.string().trim().default('mock'),
})), asyncHandler(async (req, res) => {
  const amount = money(req.body.amount);
  if (amount > 5000) throw new AppError('الحد الأقصى للشحنة الواحدة ٥٠٠٠', 400, 'amount_too_large');

  // في وضع التجربة تُضاف الشحنة مباشرة؛ مع بوابة حقيقية تمرّ عبر checkout
  if (req.body.provider === 'mock') {
    const balance = walletSvc.credit(req.user.id, amount, { type: 'topup', note: 'شحن رصيد (وضع تجريبي)' });
    return res.json({ ok: true, balance, provider: 'mock' });
  }
  throw new AppError('شحن الرصيد عبر هذه البوابة غير مفعّل بعد', 400, 'provider_unsupported');
}));

/* ============================ الباقات والاشتراك ============================ */
router.get('/plans', attachUser, asyncHandler(async (req, res) => {
  const plans = q.all('SELECT * FROM plans WHERE active = 1 ORDER BY position, price')
    .map(p => ({ ...p, features: json(p.features, []), includes: json(p.includes, {}) }));
  const current = req.user ? q.get(
    "SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ? AND s.status='active' ORDER BY s.ends_at DESC LIMIT 1",
    req.user.id) : null;
  res.json({ plans, current, currency: config.money.currency, symbol: config.money.symbol });
}));

router.post('/subscriptions/cancel', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const sub = q.get("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY ends_at DESC LIMIT 1", req.user.id);
  if (!sub) throw notFound('لا يوجد اشتراك فعّال');
  // الإلغاء يوقف التجديد فقط — المدة المدفوعة تبقى سارية
  q.run('UPDATE subscriptions SET auto_renew = 0 WHERE id = ?', sub.id);
  res.json({ ok: true, message: `أُلغي التجديد التلقائي. اشتراكك سارٍ حتى ${new Date(sub.ends_at).toLocaleDateString('ar')}` });
}));

/* ============================ الكوبونات (للمعلّم) ============================ */
router.post('/coupons', attachUser, requireAuth, validate(z.object({
  code: z.string().trim().min(3).max(30).transform(v => v.toUpperCase()),
  type: z.enum(['percent', 'fixed']).default('percent'),
  value: z.coerce.number().min(1).max(100000),
  max_uses: z.coerce.number().int().min(1).max(100000).optional().nullable(),
  min_amount: priceField.default(0),
  expires_at: z.string().optional().nullable(),
  applies_to: z.object({ type: z.string(), ids: z.array(z.number()).optional() }).optional(),
})), asyncHandler(async (req, res) => {
  if (!['instructor', 'admin'].includes(req.user.role)) throw forbidden('إنشاء الكوبونات للمعلّمين والإدارة');
  const b = req.body;
  if (b.type === 'percent' && b.value > 100) throw new AppError('نسبة الخصم لا تتجاوز ١٠٠٪', 400, 'invalid_percent');
  if (q.get('SELECT 1 AS x FROM coupons WHERE code = ?', b.code)) throw new AppError('هذا الرمز مستخدم', 409, 'code_taken');

  const info = q.run(
    `INSERT INTO coupons (code, type, value, max_uses, min_amount, applies_to, instructor_id, expires_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    b.code, b.type, b.value, b.max_uses ?? null, b.min_amount,
    b.applies_to ? JSON.stringify(b.applies_to) : JSON.stringify({ type: 'all' }),
    req.user.role === 'admin' ? null : req.user.id, b.expires_at ?? null);
  res.status(201).json(q.get('SELECT * FROM coupons WHERE id = ?', info.lastInsertRowid));
}));

router.get('/coupons', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const rows = req.user.role === 'admin'
    ? q.all('SELECT * FROM coupons ORDER BY id DESC LIMIT 200')
    : q.all('SELECT * FROM coupons WHERE instructor_id = ? ORDER BY id DESC', req.user.id);
  res.json({ data: rows.map(c => ({ ...c, applies_to: json(c.applies_to) })) });
}));

router.delete('/coupons/:id', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const coupon = q.get('SELECT * FROM coupons WHERE id = ?', Number(req.params.id));
  if (!coupon) throw notFound();
  if (req.user.role !== 'admin' && coupon.instructor_id !== req.user.id) throw forbidden();
  q.run('UPDATE coupons SET active = 0 WHERE id = ?', coupon.id);
  res.json({ ok: true });
}));

export default router;
