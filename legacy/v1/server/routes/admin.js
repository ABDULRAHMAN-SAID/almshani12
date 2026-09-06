import express from 'express';
import bcrypt from 'bcryptjs';
import config from '../config.js';
import { db, q, settings } from '../db/database.js';
import { asyncHandler, AppError, notFound } from '../middleware/error.js';
import { validate, z, arabicText, priceField } from '../middleware/validate.js';
import { attachUser, requireAdmin } from '../middleware/auth.js';
import { money, nowIso, json, toJson, paginate, pageMeta, slugify } from '../utils/helpers.js';
import { notify } from '../services/notifications.js';
import { refundOrder, fulfillOrder } from '../services/checkout.js';
import * as walletSvc from '../services/wallet.js';

const router = express.Router();
router.use(attachUser, requireAdmin);

const audit = (req, action, entity, entityId, meta = null) =>
  q.run('INSERT INTO audit_logs (user_id, action, entity, entity_id, meta, ip) VALUES (?,?,?,?,?,?)',
    req.user.id, action, entity, entityId, toJson(meta), req.ip);

/* ============================ نظرة عامة ============================ */
router.get('/overview', asyncHandler(async (_req, res) => {
  const revenue = q.get("SELECT COALESCE(SUM(total),0) AS gross, COALESCE(SUM(tax),0) AS tax, COUNT(*) AS orders FROM orders WHERE status='paid'");
  const platformShare = q.val(
    "SELECT COALESCE(SUM(oi.platform_share),0) AS s FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status='paid'");

  res.json({
    stats: {
      users: q.val('SELECT COUNT(*) AS c FROM users'),
      students: q.val("SELECT COUNT(*) AS c FROM users WHERE role='student'"),
      instructors: q.val("SELECT COUNT(*) AS c FROM users WHERE role='instructor'"),
      pendingInstructors: q.val('SELECT COUNT(*) AS c FROM instructor_profiles WHERE approved = 0'),
      courses: q.val('SELECT COUNT(*) AS c FROM courses'),
      pendingCourses: q.val("SELECT COUNT(*) AS c FROM courses WHERE status='pending'"),
      summaries: q.val('SELECT COUNT(*) AS c FROM summaries'),
      pendingSummaries: q.val("SELECT COUNT(*) AS c FROM summaries WHERE status='pending'"),
      liveSessions: q.val('SELECT COUNT(*) AS c FROM live_sessions'),
      enrollments: q.val('SELECT COUNT(*) AS c FROM enrollments'),
      grossRevenue: money(revenue.gross),
      platformRevenue: money(platformShare),
      orders: revenue.orders,
      pendingPayouts: q.val("SELECT COUNT(*) AS c FROM payouts WHERE status='pending'"),
      pendingManualOrders: q.val("SELECT COUNT(*) AS c FROM orders WHERE status='pending' AND provider='manual'"),
      activeSubscriptions: q.val("SELECT COUNT(*) AS c FROM subscriptions WHERE status='active' AND ends_at > datetime('now')"),
    },
    revenueByMonth: q.all(
      `SELECT substr(paid_at,1,7) AS month, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS orders
         FROM orders WHERE status='paid' AND paid_at IS NOT NULL GROUP BY month ORDER BY month DESC LIMIT 12`),
    topCourses: q.all(
      `SELECT c.id, c.title, c.students_count, c.rating_avg,
              (SELECT COALESCE(SUM(oi.unit_price),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id
                WHERE oi.item_type='course' AND oi.item_id=c.id AND o.status='paid') AS revenue
         FROM courses c WHERE c.status='published' ORDER BY revenue DESC LIMIT 10`),
    topSummaries: q.all(
      "SELECT id, title, sales_count, rating_avg FROM summaries WHERE status='published' ORDER BY sales_count DESC LIMIT 10"),
    recentOrders: q.all(
      `SELECT o.*, u.name AS user_name FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 15`),
  });
}));

