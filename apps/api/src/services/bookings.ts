import { db, q, settings, nowIso } from '../db/index.ts';
import { AppError, notFound, forbidden } from '../lib/errors.ts';
import { money, addMinutes, randomToken } from '../lib/helpers.ts';
import { isWithinAvailability } from './slots.ts';
import { createOrder, refundOrder, refundPercentFor } from './checkout.ts';
import { recordEarning, releaseEarnings, reverseEarning } from './earnings.ts';
import { notify } from './notifications.ts';
import type { LearnerRow } from './learners.ts';

export interface BookingRow {
  id: number; student_id: number; teacher_id: number; subject_id: number; mode: string; duration_minutes: number;
  starts_at: string; ends_at: string; status: string; price: number; currency: string; order_id: number | null;
  package_purchase_id: number | null; note: string | null; expires_at: string | null; created_at: string;
  /** لمن الحصة (متعلّم من متعلّمي الحساب student_id) — null للحجوزات القديمة فقط */
  learner_id: number | null;
}

const ACTIVE = ['pending_payment', 'confirmed', 'in_progress'];

/** «سارة (الصف الثاني عشر)» — للإشعارات الموجّهة للمعلّم */
const learnerLabel = (l: LearnerRow) => l.grade_name ? `${l.display_name} (${l.grade_name})` : l.display_name;

/**
 * إنشاء حجز: داخل معاملة واحدة —
 * ١) المعلّم معتمد ويدرّس المادة  ٢) الموعد داخل التوفّر وليس في إجازة
 * ٣) لا تعارض (قيد قاعدة البيانات يحسم السباق)  ٤) باقة أو طلب دفع بمهلة
 * الحساب الدافع student_id والمتعلّم صاحب الحصة learner (يحسمه المسار عبر requireLearner)
 */
