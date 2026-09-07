import { Router } from 'express';
import { z } from 'zod';
import { TeachersQuery, AvailabilityQuery, AvailabilityRules, TimeOff, TeacherApplication, LessonPrice, savePercent } from '@manassah/shared';
import { db, q, json, settings, nowIso } from '../db/index.ts';
import { config } from '../config.ts';
import { AppError, asyncHandler, notFound, badRequest } from '../lib/errors.ts';
import { validate, body, query, idParam } from '../lib/validate.ts';
import { attachUser, requireAuth, requireVerifiedTeacher } from '../lib/auth.ts';
import { paginate, pageMeta, money, iso, muscatToUtc, utcToMuscatParts } from '../lib/helpers.ts';
import { favoriteIds, ownedIds } from '../services/access.ts';
import { generateSlots } from '../services/slots.ts';
import { teacherCard, bookCard, courseCard, reviewItems, gradeRef, bookingView } from '../services/mappers.ts';
import { summary as earningsSummary } from '../services/earnings.ts';
import { notifyStaff, notify } from '../services/notifications.ts';
import { audit } from '../lib/audit.ts';
import { learnerRefById } from '../services/learners.ts';
import { publicUrlFromPath } from '../services/mappers.ts';
import type { BookingRow } from '../services/bookings.ts';

/* ============ عام: البحث والملف والتوفّر ============ */
export const publicRouter = Router();

const TEACHER_SELECT = 'SELECT DISTINCT tp.*, p.display_name, p.avatar_path, p.gender FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id';

