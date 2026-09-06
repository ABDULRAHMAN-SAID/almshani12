import { Router } from 'express';
import { z } from 'zod';
import { TeacherVerificationDecision, CancellationPolicy, CouponUpsert, Role } from '@manassah/shared';
import { db, q, json, settings, nowIso } from '../db/index.ts';
import { AppError, notFound, badRequest } from '../lib/errors.ts';
import { validate, body, idParam } from '../lib/validate.ts';
import { requireAuth, requireRole, requireExactRole } from '../lib/auth.ts';
import { money, slugify, paginate, pageMeta } from '../lib/helpers.ts';
import { orderView } from '../lib/views.ts';
import { signedUrl } from '../services/storage.ts';
import { fulfillOrder, refundOrder } from '../services/checkout.ts';
import { grantAccess } from '../services/access.ts';
import { notify } from '../services/notifications.ts';
import { bookingView, publicUrlFromPath } from '../services/mappers.ts';
import type { BookingRow } from '../services/bookings.ts';
import { audit } from '../lib/audit.ts';

/**
 * لوحة الإدارة — كل مسار يفرض دوره في الخادم.
 * admin/super_admin يمرّان دائماً؛ content_reviewer للمحتوى؛ finance للمال؛ support للحجوزات والبلاغات.
 */
const router = Router();
router.use(requireAuth);

const Page = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30), q: z.string().trim().max(120).optional(), status: z.string().max(40).optional() });

/* ---------- نظرة عامة (أرقام حقيقية فقط) ---------- */
router.get('/overview', requireRole('content_reviewer', 'support', 'finance'), (_req, res) => {
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const n = (sql: string, ...p: unknown[]) => q.val<number>(sql, ...p) ?? 0;
  res.json({
    users: { total: n("SELECT COUNT(*) FROM users WHERE status = 'active'"), students: n("SELECT COUNT(*) FROM user_roles WHERE role = 'student'"), newThisMonth: n('SELECT COUNT(*) FROM users WHERE created_at >= ?', monthStart.toISOString()) },
    teachers: Object.fromEntries(q.all<any>('SELECT verification_status AS s, COUNT(*) AS c FROM teacher_profiles GROUP BY verification_status').map(r => [r.s, r.c])),
    bookings: { today: n("SELECT COUNT(*) FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status IN ('confirmed','in_progress','completed')", today.toISOString(), new Date(today.getTime() + 86_400_000).toISOString()), pendingPayment: n("SELECT COUNT(*) FROM bookings WHERE status = 'pending_payment'"), disputed: n("SELECT COUNT(*) FROM bookings WHERE status = 'disputed'") },
    revenue: { month: money(n("SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN ('paid','partially_refunded') AND paid_at >= ?", monthStart.toISOString())), commissionMonth: money(n("SELECT COALESCE(SUM(commission),0) FROM teacher_earnings WHERE status <> 'reversed' AND created_at >= ?", monthStart.toISOString())), refundsMonth: money(n('SELECT COALESCE(SUM(amount),0) FROM refunds WHERE created_at >= ?', monthStart.toISOString())) },
    queues: {
      teacherApplications: n("SELECT COUNT(*) FROM teacher_profiles WHERE verification_status IN ('pending','under_review')"),
      contentReview: n("SELECT COUNT(*) FROM books WHERE status = 'pending_review'") + n("SELECT COUNT(*) FROM courses WHERE status = 'pending_review'"),
      manualPayments: n("SELECT COUNT(*) FROM payments WHERE provider = 'manual' AND status = 'pending'"),
      payouts: n("SELECT COUNT(*) FROM teacher_payouts WHERE status = 'pending'"),
      reports: n("SELECT COUNT(*) FROM reports WHERE status = 'open'"),
    },
  });
});