/* ============================ المستخدمون ============================ */
router.get('/users', asyncHandler(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { search, role, status } = req.query;
  const where = ['1=1']; const params = [];
  if (search) { where.push('(name LIKE ? OR email LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
  if (role) { where.push('role = ?'); params.push(role); }
  if (status) { where.push('status = ?'); params.push(status); }
  const whereSql = where.join(' AND ');

  res.json({
    data: q.all(
      `SELECT id, name, email, phone, role, status, wallet_balance, email_verified, created_at, last_login_at
         FROM users WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset),
    meta: pageMeta(q.val(`SELECT COUNT(*) AS c FROM users WHERE ${whereSql}`, ...params), { page, limit }),
  });
}));

router.patch('/users/:id', validate(z.object({
  role: z.enum(['student', 'instructor', 'admin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
})), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id && req.body.role && req.body.role !== 'admin') {
    throw new AppError('لا يمكنك إنزال صلاحيتك بنفسك', 400, 'self_demote');
  }
  const fields = Object.entries(req.body).filter(([, v]) => v !== undefined);
  if (fields.length) {
    q.run(`UPDATE users SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...fields.map(([, v]) => v), id);
  }
  if (req.body.role === 'instructor') {
    q.run('INSERT INTO instructor_profiles (user_id, approved) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET approved = 1', id);
  }
  if (req.body.status === 'suspended') q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', id);
  audit(req, 'user.update', 'users', id, req.body);
  res.json(q.get('SELECT id, name, email, role, status FROM users WHERE id = ?', id));
}));

router.post('/users/:id/wallet', validate(z.object({
  amount: z.coerce.number(),
  note: z.string().trim().max(200).optional(),
})), asyncHandler(async (req, res) => {
  const balance = walletSvc.record(Number(req.params.id), {
    type: 'adjustment', amount: req.body.amount, note: req.body.note ?? 'تسوية من الإدارة',
  });
  audit(req, 'wallet.adjust', 'users', Number(req.params.id), req.body);
  res.json({ ok: true, balance });
}));

/* ============================ اعتماد المعلّمين ============================ */
router.get('/instructors', asyncHandler(async (_req, res) => {
  res.json({
    data: q.all(
      `SELECT ip.*, u.name, u.email, u.created_at AS joined_at
         FROM instructor_profiles ip JOIN users u ON u.id = ip.user_id ORDER BY ip.approved, ip.user_id DESC`),
  });
}));

router.post('/instructors/:id/approve', validate(z.object({
  approved: z.boolean().default(true),
  commission_rate: z.coerce.number().min(0).max(0.9).optional(),
})), asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  q.run('UPDATE instructor_profiles SET approved = ?, commission_rate = COALESCE(?, commission_rate) WHERE user_id = ?',
    req.body.approved ? 1 : 0, req.body.commission_rate ?? null, userId);
  if (req.body.approved) q.run("UPDATE users SET role = 'instructor' WHERE id = ? AND role = 'student'", userId);

  notify(userId, req.body.approved
    ? { type: 'instructor', title: 'تم اعتمادك كمعلّم 🎉', body: 'يمكنك الآن نشر الدورات والحصص والملخّصات.', link: '#/instructor' }
    : { type: 'instructor', title: 'لم يُعتمد طلبك', body: 'تواصل مع الدعم لمزيد من التفاصيل.', link: '#/contact' });
  audit(req, 'instructor.approve', 'users', userId, req.body);
  res.json({ ok: true });
}));

/* ============================ مراجعة المحتوى ============================ */
router.get('/courses', asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  res.json({
    data: q.all(
      `SELECT c.*, u.name AS instructor_name, (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count
         FROM courses c JOIN users u ON u.id = c.instructor_id
        WHERE (? = 'all' OR c.status = ?) ORDER BY c.id DESC LIMIT 200`, status, status),
  });
}));

router.post('/courses/:id/moderate', validate(z.object({
  action: z.enum(['publish', 'reject', 'archive', 'feature', 'unfeature']),
  reason: z.string().trim().max(500).optional().nullable(),
})), asyncHandler(async (req, res) => {
  const course = q.get('SELECT * FROM courses WHERE id = ?', Number(req.params.id));
  if (!course) throw notFound('الدورة غير موجودة');

  const actions = {
    publish: () => q.run("UPDATE courses SET status='published', published_at = COALESCE(published_at, ?), reject_reason = NULL WHERE id = ?", nowIso(), course.id),
    reject: () => q.run("UPDATE courses SET status='rejected', reject_reason = ? WHERE id = ?", req.body.reason ?? null, course.id),
    archive: () => q.run("UPDATE courses SET status='archived' WHERE id = ?", course.id),
    feature: () => q.run('UPDATE courses SET featured = 1 WHERE id = ?', course.id),
    unfeature: () => q.run('UPDATE courses SET featured = 0 WHERE id = ?', course.id),
  };
  actions[req.body.action]();

  if (req.body.action === 'publish') {
    notify(course.instructor_id, { type: 'course', title: 'تم نشر دورتك ✅', body: course.title, link: `#/courses/${course.slug}` });
  } else if (req.body.action === 'reject') {
    notify(course.instructor_id, { type: 'course', title: 'دورتك تحتاج تعديلاً',
      body: `${course.title} — ${req.body.reason || 'راجع الشروط'}`, link: '#/instructor/courses' });
  }
  audit(req, `course.${req.body.action}`, 'courses', course.id, req.body);
  res.json({ ok: true, status: q.val('SELECT status FROM courses WHERE id = ?', course.id) });
}));

