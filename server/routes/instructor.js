import express from 'express';
import config from '../config.js';
import { q } from '../db/database.js';
import { asyncHandler, AppError, notFound } from '../middleware/error.js';
import { validate, z, priceField } from '../middleware/validate.js';
import { attachUser, requireInstructor } from '../middleware/auth.js';
import { money, nowIso, json } from '../utils/helpers.js';
import { notifyAdmins } from '../services/notifications.js';

const router = express.Router();
router.use(attachUser, requireInstructor);

/* ---------------------- لوحة المعلّم ---------------------- */
router.get('/dashboard', asyncHandler(async (req, res) => {
  const id = req.user.id;
  const profile = q.get('SELECT * FROM instructor_profiles WHERE user_id = ?', id);

  const salesRow = q.get(
    `SELECT COALESCE(SUM(oi.instructor_share),0) AS revenue, COUNT(*) AS sales
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.instructor_id = ? AND o.status = 'paid'`, id);

  const monthly = q.all(
    `SELECT substr(o.paid_at, 1, 7) AS month, COALESCE(SUM(oi.instructor_share),0) AS revenue, COUNT(*) AS sales
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.instructor_id = ? AND o.status = 'paid' AND o.paid_at IS NOT NULL
      GROUP BY month ORDER BY month DESC LIMIT 12`, id);

  res.json({
    profile,
    stats: {
      courses: q.val('SELECT COUNT(*) AS c FROM courses WHERE instructor_id = ?', id),
      published: q.val("SELECT COUNT(*) AS c FROM courses WHERE instructor_id = ? AND status='published'", id),
      summaries: q.val('SELECT COUNT(*) AS c FROM summaries WHERE author_id = ?', id),
      liveSessions: q.val('SELECT COUNT(*) AS c FROM live_sessions WHERE instructor_id = ?', id),
      students: q.val(
        'SELECT COUNT(DISTINCT e.user_id) AS c FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.instructor_id = ?', id),
      revenue: money(salesRow.revenue),
      sales: salesRow.sales,
      balance: money(profile?.balance ?? 0),
      rating: profile?.rating_avg ?? 0,
      pendingQuestions: q.val(
        'SELECT COUNT(*) AS c FROM questions qq JOIN courses c ON c.id = qq.course_id WHERE c.instructor_id = ? AND qq.resolved = 0', id),
    },
    monthly,
    upcomingSessions: q.all(
      `SELECT ls.*, (SELECT COUNT(*) FROM live_bookings b WHERE b.session_id = ls.id AND b.status NOT IN ('cancelled','refunded')) AS booked
         FROM live_sessions ls WHERE instructor_id = ? AND starts_at >= ? AND status <> 'cancelled'
        ORDER BY starts_at LIMIT 5`, id, nowIso()),
    recentSales: q.all(
      `SELECT oi.title, oi.instructor_share, oi.item_type, o.paid_at, u.name AS buyer
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN users u ON u.id = o.user_id
        WHERE oi.instructor_id = ? AND o.status='paid' ORDER BY o.paid_at DESC LIMIT 10`, id),
  });
}));

/* ---------------------- محتواي ---------------------- */
router.get('/courses', asyncHandler(async (req, res) => {
  res.json({
    data: q.all(
      `SELECT c.*, (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students
         FROM courses c WHERE instructor_id = ? ORDER BY c.id DESC`, req.user.id)
      .map(c => ({ ...c, outcomes: json(c.outcomes, []), requirements: json(c.requirements, []) })),
  });
}));

router.get('/summaries', asyncHandler(async (req, res) => {
  res.json({
    data: q.all('SELECT * FROM summaries WHERE author_id = ? ORDER BY id DESC', req.user.id)
      .map(s => ({ ...s, key_ideas: json(s.key_ideas, []), content: undefined })),
  });
}));