/* ---------- تحقّق المعلّمين ---------- */
router.get('/teachers', requireRole('support'), validate(Page, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof Page>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.status) { where.push('tp.verification_status = ?'); params.push(f.status); }
  if (f.q) { where.push('(norm(p.display_name) LIKE norm(?) OR u.phone LIKE ? OR u.email LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  const from = `FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id JOIN users u ON u.id = tp.user_id WHERE ${where.join(' AND ')}`;
  const total = q.val<number>(`SELECT COUNT(*) ${from}`, ...params) ?? 0;
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT tp.*, p.display_name, p.avatar_path, u.phone, u.email ${from} ORDER BY CASE tp.verification_status WHEN 'pending' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, tp.applied_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data: rows.map(t => ({ id: t.user_id, name: t.display_name, avatarUrl: publicUrlFromPath(t.avatar_path), phone: t.phone, email: t.email, headline: t.headline, specialty: t.specialty, yearsExp: t.years_exp, status: t.verification_status, appliedAt: t.applied_at, ratingAvg: t.rating_avg, lessonsCount: t.lessons_count })), meta: pageMeta(total, f.page, f.limit) });
});
router.get('/teachers/:id', requireRole('support'), (req, res) => {
  const id = idParam(req);
  const t = q.get<any>('SELECT tp.*, p.display_name, p.avatar_path, p.gender, u.phone, u.email, u.status AS user_status FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id JOIN users u ON u.id = tp.user_id WHERE tp.user_id = ?', id);
  if (!t) throw notFound();
  res.json({
    id, name: t.display_name, avatarUrl: publicUrlFromPath(t.avatar_path), gender: t.gender, phone: t.phone, email: t.email, userStatus: t.user_status,
    headline: t.headline, bio: t.bio, qualification: t.qualification, specialty: t.specialty, yearsExp: t.years_exp, languages: json(t.languages, []),
    status: t.verification_status, commissionRate: t.commission_rate, appliedAt: t.applied_at, verifiedAt: t.verified_at,
    subjects: q.all<any>('SELECT s.name AS subject, g.name AS grade FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id JOIN grades g ON g.id = ts.grade_id WHERE ts.teacher_id = ?', id),
    prices: q.all<any>('SELECT duration_minutes AS durationMinutes, mode, price FROM teacher_prices WHERE teacher_id = ?', id),
    documents: q.all<any>('SELECT d.id, d.type, d.status, d.note, d.file_id, f.mime, f.original_name FROM teacher_documents d JOIN files f ON f.id = d.file_id WHERE d.teacher_id = ?', id)
      .map(d => ({ id: d.id, type: d.type, status: d.status, note: d.note, mime: d.mime, name: d.original_name, url: signedUrl(d.file_id, req.user!.id, 600).url })),
    history: q.all<any>('SELECT v.decision, v.reason, v.decided_at, p.display_name AS reviewer FROM teacher_verifications v LEFT JOIN profiles p ON p.user_id = v.reviewer_id WHERE v.teacher_id = ? ORDER BY v.id DESC', id),
    stats: { bookings: q.val<number>('SELECT COUNT(*) FROM bookings WHERE teacher_id = ?', id), earnings: money(t.lifetime_earnings), available: money(t.available_balance), pending: money(t.pending_balance) },
  });
});
router.post('/teachers/:id/decision', requireRole('admin'), validate(TeacherVerificationDecision), (req, res) => {
  const id = idParam(req);
  const d = body<typeof TeacherVerificationDecision>(req);
  const t = q.get<any>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', id);
  if (!t) throw notFound();
  db.transaction(() => {
    q.run('UPDATE teacher_profiles SET verification_status = ?, verified_at = CASE WHEN ? = ? THEN ? ELSE verified_at END, commission_rate = COALESCE(?, commission_rate), updated_at = ? WHERE user_id = ?',
      d.decision, d.decision, 'verified', nowIso(), d.commissionRate ?? null, nowIso(), id);
    q.run('INSERT INTO teacher_verifications (teacher_id, reviewer_id, decision, reason) VALUES (?,?,?,?)', id, req.user!.id, d.decision, d.reason ?? null);
    if (d.decision === 'verified') q.run("UPDATE teacher_documents SET status = 'accepted' WHERE teacher_id = ? AND status = 'submitted'", id);
    if (d.decision === 'suspended') {
      // إيقاف المعلّم: تُلغى حصصه القادمة باسترجاع كامل
      for (const b of q.all<any>("SELECT id FROM bookings WHERE teacher_id = ? AND status IN ('pending_payment','confirmed')", id)) {
        q.run("UPDATE bookings SET status = 'cancelled_by_teacher', cancelled_at = ?, cancel_reason = 'إيقاف المعلّم', refund_percent = 100 WHERE id = ?", nowIso(), b.id);
        const bk = q.get<any>('SELECT order_id, price, package_purchase_id FROM bookings WHERE id = ?', b.id);
        if (bk.package_purchase_id) q.run('UPDATE package_purchases SET remaining = remaining + 1 WHERE id = ?', bk.package_purchase_id);
        else if (bk.order_id && q.val<string>('SELECT status FROM orders WHERE id = ?', bk.order_id) === 'paid') refundOrder(bk.order_id, { amount: money(bk.price), reason: 'إيقاف المعلّم', bookingId: b.id, processedBy: req.user!.id });
      }
    }
  })();
  const msg = { verified: ['teacher_verified', 'تم اعتماد حسابك كمعلّم 🎉', 'يمكنك الآن ضبط توفّرك ونشر محتواك'], rejected: ['teacher_rejected', 'لم يُقبل طلبك', d.reason ?? 'راجع المستندات وأعد التقديم'], under_review: ['system', 'طلبك قيد المراجعة', null], suspended: ['system', 'أُوقف حسابك كمعلّم', d.reason ?? null] }[d.decision];
  notify(id, { type: msg[0]!, title: msg[1]!, body: msg[2] });
  audit(req, `teacher.${d.decision}`, 'user', id, { reason: d.reason });
  res.json({ ok: true, status: d.decision });
});