router.get('/summaries', asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  res.json({
    data: q.all(
      `SELECT s.id, s.title, s.book_title, s.book_author, s.price, s.status, s.created_at, s.reading_minutes,
              u.name AS author_name, length(s.content) AS content_length
         FROM summaries s JOIN users u ON u.id = s.author_id
        WHERE (? = 'all' OR s.status = ?) ORDER BY s.id DESC LIMIT 200`, status, status),
  });
}));

router.post('/summaries/:id/moderate', validate(z.object({
  action: z.enum(['publish', 'reject', 'archive', 'feature', 'unfeature']),
  reason: z.string().trim().max(500).optional().nullable(),
})), asyncHandler(async (req, res) => {
  const summary = q.get('SELECT * FROM summaries WHERE id = ?', Number(req.params.id));
  if (!summary) throw notFound('الملخّص غير موجود');

  const actions = {
    publish: () => q.run("UPDATE summaries SET status='published', published_at = COALESCE(published_at, ?), reject_reason = NULL WHERE id = ?", nowIso(), summary.id),
    reject: () => q.run("UPDATE summaries SET status='rejected', reject_reason = ? WHERE id = ?", req.body.reason ?? null, summary.id),
    archive: () => q.run("UPDATE summaries SET status='archived' WHERE id = ?", summary.id),
    feature: () => q.run('UPDATE summaries SET featured = 1 WHERE id = ?', summary.id),
    unfeature: () => q.run('UPDATE summaries SET featured = 0 WHERE id = ?', summary.id),
  };
  actions[req.body.action]();

  notify(summary.author_id, req.body.action === 'publish'
    ? { type: 'summary', title: 'تم نشر ملخّصك ✅', body: summary.title, link: `#/summaries/${summary.slug}` }
    : { type: 'summary', title: 'تحديث على ملخّصك', body: `${summary.title} — ${req.body.action}`, link: '#/instructor/summaries' });
  audit(req, `summary.${req.body.action}`, 'summaries', summary.id, req.body);
  res.json({ ok: true });
}));

