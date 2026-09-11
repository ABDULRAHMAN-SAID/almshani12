import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { StudentSetup, CreateReview, FavoriteToggle, CreateReport, AnalyticsEvent, LearnerUpsert, LearnerPatch, Id } from '@manassah/shared';
import { config } from '../config.ts';
import { db, q, json, nowIso } from '../db/index.ts';
import { AppError, asyncHandler, notFound, badRequest, forbidden, conflict } from '../lib/errors.ts';
import { validate, body, idParam } from '../lib/validate.ts';
import { requireAuth, hasRole } from '../lib/auth.ts';
import { money, iso } from '../lib/helpers.ts';
import { ownedIds } from '../services/access.ts';
import { userView, orderView, notificationView } from '../lib/views.ts';
import { upload, storeUpload, publicUrl, publicFileIdOf, RASTER_IMAGE } from '../services/storage.ts';
import * as wallet from '../services/wallet.ts';
import { unreadCount } from '../services/notifications.ts';
import { bookCard, courseCard, teacherCard } from '../services/mappers.ts';
import { weakTopics } from '../services/quiz.ts';
import { listLearners, createLearner, updateLearner, archiveLearner, activateLearner, reorderLearners, projectSelfLearner } from '../services/learners.ts';
import { audit } from '../lib/audit.ts';

/** يُركَّب على /api مباشرة، لذا تُفرَض المصادقة على كل مسار على حدة (لا router.use) */
const router = Router();

/* ---------- الملف الشخصي ---------- */
const ProfilePatch = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  locale: z.enum(['ar', 'en']).optional(),
  gender: z.enum(['male', 'female']).nullable().optional(),
  avatarFileId: z.number().int().positive().nullable().optional(),
  /** جهة تواصل ثانية غير موثّقة (مثل بريد أضافه المستخدم عند التسجيل بالهاتف) — ذاتية الخدمة فقط حين لا توجد إحداها بعد */
  phone: z.string().trim().regex(/^\+\d{8,15}$/).optional(),
  email: z.string().trim().email().optional(),
});
router.patch('/me', requireAuth, validate(ProfilePatch), asyncHandler(async (req, res) => {
  const p = body<typeof ProfilePatch>(req);
  const uid = req.user!.id;
  // إضافة هاتف/بريد ثانٍ: لا يستبدل هدفاً موجوداً (تغييره يحتاج تحقّقاً لا PATCH مباشراً)، وUNIQUE في المخطّط يمنع انتحال حساب آخر
  if (p.phone !== undefined) {
    if (q.val<string | null>('SELECT phone FROM users WHERE id = ?', uid)) throw badRequest('رقم الهاتف مسجَّل مسبقاً على هذا الحساب');
    try { q.run('UPDATE users SET phone = ? WHERE id = ?', p.phone, uid); }
    catch { throw conflict('رقم الهاتف مستخدَم من حساب آخر'); }
  }
  if (p.email !== undefined) {
    if (q.val<string | null>('SELECT email FROM users WHERE id = ?', uid)) throw badRequest('البريد الإلكتروني مسجَّل مسبقاً على هذا الحساب');
    try { q.run('UPDATE users SET email = ? WHERE id = ?', p.email, uid); }
    catch { throw conflict('البريد الإلكتروني مستخدَم من حساب آخر'); }
  }
  if (p.displayName !== undefined) {
    q.run('UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ?', p.displayName, nowIso(), uid);
    // الاسم ينعكس على المتعلّم الذاتي الأول (position = 0) — فهو الحساب نفسه
    q.run('UPDATE learners SET display_name = ?, updated_at = ? WHERE account_id = ? AND is_self = 1 AND position = 0 AND archived_at IS NULL', p.displayName, nowIso(), uid);
  }
  if (p.gender !== undefined) q.run('UPDATE profiles SET gender = ? WHERE user_id = ?', p.gender, uid);
  if (p.locale) q.run('UPDATE users SET locale = ? WHERE id = ?', p.locale, uid);
  if (p.avatarFileId !== undefined) {
    const prev = publicFileIdOf(q.val<string | null>('SELECT avatar_path FROM profiles WHERE user_id = ?', uid));
    if (p.avatarFileId) {
      const f = q.get<any>('SELECT id, owner_id, visibility, mime, purpose FROM files WHERE id = ?', p.avatarFileId);
      // الصورة تُنشر للعموم بلا توقيع، فلا تُقبل إلا ملفاً رُفع لهذا الغرض: قلبُ وثيقة هوية خاصة إلى عامة لا رجعة فيه
      if (!f || f.owner_id !== uid || f.purpose !== 'avatar' || !RASTER_IMAGE.test(f.mime)) throw badRequest('الصورة غير صالحة');
      // ونشرها من جديد: إزالة صورة سابقة تقلبها إلى private، فإعادة اختيار الملف نفسه كانت تترك avatar_path
      // يشير إلى ملف لم يعد عاماً — رابط صورة يردّ 404 وحساب بلا صورة رغم أنّ الحفظ نجح.
      q.run("UPDATE files SET visibility = 'public' WHERE id = ?", f.id);
      q.run('UPDATE profiles SET avatar_path = ? WHERE user_id = ?', `/api/files/public/${f.id}`, uid);
    } else q.run('UPDATE profiles SET avatar_path = NULL WHERE user_id = ?', uid);
    // إزالة الصورة يجب أن تقطع رابطها العام أيضاً، وإلا بقيت صورة الطفل مقروءة للجميع بعد حذفها
    if (prev && prev !== p.avatarFileId) q.run("UPDATE files SET visibility = 'private' WHERE id = ? AND owner_id = ?", prev, uid);
  }
  res.json(userView(uid));
}));

