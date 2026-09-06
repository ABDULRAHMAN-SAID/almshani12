import express from 'express';
import config from '../config.js';
import { db, q } from '../db/database.js';
import { asyncHandler, AppError, notFound, forbidden, paymentRequired } from '../middleware/error.js';
import { validate, z, arabicText } from '../middleware/validate.js';
import { attachUser, requireAuth, requireInstructor } from '../middleware/auth.js';
import { json, toJson, nowIso, certSerial, paginate, pageMeta } from '../utils/helpers.js';
import { checkAccess } from '../services/access.js';
import { notify } from '../services/notifications.js';

const router = express.Router();

/* ============================ الاختبارات ============================ */
router.get('/quizzes/:id', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const quiz = q.get('SELECT * FROM quizzes WHERE id = ?', Number(req.params.id));
  if (!quiz) throw notFound('الاختبار غير موجود');

  if (quiz.course_id) {
    const access = checkAccess(req.user.id, 'course', quiz.course_id, { user: req.user });
    if (!access.allowed) throw paymentRequired('هذا الاختبار لمشتركي الدورة');
  }

  const attempts = q.all('SELECT id, score, max_score, percent, passed, finished_at FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? ORDER BY id DESC',
    quiz.id, req.user.id);
  if (quiz.attempts_allowed > 0 && attempts.filter(a => a.finished_at).length >= quiz.attempts_allowed) {
    return res.json({ quiz, questions: [], attempts, exhausted: true,
      message: `استنفدت المحاولات المسموحة (${quiz.attempts_allowed})` });
  }

  // لا تُرسل الإجابات الصحيحة للطالب قبل التسليم
  const questions = q.all('SELECT id, text, type, options, points, position FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id', quiz.id)
    .map(qq => ({ ...qq, options: json(qq.options, []) }));

  res.json({ quiz, questions, attempts, exhausted: false });
}));