publicRouter.get('/', attachUser, validate(TeachersQuery, 'query'), (req, res) => {
  const f = query<typeof TeachersQuery>(req);
  const where = ["tp.verification_status = 'verified'"];
  const joins: string[] = [];
  const params: unknown[] = [];
  if (f.subjectId || f.gradeId) {
    joins.push('JOIN teacher_subjects ts ON ts.teacher_id = tp.user_id');
    if (f.subjectId) { where.push('ts.subject_id = ?'); params.push(f.subjectId); }
    if (f.gradeId) { where.push('ts.grade_id = ?'); params.push(f.gradeId); }
  }
  if (f.q) {
    joins.push('LEFT JOIN teacher_subjects tsq ON tsq.teacher_id = tp.user_id LEFT JOIN subjects sq ON sq.id = tsq.subject_id');
    where.push('(norm(p.display_name) LIKE norm(?) OR norm(tp.headline) LIKE norm(?) OR norm(tp.specialty) LIKE norm(?) OR norm(sq.name) LIKE norm(?))');
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.maxPrice != null) { where.push('(SELECT MIN(price) FROM teacher_prices WHERE teacher_id = tp.user_id) <= ?'); params.push(f.maxPrice); }
  if (f.minRating != null) { where.push('tp.rating_avg >= ?'); params.push(f.minRating); }
  if (f.mode) { where.push('EXISTS (SELECT 1 FROM teacher_prices WHERE teacher_id = tp.user_id AND mode = ?)'); params.push(f.mode); }
  if (f.gender) { where.push('p.gender = ?'); params.push(f.gender); }
  if (f.language) { where.push('tp.languages LIKE ?'); params.push(`%"${f.language}"%`); }
  if (f.minYearsExp != null) { where.push('tp.years_exp >= ?'); params.push(f.minYearsExp); }
  const order = {
    recommended: 'tp.rating_avg DESC, tp.lessons_count DESC', rating: 'tp.rating_avg DESC, tp.rating_count DESC',
    price_asc: '(SELECT MIN(price) FROM teacher_prices WHERE teacher_id = tp.user_id) ASC', soonest: 'tp.lessons_count DESC',
  }[f.sort];
  const from = `${joins.join(' ')} WHERE ${where.join(' AND ')}`;
  const { limit, offset } = paginate(f.page, f.limit);
  const fav = favoriteIds(req.user?.id, 'teacher');
  // «متاح الآن» و«الأقرب موعداً» يعتمدان على أوّل موعد شاغر (يُحسب في JS): نطبّقهما على المرشّحين كلّهم
  // قبل التقطيع، وإلا جاءت صفحات شبه فارغة وrتيب داخل الصفحة فقط.
  if (f.availableNow || f.sort === 'soonest') {
    const candidates = q.all<any>(`${TEACHER_SELECT} ${from} ORDER BY ${order} LIMIT 200`, ...params);
    let cards = candidates.map(t => teacherCard(t, { userId: req.user?.id, fav }));
    if (f.availableNow) cards = cards.filter(c => c.availableNow);
    if (f.sort === 'soonest') cards.sort((a, b) => (a.nextSlotAt ?? '9').localeCompare(b.nextSlotAt ?? '9'));
    return res.json({ data: cards.slice(offset, offset + limit), meta: pageMeta(cards.length, f.page, f.limit) });
  }
  const total = q.val<number>(`SELECT COUNT(DISTINCT tp.user_id) FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id ${from}`, ...params) ?? 0;
  const rows = q.all<any>(`${TEACHER_SELECT} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data: rows.map(t => teacherCard(t, { userId: req.user?.id, fav })), meta: pageMeta(total, f.page, f.limit) });
});

publicRouter.get('/:id', attachUser, (req, res) => {
  const id = idParam(req);
  const uid = req.user?.id;
  const t = q.get<any>(`${TEACHER_SELECT} WHERE tp.user_id = ?`, id);
  if (!t || (t.verification_status !== 'verified' && uid !== id)) throw notFound('المعلّم غير موجود');
  const card = teacherCard(t, { userId: uid });
  const prices = q.all<any>('SELECT duration_minutes, mode, price FROM teacher_prices WHERE teacher_id = ? ORDER BY mode, duration_minutes', id)
    .map(p => ({ durationMinutes: p.duration_minutes, mode: p.mode, price: money(p.price) }));
  const packages = q.all<any>('SELECT * FROM lesson_packages WHERE teacher_id = ? AND active = 1 ORDER BY lessons_count', id).map(p => {
    const unit = prices.find(x => x.durationMinutes === p.duration_minutes && x.mode === p.mode)?.price ?? 0;
    const listPrice = money(unit * p.lessons_count) || money(p.price);
    return { id: p.id, lessonsCount: p.lessons_count, durationMinutes: p.duration_minutes, mode: p.mode, price: money(p.price), listPrice, savePercent: savePercent(listPrice, money(p.price)) };
  });
  const grades = q.all<{ grade_id: number }>('SELECT DISTINCT grade_id FROM teacher_subjects WHERE teacher_id = ?', id).map(g => gradeRef(g.grade_id));
  const canReview = !!uid && !!q.get("SELECT 1 FROM bookings WHERE student_id = ? AND teacher_id = ? AND status = 'completed'", uid, id)
    && !q.get('SELECT 1 FROM reviews WHERE user_id = ? AND target_type = ? AND target_id = ?', uid, 'teacher', id);
  const preview = generateSlots(id, { from: new Date().toISOString(), days: 7, durationMinutes: 60 }).map(d => ({ date: d.date, slotsCount: d.slots.filter(s => s.available).length }));
  // شريط الأرقام: الطلاب = متعلّمون متمايزون في حصص مكتملة (الحجوزات القديمة بلا متعلّم تُحسب بحسابها)
  const studentsCount = q.val<number>("SELECT COUNT(DISTINCT COALESCE(learner_id, -student_id)) FROM bookings WHERE teacher_id = ? AND status = 'completed'", id) ?? 0;
  const stats = { studentsCount, lessonsCount: t.lessons_count ?? 0, ratingCount: t.rating_count ?? 0, yearsExp: t.years_exp ?? 0 };
  // التوفّر الأسبوعي (بلا مدد الخانات) والإجازات المتقاطعة مع الـ٣٠ يوماً القادمة (بلا أسباب)
  const availabilityRules = q.all<any>('SELECT weekday, start_time, end_time FROM teacher_availability WHERE teacher_id = ? ORDER BY weekday, start_time', id)
    .map(r => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time }));
  const now = nowIso(), in30 = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const timeOff = q.all<any>('SELECT starts_at, ends_at FROM teacher_time_off WHERE teacher_id = ? AND ends_at >= ? AND starts_at <= ? ORDER BY starts_at', id, now, in30)
    .map(r => ({ from: r.starts_at, to: r.ends_at }));
  if (uid) q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', uid, 'teacher_view', JSON.stringify({ id }));
  res.json({
    ...card, bio: t.bio ?? '', lessonsCount: t.lessons_count, grades,
    teachingStyle: json<string[]>(t.teaching_style, []), languages: json<string[]>(t.languages, ['ar']),
    prices, packages,
    courses: q.all<any>("SELECT * FROM courses WHERE teacher_id = ? AND status = 'published' ORDER BY sales_count DESC LIMIT 6", id).map(c => courseCard(c, { userId: uid, enrolled: ownedIds(uid, 'course'), fav: favoriteIds(uid, 'course') })),
    books: q.all<any>("SELECT * FROM books WHERE author_id = ? AND status = 'published' ORDER BY sales_count DESC LIMIT 6", id).map(b => bookCard(b, { userId: uid, owned: ownedIds(uid, 'book'), fav: favoriteIds(uid, 'book') })),
    reviews: reviewItems('teacher', id), canReview, availabilityPreview: preview,
    stats, availabilityRules, timeOff,
  });
});

/** المواعيد المتاحة — بتوقيت مسقط، بعد خصم الإجازات والحجوزات */
publicRouter.get('/:id/availability', validate(AvailabilityQuery, 'query'), (req, res) => {
  const id = idParam(req);
  const f = query<typeof AvailabilityQuery>(req);
  if (!q.get("SELECT 1 FROM teacher_profiles WHERE user_id = ? AND verification_status = 'verified'", id)) throw notFound('المعلّم غير موجود');
  if (![30, 45, 60].includes(f.durationMinutes)) throw badRequest('المدة يجب أن تكون 30 أو 45 أو 60');
  res.json(generateSlots(id, { from: f.from, days: f.days, durationMinutes: f.durationMinutes }));
});

/* ============ المعلّم نفسه ============ */
export const selfRouter = Router();
selfRouter.use(requireAuth);

/** طلب الانضمام — يدخل قائمة التحقّق (pending) ولا يظهر للطلاب حتى الاعتماد */
selfRouter.post('/apply', validate(TeacherApplication), (req, res) => {
  const a = body<typeof TeacherApplication>(req);
  const uid = req.user!.id;
  const current = q.val<string>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', uid);
  if (current === 'verified') throw new AppError('conflict', 'حسابك معتمد بالفعل', 409);
  if (current === 'suspended') throw new AppError('forbidden', 'حسابك موقوف — تواصل مع الدعم', 403);
  for (const d of a.documents) {
    const f = q.get<any>('SELECT owner_id FROM files WHERE id = ?', d.fileId);
    if (!f || f.owner_id !== uid) throw badRequest('أحد المستندات غير صالح');
  }
  db.transaction(() => {
    q.run('UPDATE profiles SET display_name = ?, gender = COALESCE(?, gender), updated_at = ? WHERE user_id = ?', a.displayName, a.gender ?? null, nowIso(), uid);
    q.run(`INSERT INTO teacher_profiles (user_id, headline, bio, qualification, specialty, years_exp, languages, verification_status, applied_at, updated_at)
           VALUES (?,?,?,?,?,?,?,'pending',?,?)
           ON CONFLICT(user_id) DO UPDATE SET headline=excluded.headline, bio=excluded.bio, qualification=excluded.qualification, specialty=excluded.specialty,
             years_exp=excluded.years_exp, languages=excluded.languages, verification_status='pending', applied_at=excluded.applied_at, updated_at=excluded.updated_at`,
      uid, a.headline, a.bio, a.qualification, a.specialty, a.yearsExp, JSON.stringify(a.languages), nowIso(), nowIso());
    q.run('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)', uid, 'teacher');
    q.run('DELETE FROM teacher_subjects WHERE teacher_id = ?', uid);
    for (const s of a.subjectIds) for (const g of a.gradeIds) q.run('INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id, grade_id) VALUES (?,?,?)', uid, s, g);
    q.run('DELETE FROM teacher_prices WHERE teacher_id = ?', uid);
    for (const p of a.prices) q.run('INSERT INTO teacher_prices (teacher_id, duration_minutes, mode, price) VALUES (?,?,?,?)', uid, p.durationMinutes, p.mode, money(p.price));
    q.run('DELETE FROM teacher_documents WHERE teacher_id = ?', uid);
    for (const d of a.documents) q.run('INSERT INTO teacher_documents (teacher_id, type, file_id) VALUES (?,?,?)', uid, d.type, d.fileId);
  })();
  notifyStaff(['admin', 'support'], { type: 'system', title: 'طلب معلّم جديد', body: a.displayName, data: { teacherId: uid } });
  audit(req, 'teacher.apply', 'user', uid);
  res.status(201).json({ ok: true, verificationStatus: 'pending' });
});

selfRouter.get('/me', (req, res) => {
  const uid = req.user!.id;
  const tp = q.get<any>('SELECT * FROM teacher_profiles WHERE user_id = ?', uid);
  if (!tp) throw notFound('لم تقدّم طلب انضمام بعد');
  // «اليوم» و«هذا الشهر» بتوقيت مسقط لا UTC (بين ٠٠:٠٠ و٠٤:٠٠ كان اليوم UTC ما يزال «أمس»)
  const muscatToday = utcToMuscatParts(nowIso()).date;
  const todayIso = muscatToUtc(muscatToday, '00:00');
  const tomorrowIso = muscatToUtc(new Date(new Date(`${muscatToday}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10), '00:00');
  const monthStartIso = muscatToUtc(`${muscatToday.slice(0, 7)}-01`, '00:00');
  const dashboard = {
    verificationStatus: tp.verification_status,
    monthIncome: money(q.val<number>("SELECT COALESCE(SUM(net),0) FROM teacher_earnings WHERE teacher_id = ? AND status <> 'reversed' AND created_at >= ?", uid, monthStartIso) ?? 0),
    todayLessons: q.val<number>("SELECT COUNT(*) FROM bookings WHERE teacher_id = ? AND status IN ('confirmed','in_progress') AND starts_at >= ? AND starts_at < ?", uid, todayIso, tomorrowIso) ?? 0,
    upcomingLessons: q.val<number>("SELECT COUNT(*) FROM bookings WHERE teacher_id = ? AND status IN ('confirmed','in_progress') AND ends_at >= ?", uid, nowIso()) ?? 0,
    studentsCount: tp.students_count, ratingAvg: tp.rating_avg, availableBalance: money(tp.available_balance),
    booksSold: q.val<number>("SELECT COALESCE(SUM(sales_count),0) FROM books WHERE author_id = ?", uid) ?? 0,
    coursesSold: q.val<number>("SELECT COALESCE(SUM(sales_count),0) FROM courses WHERE teacher_id = ?", uid) ?? 0,
    pendingHomeworkReviews: 0,
  };
  const documents = q.all<any>('SELECT id, type, status, note, created_at FROM teacher_documents WHERE teacher_id = ?', uid).map(d => ({ ...d, created_at: iso(d.created_at) }));
  const lastDecision = q.get<any>('SELECT decision, reason, decided_at FROM teacher_verifications WHERE teacher_id = ? ORDER BY id DESC LIMIT 1', uid);
  if (lastDecision) lastDecision.decided_at = iso(lastDecision.decided_at);
  res.json({ ...dashboard, documents, lastDecision: lastDecision ?? null });
});

