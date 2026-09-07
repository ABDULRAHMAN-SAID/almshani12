import { Router } from 'express';
import { z } from 'zod';
import { CoursesQuery, LessonProgressUpdate, QuizSubmit } from '@manassah/shared';
import { config } from '../config.ts';
import { db, q, json, nowIso } from '../db/index.ts';
import { AppError, asyncHandler, notFound, forbidden, badRequest } from '../lib/errors.ts';
import { validate, body, query, idParam } from '../lib/validate.ts';
import { attachUser, requireAuth, requireVerifiedTeacher, hasRole } from '../lib/auth.ts';
import { paginate, pageMeta, money, iso } from '../lib/helpers.ts';
import { checkAccess, ownedIds, favoriteIds } from '../services/access.ts';
import { signedUrl, upload, storeUpload, publicUrl } from '../services/storage.ts';
import { courseCard, reviewItems } from '../services/mappers.ts';
import { scoreQuiz, quizForStudent } from '../services/quiz.ts';
import { notifyStaff } from '../services/notifications.ts';
import { resolveLearner } from '../services/learners.ts';

const router = Router();

router.get('/', attachUser, validate(CoursesQuery, 'query'), (req, res) => {
  const f = query<typeof CoursesQuery>(req);
  const where = ["c.status = 'published'"];
  const params: unknown[] = [];
  if (f.q) { where.push('(norm(c.title) LIKE norm(?) OR norm(s.name) LIKE norm(?))'); params.push(`%${f.q}%`, `%${f.q}%`); }
  if (f.gradeId) { where.push('c.grade_id = ?'); params.push(f.gradeId); }
  if (f.subjectId) { where.push('c.subject_id = ?'); params.push(f.subjectId); }
  if (f.teacherId) { where.push('c.teacher_id = ?'); params.push(f.teacherId); }
  const order = { popular: 'c.sales_count DESC, c.rating_avg DESC', newest: 'c.published_at DESC', rating: 'c.rating_avg DESC', price_asc: 'c.price ASC' }[f.sort];
  const from = `FROM courses c JOIN subjects s ON s.id = c.subject_id WHERE ${where.join(' AND ')}`;
  const total = q.val<number>(`SELECT COUNT(*) ${from}`, ...params) ?? 0;
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT c.* ${from} ORDER BY ${order}, c.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  const ctx = { userId: req.user?.id, enrolled: ownedIds(req.user?.id, 'course'), fav: favoriteIds(req.user?.id, 'course') };
  res.json({ data: rows.map(c => courseCard(c, ctx)), meta: pageMeta(total, f.page, f.limit) });
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = q.all<any>('SELECT * FROM courses WHERE teacher_id = ? ORDER BY id DESC LIMIT 200', req.user!.id);
  const mineCtx = { userId: req.user!.id, enrolled: ownedIds(req.user!.id, 'course'), fav: favoriteIds(req.user!.id, 'course') };
  res.json(rows.map(c => ({ ...courseCard(c, mineCtx), status: c.status, rejectReason: c.reject_reason })));
});

/** دروس الدورة المكتملة للمستخدم — استعلام واحد بدل استعلام لكل درس */
const completedLessonIds = (uid: number | undefined, courseId: number): Set<number> =>
  new Set(uid ? q.all<{ lesson_id: number }>(`SELECT lp.lesson_id FROM lesson_progress lp JOIN course_lessons l ON l.id = lp.lesson_id JOIN course_sections cs ON cs.id = l.section_id
    WHERE lp.user_id = ? AND lp.completed = 1 AND cs.course_id = ?`, uid, courseId).map(r => r.lesson_id) : []);

const lessonItem = (l: any, done: Set<number>, allowed: boolean) => ({
  id: l.id, title: l.title, kind: l.kind, durationSeconds: l.duration_seconds, isPreview: !!l.is_preview,
  completed: done.has(l.id),
  locked: !allowed && !l.is_preview,
});

