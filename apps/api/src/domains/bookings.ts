import { Router } from 'express';
import { CreateBooking, CancelBooking, RescheduleBooking, PostLessonNotes } from '@manassah/shared';
import { db, q, settings, nowIso } from '../db/index.ts';
import { AppError, asyncHandler, notFound, forbidden, badRequest } from '../lib/errors.ts';
import { validate, body, idParam } from '../lib/validate.ts';
import { requireAuth, hasRole } from '../lib/auth.ts';
import { utcToMuscatParts } from '../lib/helpers.ts';
import { createBooking, cancelByStudent, cancelByTeacher, completeBooking, markLeft, type BookingRow } from '../services/bookings.ts';
import { isWithinAvailability } from '../services/slots.ts';
import { issueRoomAccess, endRoom } from '../services/rooms.ts';
import { bookingView, personRef } from '../services/mappers.ts';
import { signedUrl } from '../services/storage.ts';
import { notify } from '../services/notifications.ts';
import { audit } from '../lib/audit.ts';

const router = Router();
router.use(requireAuth);

const load = (req: any): BookingRow => {
  const b = q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', idParam(req));
  if (!b) throw notFound('الحجز غير موجود');
  const u = req.user!;
  if (b.student_id !== u.id && b.teacher_id !== u.id && !hasRole(u, 'support')) throw forbidden();
  return b;
};

/** حجز حصة: التحقّق كله في الخادم؛ التعارض يحسمه قيد قاعدة البيانات */
router.post('/', validate(CreateBooking), (req, res) => {
  const input = body<typeof CreateBooking>(req);
  const { booking, order } = createBooking(req.user!.id, input);
  const view = bookingView(booking, req.user!.id);
  q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', req.user!.id, 'booking_started', JSON.stringify({ bookingId: booking.id }));
  res.status(201).json({
    booking: view, paymentRequired: !!order, orderNumber: order?.number ?? null, checkoutUrl: null,
    expiresAt: booking.expires_at ?? null, orderId: order?.id ?? null,
  });
});

/** تبويب الحصص: القادمة (اليوم/غداً/الأسبوع/لاحقاً) — السابقة — باقاتي */
router.get('/', (req, res) => {
  const uid = req.user!.id;
  const asTeacher = req.query.as === 'teacher' && req.user!.roles.includes('teacher');
  const col = asTeacher ? 'teacher_id' : 'student_id';
  const upcomingRows = q.all<BookingRow>(`SELECT * FROM bookings WHERE ${col} = ? AND status IN ('pending_payment','confirmed','in_progress') AND ends_at >= ? ORDER BY starts_at LIMIT 100`, uid, nowIso());
  const pastRows = q.all<BookingRow>(`SELECT * FROM bookings WHERE ${col} = ? AND (status IN ('completed','no_show','cancelled_by_student','cancelled_by_teacher','disputed','expired') OR ends_at < ?) ORDER BY starts_at DESC LIMIT 60`, uid, nowIso());
  const todayKey = utcToMuscatParts(nowIso()).date;
  const tomorrowKey = utcToMuscatParts(new Date(Date.now() + 86_400_000).toISOString()).date;
  const weekKey = utcToMuscatParts(new Date(Date.now() + 7 * 86_400_000).toISOString()).date;
  const upcoming = { today: [] as any[], tomorrow: [] as any[], thisWeek: [] as any[], later: [] as any[] };
  for (const b of upcomingRows) {
    const key = utcToMuscatParts(b.starts_at).date;
    const v = bookingView(b, uid);
    if (key <= todayKey) upcoming.today.push(v);
    else if (key === tomorrowKey) upcoming.tomorrow.push(v);
    else if (key <= weekKey) upcoming.thisWeek.push(v);
    else upcoming.later.push(v);
  }
  const packages = asTeacher ? [] : q.all<any>('SELECT pp.*, lp.duration_minutes, lp.mode FROM package_purchases pp JOIN lesson_packages lp ON lp.id = pp.package_id WHERE pp.user_id = ? AND pp.remaining > 0 AND (pp.expires_at IS NULL OR pp.expires_at > ?) ORDER BY pp.id DESC', uid, nowIso())
    .map(p => ({ id: p.id, teacher: personRef(p.teacher_id), lessonsCount: p.total, remaining: p.remaining, durationMinutes: p.duration_minutes, mode: p.mode, expiresAt: p.expires_at }));
  res.json({ upcoming, past: pastRows.map(b => bookingView(b, uid)), packages });
});

router.get('/:id', (req, res) => { res.json(bookingView(load(req), req.user!.id)); });

router.post('/:id/cancel', validate(CancelBooking), (req, res) => {
  const b = load(req);
  const { reason } = body<typeof CancelBooking>(req);
  if (b.student_id === req.user!.id) {
    const r = cancelByStudent(b.id, req.user!.id, reason);
    audit(req, 'booking.cancel_student', 'bookings', b.id, r);
    return res.json({ ok: true, ...r });
  }
  if (b.teacher_id === req.user!.id) {
    cancelByTeacher(b.id, req.user!.id, reason);
    audit(req, 'booking.cancel_teacher', 'bookings', b.id);
    return res.json({ ok: true, refundPercent: 100 });
  }
  throw forbidden();
});

