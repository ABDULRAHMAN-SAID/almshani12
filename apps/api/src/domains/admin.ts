import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  TeacherVerificationDecision, CancellationPolicy, CouponUpsert, Role, LearnerUpsert, LearnerPatch,
  WalletAdjust, RoleChange, UserStatusChange, ProfilePatch, EntitlementGrant, ReasonBody, SessionRevoke, TeacherDocumentDecision, TeacherPatch, OverviewQuery,
} from '@manassah/shared';
import type { LearnerRef, Overview, PersonDetail, ReviewAdmin, BookingStatus } from '@manassah/shared';
import { db, q, json, settings, nowIso } from '../db/index.ts';
import { AppError, notFound, badRequest, forbidden, conflict, asyncHandler } from '../lib/errors.ts';
import { validate, body, idParam } from '../lib/validate.ts';
import { requireAuth, requireRole, requireExactRole, hasRole } from '../lib/auth.ts';
import { money, slugify, paginate, pageMeta, iso } from '../lib/helpers.ts';
import { orderView } from '../lib/views.ts';
import { signedUrl } from '../services/storage.ts';
import { fulfillOrder, refundOrder, paidForBooking, refundableRemaining } from '../services/checkout.ts';
import { grantAccess, revokeAccess } from '../services/access.ts';
import { notify } from '../services/notifications.ts';
import * as wallet from '../services/wallet.ts';
import { bookingView, publicUrlFromPath, clearCatalogCache } from '../services/mappers.ts';
import type { BookingRow } from '../services/bookings.ts';
import { listLearners, learnerRefById, createLearner, updateLearner, archiveLearner, activateLearner, projectSelfLearner } from '../services/learners.ts';
import { emitToUser, connectedSockets } from '../realtime/index.ts';
import { audit } from '../lib/audit.ts';
import { config } from '../config.ts';
import { SCHEMA_VERSION } from '../db/migrations.ts';
import { otpMethods } from '../services/otp.ts';
import { listIntegrations, runChecks, summary as integrationsSummary } from '../services/integrations.ts';
import { runBackup, listBackups, BACKUP_DIR } from '../services/backups.ts';

/**
 * لوحة الإدارة — كل مسار يفرض دوره في الخادم.
 * admin/super_admin يمرّان دائماً؛ content_reviewer للمحتوى؛ finance للمال؛ support للحجوزات والبلاغات والأشخاص.
 * كل مسار كتابة (post/patch/delete) يسجّل audit(…) مع target_user_id للمستخدم المتأثّر (صفحة الشخص تقرأه).
 */
const router = Router();
router.use(requireAuth);

const Page = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30), q: z.string().trim().max(120).optional(), status: z.string().max(40).optional() });
const IdQ = z.coerce.number().int().positive();