router.get('/:id', attachUser, (req, res) => {
  const id = idParam(req);
  const uid = req.user?.id;
  const c = q.get<any>('SELECT * FROM courses WHERE id = ?', id);
  if (!c || (c.status !== 'published' && c.teacher_id !== uid && !hasRole(req.user, 'content_reviewer'))) throw notFound('الدورة غير موجودة');
  const allowed = checkAccess(uid, 'course', id, req.user?.roles ?? []).allowed;
  // كل الدروس باستعلام واحد مرتّبة بالقسم ثم الترتيب — لا استعلام لكل قسم ولا لكل درس
  const done = completedLessonIds(uid, id);
  const allLessons = q.all<any>('SELECT l.* FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ? ORDER BY l."order", l.id', id);
  const sections = q.all<any>('SELECT * FROM course_sections WHERE course_id = ? ORDER BY "order", id', id).map(s => ({
    id: s.id, title: s.title,
    lessons: allLessons.filter(l => l.section_id === s.id).map(l => lessonItem(l, done, allowed)),
  }));
  const canReview = !!uid && allowed && !q.get('SELECT 1 FROM reviews WHERE user_id = ? AND target_type = ? AND target_id = ?', uid, 'course', id);
  if (uid) q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', uid, 'course_view', JSON.stringify({ id }));
  res.json({
    ...courseCard(c, { userId: uid }),
    trailerUrl: c.trailer_file_id ? signedUrl(c.trailer_file_id, uid ?? 0, 3600).url : null,
    description: c.description, learnPoints: json<string[]>(c.learn_points, []), requirements: json<string[]>(c.requirements, []),
    sections, reviews: reviewItems('course', id), canReview, status: c.status,
  });
});

/** تشغيل درس: الفيديو برابط موقّع لا يُخزَّن؛ القفل في الخادم لا في الواجهة */
router.get('/:id/lessons/:lessonId', requireAuth, (req, res) => {
  const courseId = idParam(req), lessonId = idParam(req, 'lessonId');
  const uid = req.user!.id;
  const l = q.get<any>('SELECT l.*, cs.course_id FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE l.id = ? AND cs.course_id = ?', lessonId, courseId);
  if (!l) throw notFound('الدرس غير موجود');
  const allowed = checkAccess(uid, 'course', courseId, req.user!.roles).allowed;
  if (!allowed && !l.is_preview) throw new AppError('payment_required', 'اشترك في الدورة لمشاهدة هذا الدرس', 402);
  const all = q.all<any>('SELECT l.* FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ? ORDER BY cs."order", cs.id, l."order", l.id', courseId);
  const done = completedLessonIds(uid, courseId);
  const idx = all.findIndex(x => x.id === lessonId);
  const ttl = Math.max(3600, l.duration_seconds * 3);
  const link = l.video_file_id ? signedUrl(l.video_file_id, uid, ttl) : null;
  const pos = q.val<number>('SELECT position_seconds FROM lesson_progress WHERE user_id = ? AND lesson_id = ?', uid, lessonId) ?? 0;
  q.run('UPDATE course_enrollments SET last_lesson_id = ? WHERE user_id = ? AND course_id = ?', lessonId, uid, courseId);
  res.json({
    lesson: lessonItem(l, done, allowed), videoUrl: link?.url ?? null, readingBody: l.reading_body ?? null, quizId: l.quiz_id ?? null,
    positionSeconds: pos, expiresAt: link?.expiresAt ?? new Date(Date.now() + ttl * 1000).toISOString(),
    next: all[idx + 1] ? lessonItem(all[idx + 1], done, allowed) : null, prev: all[idx - 1] ? lessonItem(all[idx - 1], done, allowed) : null,
  });
});

