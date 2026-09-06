import express from 'express';
import config from '../config.js';
import { q, settings } from '../db/database.js';
import { asyncHandler } from '../middleware/error.js';
import { validate, z, arabicText, emailField } from '../middleware/validate.js';
import { attachUser } from '../middleware/auth.js';
import { nowIso, json } from '../utils/helpers.js';
import { notifyAdmins } from '../services/notifications.js';

const router = express.Router();

/* ---------------------- إعدادات الواجهة ---------------------- */
router.get('/config', asyncHandler(async (_req, res) => {
  res.json({
    platform: config.platform,
    currency: { code: config.money.currency, symbol: config.money.symbol, decimals: config.money.decimals },
    taxRate: config.money.taxRate,
    referralBonus: config.money.referralBonus,
    providers: config.payments.providers,
    settings: settings.all(),
  });
}));

router.get('/categories', asyncHandler(async (_req, res) => {
  res.json({
    data: q.all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM courses co WHERE co.category_id = c.id AND co.status='published') AS courses_count,
              (SELECT COUNT(*) FROM summaries s WHERE s.category_id = c.id AND s.status='published') AS summaries_count
         FROM categories c ORDER BY c.position, c.id`),
  });
}));

/* ---------------------- الصفحة الرئيسية ---------------------- */
router.get('/home', attachUser, asyncHandler(async (_req, res) => {
  const courseCard = `c.id, c.title, c.slug, c.subtitle, c.thumbnail, c.price, c.discount_price, c.level, c.type,
     c.rating_avg, c.rating_count, c.students_count, u.name AS instructor_name,
     (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count`;

  res.json({
    featuredCourses: q.all(
      `SELECT ${courseCard} FROM courses c JOIN users u ON u.id = c.instructor_id
        WHERE c.status='published' ORDER BY c.featured DESC, c.students_count DESC LIMIT 8`),
    newCourses: q.all(
      `SELECT ${courseCard} FROM courses c JOIN users u ON u.id = c.instructor_id
        WHERE c.status='published' ORDER BY c.published_at DESC LIMIT 8`),
    upcomingLive: q.all(
      `SELECT ls.id, ls.title, ls.starts_at, ls.duration_minutes, ls.price, ls.capacity, ls.cover, ls.status,
              u.name AS instructor_name, u.avatar AS instructor_avatar,
              (SELECT COUNT(*) FROM live_bookings b WHERE b.session_id = ls.id AND b.status NOT IN ('cancelled','refunded')) AS booked_count
         FROM live_sessions ls JOIN users u ON u.id = ls.instructor_id
        WHERE ls.status IN ('scheduled','live') AND ls.starts_at >= datetime('now','-1 hour')
        ORDER BY ls.starts_at LIMIT 6`),
    featuredSummaries: q.all(
      `SELECT s.id, s.title, s.slug, s.cover, s.book_title, s.book_author, s.price, s.discount_price,
              s.reading_minutes, s.rating_avg, s.sales_count, u.name AS author_name
         FROM summaries s JOIN users u ON u.id = s.author_id
        WHERE s.status='published' ORDER BY s.featured DESC, s.sales_count DESC LIMIT 8`),
    topInstructors: q.all(
      `SELECT u.id, u.name, u.avatar, ip.title, ip.specialty, ip.rating_avg, ip.students_count
         FROM instructor_profiles ip JOIN users u ON u.id = ip.user_id
        WHERE ip.approved = 1 ORDER BY ip.students_count DESC, ip.rating_avg DESC LIMIT 6`),
    plans: q.all('SELECT * FROM plans WHERE active = 1 ORDER BY position, price')
      .map(p => ({ ...p, features: json(p.features, []), includes: json(p.includes, {}) })),
    stats: {
      courses: q.val("SELECT COUNT(*) AS c FROM courses WHERE status='published'"),
      summaries: q.val("SELECT COUNT(*) AS c FROM summaries WHERE status='published'"),
      instructors: q.val('SELECT COUNT(*) AS c FROM instructor_profiles WHERE approved = 1'),
      students: q.val("SELECT COUNT(*) AS c FROM users WHERE role='student'"),
    },
  });
}));

/* ---------------------- بحث موحّد ---------------------- */
router.get('/search', asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json({ courses: [], summaries: [], liveSessions: [], instructors: [] });
  const like = `%${term}%`;

  res.json({
    courses: q.all(
      `SELECT c.id, c.title, c.slug, c.thumbnail, c.price, c.discount_price, c.rating_avg, u.name AS instructor_name
         FROM courses c JOIN users u ON u.id = c.instructor_id
        WHERE c.status='published' AND (c.title LIKE ? OR c.subtitle LIKE ? OR c.description LIKE ?) LIMIT 10`,
      like, like, like),
    summaries: q.all(
      `SELECT s.id, s.title, s.slug, s.cover, s.book_title, s.book_author, s.price, s.discount_price
         FROM summaries s WHERE s.status='published' AND (s.title LIKE ? OR s.book_title LIKE ? OR s.book_author LIKE ?) LIMIT 10`,
      like, like, like),
    liveSessions: q.all(
      `SELECT ls.id, ls.title, ls.starts_at, ls.price, u.name AS instructor_name
         FROM live_sessions ls JOIN users u ON u.id = ls.instructor_id
        WHERE ls.status IN ('scheduled','live') AND ls.title LIKE ? ORDER BY ls.starts_at LIMIT 10`, like),
    instructors: q.all(
      `SELECT u.id, u.name, u.avatar, ip.title, ip.specialty, ip.rating_avg, ip.students_count
         FROM instructor_profiles ip JOIN users u ON u.id = ip.user_id
        WHERE ip.approved = 1 AND (u.name LIKE ? OR ip.specialty LIKE ?) LIMIT 10`, like, like),
  });
}));

/* ---------------------- صفحة المعلّم ---------------------- */
router.get('/instructors/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const instructor = q.get(
    `SELECT u.id, u.name, u.avatar, u.bio, u.created_at, ip.title, ip.specialty, ip.headline,
            ip.years_exp, ip.rating_avg, ip.rating_count, ip.students_count
       FROM users u JOIN instructor_profiles ip ON ip.user_id = u.id
      WHERE u.id = ? AND ip.approved = 1`, id);
  if (!instructor) return res.status(404).json({ error: { code: 'not_found', message: 'المعلّم غير موجود' } });

  res.json({
    instructor,
    courses: q.all(
      `SELECT id, title, slug, thumbnail, price, discount_price, rating_avg, students_count
         FROM courses WHERE instructor_id = ? AND status='published' ORDER BY students_count DESC`, id),
    summaries: q.all(
      `SELECT id, title, slug, cover, book_title, price, discount_price, rating_avg
         FROM summaries WHERE author_id = ? AND status='published' ORDER BY sales_count DESC`, id),
    liveSessions: q.all(
      `SELECT id, title, starts_at, price, duration_minutes, status FROM live_sessions
        WHERE instructor_id = ? AND status IN ('scheduled','live') AND starts_at >= ? ORDER BY starts_at`, id, nowIso()),
  });
}));

/* ---------------------- تواصل معنا ---------------------- */
router.post('/contact', validate(z.object({
  name: arabicText(2, 80), email: emailField,
  subject: z.string().trim().max(150).optional().nullable(),
  body: arabicText(10, 3000),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  q.run('INSERT INTO contact_messages (name, email, subject, body) VALUES (?,?,?,?)',
    b.name, b.email, b.subject ?? null, b.body);
  notifyAdmins({ type: 'contact', title: 'رسالة جديدة من زائر', body: `${b.name}: ${b.subject || ''}`, link: '#/admin/messages' });
  res.status(201).json({ ok: true, message: 'وصلتنا رسالتك، سنردّ عليك قريباً' });
}));

export default router;
