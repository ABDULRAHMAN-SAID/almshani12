import express from 'express';
import { db, q } from '../db/database.js';
import { asyncHandler, AppError, notFound, forbidden, paymentRequired } from '../middleware/error.js';
import { validate, z, arabicText, priceField } from '../middleware/validate.js';
import { attachUser, requireAuth, requireInstructor } from '../middleware/auth.js';
import { paginate, pageMeta, randomCode, nowIso, addMinutes } from '../utils/helpers.js';
import { checkAccess, grantAccess } from '../services/access.js';
import { notify, notifyMany } from '../services/notifications.js';

const router = express.Router();

const sessionFields = `
  ls.*, u.name AS instructor_name, u.avatar AS instructor_avatar,
  c.title AS course_title, c.slug AS course_slug,
  (SELECT COUNT(*) FROM live_bookings b WHERE b.session_id = ls.id AND b.status NOT IN ('cancelled','refunded')) AS booked_count`;

/* ---------------------- قائمة الحصص المباشرة ---------------------- */
router.get('/', attachUser, asyncHandler(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { scope = 'upcoming', search, instructor, category, free } = req.query;

  const where = ["ls.status <> 'cancelled'"];
  const params = [];

  if (scope === 'upcoming') { where.push("(ls.starts_at >= ? OR ls.status = 'live')"); params.push(nowIso()); }
  else if (scope === 'past') { where.push('ls.starts_at < ?'); params.push(nowIso()); }
  else if (scope === 'live') where.push("ls.status = 'live'");

  if (search) { where.push('(ls.title LIKE ? OR ls.description LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
  if (instructor) { where.push('ls.instructor_id = ?'); params.push(Number(instructor)); }
  if (category) { where.push('ls.category_id = (SELECT id FROM categories WHERE slug = ?)'); params.push(category); }
  if (free === 'true') where.push('ls.price = 0');

  const whereSql = where.join(' AND ');
  const total = q.val(`SELECT COUNT(*) AS c FROM live_sessions ls WHERE ${whereSql}`, ...params);
  const rows = q.all(
    `SELECT ${sessionFields} FROM live_sessions ls
       JOIN users u ON u.id = ls.instructor_id
       LEFT JOIN courses c ON c.id = ls.course_id
      WHERE ${whereSql}
      ORDER BY ${scope === 'past' ? 'ls.starts_at DESC' : 'ls.starts_at ASC'} LIMIT ? OFFSET ?`,
    ...params, limit, offset);

  // لا نكشف رابط الاجتماع إلا للمشتركين
  const data = rows.map(r => ({ ...r, meeting_url: undefined, room_code: undefined }));
  res.json({ data, meta: pageMeta(total, { page, limit }) });
}));

/* ---------------------- تفاصيل حصة ---------------------- */
router.get('/:id', attachUser, asyncHandler(async (req, res) => {
  const session = q.get(
    `SELECT ${sessionFields}, ip.title AS instructor_title, ip.rating_avg AS instructor_rating
       FROM live_sessions ls JOIN users u ON u.id = ls.instructor_id
       LEFT JOIN instructor_profiles ip ON ip.user_id = ls.instructor_id
       LEFT JOIN courses c ON c.id = ls.course_id
      WHERE ls.id = ?`, Number(req.params.id));
  if (!session) throw notFound('الحصة غير موجودة');

  const access = checkAccess(req.user?.id, 'live_session', session.id, { user: req.user });
  const booking = req.user
    ? q.get('SELECT * FROM live_bookings WHERE session_id = ? AND user_id = ?', session.id, req.user.id) : null;

  const payload = { ...session };
  if (!access.allowed) { payload.meeting_url = null; payload.room_code = null; }

  res.json({
    session: payload, access, booking,
    seatsLeft: Math.max(0, session.capacity - session.booked_count),
    reviews: q.all(
      `SELECT r.*, u.name AS user_name FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.item_type='live_session' AND r.item_id = ? AND r.status='published' ORDER BY r.id DESC LIMIT 20`, session.id),
  });
}));

/* ---------------------- حجز حصة مجانية ---------------------- */
router.post('/:id/book', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const session = q.get('SELECT * FROM live_sessions WHERE id = ?', Number(req.params.id));
  if (!session) throw notFound('الحصة غير موجودة');
  if (session.status === 'cancelled') throw new AppError('أُلغيت هذه الحصة', 400, 'session_cancelled');
  if (session.status === 'ended') throw new AppError('انتهت هذه الحصة', 400, 'session_ended');

  const booked = q.val("SELECT COUNT(*) AS c FROM live_bookings WHERE session_id = ? AND status NOT IN ('cancelled','refunded')", session.id);
  if (booked >= session.capacity) throw new AppError('اكتمل العدد في هذه الحصة', 409, 'session_full');

  if (session.price > 0) {
    const access = checkAccess(req.user.id, 'live_session', session.id, { user: req.user });
    if (!access.allowed) throw paymentRequired('هذه حصة مدفوعة — أتمم الشراء لحجز مقعدك');
  }
  grantAccess(req.user.id, 'live_session', session.id, { source: session.price > 0 ? 'subscription' : 'free' });

  notify(session.instructor_id, {
    type: 'booking', title: 'حجز جديد في حصتك',
    body: `${req.user.name} حجز مقعداً في «${session.title}»`, link: '#/instructor/live',
  });
  res.json({ ok: true, booking: q.get('SELECT * FROM live_bookings WHERE session_id = ? AND user_id = ?', session.id, req.user.id) });
}));