/** تقدّم الدرس → نسبة الدورة تُحسب من الدروس المكتملة فعلاً */
router.put('/lessons/:lessonId/progress', requireAuth, validate(LessonProgressUpdate), (req, res) => {
  const lessonId = idParam(req, 'lessonId');
  const uid = req.user!.id;
  const p = body<typeof LessonProgressUpdate>(req);
  const l = q.get<any>('SELECT l.*, cs.course_id FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE l.id = ?', lessonId);
  if (!l) throw notFound();
  if (!checkAccess(uid, 'course', l.course_id, req.user!.roles).allowed && !l.is_preview) throw forbidden();
  const completed = p.completed ?? (l.duration_seconds > 0 && p.positionSeconds >= l.duration_seconds * 0.9);
  db.transaction(() => {
    q.run(`INSERT INTO lesson_progress (user_id, lesson_id, position_seconds, completed, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(user_id, lesson_id) DO UPDATE SET position_seconds = excluded.position_seconds, completed = MAX(lesson_progress.completed, excluded.completed), updated_at = excluded.updated_at`,
      uid, lessonId, p.positionSeconds, completed ? 1 : 0, nowIso());
    const total = q.val<number>('SELECT COUNT(*) FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ?', l.course_id) ?? 0;
    const done = q.val<number>('SELECT COUNT(*) FROM lesson_progress lp JOIN course_lessons l ON l.id = lp.lesson_id JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ? AND lp.user_id = ? AND lp.completed = 1', l.course_id, uid) ?? 0;
    const percent = total ? Math.round((done / total) * 100) : 0;
    q.run('UPDATE course_enrollments SET progress_percent = ?, last_lesson_id = ?, completed_at = CASE WHEN ? >= 100 THEN COALESCE(completed_at, ?) ELSE completed_at END WHERE user_id = ? AND course_id = ?', percent, lessonId, percent, nowIso(), uid, l.course_id);
    if (completed) q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', uid, 'course_lesson_completed', JSON.stringify({ lessonId }));
  })();
  res.json({ ok: true, completed: !!completed });
});

/* ---------- الاختبارات ---------- */
function quizAccessible(quizId: number, user: { id: number; roles: any[] }) {
  const z = q.get<any>('SELECT * FROM quizzes WHERE id = ?', quizId);
  if (!z) throw notFound('الاختبار غير موجود');
  if (z.owner_type === 'course') return checkAccess(user.id, 'course', z.owner_id, user.roles).allowed;
  if (z.owner_type === 'course_lesson') {
    const l = q.get<any>('SELECT l.is_preview, cs.course_id FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE l.id = ?', z.owner_id);
    return !!l && (!!l.is_preview || checkAccess(user.id, 'course', l.course_id, user.roles).allowed);
  }
  if (z.owner_type === 'book') return checkAccess(user.id, 'book', z.owner_id, user.roles).allowed;
  return true; // اختبارات الوحدات والاختبارات السريعة مفتوحة
}
router.get('/quizzes/:quizId', requireAuth, (req, res) => {
  const id = idParam(req, 'quizId');
  if (!quizAccessible(id, req.user!)) throw new AppError('payment_required', 'هذا الاختبار ضمن محتوى مدفوع', 402);
  q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', req.user!.id, 'quiz_started', JSON.stringify({ id }));
  res.json(quizForStudent(id, req.user!.id));
});
router.post('/quizzes/:quizId/submit', requireAuth, validate(QuizSubmit), (req, res) => {
  const id = idParam(req, 'quizId');
  if (!quizAccessible(id, req.user!)) throw new AppError('payment_required', 'هذا الاختبار ضمن محتوى مدفوع', 402);
  const s = body<typeof QuizSubmit>(req);
  const result = scoreQuiz(id, req.user!.id, s.answers, s.durationSeconds);
  q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', req.user!.id, 'quiz_completed', JSON.stringify({ id, percent: result.percent }));
  res.json(result);
});
router.get('/quizzes/:quizId/attempts', requireAuth, (req, res) => {
  res.json(q.all<any>('SELECT id, percent, passed, duration_seconds, finished_at FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? ORDER BY id DESC LIMIT 50', idParam(req, 'quizId'), req.user!.id)
    .map(a => ({ attemptId: a.id, percent: a.percent, passed: !!a.passed, durationSeconds: a.duration_seconds, finishedAt: iso(a.finished_at) })));
});
/** اختبار سريع: أحدث اختبار وحدة/مستقل لمواد المتعلّم النشط وصفّه (بلا متعلّم: كحساب بلا مواد) */
router.get('/quick-quiz/pick', requireAuth, (req, res) => {
  const uid = req.user!.id;
  const learner = resolveLearner(req);
  const row = q.get<any>(`SELECT z.id FROM quizzes z LEFT JOIN units u ON z.owner_type = 'unit' AND u.id = z.owner_id
    WHERE z.owner_type IN ('unit','standalone') AND (u.subject_id IS NULL OR u.subject_id IN (SELECT subject_id FROM learner_subjects WHERE learner_id = ?))
    AND (u.grade_id IS NULL OR u.grade_id = ?)
    ORDER BY (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = z.id AND a.user_id = ?) ASC, RANDOM() LIMIT 1`, learner?.id ?? 0, learner?.grade_id ?? null, uid);
  if (!row) throw notFound('لا اختبارات متاحة لصفّك بعد');
  res.json({ quizId: row.id });
});