/* ---------- التقويم ---------- */
selfRouter.get('/availability', (req, res) => {
  const uid = req.user!.id;
  res.json({
    rules: q.all<any>('SELECT weekday, start_time AS startTime, end_time AS endTime, slot_minutes AS slotMinutes, break_minutes AS breakMinutes FROM teacher_availability WHERE teacher_id = ? ORDER BY weekday, start_time', uid),
    timeOff: q.all<any>('SELECT id, starts_at AS startsAt, ends_at AS endsAt, reason FROM teacher_time_off WHERE teacher_id = ? AND ends_at >= ? ORDER BY starts_at', uid, nowIso()),
    maxPerDay: settings.get<number>('max_teacher_slots_per_day'),
  });
});
selfRouter.put('/availability', requireVerifiedTeacher, validate(AvailabilityRules), (req, res) => {
  const rules = body<typeof AvailabilityRules>(req);
  const uid = req.user!.id;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  for (const r of rules) if (toMin(r.endTime) <= toMin(r.startTime)) throw badRequest('وقت النهاية يجب أن يكون بعد البداية');
  // فترتان متداخلتان في اليوم نفسه تولّدان الموعد ذاته مرّتين للطلاب
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
    const a = rules[i]!, b = rules[j]!;
    if (a.weekday === b.weekday && toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime)) throw badRequest('فترات متداخلة في اليوم نفسه');
  }
  db.transaction(() => {
    q.run('DELETE FROM teacher_availability WHERE teacher_id = ?', uid);
    for (const r of rules) q.run('INSERT INTO teacher_availability (teacher_id, weekday, start_time, end_time, slot_minutes, break_minutes) VALUES (?,?,?,?,?,?)', uid, r.weekday, r.startTime, r.endTime, r.slotMinutes, r.breakMinutes);
  })();
  res.json({ ok: true, count: rules.length });
});
selfRouter.post('/time-off', requireVerifiedTeacher, validate(TimeOff), (req, res) => {
  const t = body<typeof TimeOff>(req);
  if (new Date(t.endsAt) <= new Date(t.startsAt)) throw badRequest('فترة غير صالحة');
  const info = q.run('INSERT INTO teacher_time_off (teacher_id, starts_at, ends_at, reason) VALUES (?,?,?,?)', req.user!.id, t.startsAt, t.endsAt, t.reason ?? null);
  const affected = q.all<any>("SELECT id FROM bookings WHERE teacher_id = ? AND status IN ('pending_payment','confirmed') AND starts_at < ? AND ends_at > ?", req.user!.id, t.endsAt, t.startsAt);
  res.status(201).json({ id: Number(info.lastInsertRowid), conflictingBookings: affected.map(b => b.id) });
});
selfRouter.delete('/time-off/:id', requireVerifiedTeacher, (req, res) => {
  q.run('DELETE FROM teacher_time_off WHERE id = ? AND teacher_id = ?', idParam(req), req.user!.id);
  res.json({ ok: true });
});