/* ---------- أدوات مشتركة ---------- */
const STAFF_ROLES = new Set<string>(['content_reviewer', 'support', 'finance', 'admin', 'super_admin']);
const BOOKING_STATUSES: BookingStatus[] = ['pending_payment', 'confirmed', 'in_progress', 'completed', 'cancelled_by_student', 'cancelled_by_teacher', 'no_show', 'disputed', 'expired'];
const isSuper = (req: Request) => req.user!.roles.includes('super_admin');
const n = (sql: string, ...p: unknown[]) => q.val<number>(sql, ...p) ?? 0;
const nameOf = (id: number | null | undefined): string => (id ? q.val<string>('SELECT display_name FROM profiles WHERE user_id = ?', id) : null) ?? '';
const brief = (id: number | null | undefined) => (id ? { id, name: nameOf(id) } : null);
const rolesOf = (id: number) => q.all<{ role: Role }>('SELECT role FROM user_roles WHERE user_id = ? ORDER BY role', id).map(r => r.role);
const userExists = (id: number) => { if (!q.get('SELECT 1 FROM users WHERE id = ?', id)) throw notFound('المستخدم غير موجود'); };
/** حسابات الطاقم (أي دور من STAFF_ROLES) لا يمسّها إلا super_admin (D8): تبديل هاتف/بريد يسمح بالاستيلاء عبر OTP، والإيقاف يُقصي super_admin */
const requireSuperForStaffTarget = (req: Request, id: number) => {
  if (!isSuper(req) && rolesOf(id).some(r => STAFF_ROLES.has(r))) throw forbidden('حسابات الطاقم يديرها super_admin فقط');
};
/** تاريخ فقط (UTC) — يُقارَن بأمان مع صيغتي datetime('now') و ISO معاً */
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const excerpt = (s: unknown) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 60)}…` : t; };
const isConstraint = (err: unknown) => String((err as { code?: string })?.code ?? '').startsWith('SQLITE_CONSTRAINT');

/** إنهاء جلسات المستخدم: يُبطل رموز التجديد (ورموز الإشعارات اختياريّاً) ويُبلّغ أجهزته المتصلة فوراً (session_revoked) */
function revokeSessions(userId: number, { sessionId = null, deviceTokens = true, reason = 'force_logout' }: { sessionId?: number | null; deviceTokens?: boolean; reason?: string } = {}) {
  if (sessionId) { q.run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND user_id = ?', sessionId, userId); return; } // جلسة واحدة: تسقط عند تجديدها التالي
  q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', userId);
  if (deviceTokens) q.run('DELETE FROM device_tokens WHERE user_id = ?', userId);
  emitToUser(userId, 'session_revoked', { reason });
}

/** حذف الحساب من الإدارة — المسح نفسه الذي يجريه DELETE /me (domains/users.ts) بما فيه المتعلّمون */
function scrubAccount(uid: number) {
  db.transaction(() => {
    q.run("UPDATE users SET status = 'deleted', phone = NULL, email = ?, active_learner_id = NULL WHERE id = ?", `deleted-${uid}@removed.local`, uid);
    q.run('UPDATE profiles SET display_name = ?, avatar_path = NULL, bio = NULL WHERE user_id = ?', 'مستخدم محذوف', uid);
    q.run("UPDATE learners SET display_name = 'محذوف', school = NULL, avatar_path = NULL, archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE account_id = ?", nowIso(), nowIso(), uid);
    projectSelfLearner(uid);
    q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', uid);
    q.run('DELETE FROM device_tokens WHERE user_id = ?', uid);
    q.run('DELETE FROM auth_identities WHERE user_id = ?', uid);
  })();
}

/** إعادة حساب تقييم الهدف بعد إخفاء/إظهار تقييم */
function recomputeRating(targetType: string, targetId: number) {
  const table = targetType === 'teacher' ? 'teacher_profiles' : targetType === 'book' ? 'books' : 'courses';
  q.run(`UPDATE ${table} SET rating_avg = COALESCE((SELECT AVG(rating) FROM reviews WHERE target_type = ? AND target_id = ? AND status = 'published'),0), rating_count = (SELECT COUNT(*) FROM reviews WHERE target_type = ? AND target_id = ? AND status = 'published') WHERE ${targetType === 'teacher' ? 'user_id' : 'id'} = ?`,
    targetType, targetId, targetType, targetId, targetId);
}
const targetTitleOf = (type: string, id: number): string =>
  type === 'teacher' ? nameOf(id) : (q.val<string>(`SELECT title FROM ${type === 'book' ? 'books' : 'courses'} WHERE id = ?`, id) ?? '');
const reviewAdmin = (r: any): ReviewAdmin => ({
  id: r.id, targetType: r.target_type, targetId: r.target_id, targetTitle: targetTitleOf(r.target_type, r.target_id), rating: r.rating, comment: r.comment ?? null,
  status: r.status, hiddenReason: r.hidden_reason ?? null, createdAt: r.created_at, author: { id: r.user_id, name: nameOf(r.user_id) },
});

/** بطاقة الشخص الكاملة (PersonDetail) — رأس صفحة الشخص وتبويباتها الأساسية */
function personDetail(id: number): PersonDetail {
  const u = q.get<any>('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('المستخدم غير موجود');
  const p = q.get<any>('SELECT * FROM profiles WHERE user_id = ?', id);
  const tp = q.get<any>('SELECT * FROM teacher_profiles WHERE user_id = ?', id);
  const w = q.get<any>('SELECT balance, currency FROM wallets WHERE user_id = ?', id);
  return {
    id, phone: u.phone ?? null, email: u.email ?? null, status: u.status, statusReason: u.status_reason ?? null, suspendedAt: u.suspended_at ?? null, suspendedBy: brief(u.suspended_by),
    locale: u.locale, timezone: u.timezone, onboardingCompleted: !!u.onboarding_completed, createdAt: u.created_at, lastLoginAt: u.last_login_at ?? null,
    profile: { displayName: p?.display_name ?? '', avatarUrl: publicUrlFromPath(p?.avatar_path), gender: p?.gender ?? null, bio: p?.bio ?? null, countryCode: p?.country_code ?? 'OM' },
    roles: q.all<any>('SELECT role, granted_by, created_at FROM user_roles WHERE user_id = ? ORDER BY created_at, role', id).map(r => ({ role: r.role, grantedBy: brief(r.granted_by), createdAt: r.created_at })),
    // معرّف المزوّد مقنَّع: أول ٣ أحرف فقط
    identities: q.all<any>('SELECT provider, provider_uid, created_at FROM auth_identities WHERE user_id = ? ORDER BY id', id).map(i => ({ provider: i.provider, providerUid: `${String(i.provider_uid).slice(0, 3)}***`, createdAt: i.created_at })),
    learners: listLearners(id, true).map(l => ({ ...l, bookingsCount: n('SELECT COUNT(*) FROM bookings WHERE learner_id = ?', l.id) })),
    activeLearnerId: u.active_learner_id ?? null,
    teacher: tp ? {
      status: tp.verification_status, commissionRate: tp.commission_rate, ratingAvg: Number(tp.rating_avg) || 0, ratingCount: tp.rating_count, lessonsCount: tp.lessons_count,
      availableBalance: money(tp.available_balance), pendingBalance: money(tp.pending_balance), lifetimeEarnings: money(tp.lifetime_earnings), verifiedAt: tp.verified_at ?? null,
    } : null,
    wallet: { balance: money(w?.balance ?? 0), currency: w?.currency ?? 'OMR' },
    counts: {
      orders: n('SELECT COUNT(*) FROM orders WHERE user_id = ?', id), bookings: n('SELECT COUNT(*) FROM bookings WHERE student_id = ?', id),
      entitlements: n('SELECT COUNT(*) FROM entitlements WHERE user_id = ?', id), reviews: n('SELECT COUNT(*) FROM reviews WHERE user_id = ?', id),
      reportsFiled: n('SELECT COUNT(*) FROM reports WHERE reporter_id = ?', id), reportsAgainst: n("SELECT COUNT(*) FROM reports WHERE target_type = 'user' AND target_id = ?", id),
      devices: n('SELECT COUNT(*) FROM device_tokens WHERE user_id = ?', id),
      activeSessions: n('SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ? AND revoked = 0 AND expires_at > ?', id, Math.floor(Date.now() / 1000)),
      unreadNotifications: n('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', id),
    },
  };
}

/**
 * منح/سحب أدوار مع حرّاس D8 — مشترك بين grant/revoke والمسار القديم (استبدال الكل):
 * أدوار الطاقم لـ super_admin فقط؛ لا سحب super_admin من النفس ولا من آخر واحد؛ لا ترك المستخدم بلا أدوار؛ لا سحب teacher من معلّم معتمد.
 */
function applyRoleChanges(req: Request, id: number, grants: Role[], revokes: Role[]) {
  const current = rolesOf(id);
  const toGrant = grants.filter(r => !current.includes(r));
  const toRevoke = revokes.filter(r => current.includes(r));
  if ([...toGrant, ...toRevoke].some(r => STAFF_ROLES.has(r)) && !isSuper(req)) throw forbidden('أدوار الطاقم يمنحها ويسحبها super_admin فقط');
  if (toRevoke.includes('super_admin')) {
    if (id === req.user!.id) throw new AppError('self_target', 'لا يمكنك سحب super_admin من نفسك', 409);
    if (n("SELECT COUNT(*) FROM user_roles WHERE role = 'super_admin'") <= 1) throw new AppError('last_super_admin', 'لا يمكن سحب آخر super_admin في النظام', 409);
  }
  if (toRevoke.includes('teacher') && q.val<string>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', id) === 'verified') {
    throw new AppError('teacher_verified', 'أوقف المعلّم من صفحة المعلّم قبل سحب الدور', 409);
  }
  if (!current.filter(r => !toRevoke.includes(r)).concat(toGrant).length) throw conflict('لا يمكن ترك المستخدم بلا أدوار');
  db.transaction(() => {
    for (const r of toGrant) {
      q.run('INSERT OR IGNORE INTO user_roles (user_id, role, granted_by) VALUES (?,?,?)', id, r, req.user!.id);
      // منح teacher لحساب بلا ملفّ معلّم → ملفّ معلّق ينتظر المستندات والقرار
      if (r === 'teacher' && !q.get('SELECT 1 FROM teacher_profiles WHERE user_id = ?', id)) q.run("INSERT INTO teacher_profiles (user_id, verification_status, applied_at) VALUES (?,'pending',?)", id, nowIso());
    }
    for (const r of toRevoke) q.run('DELETE FROM user_roles WHERE user_id = ? AND role = ?', id, r);
  })();
  if ([...toGrant, ...toRevoke].some(r => STAFF_ROLES.has(r))) q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', id); // تُجدَّد الصلاحيات بجلسة جديدة
  return { granted: toGrant, revoked: toRevoke, roles: rolesOf(id) };
}

/* ---------- نظرة عامة حيّة (D14: نقطة واحدة، ذاكرة مؤقّتة ١٥ ثانية لكل مدى) ---------- */
const overviewCache = new Map<number, { at: number; data: Overview }>();
const OVERVIEW_TTL_MS = 15_000;

function buildOverview(days: number): Overview {
  const now = new Date();
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(today); monthStart.setUTCDate(1);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const todayStr = dayStr(today), monthStr = dayStr(monthStart), tomorrowStr = dayStr(tomorrow);
  const counts = (sql: string, ...p: unknown[]): Record<string, number> => Object.fromEntries(q.all<{ k: string; c: number }>(sql, ...p).map(r => [String(r.k), r.c]));
  const fill = <K extends string>(keys: readonly K[], got: Record<string, number>) => Object.fromEntries(keys.map(k => [k, got[k] ?? 0])) as Record<K, number>;
  // السلاسل اليومية: N يوماً تنتهي اليوم — استعلام واحد لكل سلسلة، مجمَّع بـ strftime
  const dayList = Array.from({ length: days }, (_, i) => dayStr(new Date(today.getTime() - (days - 1 - i) * 86_400_000)));
  const first = dayList[0]!;
  const series = (sql: string, isMoney = false) => {
    const m = new Map(q.all<{ d: string; v: number }>(sql, first).map(r => [r.d, Number(r.v) || 0]));
    return dayList.map(d => (isMoney ? money(m.get(d) ?? 0) : m.get(d) ?? 0));
  };
  const queues = {
    teacherApplications: n("SELECT COUNT(*) FROM teacher_profiles WHERE verification_status IN ('pending','under_review')"),
    contentReview: n("SELECT COUNT(*) FROM books WHERE status = 'pending_review'") + n("SELECT COUNT(*) FROM courses WHERE status = 'pending_review'"),
    manualPayments: n("SELECT COUNT(*) FROM payments WHERE provider = 'manual' AND status = 'pending'"),
    payouts: n("SELECT COUNT(*) FROM teacher_payouts WHERE status = 'pending'"),
    reports: n("SELECT COUNT(*) FROM reports WHERE status = 'open'"),
    disputes: n("SELECT COUNT(*) FROM bookings WHERE status = 'disputed'"),
    pendingDocuments: n("SELECT COUNT(*) FROM teacher_documents WHERE status = 'submitted'"),
  };
  return {
    users: {
      total: n("SELECT COUNT(*) FROM users WHERE status = 'active'"),
      students: n('SELECT COUNT(DISTINCT account_id) FROM learners WHERE is_self = 1 AND archived_at IS NULL'),
      parents: n('SELECT COUNT(DISTINCT account_id) FROM learners WHERE is_self = 0 AND archived_at IS NULL'),
      learners: n('SELECT COUNT(*) FROM learners WHERE archived_at IS NULL'),
      learnersByGrade: q.all<any>('SELECT g.id, g.name, COUNT(*) AS c FROM learners l JOIN grades g ON g.id = l.grade_id WHERE l.archived_at IS NULL GROUP BY g.id ORDER BY g."order", g.id')
        .map(r => ({ gradeId: r.id, gradeName: r.name, count: r.c })),
      newThisMonth: n('SELECT COUNT(*) FROM users WHERE created_at >= ?', monthStr),
      newToday: n('SELECT COUNT(*) FROM users WHERE created_at >= ?', todayStr),
      activeUsers24h: n('SELECT COUNT(DISTINCT user_id) FROM analytics_events WHERE user_id IS NOT NULL AND created_at >= ?', new Date(now.getTime() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ')),
    },
    teachers: counts('SELECT verification_status AS k, COUNT(*) AS c FROM teacher_profiles GROUP BY verification_status'),
    bookings: {
      today: n("SELECT COUNT(*) FROM bookings WHERE starts_at >= ? AND starts_at < ? AND status IN ('confirmed','in_progress','completed')", today.toISOString(), tomorrow.toISOString()),
      pendingPayment: n("SELECT COUNT(*) FROM bookings WHERE status = 'pending_payment'"), disputed: queues.disputes,
    },
    revenue: {
      month: money(n("SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN ('paid','partially_refunded') AND paid_at >= ?", monthStr)),
      commissionMonth: money(n("SELECT COALESCE(SUM(commission),0) FROM teacher_earnings WHERE status <> 'reversed' AND created_at >= ?", monthStr)),
      refundsMonth: money(n('SELECT COALESCE(SUM(amount),0) FROM refunds WHERE created_at >= ?', monthStr)),
    },
    live: {
      lessonsInProgress: n("SELECT COUNT(*) FROM bookings WHERE status = 'in_progress'"),
      lessonsNextHour: n("SELECT COUNT(*) FROM bookings WHERE status = 'confirmed' AND starts_at >= ? AND starts_at < ?", now.toISOString(), new Date(now.getTime() + 3_600_000).toISOString()),
      connectedSockets: connectedSockets(),
      pendingPaymentBookings: n("SELECT COUNT(*) FROM bookings WHERE status = 'pending_payment'"),
      openDisputes: queues.disputes, openReports: queues.reports,
      walletLiability: money(n('SELECT COALESCE(SUM(balance),0) FROM wallets')),
      teacherPayable: { available: money(n('SELECT COALESCE(SUM(available_balance),0) FROM teacher_profiles')), pending: money(n('SELECT COALESCE(SUM(pending_balance),0) FROM teacher_profiles')) },
      gmvToday: money(n("SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN ('paid','partially_refunded') AND paid_at >= ?", todayStr)),
      refundsToday: money(n('SELECT COALESCE(SUM(amount),0) FROM refunds WHERE created_at >= ?', todayStr)),
      inProgress: q.all<any>(`SELECT b.id, pt.display_name AS teacher_name, COALESCE(l.display_name, ps.display_name) AS learner_name, b.starts_at, b.ends_at
        FROM bookings b JOIN profiles pt ON pt.user_id = b.teacher_id JOIN profiles ps ON ps.user_id = b.student_id LEFT JOIN learners l ON l.id = b.learner_id
        WHERE b.status = 'in_progress' ORDER BY b.starts_at LIMIT 20`)
        .map(r => ({ id: r.id, teacherName: r.teacher_name, learnerName: r.learner_name, startsAt: r.starts_at, endsAt: r.ends_at })),
    },
    series: {
      days: dayList,
      revenue: series("SELECT strftime('%Y-%m-%d', paid_at) AS d, SUM(total) AS v FROM orders WHERE status IN ('paid','partially_refunded') AND paid_at >= ? GROUP BY d", true),
      refunds: series("SELECT strftime('%Y-%m-%d', created_at) AS d, SUM(amount) AS v FROM refunds WHERE created_at >= ? GROUP BY d", true),
      bookings: series("SELECT strftime('%Y-%m-%d', created_at) AS d, COUNT(*) AS v FROM bookings WHERE created_at >= ? GROUP BY d"),
      completed: series("SELECT strftime('%Y-%m-%d', starts_at) AS d, COUNT(*) AS v FROM bookings WHERE status = 'completed' AND starts_at >= ? GROUP BY d"),
      newUsers: series("SELECT strftime('%Y-%m-%d', created_at) AS d, COUNT(*) AS v FROM users WHERE created_at >= ? GROUP BY d"),
      newLearners: series("SELECT strftime('%Y-%m-%d', created_at) AS d, COUNT(*) AS v FROM learners WHERE created_at >= ? GROUP BY d"),
    },
    breakdown: {
      revenueByItemType: fill(['lesson', 'book', 'course', 'package', 'subscription'] as const, Object.fromEntries(Object.entries(counts(
        "SELECT oi.item_type AS k, SUM(oi.unit_price * oi.quantity) AS c FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status IN ('paid','partially_refunded') AND o.paid_at >= ? GROUP BY oi.item_type", monthStr)).map(([k, v]) => [k, money(v)]))),
      ordersByProvider: counts("SELECT COALESCE(provider, 'unknown') AS k, COUNT(*) AS c FROM orders WHERE status IN ('paid','partially_refunded') AND paid_at >= ? GROUP BY k", monthStr),
      bookingsByStatus: fill(BOOKING_STATUSES, counts('SELECT status AS k, COUNT(*) AS c FROM bookings WHERE starts_at >= ? AND starts_at < ? GROUP BY status', monthStr, dayStr(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))))),
      contentByStatus: { books: counts('SELECT status AS k, COUNT(*) AS c FROM books GROUP BY status'), courses: counts('SELECT status AS k, COUNT(*) AS c FROM courses GROUP BY status') },
    },
    top: {
      teachers: q.all<any>(`SELECT b.teacher_id AS id, p.display_name AS name, COUNT(*) AS lessons, COALESCE(SUM(b.price),0) AS revenue FROM bookings b JOIN profiles p ON p.user_id = b.teacher_id
        WHERE b.status = 'completed' AND b.starts_at >= ? GROUP BY b.teacher_id ORDER BY lessons DESC, revenue DESC LIMIT 5`, monthStr)
        .map(r => ({ id: r.id, name: r.name, lessons: r.lessons, revenue: money(r.revenue) })),
      subjects: q.all<any>(`SELECT s.id, s.name, COUNT(*) AS lessons FROM bookings b JOIN subjects s ON s.id = b.subject_id
        WHERE b.status IN ('confirmed','in_progress','completed') AND b.starts_at >= ? GROUP BY s.id ORDER BY lessons DESC LIMIT 5`, monthStr),
    },
    queues,
    reports: queues.reports,
    generatedAt: now.toISOString(),
  };
}
router.get('/overview', requireRole('content_reviewer', 'support', 'finance'), validate(OverviewQuery, 'query'), (req, res) => {
  const { days } = req.valid.query as z.infer<typeof OverviewQuery>;
  const hit = overviewCache.get(days);
  if (hit && Date.now() - hit.at < OVERVIEW_TTL_MS) return res.json(hit.data);
  const data = buildOverview(days);
  overviewCache.set(days, { at: Date.now(), data });
  res.json(data);
});

/* ---------- المعلّمون: القائمة، صفحة المعلّم (Teacher 360)، القرارات ---------- */
const TEACHER_SELECT = 'SELECT tp.*, p.display_name, p.avatar_path, p.gender, u.phone, u.email, u.status AS user_status FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id JOIN users u ON u.id = tp.user_id';
const teacherRow = (t: any) => ({
  id: t.user_id, name: t.display_name, avatarUrl: publicUrlFromPath(t.avatar_path), phone: t.phone, email: t.email, headline: t.headline, specialty: t.specialty, yearsExp: t.years_exp,
  status: t.verification_status, appliedAt: t.applied_at, ratingAvg: Number(t.rating_avg) || 0, ratingCount: t.rating_count, lessonsCount: t.lessons_count, studentsCount: t.students_count,
  availableBalance: money(t.available_balance), commissionRate: t.commission_rate,
});
const documentView = (d: any, req: Request) => ({
  id: d.id, type: d.type, status: d.status, note: d.note ?? null, mime: d.mime, name: d.original_name ?? null, url: signedUrl(d.file_id, req.user!.id, 600).url,
  reviewedBy: brief(d.reviewed_by), reviewedAt: d.reviewed_at ?? null, createdAt: d.created_at,
});
const TeachersQuery = Page.extend({
  subjectId: IdQ.optional(), gradeId: IdQ.optional(), minRating: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(['queue', 'rating_desc', 'lessons_desc', 'applied_desc', 'name']).default('queue'),
});
const TEACHER_ORDER: Record<z.infer<typeof TeachersQuery>['sort'], string> = {
  queue: "CASE tp.verification_status WHEN 'pending' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, tp.applied_at DESC",
  rating_desc: 'tp.rating_avg DESC, tp.rating_count DESC, tp.user_id', lessons_desc: 'tp.lessons_count DESC, tp.user_id', applied_desc: 'tp.applied_at DESC, tp.user_id', name: 'p.display_name COLLATE NOCASE, tp.user_id',
};
router.get('/teachers', requireRole('support'), validate(TeachersQuery, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof TeachersQuery>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.status) { where.push('tp.verification_status = ?'); params.push(f.status); }
  if (f.q) { where.push('(norm(p.display_name) LIKE norm(?) OR u.phone LIKE ? OR u.email LIKE ? OR u.id = ?)'); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, Number(f.q) || 0); }
  if (f.subjectId || f.gradeId) {
    where.push(`EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = tp.user_id${f.subjectId ? ' AND ts.subject_id = ?' : ''}${f.gradeId ? ' AND ts.grade_id = ?' : ''})`);
    if (f.subjectId) params.push(f.subjectId); if (f.gradeId) params.push(f.gradeId);
  }
  if (f.minRating !== undefined) { where.push('tp.rating_avg >= ?'); params.push(f.minRating); }
  const from = `FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id JOIN users u ON u.id = tp.user_id WHERE ${where.join(' AND ')}`;
  const total = n(`SELECT COUNT(*) ${from}`, ...params);
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT tp.*, p.display_name, p.avatar_path, u.phone, u.email ${from} ORDER BY ${TEACHER_ORDER[f.sort]} LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data: rows.map(teacherRow), meta: pageMeta(total, f.page, f.limit) });
});
/** بطاقة المعلّم — للدعم والمالية (قراءة)؛ بيانات الصرف تظهر للمالية والإدارة فقط */
router.get('/teachers/:id', requireRole('support', 'finance'), (req, res) => {
  const id = idParam(req);
  const t = q.get<any>(`${TEACHER_SELECT} WHERE tp.user_id = ?`, id);
  if (!t) throw notFound();
  const finance = hasRole(req.user, 'finance'); // بيانات الصرف للمالية والإدارة فقط
  const contentRow = (r: any) => ({ id: r.id, title: r.title, status: r.status, price: money(r.price), updatedAt: r.updated_at });
  res.json({
    id, userId: id, name: t.display_name, avatarUrl: publicUrlFromPath(t.avatar_path), gender: t.gender ?? null, phone: t.phone, email: t.email, userStatus: t.user_status,
    headline: t.headline, bio: t.bio, qualification: t.qualification, specialty: t.specialty, yearsExp: t.years_exp, languages: json(t.languages, []), teachingStyle: json(t.teaching_style, []),
    status: t.verification_status, commissionRate: t.commission_rate, appliedAt: t.applied_at, verifiedAt: t.verified_at,
    ratingAvg: Number(t.rating_avg) || 0, ratingCount: t.rating_count, studentsCount: t.students_count, lessonsCount: t.lessons_count,
    payoutMethod: finance ? (t.payout_method ?? null) : null, payoutDetails: finance ? json(t.payout_details, null) : null,
    subjects: q.all<any>('SELECT ts.subject_id AS subjectId, ts.grade_id AS gradeId, s.name AS subject, g.name AS grade FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id JOIN grades g ON g.id = ts.grade_id WHERE ts.teacher_id = ? ORDER BY s."order", g."order"', id),
    prices: q.all<any>('SELECT duration_minutes AS durationMinutes, mode, price FROM teacher_prices WHERE teacher_id = ? ORDER BY mode, duration_minutes', id),
    packages: q.all<any>('SELECT * FROM lesson_packages WHERE teacher_id = ? ORDER BY lessons_count', id).map(p => ({ id: p.id, lessonsCount: p.lessons_count, durationMinutes: p.duration_minutes, mode: p.mode, price: money(p.price), active: !!p.active })),
    availability: q.all<any>('SELECT id, weekday, start_time AS startTime, end_time AS endTime, slot_minutes AS slotMinutes, break_minutes AS breakMinutes FROM teacher_availability WHERE teacher_id = ? ORDER BY weekday, start_time', id),
    timeOff: q.all<any>('SELECT id, starts_at, ends_at, reason FROM teacher_time_off WHERE teacher_id = ? ORDER BY starts_at DESC LIMIT 100', id).map(x => ({ id: x.id, from: x.starts_at, to: x.ends_at, reason: x.reason ?? null })),
    // مستندات الهوية بيانات حسّاسة: للدعم والإدارة (أصحاب قرار التحقّق) لا للمالية
    documents: hasRole(req.user, 'support') ? q.all<any>('SELECT d.*, f.mime, f.original_name FROM teacher_documents d JOIN files f ON f.id = d.file_id WHERE d.teacher_id = ? ORDER BY d.id', id).map(d => documentView(d, req)) : [],
    history: q.all<any>('SELECT v.decision, v.reason, v.decided_at, p.display_name AS reviewer FROM teacher_verifications v LEFT JOIN profiles p ON p.user_id = v.reviewer_id WHERE v.teacher_id = ? ORDER BY v.id DESC', id),
    content: {
      books: q.all<any>('SELECT id, title, status, price, updated_at FROM books WHERE author_id = ? ORDER BY updated_at DESC', id).map(contentRow),
      courses: q.all<any>('SELECT id, title, status, price, updated_at FROM courses WHERE teacher_id = ? ORDER BY updated_at DESC', id).map(contentRow),
    },
    stats: {
      bookings: {
        total: n('SELECT COUNT(*) FROM bookings WHERE teacher_id = ?', id), completed: n("SELECT COUNT(*) FROM bookings WHERE teacher_id = ? AND status = 'completed'", id),
        cancelledByTeacher: n("SELECT COUNT(*) FROM bookings WHERE teacher_id = ? AND status = 'cancelled_by_teacher'", id), noShow: n("SELECT COUNT(*) FROM bookings WHERE teacher_id = ? AND status = 'no_show'", id),
        disputed: n("SELECT COUNT(*) FROM bookings WHERE teacher_id = ? AND status = 'disputed'", id),
        upcoming: n("SELECT COUNT(*) FROM bookings WHERE teacher_id = ? AND status IN ('pending_payment','confirmed') AND starts_at >= ?", id, nowIso()),
      },
      earnings: { lifetime: money(t.lifetime_earnings), available: money(t.available_balance), pending: money(t.pending_balance) },
      reviews: { avg: Number(t.rating_avg) || 0, count: t.rating_count, hidden: n("SELECT COUNT(*) FROM reviews WHERE target_type = 'teacher' AND target_id = ? AND status = 'hidden'", id) },
    },
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
    if (d.decision === 'verified') q.run("UPDATE teacher_documents SET status = 'accepted', reviewed_by = COALESCE(reviewed_by, ?), reviewed_at = COALESCE(reviewed_at, ?) WHERE teacher_id = ? AND status = 'submitted'", req.user!.id, nowIso(), id);
    if (d.decision === 'suspended') {
      // إيقاف المعلّم: تُلغى حصصه القادمة باسترجاع كامل
      for (const b of q.all<any>("SELECT id FROM bookings WHERE teacher_id = ? AND status IN ('pending_payment','confirmed')", id)) {
        q.run("UPDATE bookings SET status = 'cancelled_by_teacher', cancelled_at = ?, cancel_reason = 'إيقاف المعلّم', refund_percent = 100 WHERE id = ?", nowIso(), b.id);
        const bk = q.get<any>('SELECT order_id, price, package_purchase_id FROM bookings WHERE id = ?', b.id);
        if (bk.package_purchase_id) q.run('UPDATE package_purchases SET remaining = remaining + 1 WHERE id = ?', bk.package_purchase_id);
        else if (bk.order_id && q.val<string>('SELECT status FROM orders WHERE id = ?', bk.order_id) === 'paid') {
          const paid = paidForBooking(bk.order_id, b.id);
          if (paid > 0) refundOrder(bk.order_id, { amount: paid, reason: 'إيقاف المعلّم', bookingId: b.id, processedBy: req.user!.id, clamp: true });
        }
      }
    }
  })();
  const msg = { verified: ['teacher_verified', 'تم اعتماد حسابك كمعلّم 🎉', 'يمكنك الآن ضبط توفّرك ونشر محتواك'], rejected: ['teacher_rejected', 'لم يُقبل طلبك', d.reason ?? 'راجع المستندات وأعد التقديم'], under_review: ['system', 'طلبك قيد المراجعة', null], suspended: ['system', 'أُوقف حسابك كمعلّم', d.reason ?? null] }[d.decision];
  notify(id, { type: msg[0]!, title: msg[1]!, body: msg[2] });
  audit(req, `teacher.${d.decision}`, 'user', id, { reason: d.reason, previous: t.verification_status }, id);
  res.json({ ok: true, status: d.decision });
});
router.post('/teachers/:id/documents/:docId/decision', requireRole('admin'), validate(TeacherDocumentDecision), (req, res) => {
  const id = idParam(req); const docId = idParam(req, 'docId');
  const d = body<typeof TeacherDocumentDecision>(req);
  const doc = q.get<any>('SELECT * FROM teacher_documents WHERE id = ? AND teacher_id = ?', docId, id);
  if (!doc) throw notFound('المستند غير موجود');
  q.run('UPDATE teacher_documents SET status = ?, note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', d.decision, d.note ?? null, req.user!.id, nowIso(), docId);
  if (d.decision === 'rejected') notify(id, { type: 'teacher_document_rejected', title: 'مستند بحاجة إلى إعادة رفع', body: d.note ?? null, data: { documentId: docId } });
  audit(req, `teacher.document_${d.decision}`, 'teacher_documents', docId, { type: doc.type, note: d.note ?? null }, id);
  res.json(documentView(q.get<any>('SELECT d.*, f.mime, f.original_name FROM teacher_documents d JOIN files f ON f.id = d.file_id WHERE d.id = ?', docId), req));
});
router.patch('/teachers/:id', requireRole('admin'), validate(TeacherPatch), (req, res) => {
  const id = idParam(req);
  const b = body<typeof TeacherPatch>(req);
  const t = q.get<any>('SELECT * FROM teacher_profiles WHERE user_id = ?', id);
  if (!t) throw notFound();
  const before = { commissionRate: t.commission_rate, headline: t.headline ?? null, specialty: t.specialty ?? null, yearsExp: t.years_exp };
  const after = { commissionRate: b.commissionRate ?? t.commission_rate, headline: b.headline ?? t.headline ?? null, specialty: b.specialty ?? t.specialty ?? null, yearsExp: b.yearsExp ?? t.years_exp };
  db.transaction(() => {
    q.run('UPDATE teacher_profiles SET commission_rate = ?, headline = ?, specialty = ?, years_exp = ?, updated_at = ? WHERE user_id = ?', after.commissionRate, after.headline, after.specialty, after.yearsExp, nowIso(), id);
    if (after.commissionRate !== before.commissionRate) {
      // teacher_verifications.decision لا يقبل 'pending' — يُسجَّل under_review (حالة المعلّم نفسها لا تتغيّر هنا)
      const decision = t.verification_status === 'pending' ? 'under_review' : t.verification_status;
      q.run('INSERT INTO teacher_verifications (teacher_id, reviewer_id, decision, reason) VALUES (?,?,?,?)', id, req.user!.id, decision, `commission: ${before.commissionRate}→${after.commissionRate} — ${b.reason}`);
    }
  })();
  audit(req, 'teacher.update', 'user', id, { before, after, reason: b.reason }, id);
  res.json(teacherRow(q.get<any>(`${TEACHER_SELECT} WHERE tp.user_id = ?`, id)));
});
router.get('/teachers/:id/earnings', requireRole('finance'), validate(Page, 'query'), (req, res) => {
  const id = idParam(req);
  const f = req.valid.query as z.infer<typeof Page>;
  if (!q.get('SELECT 1 FROM teacher_profiles WHERE user_id = ?', id)) throw notFound();
  const where = ['teacher_id = ?']; const params: unknown[] = [id];
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  const from = `FROM teacher_earnings WHERE ${where.join(' AND ')}`;
  const total = n(`SELECT COUNT(*) ${from}`, ...params);
  const sums = q.get<any>(`SELECT COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(commission),0) AS commission, COALESCE(SUM(net),0) AS net ${from}`, ...params);
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT * ${from} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({
    data: rows.map(e => ({ id: e.id, source: e.source_type, refId: e.source_id, gross: money(e.gross), commission: money(e.commission), net: money(e.net), status: e.status, availableAt: e.available_at ?? null, payoutId: e.payout_id ?? null, createdAt: e.created_at })),
    meta: pageMeta(total, f.page, f.limit), totals: { gross: money(sums.gross), commission: money(sums.commission), net: money(sums.net) },
  });
});
router.get('/teachers/:id/reviews', requireRole('support'), (req, res) => {
  const id = idParam(req);
  if (!q.get('SELECT 1 FROM teacher_profiles WHERE user_id = ?', id)) throw notFound();
  res.json(q.all<any>("SELECT * FROM reviews WHERE target_type = 'teacher' AND target_id = ? ORDER BY id DESC", id).map(reviewAdmin));
});
/** طلاب المعلّم مجمَّعين بـ (الحساب، المتعلّم) — المتعلّم كمرجع فقط، والحساب باسمه لرابط صفحة الشخص */
router.get('/teachers/:id/students', requireRole('support'), validate(Page, 'query'), (req, res) => {
  const id = idParam(req);
  const f = req.valid.query as z.infer<typeof Page>;
  if (!q.get('SELECT 1 FROM teacher_profiles WHERE user_id = ?', id)) throw notFound();
  const from = "FROM bookings b WHERE b.teacher_id = ? AND b.status IN ('completed','confirmed','in_progress')";
  const total = n(`SELECT COUNT(*) FROM (SELECT 1 ${from} GROUP BY b.student_id, b.learner_id)`, id);
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT b.student_id, b.learner_id, COUNT(*) AS lessons, MAX(b.starts_at) AS last_at ${from} GROUP BY b.student_id, b.learner_id ORDER BY last_at DESC LIMIT ? OFFSET ?`, id, limit, offset);
  const data = rows.map(r => {
    const account = { id: r.student_id, name: nameOf(r.student_id) };
    // حجوزات قديمة بلا متعلّم: مرجع اصطناعي بمعرّف سالب (= -معرّف الحساب) كما في GET /teacher/students
    const learner: LearnerRef = learnerRefById(r.learner_id) ?? { id: -r.student_id, displayName: account.name, gradeName: null, avatarUrl: publicUrlFromPath(q.val<string>('SELECT avatar_path FROM profiles WHERE user_id = ?', r.student_id)) };
    return { learner, account, lessons: r.lessons, lastAt: r.last_at ?? null };
  });
  res.json({ data, meta: pageMeta(total, f.page, f.limit) });
});