/**
 * إعداد الطالب الأوّلي (مهمل — يبقى إصداراً واحداً للتطبيقات القديمة؛ الجديد: POST /me/learners):
 * يحدّث اسم الحساب ثم يحدّث المتعلّم الذاتي الأول أو ينشئه. الجدولان القديمان يُكتبان انعكاساً من الخدمة.
 */
router.post('/me/student-setup', requireAuth, validate(StudentSetup), asyncHandler(async (req, res) => {
  const s = body<typeof StudentSetup>(req);
  const uid = req.user!.id;
  const input = { displayName: s.displayName, curriculumId: s.curriculumId, gradeId: s.gradeId, semesterId: s.semesterId, subjectIds: s.subjectIds, school: s.school ?? null };
  db.transaction(() => {
    const self = q.get<{ id: number }>('SELECT id FROM learners WHERE account_id = ? AND is_self = 1 AND archived_at IS NULL ORDER BY position, id LIMIT 1', uid);
    if (self) updateLearner(uid, self.id, input, req);
    else createLearner(uid, { ...input, isSelf: true }, { req });
    q.run('UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ?', s.displayName, nowIso(), uid);
    q.run('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)', uid, 'student');
    q.run('UPDATE users SET onboarding_completed = 1 WHERE id = ?', uid);
  })();
  res.json(userView(uid));
}));

/* ---------- المتعلّمون (§3.3) ---------- */
router.get('/me/learners', requireAuth, (req, res) => {
  const uid = req.user!.id;
  res.json({ data: listLearners(uid), activeLearnerId: q.val<number | null>('SELECT active_learner_id FROM users WHERE id = ?', uid) ?? null });
});
router.post('/me/learners', requireAuth, validate(LearnerUpsert), asyncHandler(async (req, res) => {
  createLearner(req.user!.id, body<typeof LearnerUpsert>(req), { req });
  res.status(201).json(userView(req.user!.id));
}));
const ReorderBody = z.object({ ids: z.array(Id).min(1).max(12) });
router.post('/me/learners/reorder', requireAuth, validate(ReorderBody), asyncHandler(async (req, res) => {
  reorderLearners(req.user!.id, body<typeof ReorderBody>(req).ids);
  res.json({ data: listLearners(req.user!.id) });
}));
router.patch('/me/learners/:id', requireAuth, validate(LearnerPatch), asyncHandler(async (req, res) => {
  updateLearner(req.user!.id, idParam(req), body<typeof LearnerPatch>(req), req);
  res.json(userView(req.user!.id));
}));
router.delete('/me/learners/:id', requireAuth, asyncHandler(async (req, res) => {
  archiveLearner(req.user!.id, idParam(req), req);
  res.json(userView(req.user!.id));
}));
router.post('/me/learners/:id/activate', requireAuth, asyncHandler(async (req, res) => {
  activateLearner(req.user!.id, idParam(req));
  res.json(userView(req.user!.id));
}));