/* ---------- مراجعة المحتوى ---------- */
router.get('/content', requireRole('content_reviewer'), validate(Page, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof Page>;
  const status = f.status ?? 'pending_review';
  const books = q.all<any>('SELECT b.id, b.title, b.type, b.price, b.status, b.updated_at, p.display_name AS author, s.name AS subject, g.name AS grade FROM books b JOIN profiles p ON p.user_id = b.author_id JOIN subjects s ON s.id = b.subject_id JOIN grades g ON g.id = b.grade_id WHERE b.status = ? ORDER BY b.updated_at LIMIT 100', status)
    .map(b => ({ ...b, entityType: 'book' }));
  const courses = q.all<any>('SELECT c.id, c.title, c.price, c.status, c.updated_at, p.display_name AS author, s.name AS subject, g.name AS grade FROM courses c JOIN profiles p ON p.user_id = c.teacher_id JOIN subjects s ON s.id = c.subject_id JOIN grades g ON g.id = c.grade_id WHERE c.status = ? ORDER BY c.updated_at LIMIT 100', status)
    .map(c => ({ ...c, entityType: 'course' }));
  res.json({ data: [...books, ...courses] });
});
router.get('/content/:type/:id/file', requireRole('content_reviewer'), (req, res) => {
  const id = idParam(req);
  if (req.params.type === 'book') {
    const f = q.get<{ file_id: number }>("SELECT file_id FROM book_files WHERE book_id = ? AND kind = 'full'", id);
    if (!f) throw notFound('لا ملف');
    return res.json(signedUrl(f.file_id, req.user!.id, 900));
  }
  const l = q.all<any>('SELECT l.id, l.title, l.video_file_id FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ?', id);
  res.json(l.map(x => ({ id: x.id, title: x.title, url: x.video_file_id ? signedUrl(x.video_file_id, req.user!.id, 900).url : null })));
});
const ContentDecision = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().max(500).nullable().optional(), checklist: z.record(z.string(), z.boolean()).optional() });
router.post('/content/:type/:id/decision', requireRole('content_reviewer'), validate(ContentDecision), (req, res) => {
  const type = req.params.type === 'book' ? 'book' : req.params.type === 'course' ? 'course' : null;
  if (!type) throw badRequest();
  const id = idParam(req);
  const d = body<typeof ContentDecision>(req);
  const table = type === 'book' ? 'books' : 'courses';
  const row = q.get<any>(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw notFound();
  const ownerId = type === 'book' ? row.author_id : row.teacher_id;
  db.transaction(() => {
    if (d.decision === 'approved') q.run(`UPDATE ${table} SET status = 'published', published_at = COALESCE(published_at, ?), reject_reason = NULL, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), id);
    else q.run(`UPDATE ${table} SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`, d.reason ?? null, nowIso(), id);
    q.run('INSERT INTO content_reviews (entity_type, entity_id, reviewer_id, decision, reason, checklist) VALUES (?,?,?,?,?,?)', type, id, req.user!.id, d.decision, d.reason ?? null, d.checklist ? JSON.stringify(d.checklist) : null);
  })();
  notify(ownerId, { type: d.decision === 'approved' ? 'content_approved' : 'content_rejected', title: d.decision === 'approved' ? `نُشر «${row.title}»` : `لم يُقبل «${row.title}»`, body: d.reason ?? null, data: { [type === 'book' ? 'bookId' : 'courseId']: id } });
  audit(req, `content.${d.decision}`, table, id, { reason: d.reason });
  res.json({ ok: true });
});
router.post('/content/:type/:id/archive', requireRole('admin'), (req, res) => {
  const table = req.params.type === 'book' ? 'books' : 'courses';
  q.run(`UPDATE ${table} SET status = 'archived', updated_at = ? WHERE id = ?`, nowIso(), idParam(req));
  audit(req, 'content.archive', table, idParam(req));
  res.json({ ok: true });
});

/* ---------- الحجوزات والطلبات والمال ---------- */
router.get('/bookings', requireRole('support', 'finance'), validate(Page, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof Page>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.status) { where.push('b.status = ?'); params.push(f.status); }
  if (f.q) { where.push('(norm(ps.display_name) LIKE norm(?) OR norm(pt.display_name) LIKE norm(?) OR b.id = ?)'); params.push(`%${f.q}%`, `%${f.q}%`, Number(f.q) || 0); }
  const from = `FROM bookings b JOIN profiles ps ON ps.user_id = b.student_id JOIN profiles pt ON pt.user_id = b.teacher_id WHERE ${where.join(' AND ')}`;
  const total = q.val<number>(`SELECT COUNT(*) ${from}`, ...params) ?? 0;
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<BookingRow>(`SELECT b.* ${from} ORDER BY b.starts_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data: rows.map(b => bookingView(b, req.user!.id)), meta: pageMeta(total, f.page, f.limit) });
});
const DisputeBody = z.object({ resolution: z.enum(['refund_student', 'pay_teacher', 'split']), reason: z.string().max(500) });
router.post('/bookings/:id/resolve', requireRole('support'), validate(DisputeBody), (req, res) => {
  const id = idParam(req);
  const d = body<typeof DisputeBody>(req);
  const b = q.get<any>('SELECT * FROM bookings WHERE id = ?', id);
  if (!b) throw notFound();
  db.transaction(() => {
    if (d.resolution !== 'pay_teacher' && b.order_id && q.val<string>('SELECT status FROM orders WHERE id = ?', b.order_id) === 'paid') {
      refundOrder(b.order_id, { amount: money(d.resolution === 'split' ? b.price / 2 : b.price), reason: d.reason, bookingId: id, processedBy: req.user!.id });
    }
    if (d.resolution !== 'pay_teacher' && b.package_purchase_id) q.run('UPDATE package_purchases SET remaining = remaining + 1 WHERE id = ?', b.package_purchase_id);
    q.run("UPDATE bookings SET status = 'completed', cancel_reason = ? WHERE id = ?", `نزاع: ${d.resolution} — ${d.reason}`, id);
  })();
  audit(req, 'booking.dispute_resolved', 'bookings', id, d);
  res.json({ ok: true });
});

router.get('/orders', requireRole('finance', 'support'), validate(Page, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof Page>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.status) { where.push('o.status = ?'); params.push(f.status); }
  if (f.q) { where.push('(o.number LIKE ? OR norm(p.display_name) LIKE norm(?))'); params.push(`%${f.q}%`, `%${f.q}%`); }
  const from = `FROM orders o JOIN profiles p ON p.user_id = o.user_id WHERE ${where.join(' AND ')}`;
  const total = q.val<number>(`SELECT COUNT(*) ${from}`, ...params) ?? 0;
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT o.*, p.display_name ${from} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data: rows.map(o => ({ ...orderView(o), userName: o.display_name, userId: o.user_id, providerRef: o.provider_ref })), meta: pageMeta(total, f.page, f.limit) });
});
router.post('/orders/:id/confirm-manual', requireRole('finance'), (req, res) => {
  const id = idParam(req);
  const o = q.get<any>('SELECT * FROM orders WHERE id = ?', id);
  if (!o) throw notFound();
  if (o.provider !== 'manual' || o.status !== 'pending') throw new AppError('conflict', 'الطلب ليس تحويلاً بنكياً معلّقاً', 409);
  const { order } = fulfillOrder(id, { provider: 'manual', providerRef: String(req.body?.reference ?? '') || null });
  audit(req, 'order.manual_confirmed', 'orders', id);
  res.json(orderView(order));
});
const RefundBody = z.object({ amount: z.number().positive().optional(), reason: z.string().min(3).max(500), bookingId: z.number().int().positive().optional() });
router.post('/orders/:id/refund', requireRole('finance'), validate(RefundBody), (req, res) => {
  const id = idParam(req);
  const r = body<typeof RefundBody>(req);
  const order = refundOrder(id, { amount: r.amount, reason: r.reason, bookingId: r.bookingId ?? null, processedBy: req.user!.id });
  if (r.bookingId) q.run("UPDATE bookings SET status = CASE WHEN status IN ('pending_payment','confirmed') THEN 'cancelled_by_teacher' ELSE status END, refund_percent = 100 WHERE id = ?", r.bookingId);
  audit(req, 'order.refund', 'orders', id, r);
  res.json(orderView(order));
});
router.get('/refunds', requireRole('finance'), (_req, res) => {
  res.json(q.all<any>('SELECT r.*, o.number, p.display_name FROM refunds r JOIN orders o ON o.id = r.order_id JOIN profiles p ON p.user_id = o.user_id ORDER BY r.id DESC LIMIT 200'));
});