router.post('/quizzes/:id/submit', attachUser, requireAuth, validate(z.object({
  answers: z.record(z.string(), z.array(z.coerce.number().int())),
})), asyncHandler(async (req, res) => {
  const quiz = q.get('SELECT * FROM quizzes WHERE id = ?', Number(req.params.id));
  if (!quiz) throw notFound('الاختبار غير موجود');
  if (quiz.course_id) {
    const access = checkAccess(req.user.id, 'course', quiz.course_id, { user: req.user });
    if (!access.allowed) throw paymentRequired();
  }
  const used = q.val("SELECT COUNT(*) AS c FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? AND finished_at IS NOT NULL", quiz.id, req.user.id);
  if (quiz.attempts_allowed > 0 && used >= quiz.attempts_allowed) {
    throw new AppError('استنفدت المحاولات المسموحة', 400, 'attempts_exhausted');
  }

  const questions = q.all('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id', quiz.id);
  if (!questions.length) throw new AppError('لا توجد أسئلة في هذا الاختبار', 400, 'empty_quiz');

  let score = 0;
  const maxScore = questions.reduce((s, qq) => s + qq.points, 0);
  const breakdown = questions.map(qq => {
    const given = [...new Set(req.body.answers[String(qq.id)] || [])].sort((a, b) => a - b);
    const correct = [...json(qq.correct, [])].sort((a, b) => a - b);
    const isCorrect = given.length === correct.length && given.every((v, i) => v === correct[i]);
    if (isCorrect) score += qq.points;
    return { question_id: qq.id, given, correct, isCorrect, explanation: qq.explanation, points: isCorrect ? qq.points : 0 };
  });

  const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
  const passed = percent >= quiz.pass_score;

  const info = q.run(
    `INSERT INTO quiz_attempts (quiz_id, user_id, score, max_score, percent, passed, answers, finished_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    quiz.id, req.user.id, score, maxScore, percent, passed ? 1 : 0, toJson(req.body.answers), nowIso());

  res.json({
    attempt_id: info.lastInsertRowid, score, maxScore, percent, passed,
    passScore: quiz.pass_score, breakdown,
    message: passed ? 'أحسنت! اجتزت الاختبار 🎉' : `لم تجتز الاختبار — الحد الأدنى ${quiz.pass_score}٪`,
  });
}));

/* ------------------ إنشاء اختبار (معلّم) ------------------ */
const quizSchema = z.object({
  course_id: z.coerce.number().int().positive().optional().nullable(),
  lesson_id: z.coerce.number().int().positive().optional().nullable(),
  live_session_id: z.coerce.number().int().positive().optional().nullable(),
  title: arabicText(2, 150),
  description: z.string().trim().max(1000).optional().nullable(),
  mode: z.enum(['practice', 'graded', 'live']).default('graded'),
  pass_score: z.coerce.number().int().min(0).max(100).default(60),
  time_limit_seconds: z.coerce.number().int().min(0).max(21600).default(0),
  attempts_allowed: z.coerce.number().int().min(0).max(20).default(3),
  questions: z.array(z.object({
    text: arabicText(2, 1000),
    type: z.enum(['single', 'multi', 'truefalse']).default('single'),
    options: z.array(z.string().trim().max(300)).min(2).max(8),
    correct: z.array(z.coerce.number().int().min(0)).min(1),
    points: z.coerce.number().int().min(1).max(20).default(1),
    explanation: z.string().trim().max(1000).optional().nullable(),
    time_seconds: z.coerce.number().int().min(5).max(300).default(20),
  })).min(1).max(100),
});

router.post('/quizzes', attachUser, requireInstructor, validate(quizSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.course_id) {
    const course = q.get('SELECT instructor_id FROM courses WHERE id = ?', b.course_id);
    if (!course || (course.instructor_id !== req.user.id && req.user.role !== 'admin')) throw forbidden();
  }
  for (const [i, question] of b.questions.entries()) {
    if (question.correct.some(c => c >= question.options.length)) {
      throw new AppError(`السؤال ${i + 1}: رقم الإجابة الصحيحة خارج نطاق الخيارات`, 400, 'invalid_correct_index');
    }
    if (question.type === 'single' && question.correct.length !== 1) {
      throw new AppError(`السؤال ${i + 1}: سؤال الاختيار الواحد يحتاج إجابة صحيحة واحدة`, 400, 'invalid_single');
    }
  }

  const quiz = db.transaction(() => {
    const info = q.run(
      `INSERT INTO quizzes (course_id, lesson_id, live_session_id, instructor_id, title, description, mode, pass_score, time_limit_seconds, attempts_allowed)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      b.course_id ?? null, b.lesson_id ?? null, b.live_session_id ?? null, req.user.id, b.title,
      b.description ?? null, b.mode, b.pass_score, b.time_limit_seconds, b.attempts_allowed);
    const quizId = info.lastInsertRowid;
    b.questions.forEach((question, i) => {
      q.run(
        `INSERT INTO quiz_questions (quiz_id, text, type, options, correct, points, explanation, time_seconds, position)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        quizId, question.text, question.type, toJson(question.options), toJson(question.correct),
        question.points, question.explanation ?? null, question.time_seconds, i);
    });
    return q.get('SELECT * FROM quizzes WHERE id = ?', quizId);
  })();

  res.status(201).json(quiz);
}));

router.delete('/quizzes/:id', attachUser, requireInstructor, asyncHandler(async (req, res) => {
  const quiz = q.get('SELECT * FROM quizzes WHERE id = ?', Number(req.params.id));
  if (!quiz) throw notFound();
  if (quiz.instructor_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  q.run('DELETE FROM quizzes WHERE id = ?', quiz.id);
  res.json({ ok: true });
}));

/* ============================ التقييمات ============================ */
router.post('/reviews', attachUser, requireAuth, validate(z.object({
  item_type: z.enum(['course', 'summary', 'live_session', 'instructor']),
  item_id: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional().nullable(),
})), asyncHandler(async (req, res) => {
  const { item_type, item_id, rating, comment } = req.body;

  // التقييم لا يُقبل إلا ممن اشترى/حضر فعلاً
  if (item_type !== 'instructor') {
    const access = checkAccess(req.user.id, item_type, item_id, { user: req.user });
    if (!access.allowed || access.reason === 'owner') {
      throw forbidden('التقييم متاح لمن اشترى هذا المحتوى فقط');
    }
  }

  q.run(
    `INSERT INTO reviews (user_id, item_type, item_id, rating, comment) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment`,
    req.user.id, item_type, item_id, rating, comment ?? null);

  recomputeRating(item_type, item_id);
  res.status(201).json({ ok: true, ...ratingOf(item_type, item_id) });
}));

function ratingOf(itemType, itemId) {
  const row = q.get(
    "SELECT AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE item_type = ? AND item_id = ? AND status = 'published'",
    itemType, itemId);
  return { rating_avg: Math.round((row.avg || 0) * 10) / 10, rating_count: row.count || 0 };
}

/** يحدّث متوسط التقييم المخزّن للعنصر ولصاحبه. */
function recomputeRating(itemType, itemId) {
  const { rating_avg, rating_count } = ratingOf(itemType, itemId);
  const table = { course: 'courses', summary: 'summaries' }[itemType];
  if (table) q.run(`UPDATE ${table} SET rating_avg = ?, rating_count = ? WHERE id = ?`, rating_avg, rating_count, itemId);

  let instructorId = null;
  if (itemType === 'course') instructorId = q.val('SELECT instructor_id FROM courses WHERE id = ?', itemId);
  if (itemType === 'summary') instructorId = q.val('SELECT author_id FROM summaries WHERE id = ?', itemId);
  if (itemType === 'live_session') instructorId = q.val('SELECT instructor_id FROM live_sessions WHERE id = ?', itemId);
  if (itemType === 'instructor') instructorId = itemId;

  if (instructorId) {
    const agg = q.get(
      `SELECT AVG(r.rating) AS avg, COUNT(*) AS count FROM reviews r
        WHERE r.status='published' AND (
          (r.item_type='course' AND r.item_id IN (SELECT id FROM courses WHERE instructor_id = ?)) OR
          (r.item_type='summary' AND r.item_id IN (SELECT id FROM summaries WHERE author_id = ?)) OR
          (r.item_type='live_session' AND r.item_id IN (SELECT id FROM live_sessions WHERE instructor_id = ?)) OR
          (r.item_type='instructor' AND r.item_id = ?))`,
      instructorId, instructorId, instructorId, instructorId);
    q.run('UPDATE instructor_profiles SET rating_avg = ?, rating_count = ? WHERE user_id = ?',
      Math.round((agg.avg || 0) * 10) / 10, agg.count || 0, instructorId);
  }
}

router.get('/reviews/:type/:id', asyncHandler(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const total = q.val("SELECT COUNT(*) AS c FROM reviews WHERE item_type = ? AND item_id = ? AND status='published'",
    req.params.type, Number(req.params.id));
  res.json({
    data: q.all(
      `SELECT r.*, u.name AS user_name, u.avatar AS user_avatar FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.item_type = ? AND r.item_id = ? AND r.status='published' ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      req.params.type, Number(req.params.id), limit, offset),
    summary: ratingOf(req.params.type, Number(req.params.id)),
    meta: pageMeta(total, { page, limit }),
  });
}));