/** حذف الحساب (متطلّب المتاجر): يُعطَّل فوراً وتُمسح بياناته الشخصية */
router.delete('/me', requireAuth, asyncHandler(async (req, res) => {
  const uid = req.user!.id;
  db.transaction(() => {
    q.run("UPDATE users SET status = 'deleted', phone = NULL, email = ?, active_learner_id = NULL WHERE id = ?", `deleted-${uid}@removed.local`, uid);
    q.run('UPDATE profiles SET display_name = ?, avatar_path = NULL, bio = NULL WHERE user_id = ?', 'مستخدم محذوف', uid);
    // صور الحساب كانت تبقى مقروءة للعموم بعد الحذف — تنشيف avatar_path وحده لا يقطع /api/files/public
    q.run("UPDATE files SET visibility = 'private' WHERE owner_id = ? AND purpose = 'avatar'", uid);
    // المتعلّمون: تُمسح بياناتهم الشخصية ويُؤرشفون (الحجوزات تبقى في السجل)
    q.run("UPDATE learners SET display_name = 'محذوف', school = NULL, avatar_path = NULL, archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE account_id = ?", nowIso(), nowIso(), uid);
    projectSelfLearner(uid); // لا متعلّم ذاتي فعّال → تُمسح صفوف الجدولين القديمين
    q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', uid);
    q.run('DELETE FROM device_tokens WHERE user_id = ?', uid);
    q.run('DELETE FROM push_devices WHERE user_id = ?', uid);
    q.run('DELETE FROM auth_identities WHERE user_id = ?', uid);
  })();
  audit(req, 'user.delete', 'user', uid);
  res.json({ ok: true });
}));