router.get('/payouts', requireRole('finance'), (req, res) => {
  const status = String(req.query.status ?? 'pending');
  res.json(q.all<any>('SELECT tp.*, p.display_name FROM teacher_payouts tp JOIN profiles p ON p.user_id = tp.teacher_id WHERE tp.status = ? ORDER BY tp.id DESC LIMIT 200', status)
    .map(p => ({ id: p.id, teacherId: p.teacher_id, teacherName: p.display_name, amount: money(p.amount), method: p.method, details: json(p.details, {}), status: p.status, note: p.note, requestedAt: p.requested_at, processedAt: p.processed_at })));
});
const PayoutDecision = z.object({ decision: z.enum(['approved', 'paid', 'rejected']), note: z.string().max(300).nullable().optional() });
router.post('/payouts/:id/decision', requireRole('finance'), validate(PayoutDecision), (req, res) => {
  const id = idParam(req);
  const d = body<typeof PayoutDecision>(req);
  const p = q.get<any>('SELECT * FROM teacher_payouts WHERE id = ?', id);
  if (!p) throw notFound();
  if (p.status === 'paid' || p.status === 'rejected') throw new AppError('conflict', 'تمت معالجة هذا الطلب', 409);
  db.transaction(() => {
    q.run('UPDATE teacher_payouts SET status = ?, note = ?, processed_by = ?, processed_at = ? WHERE id = ?', d.decision, d.note ?? null, req.user!.id, nowIso(), id);
    if (d.decision === 'rejected') q.run('UPDATE teacher_profiles SET available_balance = available_balance + ? WHERE user_id = ?', p.amount, p.teacher_id);
    if (d.decision === 'paid') {
      // نربط الأرباح المتاحة بهذا الصرف حتى المبلغ
      let left = money(p.amount);
      for (const e of q.all<any>("SELECT id, net FROM teacher_earnings WHERE teacher_id = ? AND status = 'available' ORDER BY id", p.teacher_id)) {
        if (left <= 0) break;
        q.run("UPDATE teacher_earnings SET status = 'paid', payout_id = ? WHERE id = ?", id, e.id);
        left = money(left - e.net);
      }
    }
  })();
  notify(p.teacher_id, { type: 'payout_processed', title: d.decision === 'paid' ? 'تم تحويل أرباحك' : d.decision === 'approved' ? 'تمت الموافقة على السحب' : 'رُفض طلب السحب', body: d.note ?? null, data: { payoutId: id } });
  audit(req, `payout.${d.decision}`, 'teacher_payouts', id, { amount: p.amount });
  res.json({ ok: true });
});

