import { q, json } from '../db/index.ts';
import { money } from '../lib/helpers.ts';
import { publicUrl } from './storage.ts';
import { config } from '../config.ts';
import { ownedIds, favoriteIds } from './access.ts';
import { nextAvailableSlot } from './slots.ts';
import { roomOpensAt, roomIsOpen } from './rooms.ts';
import { refundPercentFor } from './checkout.ts';
import { attendanceSummary, type BookingRow } from './bookings.ts';
import { learnerRefById } from './learners.ts';

/** صفوف قاعدة البيانات → أشكال العقود المشتركة. المكان الوحيد الذي يعرف الشكلين معاً. */

const subjectRef = (id: number) => {
  const s = q.get<any>('SELECT id, name, color_key FROM subjects WHERE id = ?', id);
  return s ? { id: s.id, name: s.name, colorKey: s.color_key } : { id, name: '', colorKey: 'default' };
};
const gradeRef = (id: number) => {
  const g = q.get<any>('SELECT id, name FROM grades WHERE id = ?', id);
  return g ? { id: g.id, name: g.name } : { id, name: '' };
};
const personRef = (id: number) => {
  const p = q.get<any>('SELECT p.display_name, p.avatar_path, tp.verification_status FROM profiles p LEFT JOIN teacher_profiles tp ON tp.user_id = p.user_id WHERE p.user_id = ?', id);
  return { id, name: p?.display_name ?? '', avatarUrl: publicUrlFromPath(p?.avatar_path), verified: p?.verification_status === 'verified' };
};
/** الصورة الشخصية تُخزَّن كمسار نسبي (/api/files/public/:id) كي لا يتعطّل عند تغيير الدومين */
export const publicUrlFromPath = (p: string | null | undefined): string | null =>
  !p ? null : p.startsWith('http') ? p : p.startsWith('/') ? `${config.publicUrl}${p}` : null;

/* ---------- الكتب ---------- */
export function bookCard(b: any, ctx: { userId?: number; owned?: Set<number>; fav?: Set<number> } = {}) {
  const owned = ctx.owned ?? ownedIds(ctx.userId, 'book');
  const fav = ctx.fav ?? favoriteIds(ctx.userId, 'book');
  const badges: string[] = [];
  if (b.sales_count >= 50) badges.push('bestseller');
  if (b.published_at && Date.now() - new Date(b.published_at).getTime() < 30 * 86_400_000) badges.push('new');
  if (b.updated_at && b.published_at && b.updated_at > b.published_at && Date.now() - new Date(b.updated_at).getTime() < 60 * 86_400_000) badges.push('updated');
  if (Number(b.price) === 0) badges.push('free');
  const author = personRef(b.author_id);
  if (author.verified) badges.push('verified');
  return {
    id: b.id, title: b.title, type: b.type,
    subject: subjectRef(b.subject_id), grade: gradeRef(b.grade_id),
    semesterName: b.semester_id ? q.val<string>('SELECT name FROM semesters WHERE id = ?', b.semester_id) ?? null : null,
    author, price: money(b.price), currency: b.currency,
    ratingAvg: Number(b.rating_avg) || 0, ratingCount: b.rating_count ?? 0, salesCount: b.sales_count ?? 0,
    coverUrl: publicUrl(b.cover_file_id), badges: badges.slice(0, 2),
    owned: owned.has(b.id) || Number(b.price) === 0 && !!ctx.userId, favorited: fav.has(b.id),
  };
}

export const reviewItems = (targetType: string, targetId: number, limit = 20) =>
  q.all<any>(`SELECT r.id, r.rating, r.comment, r.created_at, p.display_name, p.avatar_path FROM reviews r JOIN profiles p ON p.user_id = r.user_id
              WHERE r.target_type = ? AND r.target_id = ? AND r.status = 'published' ORDER BY r.id DESC LIMIT ?`, targetType, targetId, limit)
    .map(r => ({ id: r.id, rating: r.rating, comment: r.comment, userName: r.display_name, userAvatarUrl: publicUrlFromPath(r.avatar_path), createdAt: r.created_at }));