router.delete('/reviews/:id', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const review = q.get('SELECT * FROM reviews WHERE id = ?', Number(req.params.id));
  if (!review) throw notFound();
  if (review.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  q.run('DELETE FROM reviews WHERE id = ?', review.id);
  recomputeRating(review.item_type, review.item_id);
  res.json({ ok: true });
}));

/* ============================ أسئلة وأجوبة الدورة ============================ */
router.get('/courses/:courseId/questions', attachUser, asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const rows = q.all(
    `SELECT q2.*, u.name AS user_name, u.avatar AS user_avatar,
            (SELECT COUNT(*) FROM answers a WHERE a.question_id = q2.id) AS answers_count
       FROM questions q2 JOIN users u ON u.id = q2.user_id
      WHERE q2.course_id = ? ORDER BY q2.resolved, q2.id DESC LIMIT 100`, courseId);
  res.json({ data: rows });
}));

router.post('/courses/:courseId/questions', attachUser, requireAuth, validate(z.object({
  title: arabicText(5, 200),
  body: z.string().trim().max(3000).optional().nullable(),
  lesson_id: z.coerce.number().int().positive().optional().nullable(),
})), asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const access = checkAccess(req.user.id, 'course', courseId, { user: req.user });
  if (!access.allowed) throw paymentRequired('طرح الأسئلة متاح لمشتركي الدورة');

  const info = q.run('INSERT INTO questions (course_id, lesson_id, user_id, title, body) VALUES (?,?,?,?,?)',
    courseId, req.body.lesson_id ?? null, req.user.id, req.body.title, req.body.body ?? null);

  const instructorId = q.val('SELECT instructor_id FROM courses WHERE id = ?', courseId);
  notify(instructorId, { type: 'question', title: 'سؤال جديد في دورتك', body: req.body.title, link: `#/learn/${courseId}` });
  res.status(201).json(q.get('SELECT * FROM questions WHERE id = ?', info.lastInsertRowid));
}));

router.get('/questions/:id/answers', asyncHandler(async (req, res) => {
  res.json({
    question: q.get(
      `SELECT q2.*, u.name AS user_name FROM questions q2 JOIN users u ON u.id = q2.user_id WHERE q2.id = ?`,
      Number(req.params.id)),
    answers: q.all(
      `SELECT a.*, u.name AS user_name, u.avatar AS user_avatar FROM answers a JOIN users u ON u.id = a.user_id
        WHERE a.question_id = ? ORDER BY a.accepted DESC, a.id`, Number(req.params.id)),
  });
}));