/* ============================ الطلبات والمالية ============================ */
router.get('/orders', asyncHandler(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { status, search } = req.query;
  const where = ['1=1']; const params = [];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (search) { where.push('(o.number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
  const whereSql = where.join(' AND ');

  res.json({
    data: q.all(
      `SELECT o.*, u.name AS user_name, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id
        WHERE ${whereSql} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
      .map(o => ({ ...o, items: q.all('SELECT * FROM order_items WHERE order_id = ?', o.id) })),
    meta: pageMeta(q.val(`SELECT COUNT(*) AS c FROM orders o JOIN users u ON u.id = o.user_id WHERE ${whereSql}`, ...params), { page, limit }),
  });
}));

/** اعتماد تحويل بنكي يدوي. */
router.post('/orders/:id/approve', asyncHandler(async (req, res) => {
  const order = q.get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
  if (!order) throw notFound('الطلب غير موجود');
  if (order.status !== 'pending') throw new AppError('هذا الطلب ليس بانتظار الاعتماد', 400, 'not_pending');
  const result = fulfillOrder(order.id, { provider: order.provider || 'manual', providerRef: order.provider_ref });
  q.run('DELETE FROM cart_items WHERE user_id = ?', order.user_id);
  audit(req, 'order.approve', 'orders', order.id);
  res.json({ ok: true, order: result.order });
}));

router.post('/orders/:id/refund', validate(z.object({
  reason: z.string().trim().max(500).optional(),
  toWallet: z.boolean().default(true),
})), asyncHandler(async (req, res) => {
  const order = refundOrder(Number(req.params.id), req.body);
  audit(req, 'order.refund', 'orders', order.id, req.body);
  res.json({ ok: true, order });
}));

router.get('/payouts', asyncHandler(async (_req, res) => {
  res.json({
    data: q.all(
      `SELECT p.*, u.name AS instructor_name, u.email, ip.balance
         FROM payouts p JOIN users u ON u.id = p.instructor_id
         LEFT JOIN instructor_profiles ip ON ip.user_id = p.instructor_id
        ORDER BY p.status, p.id DESC LIMIT 200`),
  });
}));

router.post('/payouts/:id/process', validate(z.object({
  action: z.enum(['approve', 'paid', 'reject']),
  note: z.string().trim().max(500).optional().nullable(),
})), asyncHandler(async (req, res) => {
  const payout = q.get('SELECT * FROM payouts WHERE id = ?', Number(req.params.id));
  if (!payout) throw notFound('طلب السحب غير موجود');

  if (req.body.action === 'paid') {
    if (payout.status === 'paid') throw new AppError('سبق صرف هذا الطلب', 400, 'already_paid');
    const profile = q.get('SELECT balance FROM instructor_profiles WHERE user_id = ?', payout.instructor_id);
    if ((profile?.balance ?? 0) < payout.amount) throw new AppError('رصيد المعلّم لا يغطي المبلغ', 400, 'insufficient_balance');

    db.transaction(() => {
      q.run('UPDATE instructor_profiles SET balance = balance - ? WHERE user_id = ?', payout.amount, payout.instructor_id);
      q.run('INSERT INTO transactions (user_id, type, amount, balance_after, ref_type, ref_id, note) VALUES (?,?,?,?,?,?,?)',
        payout.instructor_id, 'payout', -payout.amount,
        q.val('SELECT balance FROM instructor_profiles WHERE user_id = ?', payout.instructor_id),
        'payout', payout.id, 'صرف أرباح');
      q.run("UPDATE payouts SET status='paid', processed_at = ?, note = ? WHERE id = ?", nowIso(), req.body.note ?? null, payout.id);
    })();
    notify(payout.instructor_id, { type: 'payout', title: 'تم صرف أرباحك 💸',
      body: `${payout.amount} ${config.money.symbol}`, link: '#/instructor/earnings' });
  } else {
    q.run('UPDATE payouts SET status = ?, processed_at = ?, note = ? WHERE id = ?',
      req.body.action === 'approve' ? 'approved' : 'rejected', nowIso(), req.body.note ?? null, payout.id);
    notify(payout.instructor_id, { type: 'payout',
      title: req.body.action === 'approve' ? 'اعتُمد طلب السحب' : 'رُفض طلب السحب',
      body: req.body.note || '', link: '#/instructor/earnings' });
  }
  audit(req, `payout.${req.body.action}`, 'payouts', payout.id, req.body);
  res.json({ ok: true });
}));

/* ============================ الباقات والتصنيفات ============================ */
router.post('/plans', validate(z.object({
  name: arabicText(2, 60), description: z.string().trim().max(500).optional().nullable(),
  price: priceField, interval: z.enum(['month', 'year']).default('month'),
  features: z.array(z.string().max(200)).max(20).optional(),
  includes: z.object({ courses: z.boolean().optional(), summaries: z.boolean().optional(), live_discount: z.number().min(0).max(1).optional() }).optional(),
  active: z.boolean().default(true), position: z.coerce.number().int().default(0),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  const info = q.run(
    'INSERT INTO plans (name, slug, description, price, interval, features, includes, active, position) VALUES (?,?,?,?,?,?,?,?,?)',
    b.name, slugify(b.name), b.description ?? null, b.price, b.interval,
    toJson(b.features ?? []), toJson(b.includes ?? {}), b.active ? 1 : 0, b.position);
  res.status(201).json(q.get('SELECT * FROM plans WHERE id = ?', info.lastInsertRowid));
}));

router.patch('/plans/:id', validate(z.object({
  name: z.string().trim().max(60).optional(), price: priceField.optional(),
  description: z.string().max(500).nullable().optional(), active: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const fields = Object.entries(req.body).filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : v]);
  if (fields.length) {
    q.run(`UPDATE plans SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...fields.map(([, v]) => v), Number(req.params.id));
  }
  res.json(q.get('SELECT * FROM plans WHERE id = ?', Number(req.params.id)));
}));

router.post('/categories', validate(z.object({
  name: arabicText(2, 60), icon: z.string().max(10).optional().nullable(),
  parent_id: z.coerce.number().int().positive().optional().nullable(),
})), asyncHandler(async (req, res) => {
  const info = q.run('INSERT INTO categories (name, slug, icon, parent_id) VALUES (?,?,?,?)',
    req.body.name, slugify(req.body.name), req.body.icon ?? null, req.body.parent_id ?? null);
  res.status(201).json(q.get('SELECT * FROM categories WHERE id = ?', info.lastInsertRowid));
}));

/* ============================ الإعدادات والسجل ============================ */
router.get('/settings', asyncHandler(async (_req, res) => {
  res.json({ settings: settings.all(), config: {
    currency: config.money.currency, commissionRate: config.money.commissionRate,
    taxRate: config.money.taxRate, providers: config.payments.providers,
  } });
}));

router.put('/settings', validate(z.record(z.string(), z.any())), asyncHandler(async (req, res) => {
  for (const [key, value] of Object.entries(req.body)) settings.set(key, value);
  audit(req, 'settings.update', 'settings', null, req.body);
  res.json({ settings: settings.all() });
}));

router.get('/audit', asyncHandler(async (_req, res) => {
  res.json({
    data: q.all(
      `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC LIMIT 200`).map(a => ({ ...a, meta: json(a.meta) })),
  });
}));

router.get('/messages', asyncHandler(async (_req, res) => {
  res.json({ data: q.all('SELECT * FROM contact_messages ORDER BY handled, id DESC LIMIT 200') });
}));

export default router;