/* ---------- رفع الملفات ---------- */
/** ما يُخدَم لاحقاً كمستند لا يُقبل إلا صورة نقطية أو PDF — text/ وSVG سكربت على نطاقنا */
const DOC_MIMES = new RegExp(`(${RASTER_IMAGE.source})|^application/pdf$`);
/** لكل غرض نوعه وحدّ حجمه — الفيديو وحده يستحقّ الحدّ الأقصى؛ والأغراض الثقيلة للمعلّمين */
const PURPOSES: Record<string, { mimes: RegExp; visibility: 'public' | 'private'; maxMb: number; teacherOnly?: boolean }> = {
  avatar: { mimes: RASTER_IMAGE, visibility: 'public', maxMb: 8 },
  cover: { mimes: RASTER_IMAGE, visibility: 'public', maxMb: 8, teacherOnly: true },
  document: { mimes: DOC_MIMES, visibility: 'private', maxMb: 20 },
  book: { mimes: /^application\/pdf$/, visibility: 'private', maxMb: 60, teacherOnly: true },
  sample: { mimes: DOC_MIMES, visibility: 'private', maxMb: 20, teacherOnly: true },
  video: { mimes: /^video\//, visibility: 'private', maxMb: config.uploads.maxSizeMb, teacherOnly: true },
  attachment: { mimes: DOC_MIMES, visibility: 'private', maxMb: 20 },
};
/**
 * حصّة تخزين لكل حساب — بلا سقف يملأ طالب واحد القرص بفيديوهات لا يستهلكها أي شيء.
 * والمعلّم وحده يرفع الفيديو (حدّ الملف الواحد UPLOAD_MAX_MB = ٢٠٠ م.ب افتراضاً)، فحصّته تُقاس بمضاعفاته:
 * سقف ٥١٢ م.ب موحّد كان يقف بعد فيديوَي درسٍ اثنين فلا يُكمل معلّم دورة واحدة.
 */
const STUDENT_QUOTA_MB = 512;
const quotaBytes = (user: Request['user']): number =>
  (hasRole(user, 'teacher') ? Math.max(4096, config.uploads.maxSizeMb * 20) : STUDENT_QUOTA_MB) * 1024 * 1024;
const ruleOf = (req: Request) => {
  const purpose = String(req.query.purpose ?? 'attachment');
  return { purpose, rule: Object.hasOwn(PURPOSES, purpose) ? PURPOSES[purpose] : undefined };
};
/**
 * الغرض يُحسم من الاستعلام وحده وقبل قراءة أي بايت: حين كان الحدّ يُقرأ من الاستعلام
 * والقاعدة من جسم الطلب أمكن رفع صورة حساب بحدّ المرفقات (٢٠ م.ب) بدل ٨.
 */
const uploadByPurpose = (req: Request, res: Response, next: NextFunction) => {
  const { rule } = ruleOf(req);
  if (!rule) return next(badRequest('غرض الملف غير معروف'));
  return upload(rule.maxMb)(req, res, next);
};
router.post('/files', requireAuth, uploadByPurpose, asyncHandler(async (req, res) => {
  const { purpose, rule } = ruleOf(req);
  if (!rule) throw badRequest('غرض الملف غير معروف');
  if (!req.file) throw badRequest('لم يُرفق ملف');
  if (rule.teacherOnly && !hasRole(req.user, 'teacher')) throw forbidden('هذا النوع من الرفع للمعلّمين');
  if (!rule.mimes.test(req.file.mimetype)) throw badRequest('نوع الملف غير مسموح لهذا الغرض');
  const used = q.val<number>('SELECT COALESCE(SUM(size),0) FROM files WHERE owner_id = ?', req.user!.id) ?? 0;
  if (used + req.file.size > quotaBytes(req.user)) throw new AppError('quota_exceeded', 'تجاوزت مساحة التخزين المتاحة لحسابك', 413);
  const f = storeUpload(req.file, { ownerId: req.user!.id, purpose, visibility: rule.visibility });
  res.status(201).json({ id: f.id, mime: f.mime, size: f.size, url: rule.visibility === 'public' ? publicUrl(f.id) : null });
}));

/* ---------- المشتريات والمحفظة ---------- */
router.get('/me/purchases', requireAuth, asyncHandler(async (req, res) => {
  const uid = req.user!.id;
  const books = q.all<any>(`SELECT b.id, b.title, b.cover_file_id, e.created_at FROM entitlements e JOIN books b ON b.id = e.item_id WHERE e.user_id = ? AND e.item_type = 'book' ORDER BY e.id DESC LIMIT 200`, uid)
    .map(r => ({ id: r.id, title: r.title, coverUrl: publicUrl(r.cover_file_id), purchasedAt: iso(r.created_at) }));
  const courses = q.all<any>(`SELECT c.id, c.title, c.cover_file_id, ce.created_at, ce.progress_percent FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id WHERE ce.user_id = ? ORDER BY ce.created_at DESC LIMIT 200`, uid)
    .map(r => ({ id: r.id, title: r.title, coverUrl: publicUrl(r.cover_file_id), purchasedAt: iso(r.created_at), progressPercent: r.progress_percent }));
  const lessons = q.all<any>(`SELECT b.id, b.starts_at, b.price, b.status, p.display_name, s.name AS subject FROM bookings b JOIN profiles p ON p.user_id = b.teacher_id JOIN subjects s ON s.id = b.subject_id WHERE b.student_id = ? ORDER BY b.starts_at DESC LIMIT 50`, uid)
    .map(r => ({ bookingId: r.id, teacherName: r.display_name, subjectName: r.subject, startsAt: r.starts_at, price: money(r.price), status: r.status }));
  const subscriptions = q.all<any>('SELECT s.id, s.status, s.ends_at, pl.name FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.user_id = ?', uid)
    .map(r => ({ id: r.id, planName: r.name, status: r.status, endsAt: r.ends_at }));
  const orders = q.all<any>('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50', uid).map(orderView);
  res.json({ books, courses, lessons, subscriptions, orders });
}));

router.get('/me/wallet', requireAuth, (req, res) => {
  res.json({
    balance: wallet.balance(req.user!.id), currency: config.money.currency,
    transactions: wallet.history(req.user!.id).map((t: any) => ({ id: t.id, type: t.type, amount: t.amount, balanceAfter: t.balance_after, note: t.note, createdAt: iso(t.created_at) })),
  });
});

/* ---------- الإشعارات ---------- */
router.get('/me/notifications', requireAuth, (req, res) => {
  const rows = q.all<any>('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', req.user!.id);
  res.json({ data: rows.map(notificationView), unread: unreadCount(req.user!.id) });
});
router.post('/me/notifications/read', requireAuth, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (ids?.length) q.run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, nowIso(), req.user!.id, ...ids);
  else q.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), req.user!.id);
  res.json({ ok: true, unread: unreadCount(req.user!.id) });
}));
const DeviceToken = z.object({ platform: z.enum(['ios', 'android', 'web']), token: z.string().min(10).max(500) });
router.post('/me/device-tokens', requireAuth, validate(DeviceToken), (req, res) => {
  const d = body<typeof DeviceToken>(req);
  q.run('INSERT INTO device_tokens (user_id, platform, token) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id', req.user!.id, d.platform, d.token);
  res.json({ ok: true });
});