export function createBooking(studentId: number, input: {
  teacherId: number; subjectId: number; mode: 'individual' | 'group'; durationMinutes: number;
  startsAt: string; packagePurchaseId?: number | null; couponCode?: string | null; note?: string | null;
}, learner: LearnerRow) {
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new AppError('validation_error', 'موعد غير صالح', 400);
  if (startsAt.getTime() < Date.now()) throw new AppError('validation_error', 'لا يمكن الحجز في وقت مضى', 400);
  if (input.teacherId === studentId) throw new AppError('validation_error', 'لا يمكنك حجز حصة مع نفسك', 400);

  const teacher = q.get<{ verification_status: string }>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', input.teacherId);
  if (!teacher || teacher.verification_status !== 'verified') throw new AppError('teacher_unavailable', 'المعلّم غير متاح للحجز', 400);
  if (!q.get('SELECT 1 FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?', input.teacherId, input.subjectId)) {
    throw new AppError('teacher_unavailable', 'المعلّم لا يدرّس هذه المادة', 400);
  }
  if (learner.account_id !== studentId) throw new AppError('learner_forbidden', 'هذا المتعلّم ليس في حسابك', 403);
  const price = q.get<{ price: number }>('SELECT price FROM teacher_prices WHERE teacher_id = ? AND duration_minutes = ? AND mode = ?',
    input.teacherId, input.durationMinutes, input.mode);
  if (!price) throw new AppError('validation_error', 'هذه المدة غير متاحة عند المعلّم', 400);

  const iso = startsAt.toISOString();
  const endIso = new Date(startsAt.getTime() + input.durationMinutes * 60_000).toISOString();
  // موعد محجوز فعلاً (ولو معلّق الدفع) → تعارض واضح، لا «خارج التوفّر»
  if (q.get(`SELECT 1 FROM bookings WHERE teacher_id = ? AND status IN ('pending_payment','confirmed','in_progress') AND starts_at < ? AND ends_at > ?`, input.teacherId, endIso, iso)) {
    throw new AppError('booking_conflict', 'هذا الموعد لم يعد متاحاً', 409);
  }
  if (!isWithinAvailability(input.teacherId, iso, input.durationMinutes)) {
    throw new AppError('teacher_unavailable', 'الموعد خارج أوقات توفّر المعلّم', 400);
  }

  return db.transaction(() => {
    // باقة؟ نتحقّق ونستهلك حصة — باقة الحساب، ولمتعلّم بعينه أو لأي متعلّم (learner_id NULL)
    let pkg: { id: number; remaining: number } | null = null;
    if (input.packagePurchaseId) {
      pkg = q.get<any>(`SELECT id, remaining FROM package_purchases WHERE id = ? AND user_id = ? AND teacher_id = ? AND (learner_id IS NULL OR learner_id = ?) AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)`,
        input.packagePurchaseId, studentId, input.teacherId, learner.id, nowIso()) ?? null;
      if (!pkg) throw new AppError('validation_error', 'الباقة غير صالحة أو استُنفدت', 400);
    }
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000).toISOString();
    const windowMin = settings.get<number>('booking_payment_window_minutes');
    let info;
    try {
      info = q.run(
        `INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price, package_purchase_id, note, expires_at, learner_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        studentId, input.teacherId, input.subjectId, input.mode, input.durationMinutes, iso, endsAt,
        pkg ? 'confirmed' : 'pending_payment', pkg ? 0 : money(price.price), pkg?.id ?? null, input.note ?? null,
        pkg ? null : addMinutes(windowMin), learner.id);
    } catch (err: any) {
      if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) throw new AppError('booking_conflict', 'هذا الموعد لم يعد متاحاً', 409);
      throw err;
    }
    const bookingId = Number(info.lastInsertRowid);

    if (pkg) {
      q.run('UPDATE package_purchases SET remaining = remaining - 1 WHERE id = ?', pkg.id);
      // المعلّم يرى اسم المتعلّم وصفّه فقط — لا هاتف ولا بريد ولا معرّف حساب
      const subject = q.val<string>('SELECT name FROM subjects WHERE id = ?', input.subjectId) ?? '';
      notify(input.teacherId, { type: 'booking_confirmed', title: 'حجز جديد', body: `حجز جديد: ${learnerLabel(learner)} — ${subject}`, data: { bookingId } });
      return { booking: q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', bookingId)!, order: null };
    }
    const order = createOrder(studentId, { items: [{ type: 'lesson', id: bookingId }], couponCode: input.couponCode ?? null, meta: { bookingId }, learnerId: learner.id });
    return { booking: q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', bookingId)!, order };
  })();
}

/** يُنهي الحجوزات المعلّقة التي فاتت مهلة دفعها (مهمة دورية) */
export function expirePendingBookings(): number {
  const rows = q.all<{ id: number; order_id: number | null }>("SELECT id, order_id FROM bookings WHERE status = 'pending_payment' AND expires_at IS NOT NULL AND expires_at < ?", nowIso());
  for (const r of rows) {
    q.run("UPDATE bookings SET status = 'expired' WHERE id = ?", r.id);
    if (r.order_id) q.run("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'", r.order_id);
  }
  return rows.length;
}

/** إلغاء الطالب: نسبة الاسترجاع من سياسة الإلغاء (إعداد لا شيفرة) */
export function cancelByStudent(bookingId: number, studentId: number, reason?: string | null) {
  return db.transaction(() => {
    const b = q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', bookingId);
    if (!b) throw notFound('الحجز غير موجود');
    if (b.student_id !== studentId) throw forbidden();
    if (!['pending_payment', 'confirmed'].includes(b.status)) throw new AppError('conflict', 'لا يمكن إلغاء هذا الحجز', 409);

    const percent = b.status === 'pending_payment' ? 100 : refundPercentFor(b.starts_at);
    q.run("UPDATE bookings SET status = 'cancelled_by_student', cancelled_at = ?, cancel_reason = ?, refund_percent = ? WHERE id = ?", nowIso(), reason ?? null, percent, bookingId);

    if (b.package_purchase_id) {
      if (percent === 100) q.run('UPDATE package_purchases SET remaining = remaining + 1 WHERE id = ?', b.package_purchase_id);
    } else if (b.order_id && b.status === 'confirmed') {
      const order = q.get<any>('SELECT * FROM orders WHERE id = ?', b.order_id);
      if (order?.status === 'paid' && percent > 0) {
        refundOrder(b.order_id, { amount: money(b.price * (percent / 100)), reason: `إلغاء حصة (${percent}٪)`, bookingId });
      } else if (order?.status === 'paid') {
        reverseEarning({ sourceType: 'lesson', sourceId: bookingId });
        // لا استرجاع: الربح يتحرّر للمعلّم لأن الوقت حُجز فعلاً
        recordEarning(b.teacher_id, { sourceType: 'lesson', sourceId: bookingId, orderId: b.order_id, gross: money(b.price) });
        releaseEarnings({ sourceType: 'lesson', sourceId: bookingId });
      }
    } else if (b.order_id) {
      q.run("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'", b.order_id);
    }
    notify(b.teacher_id, { type: 'system', title: 'أُلغيت حصة', body: `الطالب ألغى حصة ${new Date(b.starts_at).toLocaleString('ar-OM', { timeZone: 'Asia/Muscat' })}`, data: { bookingId } });
    return { refundPercent: percent };
  })();
}

/** إلغاء المعلّم: استرجاع كامل دائماً، ويُسجَّل عليه */
export function cancelByTeacher(bookingId: number, teacherId: number, reason?: string | null) {
  return db.transaction(() => {
    const b = q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', bookingId);
    if (!b) throw notFound('الحجز غير موجود');
    if (b.teacher_id !== teacherId) throw forbidden();
    if (!['pending_payment', 'confirmed'].includes(b.status)) throw new AppError('conflict', 'لا يمكن إلغاء هذا الحجز', 409);
    q.run("UPDATE bookings SET status = 'cancelled_by_teacher', cancelled_at = ?, cancel_reason = ?, refund_percent = 100 WHERE id = ?", nowIso(), reason ?? null, bookingId);
    if (b.package_purchase_id) q.run('UPDATE package_purchases SET remaining = remaining + 1 WHERE id = ?', b.package_purchase_id);
    else if (b.order_id) {
      const order = q.get<any>('SELECT status FROM orders WHERE id = ?', b.order_id);
      if (order?.status === 'paid') refundOrder(b.order_id, { amount: money(b.price), reason: 'إلغاء من المعلّم', bookingId });
      else q.run("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'", b.order_id);
    }
    notify(b.student_id, { type: 'booking_cancelled_by_teacher', title: 'ألغى المعلّم الحصة', body: reason ?? 'سيُسترجع المبلغ كاملاً', data: { bookingId } });
  })();
}

/** بعد انتهاء الحصة: تُكمَل وتُحرَّر أرباح المعلّم (أو تُسجَّل no_show) */
export function completeBooking(bookingId: number) {
  return db.transaction(() => {
    const b = q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', bookingId);
    if (!b || !['confirmed', 'in_progress'].includes(b.status)) return;
    const teacherAttended = q.get('SELECT 1 FROM booking_attendance WHERE booking_id = ? AND role = ?', bookingId, 'teacher');
    const studentAttended = q.get('SELECT 1 FROM booking_attendance WHERE booking_id = ? AND role = ?', bookingId, 'student');
    if (!teacherAttended) {
      // المعلّم لم يحضر → إلغاء بالكامل لصالح الطالب
      q.run("UPDATE bookings SET status = 'no_show', refund_percent = 100 WHERE id = ?", bookingId);
      if (b.package_purchase_id) q.run('UPDATE package_purchases SET remaining = remaining + 1 WHERE id = ?', b.package_purchase_id);
      else if (b.order_id) refundOrder(b.order_id, { amount: money(b.price), reason: 'لم يحضر المعلّم', bookingId });
      return;
    }
    q.run("UPDATE bookings SET status = ? WHERE id = ?", studentAttended ? 'completed' : 'no_show', bookingId);
    releaseEarnings({ sourceType: 'lesson', sourceId: bookingId });
    if (b.package_purchase_id && b.price === 0) {
      // حصة من باقة: الربح سُجّل عند شراء الباقة — نحرّر حصّة واحدة منها
      const pkg = q.get<any>('SELECT package_id, order_id, total FROM package_purchases WHERE id = ?', b.package_purchase_id);
      const earning = q.get<any>("SELECT id, net, teacher_id FROM teacher_earnings WHERE source_type = 'package' AND source_id = ? AND order_id = ? AND status = 'pending'", pkg?.package_id, pkg?.order_id);
      if (earning) {
        const per = money(earning.net / pkg.total);
        q.run('UPDATE teacher_earnings SET net = net - ? WHERE id = ?', per, earning.id);
        q.run("INSERT INTO teacher_earnings (teacher_id, source_type, source_id, order_id, gross, commission, net, status) VALUES (?,?,?,?,?,?,?,'available')", earning.teacher_id, 'lesson', bookingId, pkg.order_id, per, 0, per);
        q.run('UPDATE teacher_profiles SET pending_balance = pending_balance - ?, available_balance = available_balance + ? WHERE user_id = ?', per, per, earning.teacher_id);
      }
    }
    // عدد الطلاب = متعلّمون متمايزون (الحجوزات القديمة بلا متعلّم تُحسب بحسابها)
    q.run('UPDATE teacher_profiles SET lessons_count = lessons_count + 1, students_count = (SELECT COUNT(DISTINCT COALESCE(learner_id, -student_id)) FROM bookings WHERE teacher_id = ? AND status = ?) WHERE user_id = ?', b.teacher_id, 'completed', b.teacher_id);
    if (studentAttended) notify(b.student_id, { type: 'system', title: 'انتهت الحصة — قيّم المعلّم', body: null, data: { bookingId } });
  })();
}

/** الحصص التي انتهى وقتها ولم تُغلق (مهمة دورية) */
export function closeFinishedBookings(): number {
  const closeAfter = settings.get<number>('room_close_minutes_after');
  const rows = q.all<{ id: number }>(`SELECT id FROM bookings WHERE status IN ('confirmed','in_progress') AND datetime(ends_at, '+' || ? || ' minutes') < datetime('now')`, closeAfter);
  for (const r of rows) completeBooking(r.id);
  return rows.length;
}

/* ---------- الحضور ---------- */
export function markJoined(bookingId: number, userId: number, role: 'student' | 'teacher') {
  const open = q.get<any>('SELECT id, left_at FROM booking_attendance WHERE booking_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', bookingId, userId);
  if (open && !open.left_at) return; // لا يزال متصلاً
  if (open) q.run('UPDATE booking_attendance SET reconnects = reconnects + 1 WHERE id = ?', open.id);
  q.run('INSERT INTO booking_attendance (booking_id, user_id, role, joined_at) VALUES (?,?,?,?)', bookingId, userId, role, nowIso());
  q.run("UPDATE bookings SET status = 'in_progress' WHERE id = ? AND status = 'confirmed'", bookingId);
}
export function markLeft(bookingId: number, userId: number) {
  const open = q.get<any>('SELECT id, joined_at FROM booking_attendance WHERE booking_id = ? AND user_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1', bookingId, userId);
  if (!open) return;
  const seconds = Math.max(0, Math.round((Date.now() - new Date(open.joined_at).getTime()) / 1000));
  q.run('UPDATE booking_attendance SET left_at = ?, seconds = ? WHERE id = ?', nowIso(), seconds, open.id);
}
export const attendanceSummary = (bookingId: number) => {
  const sum = (role: string) => q.val<number>('SELECT COALESCE(SUM(seconds),0) FROM booking_attendance WHERE booking_id = ? AND role = ?', bookingId, role) ?? 0;
  const first = (role: string) => q.val<string>('SELECT MIN(joined_at) FROM booking_attendance WHERE booking_id = ? AND role = ?', bookingId, role) ?? null;
  return { studentSeconds: sum('student'), teacherSeconds: sum('teacher'), studentJoinedAt: first('student'), teacherJoinedAt: first('teacher') };
};

export const roomToken = () => randomToken(24);