router.get('/live', asyncHandler(async (req, res) => {
  res.json({
    data: q.all(
      `SELECT ls.*, (SELECT COUNT(*) FROM live_bookings b WHERE b.session_id = ls.id AND b.status NOT IN ('cancelled','refunded')) AS booked
         FROM live_sessions ls WHERE instructor_id = ? ORDER BY starts_at DESC`, req.user.id),
  });
}));

router.get('/students', asyncHandler(async (req, res) => {
  res.json({
    data: q.all(
      `SELECT u.id, u.name, u.email, c.title AS course_title, e.progress_percent, e.created_at
         FROM enrollments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
        WHERE c.instructor_id = ? ORDER BY e.id DESC LIMIT 300`, req.user.id),
  });
}));

router.get('/questions', asyncHandler(async (req, res) => {
  res.json({
    data: q.all(
      `SELECT qq.*, u.name AS user_name, c.title AS course_title,
              (SELECT COUNT(*) FROM answers a WHERE a.question_id = qq.id) AS answers_count
         FROM questions qq JOIN users u ON u.id = qq.user_id JOIN courses c ON c.id = qq.course_id
        WHERE c.instructor_id = ? ORDER BY qq.resolved, qq.id DESC LIMIT 100`, req.user.id),
  });
}));

/* ---------------------- الأرباح والسحب ---------------------- */
router.get('/earnings', asyncHandler(async (req, res) => {
  const profile = q.get('SELECT * FROM instructor_profiles WHERE user_id = ?', req.user.id);
  res.json({
    balance: money(profile?.balance ?? 0),
    lifetime: money(profile?.lifetime_earnings ?? 0),
    commissionRate: profile?.commission_rate ?? config.money.commissionRate,
    minPayout: config.money.minPayout,
    currency: config.money.currency, symbol: config.money.symbol,
    transactions: q.all(
      "SELECT * FROM transactions WHERE user_id = ? AND type IN ('earning','payout','refund') ORDER BY id DESC LIMIT 100", req.user.id),
    payouts: q.all('SELECT * FROM payouts WHERE instructor_id = ? ORDER BY id DESC', req.user.id),
    byItem: q.all(
      `SELECT oi.item_type, oi.title, COUNT(*) AS sales, COALESCE(SUM(oi.instructor_share),0) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.instructor_id = ? AND o.status='paid'
        GROUP BY oi.item_type, oi.item_id ORDER BY revenue DESC LIMIT 50`, req.user.id),
  });
}));

router.post('/payouts', validate(z.object({
  amount: priceField,
  method: z.string().trim().max(50).default('bank'),
  details: z.string().trim().max(500).optional().nullable(),
})), asyncHandler(async (req, res) => {
  const profile = q.get('SELECT * FROM instructor_profiles WHERE user_id = ?', req.user.id);
  const amount = money(req.body.amount);

  if (amount < config.money.minPayout) {
    throw new AppError(`الحد الأدنى للسحب ${config.money.minPayout} ${config.money.symbol}`, 400, 'below_min_payout');
  }
  if (amount > (profile?.balance ?? 0)) throw new AppError('المبلغ يتجاوز رصيدك القابل للسحب', 400, 'insufficient_balance');
  if (q.get("SELECT 1 AS x FROM payouts WHERE instructor_id = ? AND status = 'pending'", req.user.id)) {
    throw new AppError('لديك طلب سحب قيد المعالجة', 409, 'pending_payout');
  }

  const info = q.run('INSERT INTO payouts (instructor_id, amount, method, details) VALUES (?,?,?,?)',
    req.user.id, amount, req.body.method, req.body.details ?? null);
  notifyAdmins({ type: 'payout', title: 'طلب سحب أرباح',
    body: `${req.user.name} — ${amount} ${config.money.symbol}`, link: '#/admin/payouts' });
  res.status(201).json(q.get('SELECT * FROM payouts WHERE id = ?', info.lastInsertRowid));
}));

export default router;
