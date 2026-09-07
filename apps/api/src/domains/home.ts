import { Router } from 'express';
import { q, json, nowIso } from '../db/index.ts';
import { requireAuth } from '../lib/auth.ts';
import { ownedIds, favoriteIds } from '../services/access.ts';
import { publicUrl } from '../services/storage.ts';
import { unreadCount } from '../services/notifications.ts';
import { bookCard, courseCard, teacherCard, bookingView } from '../services/mappers.ts';
import { resolveLearner, learnerRef, countLearners } from '../services/learners.ts';
import { arabicDate } from '../lib/helpers.ts';
import type { BookingRow } from '../services/bookings.ts';

/**
 * الرئيسية — الترتيب ملزم: حصّتك القادمة أولاً، ثم أكمل، ثم ملخّصات صفّك، الدورات، المعلّمون…
 * كل قسم من بيانات حقيقية؛ القسم الفارغ يُعاد فارغاً (لا أرقام مزيّفة).
 * تُبنى للمتعلّم النشط (D4)؛ حساب بلا متعلّم (معلّم/طاقم) يحصل على رئيسية غير مرشّحة بالصف (D5).
 */
const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const uid = req.user!.id;
  const learner = resolveLearner(req);
  const name = q.val<string>('SELECT display_name FROM profiles WHERE user_id = ?', uid) ?? '';
  const gradeId: number | null = learner?.grade_id ?? null;
  const subjectIds = learner ? q.all<{ subject_id: number }>('SELECT subject_id FROM learner_subjects WHERE learner_id = ?', learner.id).map(r => r.subject_id) : [];
  const owned = ownedIds(uid, 'book'), enrolled = ownedIds(uid, 'course');
  const favB = favoriteIds(uid, 'book'), favC = favoriteIds(uid, 'course'), favT = favoriteIds(uid, 'teacher');
  const bctx = { userId: uid, owned, fav: favB }, cctx = { userId: uid, enrolled, fav: favC };

  // ١) الحصة القادمة (للمتعلّم النشط طالباً، أو للحساب معلّماً)
  const learnerId = learner?.id ?? null;
  const next = q.get<BookingRow>(`SELECT * FROM bookings WHERE ((student_id = ? AND (learner_id = ? OR ? IS NULL)) OR teacher_id = ?)
    AND status IN ('confirmed','in_progress') AND ends_at >= ? ORDER BY starts_at LIMIT 1`, uid, learnerId, learnerId, uid, nowIso());

  // ٢) أكمل من حيث توقّفت (على مستوى الحساب في هذا الإصدار)
  const continueItems = [
    ...q.all<any>(`SELECT b.id, b.title, b.pages, b.cover_file_id, rp.last_page, s.name AS subject FROM reading_progress rp JOIN books b ON b.id = rp.book_id JOIN subjects s ON s.id = b.subject_id
                   WHERE rp.user_id = ? AND rp.last_page > 1 ORDER BY rp.updated_at DESC LIMIT 4`, uid)
      .filter(r => owned.has(r.id)).map(r => ({ type: 'book' as const, id: r.id, title: r.title, subtitle: r.subject, coverUrl: publicUrl(r.cover_file_id), progressPercent: r.pages ? Math.min(100, Math.round((r.last_page / r.pages) * 100)) : 0 })),
    ...q.all<any>(`SELECT c.id, c.title, c.cover_file_id, ce.progress_percent, s.name AS subject FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id JOIN subjects s ON s.id = c.subject_id
                   WHERE ce.user_id = ? AND ce.progress_percent < 100 ORDER BY ce.created_at DESC LIMIT 4`, uid)
      .map(r => ({ type: 'course' as const, id: r.id, title: r.title, subtitle: r.subject, coverUrl: publicUrl(r.cover_file_id), progressPercent: Math.round(r.progress_percent) })),
  ].slice(0, 6);

  const gradeSql = gradeId ? 'AND grade_id = ?' : '';
  const gradeArg = gradeId ? [gradeId] : [];
  const subjPref = subjectIds.length ? `CASE WHEN subject_id IN (${subjectIds.join(',')}) THEN 0 ELSE 1 END,` : '';

  // ٣) ملخّصات صفّك
  const gradeSummaries = q.all<any>(`SELECT * FROM books WHERE status = 'published' AND type IN ('summary','final_review') ${gradeSql} ORDER BY ${subjPref} sales_count DESC, rating_avg DESC LIMIT 10`, ...gradeArg).map(b => bookCard(b, bctx));
  // ٤) الدورات
  const courses = q.all<any>(`SELECT * FROM courses WHERE status = 'published' ${gradeSql} ORDER BY ${subjPref} featured DESC, sales_count DESC LIMIT 8`, ...gradeArg).map(c => courseCard(c, cctx));
  // ٥) معلّمون موصى بهم — يدرّسون صفّك ومادّتك
  const teacherWhere = gradeId ? `AND EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = tp.user_id AND ts.grade_id = ? ${subjectIds.length ? `AND ts.subject_id IN (${subjectIds.join(',')})` : ''})` : '';
  let teachers = q.all<any>(`SELECT tp.*, p.display_name, p.avatar_path FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id WHERE tp.verification_status = 'verified' ${teacherWhere} ORDER BY tp.rating_avg DESC, tp.lessons_count DESC LIMIT 8`, ...gradeArg);
  if (!teachers.length && gradeId) teachers = q.all<any>("SELECT tp.*, p.display_name, p.avatar_path FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id WHERE tp.verification_status = 'verified' ORDER BY tp.rating_avg DESC LIMIT 8");
  // ٦) حلّ مسائل خطوة بخطوة
  const solvedProblems = q.all<any>(`SELECT * FROM books WHERE status = 'published' AND type IN ('solved_problems','exercises') ${gradeSql} ORDER BY ${subjPref} sales_count DESC LIMIT 8`, ...gradeArg).map(b => bookCard(b, bctx));
  // ٧) الأكثر طلباً (آخر ٣٠ يوماً من الشراء الفعلي؛ وإلا حسب المبيعات)
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let trending = q.all<any>(`SELECT b.*, COUNT(e.id) AS recent FROM books b JOIN entitlements e ON e.item_type = 'book' AND e.item_id = b.id AND replace(e.created_at, ' ', 'T') >= ? WHERE b.status = 'published' ${gradeSql.replace('grade_id', 'b.grade_id')} GROUP BY b.id ORDER BY recent DESC LIMIT 8`, monthAgo, ...gradeArg);
  if (trending.length < 4) trending = q.all<any>(`SELECT * FROM books WHERE status = 'published' ${gradeSql} ORDER BY sales_count DESC, rating_avg DESC LIMIT 8`, ...gradeArg);
  // ٨) العروض: كوبونات عامة مفعّلة وموسومة featured
  const offers = q.all<any>("SELECT id, code, type, value, scope, ends_at FROM coupons WHERE active = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)", nowIso(), nowIso())
    .filter(c => json<any>(c.scope, {}).featured)
    .map(c => ({ id: c.id, title: json<any>(c.scope, {}).title ?? (c.type === 'percentage' ? `خصم ${c.value}٪` : `خصم ${c.value} ر.ع`), subtitle: c.ends_at ? `حتى ${arabicDate(c.ends_at)}` : null, code: c.code }));

  res.json({
    greeting: {
      name, gradeName: learner?.grade_name ?? null, unreadNotifications: unreadCount(uid),
      learner: learner ? learnerRef(learner) : null, learnersCount: countLearners(uid),
    },
    nextLesson: next ? bookingView(next, uid) : null,
    continueItems, gradeSummaries, courses,
    recommendedTeachers: teachers.map(t => teacherCard(t, { userId: uid, fav: favT })),
    solvedProblems, trending: trending.map(b => bookCard(b, bctx)), offers,
  });
});

export default router;