/* ---------- إنشاء الدورات (معلّم معتمد) ---------- */
const CourseUpsert = z.object({
  title: z.string().trim().min(3).max(160), subjectId: z.number().int().positive(), gradeId: z.number().int().positive(),
  description: z.string().trim().max(5000).default(''), learnPoints: z.array(z.string().max(200)).max(12).default([]),
  requirements: z.array(z.string().max(200)).max(8).default([]), price: z.number().nonnegative(),
});
const ownCourse = (req: any) => {
  const c = q.get<any>('SELECT * FROM courses WHERE id = ?', idParam(req));
  if (!c) throw notFound();
  if (c.teacher_id !== req.user!.id && !hasRole(req.user, 'admin')) throw forbidden();
  return c;
};
router.post('/', requireVerifiedTeacher, validate(CourseUpsert), (req, res) => {
  const c = body<typeof CourseUpsert>(req);
  const info = q.run('INSERT INTO courses (teacher_id, title, subject_id, grade_id, description, learn_points, requirements, price) VALUES (?,?,?,?,?,?,?,?)',
    req.user!.id, c.title, c.subjectId, c.gradeId, c.description, JSON.stringify(c.learnPoints), JSON.stringify(c.requirements), money(c.price));
  const row = q.get<any>('SELECT * FROM courses WHERE id = ?', info.lastInsertRowid);
  res.status(201).json({ ...courseCard(row, { userId: req.user!.id }), status: row.status });
});
router.patch('/:id', requireVerifiedTeacher, validate(CourseUpsert), (req, res) => {
  const cur = ownCourse(req); const c = body<typeof CourseUpsert>(req);
  q.run(`UPDATE courses SET title=?, subject_id=?, grade_id=?, description=?, learn_points=?, requirements=?, price=?, updated_at=?,
         status = CASE WHEN status IN ('published','approved') THEN 'pending_review' ELSE status END WHERE id = ?`,
    c.title, c.subjectId, c.gradeId, c.description, JSON.stringify(c.learnPoints), JSON.stringify(c.requirements), money(c.price), nowIso(), cur.id);
  const row = q.get<any>('SELECT * FROM courses WHERE id = ?', cur.id);
  res.json({ ...courseCard(row, { userId: req.user!.id }), status: row.status });
});
const SectionBody = z.object({ title: z.string().trim().min(1).max(120) });
router.post('/:id/sections', requireVerifiedTeacher, validate(SectionBody), (req, res) => {
  const c = ownCourse(req);
  const order = (q.val<number>('SELECT COALESCE(MAX("order"),0) FROM course_sections WHERE course_id = ?', c.id) ?? 0) + 1;
  const info = q.run('INSERT INTO course_sections (course_id, title, "order") VALUES (?,?,?)', c.id, body<typeof SectionBody>(req).title, order);
  res.status(201).json({ id: Number(info.lastInsertRowid), title: body<typeof SectionBody>(req).title, lessons: [] });
});
const LessonBody = z.object({
  sectionId: z.number().int().positive(), title: z.string().trim().min(1).max(160), kind: z.enum(['video', 'quiz', 'reading']).default('video'),
  readingBody: z.string().max(20000).nullable().optional(), quizId: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().int().min(0).default(0), isPreview: z.boolean().default(false),
});
router.post('/:id/lessons', requireVerifiedTeacher, validate(LessonBody), (req, res) => {
  const c = ownCourse(req); const l = body<typeof LessonBody>(req);
  if (!q.get('SELECT 1 FROM course_sections WHERE id = ? AND course_id = ?', l.sectionId, c.id)) throw badRequest('القسم لا يتبع هذه الدورة');
  const order = (q.val<number>('SELECT COALESCE(MAX("order"),0) FROM course_lessons WHERE section_id = ?', l.sectionId) ?? 0) + 1;
  const info = q.run('INSERT INTO course_lessons (section_id, title, kind, reading_body, quiz_id, duration_seconds, is_preview, "order") VALUES (?,?,?,?,?,?,?,?)',
    l.sectionId, l.title, l.kind, l.readingBody ?? null, l.quizId ?? null, l.durationSeconds, l.isPreview ? 1 : 0, order);
  res.status(201).json({ id: Number(info.lastInsertRowid), ...l });
});
router.post('/:id/lessons/:lessonId/video', requireVerifiedTeacher, upload(config.uploads.maxSizeMb), asyncHandler(async (req, res) => {
  const c = ownCourse(req); const lessonId = idParam(req, 'lessonId');
  if (!req.file || !req.file.mimetype.startsWith('video/')) throw badRequest('ارفع ملف فيديو');
  if (!q.get('SELECT 1 FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE l.id = ? AND cs.course_id = ?', lessonId, c.id)) throw notFound();
  const f = storeUpload(req.file, { ownerId: req.user!.id, purpose: 'video', visibility: 'private' });
  const dur = Number(req.body?.durationSeconds ?? 0);
  q.run('UPDATE course_lessons SET video_file_id = ?, duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END WHERE id = ?', f.id, dur, dur, lessonId);
  res.status(201).json({ fileId: f.id });
}));
router.post('/:id/cover', requireVerifiedTeacher, upload(8), asyncHandler(async (req, res) => {
  const c = ownCourse(req);
  if (!req.file || !req.file.mimetype.startsWith('image/')) throw badRequest('الغلاف يجب أن يكون صورة');
  const f = storeUpload(req.file, { ownerId: req.user!.id, purpose: 'cover', visibility: 'public' });
  q.run('UPDATE courses SET cover_file_id = ?, updated_at = ? WHERE id = ?', f.id, nowIso(), c.id);
  res.status(201).json({ fileId: f.id, url: publicUrl(f.id) });
}));
/** اختبار داخل دورة (أسئلة مع الإجابات — لا تُرسَل للطلاب) */
const QuizBody = z.object({
  title: z.string().trim().min(2).max(160), ownerType: z.enum(['course', 'course_lesson', 'book', 'unit', 'standalone']), ownerId: z.number().int().nullable(),
  passScore: z.number().int().min(0).max(100).default(60), timeLimitSeconds: z.number().int().min(0).default(0), attemptsAllowed: z.number().int().min(0).default(3),
  questions: z.array(z.object({
    type: z.enum(['mcq', 'true_false', 'short']), text: z.string().min(1).max(2000), options: z.array(z.string().max(300)).max(8).default([]),
    answer: z.union([z.array(z.number().int()), z.array(z.string())]), explanation: z.string().max(2000).nullable().optional(), topicTag: z.string().max(60).nullable().optional(), points: z.number().int().min(1).default(1),
  })).min(1).max(100),
});
router.post('/quizzes', requireVerifiedTeacher, validate(QuizBody), (req, res) => {
  const z = body<typeof QuizBody>(req);
  const id = db.transaction(() => {
    const info = q.run('INSERT INTO quizzes (owner_type, owner_id, author_id, title, pass_score, time_limit_seconds, attempts_allowed) VALUES (?,?,?,?,?,?,?)',
      z.ownerType, z.ownerId, req.user!.id, z.title, z.passScore, z.timeLimitSeconds, z.attemptsAllowed);
    const quizId = Number(info.lastInsertRowid);
    z.questions.forEach((qq, i) => q.run('INSERT INTO quiz_questions (quiz_id, type, text, options, answer, explanation, topic_tag, points, "order") VALUES (?,?,?,?,?,?,?,?,?)',
      quizId, qq.type, qq.text, JSON.stringify(qq.type === 'true_false' ? ['صح', 'خطأ'] : qq.options), JSON.stringify(qq.answer), qq.explanation ?? null, qq.topicTag ?? null, qq.points, i));
    return quizId;
  })();
  res.status(201).json({ id });
});
router.post('/:id/submit', requireVerifiedTeacher, (req, res) => {
  const c = ownCourse(req);
  const lessons = q.val<number>('SELECT COUNT(*) FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ?', c.id) ?? 0;
  if (!lessons) throw badRequest('أضف درساً واحداً على الأقل');
  q.run("UPDATE courses SET status = 'pending_review', reject_reason = NULL, updated_at = ? WHERE id = ?", nowIso(), c.id);
  notifyStaff(['content_reviewer', 'admin'], { type: 'system', title: 'دورة جديدة بانتظار المراجعة', body: c.title, data: { courseId: c.id } });
  res.json({ ok: true, status: 'pending_review' });
});

export default router;