/* ---------- الأسعار والباقات ---------- */
selfRouter.put('/prices', validate(z.array(LessonPrice).min(1).max(6)), (req, res) => {
  const prices = body<z.ZodArray<typeof LessonPrice>>(req);
  db.transaction(() => {
    q.run('DELETE FROM teacher_prices WHERE teacher_id = ?', req.user!.id);
    for (const p of prices) q.run('INSERT OR REPLACE INTO teacher_prices (teacher_id, duration_minutes, mode, price) VALUES (?,?,?,?)', req.user!.id, p.durationMinutes, p.mode, money(p.price));
  })();
  res.json({ ok: true });
});
const PackageBody = z.object({ lessonsCount: z.number().int().min(2).max(50), durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]), mode: z.enum(['individual', 'group']), price: z.number().positive() });
selfRouter.post('/packages', requireVerifiedTeacher, validate(PackageBody), (req, res) => {
  const p = body<typeof PackageBody>(req);
  const unit = q.val<number>('SELECT price FROM teacher_prices WHERE teacher_id = ? AND duration_minutes = ? AND mode = ?', req.user!.id, p.durationMinutes, p.mode);
  if (unit == null) throw badRequest('حدّد سعر هذه المدة أولاً');
  if (p.price >= unit * p.lessonsCount) throw badRequest('سعر الباقة يجب أن يكون أقل من مجموع الحصص منفردة');
  const info = q.run('INSERT INTO lesson_packages (teacher_id, lessons_count, duration_minutes, mode, price) VALUES (?,?,?,?,?)', req.user!.id, p.lessonsCount, p.durationMinutes, p.mode, money(p.price));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});