/* ---------- الدورات ---------- */
export function courseCard(c: any, ctx: { userId?: number; enrolled?: Set<number>; fav?: Set<number> } = {}) {
  const enrolled = ctx.enrolled ?? ownedIds(ctx.userId, 'course');
  const fav = ctx.fav ?? favoriteIds(ctx.userId, 'course');
  const agg = q.get<any>(`SELECT COUNT(*) AS n, COALESCE(SUM(l.duration_seconds),0) AS s FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ?`, c.id)!;
  const progress = ctx.userId && enrolled.has(c.id) ? q.val<number>('SELECT progress_percent FROM course_enrollments WHERE user_id = ? AND course_id = ?', ctx.userId, c.id) ?? 0 : null;
  return {
    id: c.id, title: c.title, coverUrl: publicUrl(c.cover_file_id), teacher: personRef(c.teacher_id),
    subject: subjectRef(c.subject_id), grade: gradeRef(c.grade_id),
    lessonsCount: agg.n, totalMinutes: Math.round(agg.s / 60),
    ratingAvg: Number(c.rating_avg) || 0, ratingCount: c.rating_count ?? 0,
    price: money(c.price), currency: c.currency, enrolled: enrolled.has(c.id), progressPercent: progress, favorited: fav.has(c.id),
  };
}

/* ---------- المعلّمون ---------- */
export function teacherCard(t: any, ctx: { userId?: number; fav?: Set<number>; withNextSlot?: boolean } = {}) {
  const fav = ctx.fav ?? favoriteIds(ctx.userId, 'teacher');
  const subjects = q.all<any>('SELECT DISTINCT s.id, s.name, s.color_key FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id WHERE ts.teacher_id = ?', t.user_id)
    .map(s => ({ id: s.id, name: s.name, colorKey: s.color_key }));
  const priceFrom = q.val<number>('SELECT MIN(price) FROM teacher_prices WHERE teacher_id = ?', t.user_id) ?? 0;
  const modes = q.all<{ mode: string }>('SELECT DISTINCT mode FROM teacher_prices WHERE teacher_id = ?', t.user_id).map(r => r.mode);
  const nextSlotAt = ctx.withNextSlot === false ? null : nextAvailableSlot(t.user_id);
  const availableNow = !!nextSlotAt && new Date(nextSlotAt).getTime() - Date.now() < 60 * 60_000;
  return {
    id: t.user_id, name: t.display_name, avatarUrl: publicUrlFromPath(t.avatar_path), verified: t.verification_status === 'verified',
    headline: t.headline ?? null, subjects, yearsExp: t.years_exp ?? 0,
    ratingAvg: Number(t.rating_avg) || 0, ratingCount: t.rating_count ?? 0, studentsCount: t.students_count ?? 0,
    priceFrom: money(priceFrom), nextSlotAt, availableNow, modes, favorited: fav.has(t.user_id),
  };
}

/* ---------- الحجوزات ---------- */
export function bookingView(b: BookingRow, viewerId?: number) {
  const canJoin = roomIsOpen(b);
  const canCancel = ['pending_payment', 'confirmed'].includes(b.status) && new Date(b.starts_at).getTime() > Date.now();
  const notes = q.get<any>('SELECT * FROM booking_notes WHERE booking_id = ?', b.id);
  const needsReview = b.status === 'completed' && viewerId === b.student_id
    && !q.get('SELECT 1 FROM reviews WHERE user_id = ? AND target_type = ? AND target_id = ?', viewerId, 'teacher', b.teacher_id);
  return {
    id: b.id, status: b.status, mode: b.mode, durationMinutes: b.duration_minutes, startsAt: b.starts_at, endsAt: b.ends_at,
    price: money(b.price), subject: subjectRef(b.subject_id), teacher: personRef(b.teacher_id), student: personRef(b.student_id),
    // المتعلّم صاحب الحصة: LearnerRef فقط (الحساب يبقى student) — null للحجوزات القديمة
    learner: learnerRefById(b.learner_id),
    roomOpensAt: roomOpensAt(b), canJoin, canCancel, canReschedule: canCancel && b.status === 'confirmed',
    cancelRefundPercent: canCancel ? (b.status === 'pending_payment' ? 100 : refundPercentFor(b.starts_at)) : 0,
    needsReview,
    notes: notes ? { summary: notes.summary, homework: notes.homework, attachments: json<any[]>(notes.attachments, []) } : null,
    attendance: ['in_progress', 'completed', 'no_show'].includes(b.status) ? attendanceSummary(b.id) : null,
    createdAt: b.created_at,
  };
}

export { subjectRef, gradeRef, personRef };