/* ---------- الإعدادات (السياسات) ---------- */
const SettingsBody = z.object({
  commission_rate: z.number().min(0).max(0.9).optional(), tax_rate: z.number().min(0).max(0.5).optional(), min_payout: z.number().min(0).optional(),
  cancellation_policy: CancellationPolicy.optional(), room_open_minutes_before: z.number().int().min(0).max(120).optional(),
  room_close_minutes_after: z.number().int().min(0).max(240).optional(), booking_payment_window_minutes: z.number().int().min(3).max(60).optional(),
  earnings_hold_hours: z.number().int().min(0).max(720).optional(), reminder_minutes: z.array(z.number().int().min(1).max(1440)).max(4).optional(),
  max_teacher_slots_per_day: z.number().int().min(1).max(40).optional(),
});
router.get('/settings', requireRole('finance', 'support'), (_req, res) => res.json(settings.all()));
router.put('/settings', requireRole('admin'), validate(SettingsBody), (req, res) => {
  const s = body<typeof SettingsBody>(req);
  for (const [k, v] of Object.entries(s)) if (v !== undefined) settings.set(k, v);
  audit(req, 'settings.update', 'settings', null, s);
  res.json(settings.all());
});

/* ---------- المنهج ---------- */
const Named = z.object({ name: z.string().trim().min(1).max(120), order: z.number().int().optional() });
router.post('/catalog/countries', requireRole('admin'), validate(z.object({ code: z.string().length(2), name: z.string().min(1) })), (req, res) => {
  const b = req.body; const info = q.run('INSERT INTO countries (code, name) VALUES (?,?)', b.code.toUpperCase(), b.name); res.status(201).json({ id: Number(info.lastInsertRowid) });
});
router.post('/catalog/curriculums', requireRole('admin'), validate(Named.extend({ countryId: z.number().int() })), (req, res) => {
  const info = q.run('INSERT INTO curriculums (country_id, name) VALUES (?,?)', req.body.countryId, req.body.name); res.status(201).json({ id: Number(info.lastInsertRowid) });
});
router.post('/catalog/grades', requireRole('admin'), validate(Named.extend({ curriculumId: z.number().int() })), (req, res) => {
  const info = q.run('INSERT INTO grades (curriculum_id, name, "order") VALUES (?,?,?)', req.body.curriculumId, req.body.name, req.body.order ?? 0); res.status(201).json({ id: Number(info.lastInsertRowid) });
});
router.post('/catalog/semesters', requireRole('admin'), validate(Named.extend({ curriculumId: z.number().int() })), (req, res) => {
  const info = q.run('INSERT INTO semesters (curriculum_id, name, "order") VALUES (?,?,?)', req.body.curriculumId, req.body.name, req.body.order ?? 0); res.status(201).json({ id: Number(info.lastInsertRowid) });
});
router.post('/catalog/subjects', requireRole('admin'), validate(Named.extend({ curriculumId: z.number().int(), colorKey: z.string().max(20).default('default'), slug: z.string().max(40).optional() })), (req, res) => {
  const b = req.body; const info = q.run('INSERT INTO subjects (curriculum_id, name, slug, color_key, "order") VALUES (?,?,?,?,?)', b.curriculumId, b.name, b.slug ?? slugify(b.name), b.colorKey, b.order ?? 0); res.status(201).json({ id: Number(info.lastInsertRowid) });
});
router.post('/catalog/units', requireRole('admin', 'content_reviewer'), validate(z.object({ subjectId: z.number().int(), gradeId: z.number().int(), semesterId: z.number().int(), title: z.string().min(1).max(160), order: z.number().int().optional() })), (req, res) => {
  const b = req.body; const info = q.run('INSERT INTO units (subject_id, grade_id, semester_id, title, "order") VALUES (?,?,?,?,?)', b.subjectId, b.gradeId, b.semesterId, b.title, b.order ?? 0); res.status(201).json({ id: Number(info.lastInsertRowid) });
});
router.post('/catalog/lessons', requireRole('admin', 'content_reviewer'), validate(z.object({ unitId: z.number().int(), title: z.string().min(1).max(160), order: z.number().int().optional() })), (req, res) => {
  const b = req.body; const info = q.run('INSERT INTO curriculum_lessons (unit_id, title, "order") VALUES (?,?,?)', b.unitId, b.title, b.order ?? 0); res.status(201).json({ id: Number(info.lastInsertRowid) });
});
const CATALOG_TABLES: Record<string, string> = { countries: 'countries', curriculums: 'curriculums', grades: 'grades', semesters: 'semesters', subjects: 'subjects', units: 'units', lessons: 'curriculum_lessons' };
router.patch('/catalog/:kind/:id', requireRole('admin'), (req, res) => {
  const table = CATALOG_TABLES[req.params.kind]; if (!table) throw notFound();
  const id = idParam(req);
  const allowed: Record<string, string> = { name: 'name', title: 'title', order: '"order"', colorKey: 'color_key', active: 'active' };
  const sets: string[] = []; const params: unknown[] = [];
  for (const [k, col] of Object.entries(allowed)) if (req.body?.[k] !== undefined) { sets.push(`${col} = ?`); params.push(typeof req.body[k] === 'boolean' ? (req.body[k] ? 1 : 0) : req.body[k]); }
  if (!sets.length) throw badRequest('لا تغييرات');
  q.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  res.json({ ok: true });
});
router.delete('/catalog/:kind/:id', requireRole('admin'), (req, res) => {
  const table = CATALOG_TABLES[req.params.kind]; if (!table) throw notFound();
  try { q.run(`DELETE FROM ${table} WHERE id = ?`, idParam(req)); }
  catch (err: any) { if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) throw new AppError('conflict', 'لا يمكن الحذف: مرتبط بمحتوى منشور', 409); throw err; }
  audit(req, 'catalog.delete', table, idParam(req));
  res.json({ ok: true });
});