/* ---------- مراجعة المحتوى ---------- */
const ContentQuery = Page.extend({ authorId: IdQ.optional() });
router.get('/content', requireRole('content_reviewer'), validate(ContentQuery, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof ContentQuery>;
  const status = f.status ?? 'pending_review';
  const where = (col: string) => { const w: string[] = []; const p: unknown[] = []; if (status !== 'all') { w.push(`${col.split('.')[0]}.status = ?`); p.push(status); } if (f.authorId) { w.push(`${col} = ?`); p.push(f.authorId); } if (f.q) { w.push(`norm(${col.split('.')[0]}.title) LIKE norm(?)`); p.push(`%${f.q}%`); } return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', p }; };
  const wb = where('b.author_id'), wc = where('c.teacher_id');
  const books = q.all<any>(`SELECT b.id, b.title, b.type, b.price, b.status, b.updated_at, b.author_id AS authorId, p.display_name AS author, s.name AS subject, g.name AS grade FROM books b JOIN profiles p ON p.user_id = b.author_id JOIN subjects s ON s.id = b.subject_id JOIN grades g ON g.id = b.grade_id ${wb.sql} ORDER BY b.updated_at LIMIT 100`, ...wb.p)
    .map(b => ({ ...b, entityType: 'book' }));
  const courses = q.all<any>(`SELECT c.id, c.title, c.price, c.status, c.updated_at, c.teacher_id AS authorId, p.display_name AS author, s.name AS subject, g.name AS grade FROM courses c JOIN profiles p ON p.user_id = c.teacher_id JOIN subjects s ON s.id = c.subject_id JOIN grades g ON g.id = c.grade_id ${wc.sql} ORDER BY c.updated_at LIMIT 100`, ...wc.p)
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
  // القرار للمراجعة وحدها — سحب محتوى منشور يمرّ بالأرشفة (admin) لا برفض مراجع المحتوى
  if (row.status !== 'pending_review') throw conflict('القرار متاح لما هو «بانتظار المراجعة» فقط — استخدم الأرشفة لسحب المنشور');
  const ownerId = type === 'book' ? row.author_id : row.teacher_id;
  db.transaction(() => {
    if (d.decision === 'approved') q.run(`UPDATE ${table} SET status = 'published', published_at = COALESCE(published_at, ?), reject_reason = NULL, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), id);
    else q.run(`UPDATE ${table} SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`, d.reason ?? null, nowIso(), id);
    q.run('INSERT INTO content_reviews (entity_type, entity_id, reviewer_id, decision, reason, checklist) VALUES (?,?,?,?,?,?)', type, id, req.user!.id, d.decision, d.reason ?? null, d.checklist ? JSON.stringify(d.checklist) : null);
  })();
  notify(ownerId, { type: d.decision === 'approved' ? 'content_approved' : 'content_rejected', title: d.decision === 'approved' ? `نُشر «${row.title}»` : `لم يُقبل «${row.title}»`, body: d.reason ?? null, data: { [type === 'book' ? 'bookId' : 'courseId']: id } });
  audit(req, `content.${d.decision}`, table, id, { reason: d.reason }, ownerId);
  res.json({ ok: true });
});
router.post('/content/:type/:id/archive', requireRole('admin'), (req, res) => {
  const table = req.params.type === 'book' ? 'books' : 'courses';
  const id = idParam(req);
  const row = q.get<any>(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw notFound();
  q.run(`UPDATE ${table} SET status = 'archived', updated_at = ? WHERE id = ?`, nowIso(), id);
  audit(req, 'content.archive', table, id, { previous: row.status }, table === 'books' ? row.author_id : row.teacher_id);
  res.json({ ok: true });
});

/* ---------- الحجوزات والطلبات والمال ---------- */
type AdminBookingRow = BookingRow & { learner_id: number | null; cancel_reason: string | null; refund_percent: number | null; cancelled_at: string | null };
/** bookingView + حقول تخصّ الإدارة (المتعلّم، الطلب، الباقة، الإلغاء) */
const adminBookingView = (b: AdminBookingRow, viewerId: number) => ({
  ...bookingView(b, viewerId), learner: learnerRefById(b.learner_id), orderId: b.order_id, packagePurchaseId: b.package_purchase_id,
  cancelReason: b.cancel_reason ?? null, refundPercent: b.refund_percent ?? null, note: b.note ?? null, expiresAt: b.expires_at ?? null, cancelledAt: b.cancelled_at ?? null,
});
const BookingsQuery = Page.extend({ studentId: IdQ.optional(), teacherId: IdQ.optional(), learnerId: IdQ.optional() });
router.get('/bookings', requireRole('support', 'finance'), validate(BookingsQuery, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof BookingsQuery>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.status) { where.push('b.status = ?'); params.push(f.status); }
  if (f.studentId) { where.push('b.student_id = ?'); params.push(f.studentId); }
  if (f.teacherId) { where.push('b.teacher_id = ?'); params.push(f.teacherId); }
  if (f.learnerId) { where.push('b.learner_id = ?'); params.push(f.learnerId); }
  if (f.q) { where.push('(norm(ps.display_name) LIKE norm(?) OR norm(pt.display_name) LIKE norm(?) OR b.id = ?)'); params.push(`%${f.q}%`, `%${f.q}%`, Number(f.q) || 0); }
  const from = `FROM bookings b JOIN profiles ps ON ps.user_id = b.student_id JOIN profiles pt ON pt.user_id = b.teacher_id WHERE ${where.join(' AND ')}`;
  const total = n(`SELECT COUNT(*) ${from}`, ...params);
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<AdminBookingRow>(`SELECT b.* ${from} ORDER BY b.starts_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data: rows.map(b => adminBookingView(b, req.user!.id)), meta: pageMeta(total, f.page, f.limit) });
});
const DisputeBody = z.object({ resolution: z.enum(['refund_student', 'pay_teacher', 'split']), reason: z.string().max(500) });
/** حلّ النزاع يُطبَّق مرة واحدة على حجز في نزاع فقط — الحالة نفسها هي حارس التكرار (بعد الحلّ يصير completed) */
router.post('/bookings/:id/resolve', requireRole('support'), validate(DisputeBody), (req, res) => {
  const id = idParam(req);
  const d = body<typeof DisputeBody>(req);
  const b = q.get<any>('SELECT * FROM bookings WHERE id = ?', id);
  if (!b) throw notFound();
  if (b.status !== 'disputed') throw conflict(b.cancel_reason?.startsWith('نزاع:') ? 'حُلّ هذا النزاع من قبل' : 'الحجز ليس في نزاع');
  db.transaction(() => {
    if (d.resolution !== 'pay_teacher' && b.order_id && q.val<string>('SELECT status FROM orders WHERE id = ?', b.order_id) === 'paid') {
      // الأساس ما دُفع فعلاً عن الحصة (بعد الكوبون) لا سعر المعلّم
      const paid = paidForBooking(b.order_id, id);
      const amount = money(d.resolution === 'split' ? paid / 2 : paid);
      if (amount > 0) refundOrder(b.order_id, { amount, reason: d.reason, bookingId: id, processedBy: req.user!.id, clamp: true });
    }
    if (d.resolution !== 'pay_teacher' && b.package_purchase_id) q.run('UPDATE package_purchases SET remaining = remaining + 1 WHERE id = ?', b.package_purchase_id);
    q.run("UPDATE bookings SET status = 'completed', cancel_reason = ? WHERE id = ?", `نزاع: ${d.resolution} — ${d.reason}`, id);
  })();
  audit(req, 'booking.dispute_resolved', 'bookings', id, d, b.student_id);
  res.json({ ok: true });
});

const OrdersQuery = Page.extend({ userId: IdQ.optional() });
router.get('/orders', requireRole('finance', 'support'), validate(OrdersQuery, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof OrdersQuery>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.status) { where.push('o.status = ?'); params.push(f.status); }
  if (f.userId) { where.push('o.user_id = ?'); params.push(f.userId); }
  if (f.q) { where.push('(o.number LIKE ? OR norm(p.display_name) LIKE norm(?))'); params.push(`%${f.q}%`, `%${f.q}%`); }
  const from = `FROM orders o JOIN profiles p ON p.user_id = o.user_id WHERE ${where.join(' AND ')}`;
  const total = n(`SELECT COUNT(*) ${from}`, ...params);
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT o.*, p.display_name ${from} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({
    data: rows.map(o => ({
      ...orderView(o), userName: o.display_name, userId: o.user_id, providerRef: o.provider_ref,
      payments: q.all<any>('SELECT provider, status, amount, provider_ref, created_at FROM payments WHERE order_id = ? ORDER BY id', o.id).map(p => ({ provider: p.provider, status: p.status, amount: money(p.amount), providerRef: p.provider_ref ?? null, createdAt: p.created_at })),
      refunds: q.all<any>('SELECT amount, reason, created_at FROM refunds WHERE order_id = ? ORDER BY id', o.id).map(r => ({ amount: money(r.amount), reason: r.reason ?? null, createdAt: iso(r.created_at) })),
      // المتبقّي القابل للاسترجاع — سقف أي استرجاع لاحق (الواجهة تعرضه بدل إجمالي الطلب)
      refundable: o.status === 'paid' || o.status === 'partially_refunded' ? refundableRemaining(o) : 0,
    })),
    meta: pageMeta(total, f.page, f.limit),
  });
});
router.post('/orders/:id/confirm-manual', requireRole('finance'), (req, res) => {
  const id = idParam(req);
  const o = q.get<any>('SELECT * FROM orders WHERE id = ?', id);
  if (!o) throw notFound();
  if (o.provider !== 'manual' || o.status !== 'pending') throw new AppError('conflict', 'الطلب ليس تحويلاً بنكياً معلّقاً', 409);
  const { order } = fulfillOrder(id, { provider: 'manual', providerRef: String(req.body?.reference ?? '') || null });
  audit(req, 'order.manual_confirmed', 'orders', id, null, o.user_id);
  res.json(orderView(order));
});
const RefundBody = z.object({ amount: z.number().positive().optional(), reason: z.string().min(3).max(500), bookingId: z.number().int().positive().optional() });
router.post('/orders/:id/refund', requireRole('finance'), validate(RefundBody), (req, res) => {
  const id = idParam(req);
  const r = body<typeof RefundBody>(req);
  const order = refundOrder(id, { amount: r.amount, reason: r.reason, bookingId: r.bookingId ?? null, processedBy: req.user!.id });
  if (r.bookingId) q.run("UPDATE bookings SET status = CASE WHEN status IN ('pending_payment','confirmed') THEN 'cancelled_by_teacher' ELSE status END, refund_percent = 100 WHERE id = ?", r.bookingId);
  audit(req, 'order.refund', 'orders', id, r, order.user_id);
  res.json(orderView(order));
});
router.get('/refunds', requireRole('finance'), (_req, res) => {
  res.json(q.all<any>('SELECT r.*, o.number, p.display_name FROM refunds r JOIN orders o ON o.id = r.order_id JOIN profiles p ON p.user_id = o.user_id ORDER BY r.id DESC LIMIT 200'));
});

const PayoutsQuery = z.object({ status: z.string().max(40).default('pending'), teacherId: IdQ.optional() });
router.get('/payouts', requireRole('finance'), validate(PayoutsQuery, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof PayoutsQuery>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.status !== 'all') { where.push('tp.status = ?'); params.push(f.status); }
  if (f.teacherId) { where.push('tp.teacher_id = ?'); params.push(f.teacherId); }
  res.json(q.all<any>(`SELECT tp.*, p.display_name FROM teacher_payouts tp JOIN profiles p ON p.user_id = tp.teacher_id WHERE ${where.join(' AND ')} ORDER BY tp.id DESC LIMIT 200`, ...params)
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
  audit(req, `payout.${d.decision}`, 'teacher_payouts', id, { amount: p.amount }, p.teacher_id);
  res.json({ ok: true });
});

/* ---------- حالة النظام (قراءة فقط — لا أسرار أبداً) ---------- */
router.get('/system', requireRole('admin'), (_req, res) => {
  const { otp, payments, rooms, bootstrap } = config;
  const backups = listBackups();
  const turn = rooms.iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith('turn')));
  res.json({
    publicUrl: config.publicUrl, env: config.env, schemaVersion: SCHEMA_VERSION,
    otp: { ...otpMethods(), smsProvider: otp.sms.provider, emailProvider: otp.email.provider, allowedCountries: otp.sms.allowedCountries, testTargets: otp.testTargets.length },
    payments: { providers: payments.providers },
    rooms: { provider: rooms.provider, turn },
    bootstrap: { allowDemoSeed: bootstrap.allowDemoSeed, adminPhone: !!bootstrap.adminPhone },
    integrations: listIntegrations(), summary: integrationsSummary(),
    backups: { last: backups[0]?.at ?? null, count: backups.length, dir: BACKUP_DIR },
    deploy: { domain: config.deploy.domain || null, image: config.deploy.image || null },
  });
});