/* ---------------------- إلغاء الحجز ---------------------- */
router.post('/:id/cancel-booking', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const session = q.get('SELECT * FROM live_sessions WHERE id = ?', Number(req.params.id));
  if (!session) throw notFound('الحصة غير موجودة');
  // الإلغاء متاح حتى ساعتين قبل البدء
  if (new Date(session.starts_at).getTime() - Date.now() < 2 * 3600000) {
    throw new AppError('لا يمكن الإلغاء قبل أقل من ساعتين من موعد الحصة', 400, 'too_late');
  }
  q.run("UPDATE live_bookings SET status = 'cancelled' WHERE session_id = ? AND user_id = ?", session.id, req.user.id);
  res.json({ ok: true, message: 'أُلغي الحجز. لطلب استرجاع المبلغ تواصل مع الدعم.' });
}));

/* ---------------------- دخول القاعة ---------------------- */
router.get('/:id/room', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const session = q.get('SELECT * FROM live_sessions WHERE id = ?', Number(req.params.id));
  if (!session) throw notFound('الحصة غير موجودة');

  const isHost = session.instructor_id === req.user.id || req.user.role === 'admin';
  const access = checkAccess(req.user.id, 'live_session', session.id, { user: req.user });
  if (!isHost && !access.allowed) throw paymentRequired('احجز مقعدك أولاً للدخول إلى القاعة');

  // بوابة زمنية: الدخول يفتح قبل الموعد بـ ١٥ دقيقة
  const startsIn = new Date(session.starts_at).getTime() - Date.now();
  const endsAt = new Date(session.starts_at).getTime() + session.duration_minutes * 60000;
  const openEarly = 15 * 60000;
  if (!isHost && startsIn > openEarly) {
    throw new AppError(`تفتح القاعة قبل الموعد بـ ١٥ دقيقة (${new Date(session.starts_at).toLocaleString('ar')})`, 403, 'room_not_open');
  }
  if (Date.now() > endsAt + 3600000 && session.status !== 'live') {
    throw new AppError('انتهت هذه الحصة', 400, 'session_ended');
  }

  if (!isHost) {
    q.run("UPDATE live_bookings SET joined_at = COALESCE(joined_at, ?), status = 'attended' WHERE session_id = ? AND user_id = ?",
      nowIso(), session.id, req.user.id);
  }

  res.json({
    session, isHost,
    roomCode: session.room_code,
    meetingUrl: session.meeting_url,
    provider: session.meeting_provider,
    messages: q.all(
      `SELECT m.*, u.name AS user_name, u.avatar AS user_avatar FROM live_messages m JOIN users u ON u.id = m.user_id
        WHERE m.session_id = ? ORDER BY m.id DESC LIMIT 100`, session.id).reverse(),
    participants: q.all(
      `SELECT u.id, u.name, u.avatar, b.status, b.joined_at FROM live_bookings b JOIN users u ON u.id = b.user_id
        WHERE b.session_id = ? AND b.status NOT IN ('cancelled','refunded') ORDER BY b.joined_at DESC`, session.id),
  });
}));