/* ---------- المفضّلة ---------- */
router.get('/me/favorites', requireAuth, (req, res) => {
  const uid = req.user!.id;
  const ids = (t: string) => q.all<{ target_id: number }>('SELECT target_id FROM favorites WHERE user_id = ? AND target_type = ? ORDER BY created_at DESC LIMIT 100', uid, t).map(r => r.target_id);
  const inList = (xs: number[]) => xs.length ? xs.map(() => '?').join(',') : 'NULL';
  const b = ids('book'), c = ids('course'), t = ids('teacher');
  // مجموعات الملكية/المفضّلة تُقرأ مرة واحدة للطلب كلّه بدل استعلامين لكل بطاقة
  const bctx = { userId: uid, owned: ownedIds(uid, 'book'), fav: new Set(b) };
  const cctx = { userId: uid, enrolled: ownedIds(uid, 'course'), fav: new Set(c) };
  const tctx = { userId: uid, fav: new Set(t), withNextSlot: false };
  res.json({
    books: q.all<any>(`SELECT * FROM books WHERE status = 'published' AND id IN (${inList(b)})`, ...b).map(r => bookCard(r, bctx)),
    courses: q.all<any>(`SELECT * FROM courses WHERE status = 'published' AND id IN (${inList(c)})`, ...c).map(r => courseCard(r, cctx)),
    teachers: q.all<any>(`SELECT tp.*, p.display_name, p.avatar_path FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id WHERE tp.verification_status = 'verified' AND tp.user_id IN (${inList(t)})`, ...t).map(r => teacherCard(r, tctx)),
  });
});
router.post('/me/favorites', requireAuth, validate(FavoriteToggle), (req, res) => {
  const { targetType, targetId } = body<typeof FavoriteToggle>(req);
  const uid = req.user!.id;
  const exists = q.get('SELECT 1 FROM favorites WHERE user_id = ? AND target_type = ? AND target_id = ?', uid, targetType, targetId);
  if (exists) q.run('DELETE FROM favorites WHERE user_id = ? AND target_type = ? AND target_id = ?', uid, targetType, targetId);
  else q.run('INSERT INTO favorites (user_id, target_type, target_id) VALUES (?,?,?)', uid, targetType, targetId);
  res.json({ favorited: !exists });
});

/* ---------- التقييمات (مقفلة بتجربة حقيقية) ---------- */
router.post('/reviews', requireAuth, validate(CreateReview), asyncHandler(async (req, res) => {
  const r = body<typeof CreateReview>(req);
  const uid = req.user!.id;
  let gate: { type: 'booking' | 'order' | 'enrollment'; id: number } | null = null;
  if (r.targetType === 'teacher') {
    const b = q.get<{ id: number }>(`SELECT id FROM bookings WHERE student_id = ? AND teacher_id = ? AND status = 'completed' ${r.gateRef ? 'AND id = ?' : ''} ORDER BY id DESC LIMIT 1`, ...(r.gateRef ? [uid, r.targetId, r.gateRef] : [uid, r.targetId]));
    if (b) gate = { type: 'booking', id: b.id };
  } else {
    const e = q.get<{ id: number; order_id: number | null }>(`SELECT id, order_id FROM entitlements WHERE user_id = ? AND item_type = ? AND item_id = ?`, uid, r.targetType, r.targetId);
    if (e) gate = r.targetType === 'course' ? { type: 'enrollment', id: e.id } : { type: 'order', id: e.order_id ?? e.id };
  }
  if (!gate) throw new AppError('forbidden', 'التقييم متاح بعد تجربة حقيقية (حصة مكتملة أو شراء)', 403);
  try {
    q.run('INSERT INTO reviews (user_id, target_type, target_id, rating, comment, gate_type, gate_id) VALUES (?,?,?,?,?,?,?)',
      uid, r.targetType, r.targetId, r.rating, r.comment ?? null, gate.type, gate.id);
  } catch (err: any) {
    if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) throw conflict('قيّمت هذا العنصر من قبل');
    throw err;
  }
  const table = r.targetType === 'teacher' ? 'teacher_profiles' : r.targetType === 'book' ? 'books' : 'courses';
  const key = r.targetType === 'teacher' ? 'user_id' : 'id';
  q.run(`UPDATE ${table} SET rating_avg = (SELECT AVG(rating) FROM reviews WHERE target_type = ? AND target_id = ? AND status = 'published'),
         rating_count = (SELECT COUNT(*) FROM reviews WHERE target_type = ? AND target_id = ? AND status = 'published') WHERE ${key} = ?`,
    r.targetType, r.targetId, r.targetType, r.targetId, r.targetId);
  res.status(201).json({ ok: true });
}));