selfRouter.delete('/packages/:id', (req, res) => {
  q.run('UPDATE lesson_packages SET active = 0 WHERE id = ? AND teacher_id = ?', idParam(req), req.user!.id);
  res.json({ ok: true });
});

/* ---------- الأرباح والسحب ---------- */
selfRouter.get('/earnings', (req, res) => {
  const uid = req.user!.id;
  const s = earningsSummary(uid);
  res.json({
    ...s,
    commissionRate: q.val<number>('SELECT commission_rate FROM teacher_profiles WHERE user_id = ?', uid) ?? settings.get<number>('commission_rate'),
    minPayout: settings.get<number>('min_payout'),
    payouts: q.all<any>('SELECT id, amount, status, requested_at, processed_at FROM teacher_payouts WHERE teacher_id = ? ORDER BY id DESC LIMIT 30', uid)
      .map(p => ({ id: p.id, amount: money(p.amount), status: p.status, requestedAt: iso(p.requested_at), processedAt: iso(p.processed_at) })),
    recent: q.all<any>("SELECT id, source_type, gross, commission, net, status, created_at FROM teacher_earnings WHERE teacher_id = ? ORDER BY id DESC LIMIT 40", uid).map(r => ({ ...r, created_at: iso(r.created_at) })),
  });
});
const PayoutBody = z.object({ amount: z.number().positive(), method: z.enum(['bank', 'wallet']).default('bank'), details: z.record(z.string(), z.string()).default({}) });
selfRouter.post('/payouts', requireVerifiedTeacher, validate(PayoutBody), (req, res) => {
  const p = body<typeof PayoutBody>(req);
  const uid = req.user!.id;
  const available = money(q.val<number>('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', uid) ?? 0);
  const min = settings.get<number>('min_payout');
  if (q.get("SELECT 1 FROM teacher_payouts WHERE teacher_id = ? AND status IN ('pending','approved')", uid)) throw new AppError('conflict', 'لديك طلب سحب قيد المعالجة', 409);
  if (p.amount < min) throw badRequest(`الحدّ الأدنى للسحب ${min}`);
  if (p.amount > available) throw new AppError('insufficient_funds', 'المبلغ يتجاوز رصيدك المتاح', 400);
  const id = db.transaction(() => {
    const info = q.run('INSERT INTO teacher_payouts (teacher_id, amount, method, details) VALUES (?,?,?,?)', uid, money(p.amount), p.method, JSON.stringify(p.details));
    q.run('UPDATE teacher_profiles SET available_balance = available_balance - ? WHERE user_id = ?', money(p.amount), uid);
    return Number(info.lastInsertRowid);
  })();
  notifyStaff(['finance', 'admin'], { type: 'system', title: 'طلب سحب جديد', body: `${p.amount} ${config.money.currency}`, data: { payoutId: id } });
  audit(req, 'payout.request', 'teacher_payouts', id, { amount: p.amount });
  res.status(201).json({ id });
});