/* ======================= إدارة الحصص (المعلّم) ======================= */
const sessionSchema = z.object({
  course_id: z.coerce.number().int().positive().optional().nullable(),
  category_id: z.coerce.number().int().positive().optional().nullable(),
  title: arabicText(3, 150),
  description: z.string().trim().max(5000).optional().nullable(),
  cover: z.string().trim().max(500).optional().nullable(),
  starts_at: z.string().datetime({ offset: true }).or(z.string().min(10)),
  duration_minutes: z.coerce.number().int().min(10).max(600).default(60),
  capacity: z.coerce.number().int().min(1).max(1000).default(30),
  price: priceField.default(0),
  meeting_provider: z.enum(['internal', 'zoom', 'meet', 'teams', 'other']).default('internal'),
  meeting_url: z.string().trim().max(500).optional().nullable(),
});

function assertSessionOwner(id, user) {
  const session = q.get('SELECT * FROM live_sessions WHERE id = ?', id);
  if (!session) throw notFound('الحصة غير موجودة');
  if (user.role !== 'admin' && session.instructor_id !== user.id) throw forbidden('هذه ليست حصتك');
  return session;
}

router.post('/', attachUser, requireInstructor, validate(sessionSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const startsAt = new Date(b.starts_at);
  if (Number.isNaN(startsAt.getTime())) throw new AppError('تاريخ غير صالح', 400, 'invalid_date');
  if (startsAt.getTime() < Date.now()) throw new AppError('لا يمكن جدولة حصة في الماضي', 400, 'past_date');
  if (b.course_id) {
    const course = q.get('SELECT instructor_id FROM courses WHERE id = ?', b.course_id);
    if (!course || (course.instructor_id !== req.user.id && req.user.role !== 'admin')) {
      throw forbidden('لا يمكنك ربط الحصة بدورة ليست لك');
    }
  }
  if (b.meeting_provider !== 'internal' && !b.meeting_url) {
    throw new AppError('أضف رابط الاجتماع الخارجي', 400, 'missing_meeting_url');
  }

  const info = q.run(
    `INSERT INTO live_sessions (course_id, instructor_id, category_id, title, description, cover, starts_at,
                                duration_minutes, capacity, price, meeting_provider, meeting_url, room_code)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    b.course_id ?? null, req.user.id, b.category_id ?? null, b.title, b.description ?? null, b.cover ?? null,
    startsAt.toISOString(), b.duration_minutes, b.capacity, b.price, b.meeting_provider, b.meeting_url ?? null,
    randomCode(7));

  const session = q.get('SELECT * FROM live_sessions WHERE id = ?', info.lastInsertRowid);
  if (b.course_id) {
    const students = q.all('SELECT user_id FROM enrollments WHERE course_id = ?', b.course_id);
    notifyMany(students.map(s => s.user_id), {
      type: 'live_scheduled', title: 'حصة مباشرة جديدة',
      body: `${b.title} — ${startsAt.toLocaleString('ar')}`, link: `#/live/${session.id}`,
    });
  }
  res.status(201).json(session);
}));

router.patch('/:id', attachUser, requireInstructor, validate(sessionSchema.partial()), asyncHandler(async (req, res) => {
  const session = assertSessionOwner(Number(req.params.id), req.user);
  const fields = Object.entries(req.body).filter(([, v]) => v !== undefined);
  if (fields.length) {
    q.run(`UPDATE live_sessions SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...fields.map(([, v]) => v), session.id);
  }
  if (req.body.starts_at) {
    const attendees = q.all("SELECT user_id FROM live_bookings WHERE session_id = ? AND status = 'booked'", session.id);
    notifyMany(attendees.map(a => a.user_id), {
      type: 'live_updated', title: 'تغيّر موعد حصة محجوزة',
      body: `${session.title} — الموعد الجديد ${new Date(req.body.starts_at).toLocaleString('ar')}`,
      link: `#/live/${session.id}`,
    });
  }
  res.json(q.get('SELECT * FROM live_sessions WHERE id = ?', session.id));
}));