/** إعادة الجدولة = إلغاء بلا رسوم + حجز جديد داخل معاملة واحدة (قبل ٢٤ ساعة على الأقل) */
router.post('/:id/reschedule', validate(RescheduleBooking), (req, res) => {
  const b = load(req);
  const { startsAt } = body<typeof RescheduleBooking>(req);
  if (b.student_id !== req.user!.id) throw forbidden();
  if (b.status !== 'confirmed') throw new AppError('conflict', 'لا يمكن إعادة جدولة هذا الحجز', 409);
  const policy = settings.get<{ hoursBefore: number; refundPercent: number }[]>('cancellation_policy');
  const freeHours = Math.max(...policy.filter(p => p.refundPercent === 100).map(p => p.hoursBefore), 0);
  if ((new Date(b.starts_at).getTime() - Date.now()) / 3_600_000 < freeHours) throw new AppError('conflict', `إعادة الجدولة متاحة قبل ${freeHours} ساعة من الموعد`, 409);
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) throw badRequest('موعد غير صالح');
  const iso = start.toISOString();
  if (!isWithinAvailability(b.teacher_id, iso, b.duration_minutes)) throw new AppError('teacher_unavailable', 'الموعد خارج توفّر المعلّم', 400);
  db.transaction(() => {
    const endsAt = new Date(start.getTime() + b.duration_minutes * 60_000).toISOString();
    try { q.run('UPDATE bookings SET starts_at = ?, ends_at = ? WHERE id = ?', iso, endsAt, b.id); }
    catch (err: any) { if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) throw new AppError('booking_conflict', 'هذا الموعد لم يعد متاحاً', 409); throw err; }
    q.run('DELETE FROM live_rooms WHERE booking_id = ?', b.id);
  })();
  notify(b.teacher_id, { type: 'system', title: 'أُعيدت جدولة حصة', body: null, data: { bookingId: b.id } });
  audit(req, 'booking.reschedule', 'bookings', b.id, { from: b.starts_at, to: iso });
  res.json(bookingView(q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', b.id)!, req.user!.id));
});

/** دخول القاعة: رمز محدود المدة من حجز رسمي فقط — لا رابط عام */
router.get('/:id/room', asyncHandler(async (req, res) => {
  const b = load(req);
  const name = q.val<string>('SELECT display_name FROM profiles WHERE user_id = ?', req.user!.id) ?? '';
  const access = await issueRoomAccess(b.id, { id: req.user!.id, roles: req.user!.roles, name });
  q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', req.user!.id, 'room_join', JSON.stringify({ bookingId: b.id }));
  res.json({
    provider: access.provider, roomId: access.roomId, token: access.token, expiresAt: access.expiresAt, joinUrl: access.joinUrl,
    realtimeNamespace: '/room', isHost: access.isHost, booking: bookingView(access.booking, req.user!.id),
  });
}));

/** إنهاء الحصة من المعلّم — يغلق القاعة ويُكملها ويحرّر الربح حسب الحضور */
router.post('/:id/end', (req, res) => {
  const b = load(req);
  if (b.teacher_id !== req.user!.id && !hasRole(req.user, 'admin')) throw forbidden();
  if (!['confirmed', 'in_progress'].includes(b.status)) throw new AppError('conflict', 'الحصة ليست جارية', 409);
  if (new Date(b.starts_at).getTime() > Date.now()) throw new AppError('conflict', 'لم تبدأ الحصة بعد', 409);
  db.transaction(() => {
    markLeft(b.id, b.teacher_id); markLeft(b.id, b.student_id);
    endRoom(b.id);
    completeBooking(b.id);
  })();
  res.json(bookingView(q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', b.id)!, req.user!.id));
});

/** ما بعد الحصة: ملخّص وواجب ومرفقات من المعلّم — يصل للطالب إشعاراً */
router.post('/:id/notes', validate(PostLessonNotes), (req, res) => {
  const b = load(req);
  if (b.teacher_id !== req.user!.id) throw forbidden();
  const n = body<typeof PostLessonNotes>(req);
  const attachments = n.attachmentFileIds.map(id => {
    const f = q.get<any>('SELECT id, original_name, owner_id FROM files WHERE id = ?', id);
    if (!f || f.owner_id !== req.user!.id) throw badRequest('مرفق غير صالح');
    return { fileId: f.id, name: f.original_name ?? `ملف ${f.id}` };
  });
  q.run(`INSERT INTO booking_notes (booking_id, summary, homework, attachments, suggest_next, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(booking_id) DO UPDATE SET summary=excluded.summary, homework=excluded.homework, attachments=excluded.attachments, suggest_next=excluded.suggest_next, updated_at=excluded.updated_at`,
    b.id, n.summary, n.homework, JSON.stringify(attachments), n.suggestNext ? 1 : 0, nowIso());
  notify(b.student_id, { type: 'homework', title: n.homework ? 'واجب جديد من معلّمك' : 'ملخّص الحصة جاهز', body: (n.homework ?? n.summary ?? '').slice(0, 120) || null, data: { bookingId: b.id } });
  res.json({ ok: true });
});
/** مرفقات ملاحظات الحصة برابط موقّع للطرفين فقط */
router.get('/:id/notes/files/:fileId', (req, res) => {
  const b = load(req);
  const fileId = idParam(req, 'fileId');
  const notes = q.get<any>('SELECT attachments FROM booking_notes WHERE booking_id = ?', b.id);
  const list = notes ? JSON.parse(notes.attachments) as { fileId: number }[] : [];
  if (!list.some(a => a.fileId === fileId)) throw notFound();
  res.json(signedUrl(fileId, req.user!.id));
});

export default router;