/* ---------- الكوبونات ---------- */
router.get('/coupons', requireRole('finance'), (_req, res) => {
  res.json(q.all<any>('SELECT * FROM coupons ORDER BY id DESC').map(c => ({ id: c.id, code: c.code, type: c.type, value: c.value, startsAt: c.starts_at, endsAt: c.ends_at, usageLimit: c.usage_limit, userLimit: c.user_limit, usedCount: c.used_count, scope: json(c.scope, {}), active: !!c.active })));
});
router.post('/coupons', requireRole('finance'), validate(CouponUpsert), (req, res) => {
  const c = body<typeof CouponUpsert>(req);
  try {
    const info = q.run('INSERT INTO coupons (code, type, value, starts_at, ends_at, usage_limit, user_limit, scope, created_by, active) VALUES (?,?,?,?,?,?,?,?,?,?)',
      c.code, c.type, c.value, c.startsAt, c.endsAt, c.usageLimit, c.userLimit, JSON.stringify(c.scope), req.user!.id, c.active ? 1 : 0);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err: any) { if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) throw new AppError('conflict', 'الرمز مستخدم', 409); throw err; }
});
router.patch('/coupons/:id', requireRole('finance'), (req, res) => {
  const active = req.body?.active;
  if (typeof active !== 'boolean') throw badRequest();
  q.run('UPDATE coupons SET active = ? WHERE id = ?', active ? 1 : 0, idParam(req));
  res.json({ ok: true });
});