/** فحص الاتصال الفعلي بالخدمات — مرة كل ١٠ ثوانٍ لكل عملية (الفحوصات تلمس شبكات خارجية) */
let lastCheckAt = 0;
router.post('/system/check', requireRole('admin'), validate(z.object({ ids: z.array(z.string().min(1).max(60)).max(60).optional() })), asyncHandler(async (req, res) => {
  if (Date.now() - lastCheckAt < 10_000) throw new AppError('rate_limited', 'انتظر ١٠ ثوانٍ قبل فحص آخر', 429);
  lastCheckAt = Date.now();
  const results = await runChecks(req.body.ids);
  audit(req, 'system.check', 'system', null, { ids: Object.keys(results).length });
  res.json(results);
}));

router.post('/system/backup', requireRole('admin'), (req, res) => {
  const b = runBackup();
  audit(req, 'system.backup', 'system', null, { file: b.file, bytes: b.bytes });
  res.json(b);
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
  const b = req.body; const id = Number(q.run('INSERT INTO countries (code, name) VALUES (?,?)', b.code.toUpperCase(), b.name).lastInsertRowid);
  clearCatalogCache(); audit(req, 'catalog.create', 'countries', id, b); res.status(201).json({ id });
});
router.post('/catalog/curriculums', requireRole('admin'), validate(Named.extend({ countryId: z.number().int() })), (req, res) => {
  const id = Number(q.run('INSERT INTO curriculums (country_id, name) VALUES (?,?)', req.body.countryId, req.body.name).lastInsertRowid);
  clearCatalogCache(); audit(req, 'catalog.create', 'curriculums', id, req.body); res.status(201).json({ id });
});
router.post('/catalog/grades', requireRole('admin'), validate(Named.extend({ curriculumId: z.number().int() })), (req, res) => {
  const id = Number(q.run('INSERT INTO grades (curriculum_id, name, "order") VALUES (?,?,?)', req.body.curriculumId, req.body.name, req.body.order ?? 0).lastInsertRowid);
  clearCatalogCache(); audit(req, 'catalog.create', 'grades', id, req.body); res.status(201).json({ id });
});
router.post('/catalog/semesters', requireRole('admin'), validate(Named.extend({ curriculumId: z.number().int() })), (req, res) => {
  const id = Number(q.run('INSERT INTO semesters (curriculum_id, name, "order") VALUES (?,?,?)', req.body.curriculumId, req.body.name, req.body.order ?? 0).lastInsertRowid);
  clearCatalogCache(); audit(req, 'catalog.create', 'semesters', id, req.body); res.status(201).json({ id });
});
router.post('/catalog/subjects', requireRole('admin'), validate(Named.extend({ curriculumId: z.number().int(), colorKey: z.string().max(20).default('default'), slug: z.string().max(40).optional() })), (req, res) => {
  const b = req.body; const id = Number(q.run('INSERT INTO subjects (curriculum_id, name, slug, color_key, "order") VALUES (?,?,?,?,?)', b.curriculumId, b.name, b.slug ?? slugify(b.name), b.colorKey, b.order ?? 0).lastInsertRowid);
  clearCatalogCache(); audit(req, 'catalog.create', 'subjects', id, b); res.status(201).json({ id });
});
router.post('/catalog/units', requireRole('admin', 'content_reviewer'), validate(z.object({ subjectId: z.number().int(), gradeId: z.number().int(), semesterId: z.number().int(), title: z.string().min(1).max(160), order: z.number().int().optional() })), (req, res) => {
  const b = req.body; const id = Number(q.run('INSERT INTO units (subject_id, grade_id, semester_id, title, "order") VALUES (?,?,?,?,?)', b.subjectId, b.gradeId, b.semesterId, b.title, b.order ?? 0).lastInsertRowid);
  clearCatalogCache(); audit(req, 'catalog.create', 'units', id, b); res.status(201).json({ id });
});
router.post('/catalog/lessons', requireRole('admin', 'content_reviewer'), validate(z.object({ unitId: z.number().int(), title: z.string().min(1).max(160), order: z.number().int().optional() })), (req, res) => {
  const b = req.body; const id = Number(q.run('INSERT INTO curriculum_lessons (unit_id, title, "order") VALUES (?,?,?)', b.unitId, b.title, b.order ?? 0).lastInsertRowid);
  clearCatalogCache(); audit(req, 'catalog.create', 'curriculum_lessons', id, b); res.status(201).json({ id });
});
const CATALOG_TABLES: Record<string, string> = { countries: 'countries', curriculums: 'curriculums', grades: 'grades', semesters: 'semesters', subjects: 'subjects', units: 'units', lessons: 'curriculum_lessons' };
/** الأعمدة المسموح تعديلها لكل نوع — «active» ليس عموداً في كل الجداول (كان يرمي 500) */
const CATALOG_COLUMNS: Record<string, string[]> = {
  countries: ['name'], curriculums: ['name', 'active'], grades: ['name', 'order'], semesters: ['name', 'order'],
  subjects: ['name', 'order', 'colorKey'], units: ['title', 'order'], lessons: ['title', 'order'],
};
const CatalogPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(), title: z.string().trim().min(1).max(160).optional(),
  order: z.number().int().min(0).max(9999).optional(), colorKey: z.string().trim().min(1).max(20).optional(), active: z.boolean().optional(),
}).strict();
router.patch('/catalog/:kind/:id', requireRole('admin'), validate(CatalogPatch), (req, res) => {
  const table = CATALOG_TABLES[req.params.kind]; if (!table) throw notFound();
  const id = idParam(req);
  const b = body<typeof CatalogPatch>(req);
  const columns = CATALOG_COLUMNS[req.params.kind]!;
  const allowed: Record<string, string> = { name: 'name', title: 'title', order: '"order"', colorKey: 'color_key', active: 'active' };
  const sets: string[] = []; const params: unknown[] = []; const changes: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(allowed)) {
    const value = (b as Record<string, unknown>)[k];
    if (value === undefined) continue;
    if (!columns.includes(k)) throw badRequest(`«${k}» لا ينطبق على هذا النوع`);
    sets.push(`${col} = ?`); params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value); changes[k] = value;
  }
  if (!sets.length) throw badRequest('لا تغييرات');
  q.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  clearCatalogCache();
  audit(req, 'catalog.update', table, id, changes);
  res.json({ ok: true });
});
/** ما يشير إلى عنصر المنهج قبل حذفه — الحذف الصامت كان يجرّد المتعلّمين من صفّهم ويحذف وحدات المنهج (SET NULL/CASCADE) */
const CATALOG_REFS: Record<string, { label: string; sql: string }[]> = {
  countries: [{ label: 'مناهج', sql: 'SELECT COUNT(*) FROM curriculums WHERE country_id = ?' }],
  curriculums: [
    { label: 'صفوف', sql: 'SELECT COUNT(*) FROM grades WHERE curriculum_id = ?' },
    { label: 'مواد', sql: 'SELECT COUNT(*) FROM subjects WHERE curriculum_id = ?' },
    { label: 'متعلّمين', sql: 'SELECT COUNT(*) FROM learners WHERE curriculum_id = ?' },
  ],
  grades: [
    { label: 'متعلّمين', sql: 'SELECT COUNT(*) FROM learners WHERE grade_id = ?' },
    { label: 'معلّمين', sql: 'SELECT COUNT(DISTINCT teacher_id) FROM teacher_subjects WHERE grade_id = ?' },
    { label: 'وحدات منهج', sql: 'SELECT COUNT(*) FROM units WHERE grade_id = ?' },
    { label: 'كتباً', sql: 'SELECT COUNT(*) FROM books WHERE grade_id = ?' },
    { label: 'دورات', sql: 'SELECT COUNT(*) FROM courses WHERE grade_id = ?' },
  ],
  semesters: [
    { label: 'متعلّمين', sql: 'SELECT COUNT(*) FROM learners WHERE semester_id = ?' },
    { label: 'وحدات منهج', sql: 'SELECT COUNT(*) FROM units WHERE semester_id = ?' },
    { label: 'كتباً', sql: 'SELECT COUNT(*) FROM books WHERE semester_id = ?' },
  ],
  subjects: [
    { label: 'متعلّمين', sql: 'SELECT COUNT(*) FROM learner_subjects WHERE subject_id = ?' },
    { label: 'معلّمين', sql: 'SELECT COUNT(DISTINCT teacher_id) FROM teacher_subjects WHERE subject_id = ?' },
    { label: 'وحدات منهج', sql: 'SELECT COUNT(*) FROM units WHERE subject_id = ?' },
    { label: 'كتباً', sql: 'SELECT COUNT(*) FROM books WHERE subject_id = ?' },
    { label: 'دورات', sql: 'SELECT COUNT(*) FROM courses WHERE subject_id = ?' },
    { label: 'حجوزات', sql: 'SELECT COUNT(*) FROM bookings WHERE subject_id = ?' },
  ],
  units: [{ label: 'دروساً', sql: 'SELECT COUNT(*) FROM curriculum_lessons WHERE unit_id = ?' }],
  lessons: [],
};
router.delete('/catalog/:kind/:id', requireRole('admin'), (req, res) => {
  const table = CATALOG_TABLES[req.params.kind]; if (!table) throw notFound();
  const id = idParam(req);
  // الاسم يُقرأ قبل الحذف ليبقى في السجلّ — بعده لا يبقى إلا رقم بلا دلالة
  const row = q.get<{ name?: string; title?: string }>(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw notFound();
  const used = (CATALOG_REFS[req.params.kind] ?? []).map(r => ({ label: r.label, count: n(r.sql, id) })).filter(r => r.count > 0);
  if (used.length) throw conflict(`لا يمكن الحذف: مرتبط بـ ${used.map(u => `${u.count} ${u.label}`).join('، ')}. انقلها أولاً ثم احذف.`);
  try { q.run(`DELETE FROM ${table} WHERE id = ?`, id); }
  catch (err) { if (isConstraint(err)) throw new AppError('conflict', 'لا يمكن الحذف: مرتبط بمحتوى منشور', 409); throw err; }
  clearCatalogCache();
  audit(req, 'catalog.delete', table, id, { name: row.name ?? row.title ?? null });
  res.json({ ok: true });
});

/* ---------- الكوبونات ---------- */
router.get('/coupons', requireRole('finance'), (_req, res) => {
  res.json(q.all<any>('SELECT * FROM coupons ORDER BY id DESC LIMIT 300').map(c => ({ id: c.id, code: c.code, type: c.type, value: c.value, startsAt: c.starts_at, endsAt: c.ends_at, usageLimit: c.usage_limit, userLimit: c.user_limit, usedCount: c.used_count, scope: json(c.scope, {}), active: !!c.active })));
});
router.post('/coupons', requireRole('finance'), validate(CouponUpsert), (req, res) => {
  const c = body<typeof CouponUpsert>(req);
  let id: number;
  try {
    id = Number(q.run('INSERT INTO coupons (code, type, value, starts_at, ends_at, usage_limit, user_limit, scope, created_by, active) VALUES (?,?,?,?,?,?,?,?,?,?)',
      c.code, c.type, c.value, c.startsAt, c.endsAt, c.usageLimit, c.userLimit, JSON.stringify(c.scope), req.user!.id, c.active ? 1 : 0).lastInsertRowid);
  } catch (err) { if (isConstraint(err)) throw new AppError('conflict', 'الرمز مستخدم', 409); throw err; }
  audit(req, 'coupon.create', 'coupons', id, { code: c.code, type: c.type, value: c.value });
  res.status(201).json({ id });
});
/** تعديل الكوبون: جسم كامل بقيود الإنشاء نفسها، أو `{ active }` وحده لتبديل التفعيل */
router.patch('/coupons/:id', requireRole('finance'), (req, res) => {
  const id = idParam(req);
  if (!q.get('SELECT id FROM coupons WHERE id = ?', id)) throw notFound('الكوبون غير موجود');
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.active === 'boolean' && Object.keys(b).length === 1) {
    q.run('UPDATE coupons SET active = ? WHERE id = ?', b.active ? 1 : 0, id);
    audit(req, 'coupon.update', 'coupons', id, { active: b.active });
    return res.json({ ok: true });
  }
  const parsed = CouponUpsert.safeParse(b);
  if (!parsed.success) throw new AppError('validation_error', 'بعض البيانات غير صحيحة', 422, parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  const c = parsed.data;
  try {
    q.run('UPDATE coupons SET code = ?, type = ?, value = ?, starts_at = ?, ends_at = ?, usage_limit = ?, user_limit = ?, scope = ?, active = ? WHERE id = ?',
      c.code, c.type, c.value, c.startsAt, c.endsAt, c.usageLimit, c.userLimit, JSON.stringify(c.scope), c.active ? 1 : 0, id);
  } catch (err) { if (isConstraint(err)) throw new AppError('conflict', 'الرمز مستخدم', 409); throw err; }
  audit(req, 'coupon.update', 'coupons', id, { code: c.code, type: c.type, value: c.value, active: c.active });
  res.json({ ok: true });
});

/* ---------- المستخدمون: القائمة وصفحة الشخص (Person 360) ---------- */
const UsersQuery = Page.extend({ role: Role.optional(), sort: z.enum(['created_desc', 'last_login_desc', 'name']).default('created_desc') });
const USERS_ORDER: Record<z.infer<typeof UsersQuery>['sort'], string> = { created_desc: 'u.created_at DESC, u.id DESC', last_login_desc: 'u.last_login_at IS NULL, u.last_login_at DESC, u.id DESC', name: 'p.display_name COLLATE NOCASE, u.id' };
router.get('/users', requireRole('support'), validate(UsersQuery, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof UsersQuery>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.q) { where.push('(norm(p.display_name) LIKE norm(?) OR u.phone LIKE ? OR u.email LIKE ? OR u.id = ?)'); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, Number(f.q) || 0); }
  if (f.status) { where.push('u.status = ?'); params.push(f.status); }
  if (f.role) { where.push('EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = ?)'); params.push(f.role); }
  const from = `FROM users u JOIN profiles p ON p.user_id = u.id WHERE ${where.join(' AND ')}`;
  const total = n(`SELECT COUNT(*) ${from}`, ...params);
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT u.*, p.display_name, (SELECT COUNT(*) FROM learners l WHERE l.account_id = u.id AND l.archived_at IS NULL) AS learners_count, COALESCE((SELECT balance FROM wallets w WHERE w.user_id = u.id), 0) AS wallet_balance ${from} ORDER BY ${USERS_ORDER[f.sort]} LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({
    data: rows.map(u => ({ id: u.id, name: u.display_name, phone: u.phone, email: u.email, status: u.status, roles: rolesOf(u.id), learnersCount: u.learners_count, walletBalance: money(u.wallet_balance), createdAt: u.created_at, lastLoginAt: u.last_login_at })),
    meta: pageMeta(total, f.page, f.limit),
  });
});
/** بطاقة الشخص — للدعم والمالية (قراءة)؛ الكتابة بأدوارها أدناه */
router.get('/users/:id', requireRole('support', 'finance'), (req, res) => { res.json(personDetail(idParam(req))); });
router.patch('/users/:id/profile', requireRole('admin'), validate(ProfilePatch), (req, res) => {
  const id = idParam(req);
  const b = body<typeof ProfilePatch>(req);
  const u = q.get<any>('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('المستخدم غير موجود');
  requireSuperForStaffTarget(req, id);
  const p = q.get<any>('SELECT * FROM profiles WHERE user_id = ?', id);
  if (b.phone && q.get('SELECT 1 FROM users WHERE phone = ? AND id <> ?', b.phone, id)) throw new AppError('phone_taken', 'رقم الهاتف مستخدم في حساب آخر', 409);
  if (b.email && q.get('SELECT 1 FROM users WHERE email = ? AND id <> ?', b.email, id)) throw new AppError('email_taken', 'البريد مستخدم في حساب آخر', 409);
  const phone = b.phone === undefined ? u.phone : b.phone, email = b.email === undefined ? u.email : b.email;
  if (!phone && !email) throw badRequest('يجب أن يبقى هاتف أو بريد واحد على الأقل');
  const snapshot = (uu: any, pp: any) => ({ displayName: pp?.display_name ?? '', phone: uu.phone ?? null, email: uu.email ?? null, locale: uu.locale, timezone: uu.timezone, gender: pp?.gender ?? null });
  const before = snapshot(u, p);
  try {
    db.transaction(() => {
      q.run('UPDATE users SET phone = ?, email = ?, locale = ?, timezone = ? WHERE id = ?', phone, email, b.locale ?? u.locale, b.timezone ?? u.timezone, id);
      if (b.displayName !== undefined || b.gender !== undefined) {
        q.run('UPDATE profiles SET display_name = ?, gender = ?, updated_at = ? WHERE user_id = ?', b.displayName ?? p?.display_name ?? '', b.gender === undefined ? (p?.gender ?? null) : b.gender, nowIso(), id);
        // الاسم ينعكس على المتعلّم الذاتي الأول كما في PATCH /me
        if (b.displayName !== undefined) q.run('UPDATE learners SET display_name = ?, updated_at = ? WHERE account_id = ? AND is_self = 1 AND position = 0 AND archived_at IS NULL', b.displayName, nowIso(), id);
      }
    })();
  } catch (err) { if (isConstraint(err)) throw new AppError(String((err as Error).message).includes('email') ? 'email_taken' : 'phone_taken', 'البيانات مستخدمة في حساب آخر', 409); throw err; }
  const after = snapshot(q.get<any>('SELECT * FROM users WHERE id = ?', id), q.get<any>('SELECT * FROM profiles WHERE user_id = ?', id));
  audit(req, 'user.profile_update', 'user', id, { before, after }, id);
  res.json(personDetail(id));
});
/** تغيير الحالة: الإيقاف يحتاج سبباً ويُنهي الجلسات؛ الحذف لـ super_admin ويُجري مسح DELETE /me نفسه */
router.post('/users/:id/status', requireRole('admin'), validate(UserStatusChange), (req, res) => {
  const id = idParam(req);
  const b = body<typeof UserStatusChange>(req);
  if (id === req.user!.id) throw new AppError('self_target', 'لا يمكنك تغيير حالة حسابك', 400);
  if (b.status === 'deleted' && !isSuper(req)) throw forbidden('حذف الحسابات لـ super_admin فقط');
  const u = q.get<any>('SELECT id, status FROM users WHERE id = ?', id);
  if (!u) throw notFound('المستخدم غير موجود');
  requireSuperForStaffTarget(req, id);
  if (b.status === 'suspended') {
    q.run("UPDATE users SET status = 'suspended', status_reason = ?, suspended_at = ?, suspended_by = ? WHERE id = ?", b.reason, nowIso(), req.user!.id, id);
    revokeSessions(id, { reason: 'suspended' });
  } else if (b.status === 'active') {
    q.run("UPDATE users SET status = 'active', status_reason = NULL, suspended_at = NULL, suspended_by = NULL WHERE id = ?", id);
  } else {
    scrubAccount(id);
    q.run('UPDATE users SET status_reason = ? WHERE id = ?', b.reason, id);
    emitToUser(id, 'session_revoked', { reason: 'deleted' });
  }
  audit(req, `user.${b.status}`, 'user', id, { reason: b.reason ?? null, previous: u.status }, id);
  res.json(personDetail(id));
});
router.post('/users/:id/roles/grant', requireRole('admin'), validate(RoleChange), (req, res) => {
  const id = idParam(req); userExists(id);
  const b = body<typeof RoleChange>(req);
  const r = applyRoleChanges(req, id, [b.role], []);
  audit(req, 'user.role_grant', 'user', id, { role: b.role, reason: b.reason ?? null, changed: r.granted.length > 0 }, id);
  res.json({ roles: r.roles });
});
router.post('/users/:id/roles/revoke', requireRole('admin'), validate(RoleChange), (req, res) => {
  const id = idParam(req); userExists(id);
  const b = body<typeof RoleChange>(req);
  const r = applyRoleChanges(req, id, [], [b.role]);
  audit(req, 'user.role_revoke', 'user', id, { role: b.role, reason: b.reason ?? null, changed: r.revoked.length > 0 }, id);
  res.json({ roles: r.roles });
});
/** المسار القديم (استبدال كل الأدوار) — يبقى للوحة القديمة؛ الحرّاس نفسها تُطبَّق على الفرق */
router.post('/users/:id/roles', requireExactRole('super_admin'), validate(z.object({ roles: z.array(Role).min(1) })), (req, res) => {
  const id = idParam(req); userExists(id);
  const wanted = [...new Set(req.body.roles as Role[])];
  const current = rolesOf(id);
  const r = applyRoleChanges(req, id, wanted.filter(x => !current.includes(x)), current.filter(x => !wanted.includes(x)));
  q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', id); // تُجدَّد الصلاحيات بجلسة جديدة
  audit(req, 'user.roles', 'user', id, { roles: wanted, granted: r.granted, revoked: r.revoked }, id);
  res.json({ ok: true, roles: r.roles });
});

/* المحفظة */
router.get('/users/:id/wallet', requireRole('finance', 'support'), validate(Page, 'query'), (req, res) => {
  const id = idParam(req); userExists(id);
  const f = req.valid.query as z.infer<typeof Page>;
  const total = n('SELECT COUNT(*) FROM wallet_transactions WHERE user_id = ?', id);
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', id, limit, offset);
  const w = q.get<any>('SELECT balance, currency FROM wallets WHERE user_id = ?', id);
  res.json({
    balance: money(w?.balance ?? 0), currency: w?.currency ?? 'OMR',
    data: rows.map(t => ({ id: t.id, type: t.type, amount: money(t.amount), balanceAfter: money(t.balance_after), refType: t.ref_type ?? null, refId: t.ref_id ?? null, note: t.note ?? null, createdAt: t.created_at })),
    meta: pageMeta(total, f.page, f.limit),
  });
});
/** تعديل الرصيد (D9): المالية/الإدارة فقط، |المبلغ| ≤ ٥٠٠، ملاحظة ≥ ٥ أحرف، مسجَّل ومُبلَّغ للمستخدم */
router.post('/users/:id/wallet/adjust', requireExactRole('finance', 'admin', 'super_admin'), validate(WalletAdjust), (req, res) => {
  const id = idParam(req); userExists(id);
  const b = body<typeof WalletAdjust>(req);
  const balance = wallet.record(id, { type: b.type, amount: b.amount, refType: 'admin', refId: req.user!.id, note: b.note }); // insufficient_funds 400 من الخدمة
  audit(req, 'wallet.adjust', 'wallets', id, { amount: b.amount, type: b.type, note: b.note }, id);
  notify(id, { type: 'wallet_adjusted', title: b.amount > 0 ? 'تمت إضافة رصيد إلى محفظتك' : 'تم خصم رصيد من محفظتك', body: b.note, data: { amount: b.amount } });
  res.json({ balance: money(balance) });
});

/* الامتلاك: الاستحقاقات والتسجيل في الدورات والباقات والاشتراكات (كلّها على مستوى الحساب — D2) */
router.get('/users/:id/entitlements', requireRole('support', 'finance'), (req, res) => {
  const id = idParam(req); userExists(id);
  const entitlements = q.all<any>(`SELECT e.*, o.number AS order_number,
      CASE e.item_type WHEN 'book' THEN (SELECT title FROM books WHERE id = e.item_id) WHEN 'course' THEN (SELECT title FROM courses WHERE id = e.item_id) ELSE (SELECT name FROM plans WHERE id = e.item_id) END AS title
    FROM entitlements e LEFT JOIN orders o ON o.id = e.order_id WHERE e.user_id = ? ORDER BY e.id DESC`, id)
    .map(e => ({ id: e.id, itemType: e.item_type, itemId: e.item_id, title: e.title ?? '', source: e.source, orderNumber: e.order_number ?? null, expiresAt: e.expires_at ?? null, createdAt: e.created_at }));
  // التقدّم في الدورات على مستوى الحساب هذا الإصدار (لا learner_id في course_enrollments) → learner = null
  const enrollments = q.all<any>('SELECT ce.*, c.title FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id WHERE ce.user_id = ? ORDER BY ce.created_at DESC', id)
    .map(e => ({ courseId: e.course_id, title: e.title, learner: null as LearnerRef | null, progressPercent: Number(e.progress_percent) || 0, completedAt: e.completed_at ?? null }));
  const packages = q.all<any>('SELECT pp.*, p.display_name FROM package_purchases pp JOIN profiles p ON p.user_id = pp.teacher_id WHERE pp.user_id = ? ORDER BY pp.id DESC', id)
    .map(p => ({ id: p.id, teacher: { id: p.teacher_id, name: p.display_name }, total: p.total, remaining: p.remaining, expiresAt: p.expires_at ?? null, learner: learnerRefById(p.learner_id) }));
  const subscriptions = q.all<any>('SELECT s.*, pl.name FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.user_id = ? ORDER BY s.id DESC', id)
    .map(s => ({ id: s.id, planName: s.name, status: s.status, expiresAt: s.ends_at ?? null }));
  res.json({ entitlements, enrollments, packages, subscriptions });
});
router.post('/users/:id/grant', requireRole('admin'), validate(EntitlementGrant), (req, res) => {
  const id = idParam(req); userExists(id);
  const b = body<typeof EntitlementGrant>(req);
  if (!q.get(`SELECT 1 FROM ${b.itemType === 'book' ? 'books' : 'courses'} WHERE id = ?`, b.itemId)) throw notFound('المحتوى غير موجود');
  grantAccess(id, b.itemType, b.itemId, { source: 'admin', expiresAt: b.expiresAt ?? null });
  const entId = q.val<number>('SELECT id FROM entitlements WHERE user_id = ? AND item_type = ? AND item_id = ?', id, b.itemType, b.itemId)!;
  audit(req, 'entitlement.grant', 'entitlements', entId, { userId: id, itemType: b.itemType, itemId: b.itemId, expiresAt: b.expiresAt ?? null, note: b.note ?? null }, id);
  res.json({ ok: true, id: entId });
});
router.delete('/users/:id/entitlements/:entId', requireRole('admin'), validate(ReasonBody), (req, res) => {
  const id = idParam(req); const entId = idParam(req, 'entId');
  const b = body<typeof ReasonBody>(req);
  const e = q.get<any>('SELECT * FROM entitlements WHERE id = ? AND user_id = ?', entId, id);
  if (!e) throw notFound('الاستحقاق غير موجود');
  revokeAccess(id, e.item_type, e.item_id);
  audit(req, 'entitlement.revoke', 'entitlements', entId, { itemType: e.item_type, itemId: e.item_id, reason: b.reason }, id);
  res.status(204).end();
});

/* التقييمات */
router.get('/users/:id/reviews', requireRole('support'), (req, res) => {
  const id = idParam(req); userExists(id);
  res.json({
    written: q.all<any>('SELECT * FROM reviews WHERE user_id = ? ORDER BY id DESC', id).map(reviewAdmin),
    received: q.all<any>("SELECT * FROM reviews WHERE target_type = 'teacher' AND target_id = ? ORDER BY id DESC", id).map(reviewAdmin),
  });
});
router.post('/reviews/:id/hide', requireRole('support'), validate(ReasonBody), (req, res) => {
  const id = idParam(req);
  const b = body<typeof ReasonBody>(req);
  const r = q.get<any>('SELECT * FROM reviews WHERE id = ?', id); if (!r) throw notFound();
  q.run("UPDATE reviews SET status = 'hidden', hidden_reason = ?, hidden_by = ? WHERE id = ?", b.reason, req.user!.id, id);
  recomputeRating(r.target_type, r.target_id);
  audit(req, 'review.hide', 'reviews', id, { reason: b.reason }, r.user_id);
  res.json({ ok: true });
});
router.post('/reviews/:id/unhide', requireRole('support'), (req, res) => {
  const id = idParam(req);
  const r = q.get<any>('SELECT * FROM reviews WHERE id = ?', id); if (!r) throw notFound();
  q.run("UPDATE reviews SET status = 'published', hidden_reason = NULL, hidden_by = NULL WHERE id = ?", id);
  recomputeRating(r.target_type, r.target_id);
  audit(req, 'review.unhide', 'reviews', id, null, r.user_id);
  res.json({ ok: true });
});

/* الجلسات والأجهزة */
router.get('/users/:id/sessions', requireRole('support'), (req, res) => {
  const id = idParam(req); userExists(id);
  res.json({
    sessions: q.all<any>('SELECT * FROM refresh_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 50', id)
      .map(s => ({ id: s.id, device: s.device || null, ip: s.ip ?? null, createdAt: s.created_at, expiresAt: new Date(s.expires_at * 1000).toISOString(), revoked: !!s.revoked })),
    devices: q.all<any>('SELECT id, platform, token, created_at FROM device_tokens WHERE user_id = ? ORDER BY id DESC', id)
      .map(d => ({ id: d.id, platform: d.platform, tokenSuffix: String(d.token).slice(-6), createdAt: d.created_at })),
  });
});
router.post('/users/:id/sessions/revoke', requireRole('support'), validate(SessionRevoke), (req, res) => {
  const id = idParam(req); userExists(id); requireSuperForStaffTarget(req, id);
  const b = body<typeof SessionRevoke>(req);
  revokeSessions(id, { sessionId: b.sessionId ?? null, deviceTokens: b.deviceTokens, reason: 'force_logout' });
  audit(req, 'user.force_logout', 'user', id, { sessionId: b.sessionId ?? null, deviceTokens: b.deviceTokens }, id);
  res.status(204).end();
});

/* المتعلّمون نيابةً عن الحساب — الخدمة نفسها التي تخدم /me/learners وتسجّل learner.* مع target_user_id */
router.post('/users/:id/learners', requireRole('support'), validate(LearnerUpsert), (req, res) => {
  const id = idParam(req); userExists(id);
  createLearner(id, body<typeof LearnerUpsert>(req), { req, adminTarget: true }); // يسجّل audit learner.create
  res.status(201).json(personDetail(id));
});
router.patch('/users/:id/learners/:lid', requireRole('support'), validate(LearnerPatch), (req, res) => {
  const id = idParam(req); userExists(id);
  updateLearner(id, idParam(req, 'lid'), body<typeof LearnerPatch>(req), req); // يسجّل audit learner.update
  res.json(personDetail(id));
});
router.delete('/users/:id/learners/:lid', requireRole('support'), (req, res) => {
  const id = idParam(req); userExists(id);
  archiveLearner(id, idParam(req, 'lid'), req); // يسجّل audit learner.archive
  res.json(personDetail(id));
});
router.post('/users/:id/learners/:lid/activate', requireRole('support'), (req, res) => {
  const id = idParam(req); userExists(id);
  const lid = idParam(req, 'lid');
  activateLearner(id, lid);
  audit(req, 'learner.activate', 'learners', lid, null, id);
  res.json(personDetail(id));
});

/* ---------- البلاغات والسجلّ ---------- */
/** عنوان هدف البلاغ وصاحبه (لصفحة الشخص: «ضدّه») */
function reportTarget(type: string, id: number): { label: string; ownerId: number | null } {
  switch (type) {
    case 'user': return { label: nameOf(id), ownerId: id };
    case 'message': { const m = q.get<any>('SELECT sender_id, body FROM messages WHERE id = ?', id); return { label: excerpt(m?.body), ownerId: m?.sender_id ?? null }; }
    case 'book': { const b = q.get<any>('SELECT author_id, title FROM books WHERE id = ?', id); return { label: b?.title ?? '', ownerId: b?.author_id ?? null }; }
    case 'course': { const c = q.get<any>('SELECT teacher_id, title FROM courses WHERE id = ?', id); return { label: c?.title ?? '', ownerId: c?.teacher_id ?? null }; }
    case 'review': { const r = q.get<any>('SELECT user_id, comment FROM reviews WHERE id = ?', id); return { label: excerpt(r?.comment), ownerId: r?.user_id ?? null }; }
    default: return { label: '', ownerId: null };
  }
}
const ReportsQuery = z.object({ status: z.string().max(40).default('open'), reporterId: IdQ.optional(), targetType: z.enum(['user', 'message', 'book', 'course', 'review']).optional(), targetId: IdQ.optional() });
router.get('/reports', requireRole('support'), validate(ReportsQuery, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof ReportsQuery>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.status !== 'all') { where.push('r.status = ?'); params.push(f.status); }
  if (f.reporterId) { where.push('r.reporter_id = ?'); params.push(f.reporterId); }
  if (f.targetType) { where.push('r.target_type = ?'); params.push(f.targetType); }
  if (f.targetId) { where.push('r.target_id = ?'); params.push(f.targetId); }
  res.json(q.all<any>(`SELECT r.*, p.display_name AS reporter FROM reports r JOIN profiles p ON p.user_id = r.reporter_id WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT 200`, ...params)
    .map(r => { const t = reportTarget(r.target_type, r.target_id); return { ...r, reporterId: r.reporter_id, targetType: r.target_type, targetId: r.target_id, targetLabel: t.label, targetOwnerId: t.ownerId, handledBy: brief(r.handled_by), createdAt: r.created_at }; }));
});
router.post('/reports/:id/status', requireRole('support'), validate(z.object({ status: z.enum(['reviewing', 'resolved', 'dismissed']) })), (req, res) => {
  const id = idParam(req);
  const r = q.get<any>('SELECT * FROM reports WHERE id = ?', id); if (!r) throw notFound();
  q.run('UPDATE reports SET status = ?, handled_by = ? WHERE id = ?', req.body.status, req.user!.id, id);
  audit(req, 'report.status', 'reports', id, req.body, reportTarget(r.target_type, r.target_id).ownerId);
  res.json({ ok: true });
});
const AuditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(500).default(100),
  actorId: IdQ.optional(), targetUserId: IdQ.optional(), entity: z.string().max(40).optional(), entityId: z.coerce.number().int().optional(),
  action: z.string().max(80).optional(), from: z.string().max(40).optional(), to: z.string().max(40).optional(),
});
router.get('/audit', requireRole('admin'), validate(AuditQuery, 'query'), (req, res) => {
  const f = req.valid.query as z.infer<typeof AuditQuery>;
  const where = ['1=1']; const params: unknown[] = [];
  if (f.actorId) { where.push('a.actor_id = ?'); params.push(f.actorId); }
  if (f.targetUserId) { where.push('a.target_user_id = ?'); params.push(f.targetUserId); }
  if (f.entity) { where.push('a.entity = ?'); params.push(f.entity); }
  if (f.entityId !== undefined) { where.push('a.entity_id = ?'); params.push(f.entityId); }
  if (f.action) { where.push("a.action LIKE ? || '%'"); params.push(f.action); }
  // datetime() يوحّد صيغتي created_at (datetime('now') و ISO) قبل المقارنة؛ تاريخ فقط في «إلى» يعني نهاية ذلك اليوم
  if (f.from) { where.push('datetime(a.created_at) >= datetime(?)'); params.push(f.from); }
  if (f.to) { where.push('datetime(a.created_at) <= datetime(?)'); params.push(f.to.length === 10 ? `${f.to} 23:59:59` : f.to); }
  const from = `FROM audit_logs a LEFT JOIN profiles p ON p.user_id = a.actor_id LEFT JOIN profiles t ON t.user_id = a.target_user_id WHERE ${where.join(' AND ')}`;
  const total = n(`SELECT COUNT(*) ${from}`, ...params);
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT a.*, p.display_name AS actor, t.display_name AS target_name ${from} ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({
    data: rows.map(a => ({ ...a, meta: json(a.meta, null), actorId: a.actor_id ?? null, entityId: a.entity_id ?? null, targetUserId: a.target_user_id ?? null, targetName: a.target_name ?? null, createdAt: a.created_at })),
    meta: pageMeta(total, f.page, f.limit),
  });
});

export default router;