router.post('/questions/:id/answers', attachUser, requireAuth, validate(z.object({
  body: arabicText(2, 3000),
})), asyncHandler(async (req, res) => {
  const question = q.get('SELECT * FROM questions WHERE id = ?', Number(req.params.id));
  if (!question) throw notFound('السؤال غير موجود');

  const instructorId = q.val('SELECT instructor_id FROM courses WHERE id = ?', question.course_id);
  const isInstructor = instructorId === req.user.id;
  if (!isInstructor) {
    const access = checkAccess(req.user.id, 'course', question.course_id, { user: req.user });
    if (!access.allowed) throw paymentRequired();
  }

  const info = q.run('INSERT INTO answers (question_id, user_id, body, is_instructor) VALUES (?,?,?,?)',
    question.id, req.user.id, req.body.body, isInstructor ? 1 : 0);
  if (question.user_id !== req.user.id) {
    notify(question.user_id, {
      type: 'answer', title: isInstructor ? 'أجاب المعلّم على سؤالك' : 'إجابة جديدة على سؤالك',
      body: question.title, link: `#/learn/${question.course_id}`,
    });
  }
  res.status(201).json(q.get('SELECT * FROM answers WHERE id = ?', info.lastInsertRowid));
}));

router.post('/answers/:id/accept', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const answer = q.get('SELECT * FROM answers WHERE id = ?', Number(req.params.id));
  if (!answer) throw notFound();
  const question = q.get('SELECT * FROM questions WHERE id = ?', answer.question_id);
  if (question.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden('صاحب السؤال فقط يعتمد الإجابة');

  db.transaction(() => {
    q.run('UPDATE answers SET accepted = 0 WHERE question_id = ?', question.id);
    q.run('UPDATE answers SET accepted = 1 WHERE id = ?', answer.id);
    q.run('UPDATE questions SET resolved = 1 WHERE id = ?', question.id);
  })();
  res.json({ ok: true });
}));

/* ============================ الشهادات ============================ */
router.post('/certificates/:courseId/issue', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const enrollment = q.get('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?', req.user.id, courseId);
  if (!enrollment) throw notFound('لست مسجّلاً في هذه الدورة');
  if (enrollment.progress_percent < 100) {
    throw new AppError(`أكمل الدورة أولاً (تقدّمك ${Math.round(enrollment.progress_percent)}٪)`, 400, 'course_incomplete');
  }

  // اجتياز الاختبارات المقيَّمة شرط للشهادة
  const gradedQuizzes = q.all("SELECT id, title FROM quizzes WHERE course_id = ? AND mode = 'graded'", courseId);
  for (const quiz of gradedQuizzes) {
    const passed = q.val('SELECT COUNT(*) AS c FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? AND passed = 1', quiz.id, req.user.id);
    if (!passed) throw new AppError(`عليك اجتياز اختبار «${quiz.title}» أولاً`, 400, 'quiz_not_passed');
  }

  const existing = q.get('SELECT * FROM certificates WHERE user_id = ? AND course_id = ?', req.user.id, courseId);
  if (existing) return res.json({ certificate: existing, existing: true });

  const grade = q.val(
    'SELECT AVG(percent) AS g FROM quiz_attempts WHERE user_id = ? AND passed = 1 AND quiz_id IN (SELECT id FROM quizzes WHERE course_id = ?)',
    req.user.id, courseId);
  const info = q.run('INSERT INTO certificates (serial, user_id, course_id, grade) VALUES (?,?,?,?)',
    certSerial(), req.user.id, courseId, grade ?? null);

  const certificate = q.get('SELECT * FROM certificates WHERE id = ?', info.lastInsertRowid);
  notify(req.user.id, { type: 'certificate', title: 'مبروك! صدرت شهادتك 🎓',
    body: `رقم الشهادة: ${certificate.serial}`, link: '#/certificates' });
  res.status(201).json({ certificate, existing: false });
}));

router.get('/certificates', attachUser, requireAuth, asyncHandler(async (req, res) => {
  res.json({
    data: q.all(
      `SELECT c.*, co.title AS course_title, co.slug AS course_slug, u.name AS instructor_name
         FROM certificates c JOIN courses co ON co.id = c.course_id JOIN users u ON u.id = co.instructor_id
        WHERE c.user_id = ? ORDER BY c.id DESC`, req.user.id),
  });
}));

/** تحقّق عام من الشهادة برقمها التسلسلي — لا يتطلّب تسجيل دخول. */
router.get('/certificates/verify/:serial', asyncHandler(async (req, res) => {
  const cert = q.get(
    `SELECT c.serial, c.issued_at, c.grade, u.name AS student_name, co.title AS course_title,
            iu.name AS instructor_name
       FROM certificates c JOIN users u ON u.id = c.user_id JOIN courses co ON co.id = c.course_id
       JOIN users iu ON iu.id = co.instructor_id WHERE c.serial = ?`, req.params.serial.toUpperCase());
  if (!cert) return res.status(404).json({ valid: false, message: 'لا توجد شهادة بهذا الرقم' });
  res.json({ valid: true, certificate: cert, platform: config.platform.name });
}));

export default router;