/* ---------- الإبلاغ والحظر ---------- */
router.post('/reports', requireAuth, validate(CreateReport), (req, res) => {
  const r = body<typeof CreateReport>(req);
  q.run('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?,?,?,?)', req.user!.id, r.targetType, r.targetId, r.reason);
  res.status(201).json({ ok: true });
});
router.post('/blocks/:id', requireAuth, (req, res) => {
  const other = idParam(req);
  if (other === req.user!.id) throw badRequest();
  if (!q.get('SELECT 1 FROM users WHERE id = ?', other)) throw notFound();
  q.run('INSERT OR IGNORE INTO blocks (user_id, blocked_user_id) VALUES (?,?)', req.user!.id, other);
  res.json({ ok: true });
});
router.delete('/blocks/:id', requireAuth, (req, res) => {
  q.run('DELETE FROM blocks WHERE user_id = ? AND blocked_user_id = ?', req.user!.id, idParam(req));
  res.json({ ok: true });
});

/* ---------- التحليلات (أحداث فقط، لا تتبّع خارجي) ---------- */
router.post('/events', requireAuth, validate(AnalyticsEvent), (req, res) => {
  const e = body<typeof AnalyticsEvent>(req);
  q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', req.user!.id, e.name, e.props ? JSON.stringify(e.props) : null);
  res.status(204).end();
});

/* ---------- لوحة التقدّم — من بيانات حقيقية فقط ---------- */
router.get('/me/progress', requireAuth, (req, res) => {
  const uid = req.user!.id;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const lessons = q.val<number>("SELECT COUNT(*) FROM bookings WHERE student_id = ? AND status = 'completed' AND ends_at >= ?", uid, weekAgo) ?? 0;
  const attendanceSec = q.val<number>('SELECT COALESCE(SUM(seconds),0) FROM booking_attendance WHERE user_id = ? AND joined_at >= ?', uid, weekAgo) ?? 0;
  const courseSec = q.val<number>("SELECT COALESCE(SUM(cl.duration_seconds),0) FROM lesson_progress lp JOIN course_lessons cl ON cl.id = lp.lesson_id WHERE lp.user_id = ? AND lp.completed = 1 AND replace(lp.updated_at, ' ', 'T') >= ?", uid, weekAgo) ?? 0;
  const quizzes = q.val<number>('SELECT COUNT(*) FROM quiz_attempts WHERE user_id = ? AND finished_at >= ?', uid, weekAgo) ?? 0;
  const avgScore = q.val<number | null>('SELECT AVG(percent) FROM quiz_attempts WHERE user_id = ? AND finished_at >= ?', uid, weekAgo) ?? null;

  const bySubject = q.all<any>(`
    SELECT s.id AS subject_id, s.name, s.color_key, AVG(ce.progress_percent) AS percent
    FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id JOIN subjects s ON s.id = c.subject_id
    WHERE ce.user_id = ? GROUP BY s.id`, uid).map(r => ({ subjectId: r.subject_id, name: r.name, colorKey: r.color_key, percent: Math.round(r.percent) }));

  const subjectOfQuiz = (quizId: number): string => q.val<string>(`
    SELECT s.name FROM quizzes z
    LEFT JOIN course_lessons cl ON z.owner_type = 'course_lesson' AND cl.id = z.owner_id
    LEFT JOIN course_sections cs ON cs.id = cl.section_id
    LEFT JOIN courses c ON c.id = COALESCE(cs.course_id, CASE WHEN z.owner_type = 'course' THEN z.owner_id END)
    LEFT JOIN books b ON z.owner_type = 'book' AND b.id = z.owner_id
    LEFT JOIN units u ON z.owner_type = 'unit' AND u.id = z.owner_id
    LEFT JOIN subjects s ON s.id = COALESCE(c.subject_id, b.subject_id, u.subject_id)
    WHERE z.id = ?`, quizId) ?? 'عام';
  const lastQuiz = q.val<number>('SELECT quiz_id FROM quiz_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 1', uid);
  const weak = weakTopics(uid).map(t => ({ ...t, subjectName: lastQuiz ? subjectOfQuiz(lastQuiz) : 'عام' }));

  res.json({
    week: { lessons, learningMinutes: Math.round((attendanceSec + courseSec) / 60), quizzes, avgScore: avgScore == null ? null : Math.round(avgScore) },
    bySubject, weakTopics: weak,
  });
});

export { json };
export default router;