/* ---------- المستخدمون والبلاغات والسجلّ ---------- */
router.get('/users', requireRole('support'), validate(Page, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof Page>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.q) { where.push('(norm(p.display_name) LIKE norm(?) OR u.phone LIKE ? OR u.email LIKE ? OR u.id = ?)'); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, Number(f.q) || 0); }
  if (f.status) { where.push('u.status = ?'); params.push(f.status); }
  const from = `FROM users u JOIN profiles p ON p.user_id = u.id WHERE ${where.join(' AND ')}`;
  const total = q.val<number>(`SELECT COUNT(*) ${from}`, ...params) ?? 0;
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT u.*, p.display_name ${from} ORDER BY u.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data: rows.map(u => ({ id: u.id, name: u.display_name, phone: u.phone, email: u.email, status: u.status, roles: q.all<{ role: string }>('SELECT role FROM user_roles WHERE user_id = ?', u.id).map(r => r.role), createdAt: u.created_at, lastLoginAt: u.last_login_at })), meta: pageMeta(total, f.page, f.limit) });
});
router.post('/users/:id/roles', requireExactRole('super_admin'), validate(z.object({ roles: z.array(Role).min(1) })), (req, res) => {
  const id = idParam(req);
  const roles = req.body.roles as string[];
  db.transaction(() => {
    q.run('DELETE FROM user_roles WHERE user_id = ?', id);
    for (const r of new Set(roles)) q.run('INSERT INTO user_roles (user_id, role, granted_by) VALUES (?,?,?)', id, r, req.user!.id);
  })();
  q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', id); // تُجدَّد الصلاحيات بجلسة جديدة
  audit(req, 'user.roles', 'user', id, { roles });
  res.json({ ok: true });
});
router.post('/users/:id/status', requireRole('admin'), validate(z.object({ status: z.enum(['active', 'suspended']), reason: z.string().max(300).optional() })), (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw badRequest('لا يمكنك تغيير حالة حسابك');
  q.run('UPDATE users SET status = ? WHERE id = ?', req.body.status, id);
  if (req.body.status === 'suspended') q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', id);
  audit(req, `user.${req.body.status}`, 'user', id, { reason: req.body.reason });
  res.json({ ok: true });
});
router.post('/users/:id/grant', requireRole('admin'), validate(z.object({ itemType: z.enum(['book', 'course']), itemId: z.number().int().positive() })), (req, res) => {
  grantAccess(idParam(req), req.body.itemType, req.body.itemId, { source: 'admin' });
  audit(req, 'entitlement.grant', req.body.itemType, req.body.itemId, { userId: idParam(req) });
  res.json({ ok: true });
});
router.get('/reports', requireRole('support'), (req, res) => {
  const status = String(req.query.status ?? 'open');
  res.json(q.all<any>('SELECT r.*, p.display_name AS reporter FROM reports r JOIN profiles p ON p.user_id = r.reporter_id WHERE r.status = ? ORDER BY r.id DESC LIMIT 200', status));
});
router.post('/reports/:id/status', requireRole('support'), validate(z.object({ status: z.enum(['reviewing', 'resolved', 'dismissed']) })), (req, res) => {
  q.run('UPDATE reports SET status = ?, handled_by = ? WHERE id = ?', req.body.status, req.user!.id, idParam(req));
  audit(req, 'report.status', 'reports', idParam(req), req.body);
  res.json({ ok: true });
});
router.post('/reviews/:id/hide', requireRole('support'), (req, res) => {
  const id = idParam(req);
  const r = q.get<any>('SELECT * FROM reviews WHERE id = ?', id); if (!r) throw notFound();
  q.run("UPDATE reviews SET status = 'hidden' WHERE id = ?", id);
  const table = r.target_type === 'teacher' ? 'teacher_profiles' : r.target_type === 'book' ? 'books' : 'courses';
  q.run(`UPDATE ${table} SET rating_avg = COALESCE((SELECT AVG(rating) FROM reviews WHERE target_type = ? AND target_id = ? AND status = 'published'),0), rating_count = (SELECT COUNT(*) FROM reviews WHERE target_type = ? AND target_id = ? AND status = 'published') WHERE ${r.target_type === 'teacher' ? 'user_id' : 'id'} = ?`, r.target_type, r.target_id, r.target_type, r.target_id, r.target_id);
  audit(req, 'review.hide', 'reviews', id);
  res.json({ ok: true });
});
router.get('/audit', requireRole('admin'), (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json(q.all<any>('SELECT a.*, p.display_name AS actor FROM audit_logs a LEFT JOIN profiles p ON p.user_id = a.actor_id ORDER BY a.id DESC LIMIT ?', limit).map(a => ({ ...a, meta: json(a.meta, null) })));
});

export default router;