router.post('/:id/start', attachUser, requireInstructor, asyncHandler(async (req, res) => {
  const session = assertSessionOwner(Number(req.params.id), req.user);
  q.run("UPDATE live_sessions SET status = 'live', started_at = ? WHERE id = ?", nowIso(), session.id);
  const attendees = q.all("SELECT user_id FROM live_bookings WHERE session_id = ? AND status NOT IN ('cancelled','refunded')", session.id);
  notifyMany(attendees.map(a => a.user_id), {
    type: 'live_started', title: '🔴 بدأت الحصة الآن',
    body: session.title, link: `#/live/${session.id}/room`,
  });
  req.app.get('io')?.to(`live:${session.id}`).emit('session:started', { sessionId: session.id });
  res.json({ ok: true, status: 'live' });
}));

router.post('/:id/end', attachUser, requireInstructor, validate(z.object({
  recording_url: z.string().trim().max(500).optional().nullable(),
})), asyncHandler(async (req, res) => {
  const session = assertSessionOwner(Number(req.params.id), req.user);
  q.run("UPDATE live_sessions SET status = 'ended', ended_at = ?, recording_url = COALESCE(?, recording_url) WHERE id = ?",
    nowIso(), req.body.recording_url ?? null, session.id);
  // من لم يحضر يُسجَّل غائباً
  q.run("UPDATE live_bookings SET status = 'absent' WHERE session_id = ? AND status = 'booked'", session.id);
  req.app.get('io')?.to(`live:${session.id}`).emit('session:ended', { sessionId: session.id });
  res.json({ ok: true, status: 'ended' });
}));

router.post('/:id/cancel', attachUser, requireInstructor, validate(z.object({
  reason: z.string().trim().max(500).optional(),
})), asyncHandler(async (req, res) => {
  const session = assertSessionOwner(Number(req.params.id), req.user);
  q.run("UPDATE live_sessions SET status = 'cancelled' WHERE id = ?", session.id);
  const attendees = q.all("SELECT user_id FROM live_bookings WHERE session_id = ? AND status NOT IN ('cancelled','refunded')", session.id);
  notifyMany(attendees.map(a => a.user_id), {
    type: 'live_cancelled', title: 'أُلغيت حصة محجوزة',
    body: `${session.title}${req.body.reason ? ` — ${req.body.reason}` : ''}. تواصل مع الدعم لاسترجاع المبلغ.`,
    link: '#/orders',
  });
  res.json({ ok: true, notified: attendees.length });
}));

/* ---------------------- كشف الحضور ---------------------- */
router.get('/:id/attendance', attachUser, requireInstructor, asyncHandler(async (req, res) => {
  const session = assertSessionOwner(Number(req.params.id), req.user);
  res.json({
    session: { id: session.id, title: session.title, starts_at: session.starts_at },
    attendance: q.all(
      `SELECT u.id, u.name, u.email, b.status, b.joined_at, b.left_at, b.attendance_minutes, b.rating
         FROM live_bookings b JOIN users u ON u.id = b.user_id
        WHERE b.session_id = ? ORDER BY b.status, u.name`, session.id),
  });
}));

/* ---------------------- حصصي (طالب) ---------------------- */
router.get('/my/bookings', attachUser, requireAuth, asyncHandler(async (req, res) => {
  res.json({
    data: q.all(
      `SELECT ls.id, ls.title, ls.starts_at, ls.duration_minutes, ls.status, ls.cover, ls.recording_url,
              b.status AS booking_status, u.name AS instructor_name
         FROM live_bookings b JOIN live_sessions ls ON ls.id = b.session_id JOIN users u ON u.id = ls.instructor_id
        WHERE b.user_id = ? AND b.status NOT IN ('cancelled','refunded')
        ORDER BY ls.starts_at DESC`, req.user.id),
  });
}));

export default router;