/** طلاب المعلّم = متعلّمون: كل صف {learner: LearnerRef, lessons, lastAt} فقط — لا هاتف ولا بريد ولا معرّف حساب (D11) */
selfRouter.get('/students', requireVerifiedTeacher, (req, res) => {
  const rows = q.all<any>(`SELECT b.learner_id, b.student_id, p.display_name, p.avatar_path, COUNT(*) AS lessons, MAX(b.starts_at) AS last_at
    FROM bookings b JOIN profiles p ON p.user_id = b.student_id
    WHERE b.teacher_id = ? AND b.status IN ('completed','confirmed','in_progress') GROUP BY COALESCE(b.learner_id, -b.student_id) ORDER BY last_at DESC LIMIT 300`, req.user!.id);
  res.json(rows.map(r => ({
    // حجز قديم بلا متعلّم (أو متعلّم حُذف نهائياً) → مرجع اصطناعي بمعرّف سالب من الحساب، بلا أي بيانات اتصال
    learner: (r.learner_id ? learnerRefById(r.learner_id) : null) ?? { id: -r.student_id, displayName: r.display_name ?? '', gradeName: null, avatarUrl: publicUrlFromPath(r.avatar_path) },
    lessons: r.lessons, lastAt: r.last_at ?? null,
  })));
});

/** حصص المعلّم القادمة والسابقة */
selfRouter.get('/bookings', (req, res) => {
  const uid = req.user!.id;
  const upcoming = q.all<BookingRow>("SELECT * FROM bookings WHERE teacher_id = ? AND status IN ('confirmed','in_progress') AND ends_at >= ? ORDER BY starts_at LIMIT 100", uid, nowIso());
  const past = q.all<BookingRow>("SELECT * FROM bookings WHERE teacher_id = ? AND (status IN ('completed','no_show','cancelled_by_student','cancelled_by_teacher','disputed') OR ends_at < ?) ORDER BY starts_at DESC LIMIT 60", uid, nowIso());
  res.json({ upcoming: upcoming.map(b => bookingView(b, uid)), past: past.map(b => bookingView(b, uid)) });
});

export { notify };
