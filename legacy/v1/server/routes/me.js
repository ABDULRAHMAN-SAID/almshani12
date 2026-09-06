import express from 'express';
import { q } from '../db/database.js';
import { asyncHandler, notFound } from '../middleware/error.js';
import { validate, z } from '../middleware/validate.js';
import { attachUser, requireAuth } from '../middleware/auth.js';
import { nowIso, json } from '../utils/helpers.js';

const router = express.Router();
router.use(attachUser, requireAuth);

/* ---------------------- لوحة الطالب ---------------------- */
router.get('/dashboard', asyncHandler(async (req, res) => {
  const inProgress = q.all(
    `SELECT c.id, c.title, c.slug, c.thumbnail, e.progress_percent, e.last_lesson_id, u.name AS instructor_name,
            (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count
       FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN users u ON u.id = c.instructor_id
      WHERE e.user_id = ? AND e.progress_percent < 100 ORDER BY e.id DESC LIMIT 6`, req.user.id);

  const upcomingLive = q.all(
    `SELECT ls.id, ls.title, ls.starts_at, ls.status, ls.duration_minutes, u.name AS instructor_name
       FROM live_bookings b JOIN live_sessions ls ON ls.id = b.session_id JOIN users u ON u.id = ls.instructor_id
      WHERE b.user_id = ? AND b.status NOT IN ('cancelled','refunded') AND ls.starts_at >= ?
      ORDER BY ls.starts_at LIMIT 5`, req.user.id, nowIso());

  const recentSummaries = q.all(
    `SELECT s.id, s.title, s.slug, s.cover, s.book_author, s.reading_minutes
       FROM entitlements e JOIN summaries s ON s.id = e.item_id
      WHERE e.user_id = ? AND e.item_type = 'summary' ORDER BY e.id DESC LIMIT 6`, req.user.id);

  res.json({
    stats: {
      courses: q.val('SELECT COUNT(*) AS c FROM enrollments WHERE user_id = ?', req.user.id),
      completed: q.val('SELECT COUNT(*) AS c FROM enrollments WHERE user_id = ? AND progress_percent >= 100', req.user.id),
      summaries: q.val("SELECT COUNT(*) AS c FROM entitlements WHERE user_id = ? AND item_type='summary'", req.user.id),
      liveSessions: q.val("SELECT COUNT(*) AS c FROM live_bookings WHERE user_id = ? AND status NOT IN ('cancelled','refunded')", req.user.id),
      certificates: q.val('SELECT COUNT(*) AS c FROM certificates WHERE user_id = ?', req.user.id),
      watchMinutes: Math.round((q.val('SELECT COALESCE(SUM(seconds_watched),0) AS s FROM lesson_progress WHERE user_id = ?', req.user.id) || 0) / 60),
      wallet: req.user.wallet_balance,
    },
    inProgress, upcomingLive, recentSummaries,
  });
}));

/* ---------------------- مكتبتي ---------------------- */
router.get('/library', asyncHandler(async (req, res) => {
  res.json({
    courses: q.all(
      `SELECT c.id, c.title, c.slug, c.thumbnail, c.type, e.progress_percent, e.completed_at, e.last_lesson_id,
              u.name AS instructor_name,
              (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count,
              (SELECT COUNT(*) FROM certificates ce WHERE ce.course_id = c.id AND ce.user_id = e.user_id) AS has_certificate
         FROM enrollments e JOIN courses c ON c.id = e.course_id JOIN users u ON u.id = c.instructor_id
        WHERE e.user_id = ? ORDER BY e.id DESC`, req.user.id),
    summaries: q.all(
      `SELECT s.id, s.title, s.slug, s.cover, s.book_title, s.book_author, s.reading_minutes,
              s.pdf_url IS NOT NULL AS has_pdf, s.audio_url IS NOT NULL AS has_audio, e.created_at AS acquired_at
         FROM entitlements e JOIN summaries s ON s.id = e.item_id
        WHERE e.user_id = ? AND e.item_type = 'summary' ORDER BY e.id DESC`, req.user.id),
    liveSessions: q.all(
      `SELECT ls.id, ls.title, ls.starts_at, ls.status, ls.recording_url, b.status AS booking_status,
              u.name AS instructor_name
         FROM live_bookings b JOIN live_sessions ls ON ls.id = b.session_id JOIN users u ON u.id = ls.instructor_id
        WHERE b.user_id = ? AND b.status NOT IN ('cancelled','refunded') ORDER BY ls.starts_at DESC`, req.user.id),
  });
}));

/* ---------------------- الإشعارات ---------------------- */
router.get('/notifications', asyncHandler(async (req, res) => {
  res.json({
    data: q.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', req.user.id),
    unread: q.val('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id),
  });
}));

router.post('/notifications/read', validate(z.object({
  id: z.coerce.number().int().positive().optional(),
})), asyncHandler(async (req, res) => {
  if (req.body.id) q.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', nowIso(), req.body.id, req.user.id);
  else q.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), req.user.id);
  res.json({ ok: true, unread: q.val('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id) });
}));

/* ---------------------- ملاحظاتي ---------------------- */
router.get('/notes', asyncHandler(async (req, res) => {
  res.json({
    data: q.all(
      `SELECT n.*, l.title AS lesson_title, l.course_id, s.title AS summary_title
         FROM notes n LEFT JOIN lessons l ON l.id = n.lesson_id LEFT JOIN summaries s ON s.id = n.summary_id
        WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 200`, req.user.id),
  });
}));

export default router;
