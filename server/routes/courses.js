import express from 'express';
import { db, q } from '../db/database.js';
import { asyncHandler, AppError, notFound, forbidden, paymentRequired } from '../middleware/error.js';
import { validate, z, arabicText, priceField } from '../middleware/validate.js';
import { attachUser, requireAuth, requireInstructor } from '../middleware/auth.js';
import { paginate, pageMeta, uniqueSlug, json, toJson, nowIso } from '../utils/helpers.js';
import { checkAccess, grantAccess } from '../services/access.js';
import { notifyAdmins, notifyCourseStudents } from '../services/notifications.js';

const router = express.Router();

const courseCard = `
  c.id, c.title, c.slug, c.subtitle, c.level, c.type, c.language, c.price, c.discount_price,
  c.thumbnail, c.rating_avg, c.rating_count, c.students_count, c.featured, c.published_at, c.status,
  c.instructor_id, u.name AS instructor_name, u.avatar AS instructor_avatar,
  cat.name AS category_name, cat.slug AS category_slug,
  (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count,
  (SELECT COALESCE(SUM(l.duration_seconds),0) FROM lessons l WHERE l.course_id = c.id) AS total_seconds`;

/* ---------------------- قائمة الدورات مع الفلاتر ---------------------- */
router.get('/', attachUser, asyncHandler(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { search, category, level, type, min_price, max_price, sort = 'newest', free, instructor } = req.query;

  const where = ["c.status = 'published'"];
  const params = [];

  if (search) { where.push('(c.title LIKE ? OR c.subtitle LIKE ? OR c.description LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
  if (category) { where.push('cat.slug = ?'); params.push(category); }
  if (level) { where.push('c.level = ?'); params.push(level); }
  if (type) { where.push('c.type = ?'); params.push(type); }
  if (instructor) { where.push('c.instructor_id = ?'); params.push(Number(instructor)); }
  if (free === 'true') where.push('COALESCE(c.discount_price, c.price) = 0');
  if (min_price) { where.push('COALESCE(c.discount_price, c.price) >= ?'); params.push(Number(min_price)); }
  if (max_price) { where.push('COALESCE(c.discount_price, c.price) <= ?'); params.push(Number(max_price)); }

  const orderBy = {
    newest: 'c.published_at DESC, c.id DESC',
    popular: 'c.students_count DESC, c.rating_avg DESC',
    rating: 'c.rating_avg DESC, c.rating_count DESC',
    price_asc: 'COALESCE(c.discount_price, c.price) ASC',
    price_desc: 'COALESCE(c.discount_price, c.price) DESC',
  }[sort] || 'c.published_at DESC';

  const whereSql = where.join(' AND ');
  const total = q.val(
    `SELECT COUNT(*) AS c FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id WHERE ${whereSql}`, ...params);

  const rows = q.all(
    `SELECT ${courseCard} FROM courses c
       JOIN users u ON u.id = c.instructor_id
       LEFT JOIN categories cat ON cat.id = c.category_id
      WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...params, limit, offset);

  res.json({ data: rows, meta: pageMeta(total, { page, limit }) });
}));

/* ---------------------- تفاصيل دورة ---------------------- */
router.get('/:slug', attachUser, asyncHandler(async (req, res) => {
  const course = q.get(
    `SELECT c.*, u.name AS instructor_name, u.avatar AS instructor_avatar, u.bio AS instructor_bio,
            ip.title AS instructor_title, ip.rating_avg AS instructor_rating, ip.students_count AS instructor_students,
            cat.name AS category_name, cat.slug AS category_slug
       FROM courses c JOIN users u ON u.id = c.instructor_id
       LEFT JOIN instructor_profiles ip ON ip.user_id = c.instructor_id
       LEFT JOIN categories cat ON cat.id = c.category_id
      WHERE c.slug = ? OR c.id = ?`, req.params.slug, Number(req.params.slug) || 0);
  if (!course) throw notFound('الدورة غير موجودة');

  const isOwner = req.user && (req.user.id === course.instructor_id || req.user.role === 'admin');
  if (course.status !== 'published' && !isOwner) throw notFound('الدورة غير متاحة');

  const access = checkAccess(req.user?.id, 'course', course.id, { user: req.user });
  const sections = q.all('SELECT * FROM sections WHERE course_id = ? ORDER BY position, id', course.id);
  const lessons = q.all(
    `SELECT id, section_id, title, type, duration_seconds, position, is_free_preview,
            CASE WHEN ? OR is_free_preview = 1 THEN content_url ELSE NULL END AS content_url
       FROM lessons WHERE course_id = ? ORDER BY position, id`,
    access.allowed ? 1 : 0, course.id);

  const curriculum = sections.map(s => ({ ...s, lessons: lessons.filter(l => l.section_id === s.id) }));
  const orphans = lessons.filter(l => !l.section_id);
  if (orphans.length) curriculum.push({ id: null, title: 'دروس متفرّقة', lessons: orphans });

  const reviews = q.all(
    `SELECT r.*, u.name AS user_name, u.avatar AS user_avatar FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.item_type = 'course' AND r.item_id = ? AND r.status = 'published' ORDER BY r.id DESC LIMIT 20`, course.id);

  const liveSessions = q.all(
    `SELECT id, title, starts_at, duration_minutes, price, status, capacity,
            (SELECT COUNT(*) FROM live_bookings b WHERE b.session_id = ls.id AND b.status <> 'cancelled') AS booked
       FROM live_sessions ls WHERE course_id = ? AND status <> 'cancelled' ORDER BY starts_at`, course.id);

  const progress = req.user ? q.get('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', req.user.id, course.id) : null;

  res.json({
    course: {
      ...course,
      outcomes: json(course.outcomes, []),
      requirements: json(course.requirements, []),
      total_seconds: q.val('SELECT COALESCE(SUM(duration_seconds),0) AS s FROM lessons WHERE course_id = ?', course.id),
      lessons_count: lessons.length,
    },
    curriculum, reviews, liveSessions, access, progress,
  });
}));

/* ---------------------- محتوى درس (محميّ) ---------------------- */
router.get('/:courseId/lessons/:lessonId', attachUser, asyncHandler(async (req, res) => {
  const lesson = q.get('SELECT * FROM lessons WHERE id = ? AND course_id = ?',
    Number(req.params.lessonId), Number(req.params.courseId));
  if (!lesson) throw notFound('الدرس غير موجود');

  const access = checkAccess(req.user?.id, 'course', lesson.course_id, { user: req.user });
  if (!access.allowed && !lesson.is_free_preview) {
    throw paymentRequired('هذا الدرس متاح للمشتركين في الدورة فقط');
  }

  const quiz = q.get('SELECT id, title, pass_score, time_limit_seconds, attempts_allowed FROM quizzes WHERE lesson_id = ?', lesson.id);
  const notes = req.user ? q.all('SELECT * FROM notes WHERE user_id = ? AND lesson_id = ? ORDER BY at_seconds', req.user.id, lesson.id) : [];
  const nextLesson = q.get(
    'SELECT id, title FROM lessons WHERE course_id = ? AND position > ? ORDER BY position LIMIT 1',
    lesson.course_id, lesson.position);

  res.json({ lesson, quiz, notes, nextLesson, access });
}));

/* ---------------------- تتبّع التقدّم ---------------------- */
router.post('/:courseId/lessons/:lessonId/progress', attachUser, requireAuth, validate(z.object({
  completed: z.boolean().optional(),
  seconds_watched: z.coerce.number().int().min(0).optional(),
})), asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const lessonId = Number(req.params.lessonId);
  const access = checkAccess(req.user.id, 'course', courseId, { user: req.user });
  if (!access.allowed) throw paymentRequired();
  if (!q.get('SELECT 1 AS x FROM lessons WHERE id = ? AND course_id = ?', lessonId, courseId)) throw notFound('الدرس غير موجود');

  const result = db.transaction(() => {
    q.run(
      `INSERT INTO lesson_progress (user_id, course_id, lesson_id, completed, seconds_watched, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, lesson_id) DO UPDATE SET
         completed = MAX(lesson_progress.completed, excluded.completed),
         seconds_watched = MAX(lesson_progress.seconds_watched, excluded.seconds_watched),
         updated_at = excluded.updated_at`,
      req.user.id, courseId, lessonId, req.body.completed ? 1 : 0, req.body.seconds_watched ?? 0, nowIso());

    const totalLessons = q.val('SELECT COUNT(*) AS c FROM lessons WHERE course_id = ?', courseId);
    const done = q.val('SELECT COUNT(*) AS c FROM lesson_progress WHERE user_id = ? AND course_id = ? AND completed = 1',
      req.user.id, courseId);
    const percent = totalLessons ? Math.round((done / totalLessons) * 100) : 0;

    q.run(
      `INSERT INTO enrollments (user_id, course_id, progress_percent, last_lesson_id, completed_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, course_id) DO UPDATE SET
         progress_percent = excluded.progress_percent,
         last_lesson_id = excluded.last_lesson_id,
         completed_at = CASE WHEN excluded.progress_percent >= 100 AND enrollments.completed_at IS NULL
                             THEN excluded.completed_at ELSE enrollments.completed_at END`,
      req.user.id, courseId, percent, lessonId, percent >= 100 ? nowIso() : null);

    return { percent, completedLessons: done, totalLessons };
  })();

  res.json(result);
}));

/* ---------------------- ملاحظات الطالب ---------------------- */
router.post('/:courseId/lessons/:lessonId/notes', attachUser, requireAuth, validate(z.object({
  body: arabicText(1, 2000),
  at_seconds: z.coerce.number().int().min(0).optional().nullable(),
})), asyncHandler(async (req, res) => {
  const access = checkAccess(req.user.id, 'course', Number(req.params.courseId), { user: req.user });
  if (!access.allowed) throw paymentRequired();
  const info = q.run('INSERT INTO notes (user_id, lesson_id, at_seconds, body) VALUES (?,?,?,?)',
    req.user.id, Number(req.params.lessonId), req.body.at_seconds ?? null, req.body.body);
  res.status(201).json(q.get('SELECT * FROM notes WHERE id = ?', info.lastInsertRowid));
}));

router.delete('/notes/:id', attachUser, requireAuth, asyncHandler(async (req, res) => {
  q.run('DELETE FROM notes WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));

/* ---------------------- التسجيل في دورة مجانية ---------------------- */
router.post('/:id/enroll', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const course = q.get('SELECT * FROM courses WHERE id = ? AND status = ?', Number(req.params.id), 'published');
  if (!course) throw notFound('الدورة غير موجودة');
  const price = course.discount_price ?? course.price;
  if (price > 0) {
    const access = checkAccess(req.user.id, 'course', course.id, { user: req.user });
    if (!access.allowed) throw paymentRequired('هذه دورة مدفوعة — أضفها للسلة لإتمام الشراء');
  }
  grantAccess(req.user.id, 'course', course.id, { source: price > 0 ? 'subscription' : 'free' });
  res.json({ ok: true, enrolled: true });
}));

/* ======================= إدارة الدورة (المعلّم) ======================= */
const courseSchema = z.object({
  title: arabicText(3, 150),
  subtitle: z.string().trim().max(250).optional().nullable(),
  description: z.string().trim().max(20000).optional().nullable(),
  category_id: z.coerce.number().int().positive().optional().nullable(),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'all']).default('beginner'),
  type: z.enum(['recorded', 'live', 'hybrid']).default('recorded'),
  language: z.string().trim().max(10).default('ar'),
  price: priceField.default(0),
  discount_price: priceField.optional().nullable(),
  thumbnail: z.string().trim().max(500).optional().nullable(),
  promo_video: z.string().trim().max(500).optional().nullable(),
  outcomes: z.array(z.string().trim().max(300)).max(20).optional(),
  requirements: z.array(z.string().trim().max(300)).max(20).optional(),
});

function assertCourseOwner(courseId, user) {
  const course = q.get('SELECT * FROM courses WHERE id = ?', courseId);
  if (!course) throw notFound('الدورة غير موجودة');
  if (user.role !== 'admin' && course.instructor_id !== user.id) throw forbidden('هذه ليست دورتك');
  return course;
}

router.post('/', attachUser, requireInstructor, validate(courseSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.discount_price != null && b.discount_price > b.price) {
    throw new AppError('سعر العرض يجب أن يكون أقل من السعر الأصلي', 400, 'invalid_discount');
  }
  const info = q.run(
    `INSERT INTO courses (instructor_id, category_id, title, slug, subtitle, description, level, type, language,
                          price, discount_price, thumbnail, promo_video, outcomes, requirements, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')`,
    req.user.id, b.category_id ?? null, b.title, uniqueSlug(db, 'courses', b.title), b.subtitle ?? null,
    b.description ?? null, b.level, b.type, b.language, b.price, b.discount_price ?? null,
    b.thumbnail ?? null, b.promo_video ?? null, toJson(b.outcomes ?? []), toJson(b.requirements ?? []));
  res.status(201).json(q.get('SELECT * FROM courses WHERE id = ?', info.lastInsertRowid));
}));

router.patch('/:id', attachUser, requireInstructor, validate(courseSchema.partial()), asyncHandler(async (req, res) => {
  const course = assertCourseOwner(Number(req.params.id), req.user);
  const b = { ...req.body };
  if (b.outcomes) b.outcomes = toJson(b.outcomes);
  if (b.requirements) b.requirements = toJson(b.requirements);

  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (fields.length) {
    q.run(`UPDATE courses SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...fields.map(([, v]) => v), nowIso(), course.id);
  }
  res.json(q.get('SELECT * FROM courses WHERE id = ?', course.id));
}));

router.post('/:id/submit', attachUser, requireInstructor, asyncHandler(async (req, res) => {
  const course = assertCourseOwner(Number(req.params.id), req.user);
  const lessons = q.val('SELECT COUNT(*) AS c FROM lessons WHERE course_id = ?', course.id);
  if (lessons < 1) throw new AppError('أضف درساً واحداً على الأقل قبل إرسال الدورة للمراجعة', 400, 'no_lessons');

  q.run("UPDATE courses SET status = 'pending', updated_at = ? WHERE id = ?", nowIso(), course.id);
  notifyAdmins({ type: 'course_review', title: 'دورة بانتظار المراجعة', body: course.title, link: '#/admin/courses' });
  res.json({ ok: true, status: 'pending' });
}));

router.delete('/:id', attachUser, requireInstructor, asyncHandler(async (req, res) => {
  const course = assertCourseOwner(Number(req.params.id), req.user);
  const sold = q.val("SELECT COUNT(*) AS c FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.item_type='course' AND oi.item_id = ? AND o.status='paid'", course.id);
  if (sold > 0) {
    // لا نحذف محتوى اشتراه طلاب — نؤرشفه فقط
    q.run("UPDATE courses SET status = 'archived' WHERE id = ?", course.id);
    return res.json({ ok: true, archived: true, message: 'تمت أرشفة الدورة (لوجود مشتركين فيها)' });
  }
  q.run('DELETE FROM courses WHERE id = ?', course.id);
  res.json({ ok: true, deleted: true });
}));

/* ---------------------- الأقسام والدروس ---------------------- */
router.post('/:id/sections', attachUser, requireInstructor, validate(z.object({
  title: arabicText(2, 150), position: z.coerce.number().int().min(0).default(0),
})), asyncHandler(async (req, res) => {
  const course = assertCourseOwner(Number(req.params.id), req.user);
  const info = q.run('INSERT INTO sections (course_id, title, position) VALUES (?,?,?)',
    course.id, req.body.title, req.body.position);
  res.status(201).json(q.get('SELECT * FROM sections WHERE id = ?', info.lastInsertRowid));
}));

const lessonSchema = z.object({
  section_id: z.coerce.number().int().positive().optional().nullable(),
  title: arabicText(2, 200),
  type: z.enum(['video', 'article', 'pdf', 'quiz', 'live', 'audio']).default('video'),
  content_url: z.string().trim().max(500).optional().nullable(),
  content_text: z.string().max(50000).optional().nullable(),
  duration_seconds: z.coerce.number().int().min(0).max(86400).default(0),
  position: z.coerce.number().int().min(0).default(0),
  is_free_preview: z.coerce.boolean().default(false),
});

router.post('/:id/lessons', attachUser, requireInstructor, validate(lessonSchema), asyncHandler(async (req, res) => {
  const course = assertCourseOwner(Number(req.params.id), req.user);
  const b = req.body;
  if (b.section_id && !q.get('SELECT 1 AS x FROM sections WHERE id = ? AND course_id = ?', b.section_id, course.id)) {
    throw new AppError('القسم لا ينتمي لهذه الدورة', 400, 'invalid_section');
  }
  const position = b.position || (q.val('SELECT COALESCE(MAX(position),0) AS p FROM lessons WHERE course_id = ?', course.id) + 1);
  const info = q.run(
    `INSERT INTO lessons (course_id, section_id, title, type, content_url, content_text, duration_seconds, position, is_free_preview)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    course.id, b.section_id ?? null, b.title, b.type, b.content_url ?? null, b.content_text ?? null,
    b.duration_seconds, position, b.is_free_preview ? 1 : 0);

  if (course.status === 'published') {
    notifyCourseStudents(course.id, {
      type: 'new_lesson', title: 'درس جديد في دورتك', body: `${course.title}: ${b.title}`,
      link: `#/learn/${course.id}`,
    });
  }
  res.status(201).json(q.get('SELECT * FROM lessons WHERE id = ?', info.lastInsertRowid));
}));

router.patch('/:id/lessons/:lessonId', attachUser, requireInstructor, validate(lessonSchema.partial()), asyncHandler(async (req, res) => {
  const course = assertCourseOwner(Number(req.params.id), req.user);
  const fields = Object.entries(req.body).filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, k === 'is_free_preview' ? (v ? 1 : 0) : v]);
  if (fields.length) {
    q.run(`UPDATE lessons SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ? AND course_id = ?`,
      ...fields.map(([, v]) => v), Number(req.params.lessonId), course.id);
  }
  res.json(q.get('SELECT * FROM lessons WHERE id = ?', Number(req.params.lessonId)));
}));

router.delete('/:id/lessons/:lessonId', attachUser, requireInstructor, asyncHandler(async (req, res) => {
  const course = assertCourseOwner(Number(req.params.id), req.user);
  q.run('DELETE FROM lessons WHERE id = ? AND course_id = ?', Number(req.params.lessonId), course.id);
  res.json({ ok: true });
}));

router.put('/:id/reorder', attachUser, requireInstructor, validate(z.object({
  lessons: z.array(z.object({ id: z.coerce.number().int(), position: z.coerce.number().int().min(0) })).max(500),
})), asyncHandler(async (req, res) => {
  const course = assertCourseOwner(Number(req.params.id), req.user);
  db.transaction(() => {
    for (const l of req.body.lessons) {
      q.run('UPDATE lessons SET position = ? WHERE id = ? AND course_id = ?', l.position, l.id, course.id);
    }
  })();
  res.json({ ok: true });
}));

export default router;
