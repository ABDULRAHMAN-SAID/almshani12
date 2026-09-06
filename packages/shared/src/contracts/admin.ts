import { z } from 'zod';
import { Id, IsoDateTime, PageMeta } from './common';
import { Role, Learner, LearnerRef, LearnerUpsert, LearnerPatch } from './auth';
import type { BookingStatus } from './bookings';

/**
 * لوحة الإدارة — صفحة الشخص (Person 360) وصفحة المعلّم (Teacher 360) والنظرة الحيّة.
 * الخادم يتحقّق من الأجسام بهذه المخطّطات، ولوحة الإدارة تستورد الأنواع.
 */

/* ---------- أجسام الطلبات ---------- */
export const WalletAdjust = z.object({
  amount: z.number().refine(a => a !== 0 && Math.abs(a) <= 500, 'المبلغ بين -٥٠٠ و ٥٠٠ وغير صفري'),
  type: z.enum(['adjustment', 'bonus']).default('adjustment'),
  note: z.string().trim().min(5).max(200),
});
export type WalletAdjust = z.infer<typeof WalletAdjust>;

export const RoleChange = z.object({ role: Role, reason: z.string().trim().max(200).optional() });
export type RoleChange = z.infer<typeof RoleChange>;

export const UserStatusChange = z.object({
  status: z.enum(['active', 'suspended', 'deleted']),
  reason: z.string().trim().min(3).max(300).optional(),
}).refine(b => b.status === 'active' || !!b.reason, { message: 'السبب مطلوب', path: ['reason'] });
export type UserStatusChange = z.infer<typeof UserStatusChange>;

export const ProfilePatch = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  phone: z.string().trim().regex(/^\+\d{8,15}$/).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  locale: z.enum(['ar', 'en']).optional(), timezone: z.string().max(60).optional(),
  gender: z.enum(['male', 'female']).nullable().optional(),
});
export type ProfilePatch = z.infer<typeof ProfilePatch>;

export const EntitlementGrant = z.object({
  itemType: z.enum(['book', 'course']), itemId: Id,
  expiresAt: IsoDateTime.nullable().optional(), note: z.string().max(200).optional(),
});
export type EntitlementGrant = z.infer<typeof EntitlementGrant>;

export const ReasonBody = z.object({ reason: z.string().trim().min(3).max(300) });
export type ReasonBody = z.infer<typeof ReasonBody>;

export const SessionRevoke = z.object({ sessionId: Id.optional(), deviceTokens: z.boolean().default(true) });
export type SessionRevoke = z.infer<typeof SessionRevoke>;

export const TeacherDocumentDecision = z.object({ decision: z.enum(['accepted', 'rejected']), note: z.string().trim().max(300).optional() });
export type TeacherDocumentDecision = z.infer<typeof TeacherDocumentDecision>;

export const TeacherPatch = z.object({
  commissionRate: z.number().min(0).max(0.6).optional(), headline: z.string().trim().max(120).optional(),
  specialty: z.string().trim().max(120).optional(), yearsExp: z.number().int().min(0).max(60).optional(),
  reason: z.string().trim().min(3).max(200),
});
export type TeacherPatch = z.infer<typeof TeacherPatch>;

export const AdminLearnerUpsert = LearnerUpsert;
export const AdminLearnerPatch = LearnerPatch;

/** حالة النظام (GET /admin/system) — قراءة فقط، بلا أسرار */
export const SystemInfo = z.object({
  publicUrl: z.string(), env: z.string(), schemaVersion: z.number().int(),
  otp: z.object({
    phone: z.boolean(), whatsapp: z.boolean(), email: z.boolean(), testCode: z.boolean(),
    smsProvider: z.enum(['twilio_verify', 'twilio', 'http', 'log']), emailProvider: z.enum(['smtp', 'resend', 'log']),
    allowedCountries: z.array(z.string()), testTargets: z.number().int(),
  }),
  payments: z.object({ providers: z.array(z.string()) }),
  rooms: z.object({ provider: z.string(), turn: z.boolean() }),
  bootstrap: z.object({ allowDemoSeed: z.boolean(), adminPhone: z.boolean() }),
});
export type SystemInfo = z.infer<typeof SystemInfo>;

export const OverviewQuery = z.object({ days: z.coerce.number().int().refine(d => [7, 14, 30, 90].includes(d), 'المدى ٧ أو ١٤ أو ٣٠ أو ٩٠ يوماً').default(14) });
export type OverviewQuery = z.infer<typeof OverviewQuery>;

/* ---------- أشكال الاستجابات (بمخطّطات) ---------- */
const PersonBrief = z.object({ id: Id, name: z.string() });
export type PersonBrief = z.infer<typeof PersonBrief>;

export const PersonDetail = z.object({
  id: Id, phone: z.string().nullable(), email: z.string().nullable(),
  status: z.enum(['active', 'suspended', 'deleted']), statusReason: z.string().nullable(),
  suspendedAt: IsoDateTime.nullable(), suspendedBy: PersonBrief.nullable(),
  locale: z.string(), timezone: z.string(), onboardingCompleted: z.boolean(), createdAt: IsoDateTime, lastLoginAt: IsoDateTime.nullable(),
  profile: z.object({ displayName: z.string(), avatarUrl: z.string().nullable(), gender: z.enum(['male', 'female']).nullable(), bio: z.string().nullable(), countryCode: z.string() }),
  roles: z.array(z.object({ role: Role, grantedBy: PersonBrief.nullable(), createdAt: IsoDateTime })),
  /** providerUid مقنَّع: أول ٣ أحرف + *** */
  identities: z.array(z.object({ provider: z.string(), providerUid: z.string(), createdAt: IsoDateTime })),
  /** يشمل المؤرشفين (archivedAt) */
  learners: z.array(Learner.extend({ bookingsCount: z.number().int() })),
  activeLearnerId: Id.nullable(),
  teacher: z.object({ status: z.string(), commissionRate: z.number(), ratingAvg: z.number(), ratingCount: z.number().int(), lessonsCount: z.number().int(),
    availableBalance: z.number(), pendingBalance: z.number(), lifetimeEarnings: z.number(), verifiedAt: IsoDateTime.nullable() }).nullable(),
  wallet: z.object({ balance: z.number(), currency: z.string() }),
  counts: z.object({ orders: z.number().int(), bookings: z.number().int(), entitlements: z.number().int(), reviews: z.number().int(),
    reportsFiled: z.number().int(), reportsAgainst: z.number().int(), devices: z.number().int(), activeSessions: z.number().int(), unreadNotifications: z.number().int() }),
});
export type PersonDetail = z.infer<typeof PersonDetail>;

export const WalletTx = z.object({ id: Id, type: z.string(), amount: z.number(), balanceAfter: z.number(), refType: z.string().nullable(), refId: z.number().nullable(), note: z.string().nullable(), createdAt: IsoDateTime });
export type WalletTx = z.infer<typeof WalletTx>;

export const ReviewAdmin = z.object({ id: Id, targetType: z.string(), targetId: Id, targetTitle: z.string(), rating: z.number().int(), comment: z.string().nullable(),
  status: z.enum(['published', 'hidden']), hiddenReason: z.string().nullable(), createdAt: IsoDateTime, author: PersonBrief });
export type ReviewAdmin = z.infer<typeof ReviewAdmin>;

export const SessionRow = z.object({ id: Id, device: z.string().nullable(), ip: z.string().nullable(), createdAt: IsoDateTime, expiresAt: IsoDateTime, revoked: z.boolean() });
export type SessionRow = z.infer<typeof SessionRow>;

export const DeviceRow = z.object({ id: Id, platform: z.string(), tokenSuffix: z.string(), createdAt: IsoDateTime });
export type DeviceRow = z.infer<typeof DeviceRow>;

/** learner.id سالب (= -account id) للحجوزات القديمة بلا متعلّم */
export const TeacherStudentRow = z.object({ learner: LearnerRef.extend({ id: z.number().int() }), account: PersonBrief, lessons: z.number().int(), lastAt: IsoDateTime.nullable() });
export type TeacherStudentRow = z.infer<typeof TeacherStudentRow>;

export type PageMetaT = z.infer<typeof PageMeta>;

/* ---------- أشكال الاستجابات (أنواع فقط — بلا تحقّق وقت التشغيل) ---------- */

/** صفّ قائمة المستخدمين GET /admin/users */
export interface AdminUserRow {
  id: number; name: string; phone: string | null; email: string | null; status: 'active' | 'suspended' | 'deleted'; roles: Role[];
  learnersCount: number; walletBalance: number; createdAt: string; lastLoginAt: string | null;
}

/** GET /admin/users/:id/wallet */
export interface PersonWallet { balance: number; currency: string; data: WalletTx[]; meta: PageMetaT }

/** GET /admin/users/:id/entitlements */
export interface PersonEntitlements {
  entitlements: { id: number; itemType: string; itemId: number; title: string; source: string; orderNumber: string | null; expiresAt: string | null; createdAt: string }[];
  enrollments: { courseId: number; title: string; learner: LearnerRef | null; progressPercent: number; completedAt: string | null }[];
  packages: { id: number; teacher: PersonBrief; total: number; remaining: number; expiresAt: string | null; learner: LearnerRef | null }[];
  subscriptions: { id: number; planName: string; status: string; expiresAt: string | null }[];
}

/** GET /admin/users/:id/sessions */
export interface PersonSessions { sessions: SessionRow[]; devices: DeviceRow[] }

/** GET /admin/audit صفّ */
export interface AuditRow {
  id: number; actorId: number | null; actor: string | null; action: string; entity: string | null; entityId: number | null;
  meta: unknown; ip: string | null; targetUserId: number | null; targetName: string | null; createdAt: string;
}

/** صفّ قائمة المعلّمين GET /admin/teachers */
export interface TeacherAdminRow {
  id: number; name: string; avatarUrl: string | null; phone: string | null; email: string | null; headline: string | null; specialty: string | null; yearsExp: number;
  status: string; appliedAt: string | null; ratingAvg: number; ratingCount: number; lessonsCount: number; studentsCount: number; availableBalance: number; commissionRate: number;
}

/** GET /admin/teachers/:id */
export interface TeacherAdminDetail {
  id: number; userId: number; name: string; avatarUrl: string | null; gender: 'male' | 'female' | null; phone: string | null; email: string | null; userStatus: string;
  headline: string | null; bio: string | null; qualification: string | null; specialty: string | null; yearsExp: number; languages: string[]; teachingStyle: string[];
  status: string; commissionRate: number; appliedAt: string | null; verifiedAt: string | null;
  ratingAvg: number; ratingCount: number; studentsCount: number; lessonsCount: number;
  /** للمالية والإدارة فقط — وإلا null */
  payoutMethod: string | null; payoutDetails: unknown | null;
  subjects: { subjectId: number; gradeId: number; subject: string; grade: string }[];
  prices: { durationMinutes: number; mode: string; price: number }[];
  packages: { id: number; lessonsCount: number; durationMinutes: number; mode: string; price: number; active: boolean }[];
  availability: { id: number; weekday: number; startTime: string; endTime: string; slotMinutes: number; breakMinutes: number }[];
  timeOff: { id: number; from: string; to: string; reason: string | null }[];
  documents: { id: number; type: string; status: string; note: string | null; mime: string; name: string | null; url: string; reviewedBy: PersonBrief | null; reviewedAt: string | null; createdAt: string }[];
  history: { decision: string; reason: string | null; decided_at: string; reviewer: string | null }[];
  content: { books: { id: number; title: string; status: string; price: number; updatedAt: string }[]; courses: { id: number; title: string; status: string; price: number; updatedAt: string }[] };
  stats: {
    bookings: { total: number; completed: number; cancelledByTeacher: number; noShow: number; disputed: number; upcoming: number };
    earnings: { lifetime: number; available: number; pending: number };
    reviews: { avg: number; count: number; hidden: number };
  };
}

/** GET /admin/teachers/:id/earnings */
export interface TeacherEarningRow { id: number; source: string; refId: number; gross: number; commission: number; net: number; status: string; availableAt: string | null; payoutId: number | null; createdAt: string }
export interface TeacherEarningsAdmin { data: TeacherEarningRow[]; meta: PageMetaT; totals: { gross: number; commission: number; net: number } }

/** صفّ GET /admin/bookings — bookingView + حقول الإدارة */
export interface AdminBooking {
  id: number; status: BookingStatus; mode: string; durationMinutes: number; startsAt: string; endsAt: string; price: number;
  subject: { id: number; name: string; colorKey: string };
  teacher: { id: number; name: string; avatarUrl: string | null; verified: boolean };
  student: { id: number; name: string; avatarUrl: string | null; verified: boolean };
  learner: LearnerRef | null;
  orderId: number | null; packagePurchaseId: number | null; cancelReason: string | null; refundPercent: number | null; note: string | null; expiresAt: string | null;
  createdAt: string;
  [extra: string]: unknown;
}

/** صفّ GET /admin/orders — orderView + حقول الإدارة */
export interface AdminOrder {
  id: number; number: string; status: string; subtotal: number; discount: number; tax: number; total: number; currency: string; provider: string | null;
  items: { itemType: string; itemId: number; title: string; unitPrice: number; quantity: number }[]; createdAt: string; paidAt: string | null;
  userName: string; userId: number; providerRef: string | null; learner: LearnerRef | null;
  payments: { provider: string; status: string; amount: number; providerRef: string | null; createdAt: string }[];
  refunds: { amount: number; reason: string | null; createdAt: string }[];
  [extra: string]: unknown;
}

/** صفّ GET /admin/reports */
export interface AdminReport {
  id: number; reporterId: number; reporter: string; targetType: string; targetId: number; targetLabel: string; targetOwnerId: number | null;
  reason: string; status: string; handledBy: PersonBrief | null; createdAt: string;
  [extra: string]: unknown;
}

/** GET /admin/overview?days= */
export interface Overview {
  users: { total: number; students: number; parents: number; learners: number; learnersByGrade: { gradeId: number; gradeName: string; count: number }[]; newThisMonth: number; newToday: number; activeUsers24h: number };
  teachers: Record<string, number>;
  bookings: { today: number; pendingPayment: number; disputed: number };
  revenue: { month: number; commissionMonth: number; refundsMonth: number };
  live: {
    lessonsInProgress: number; lessonsNextHour: number; connectedSockets: number; pendingPaymentBookings: number; openDisputes: number; openReports: number;
    walletLiability: number; teacherPayable: { available: number; pending: number }; gmvToday: number; refundsToday: number;
    inProgress: { id: number; teacherName: string; learnerName: string; startsAt: string; endsAt: string }[];
  };
  series: { days: string[]; revenue: number[]; refunds: number[]; bookings: number[]; completed: number[]; newUsers: number[]; newLearners: number[] };
  breakdown: {
    revenueByItemType: Record<'lesson' | 'book' | 'course' | 'package' | 'subscription', number>;
    ordersByProvider: Record<string, number>;
    bookingsByStatus: Record<BookingStatus, number>;
    contentByStatus: { books: Record<string, number>; courses: Record<string, number> };
  };
  top: { teachers: { id: number; name: string; lessons: number; revenue: number }[]; subjects: { id: number; name: string; lessons: number }[] };
  queues: { teacherApplications: number; contentReview: number; manualPayments: number; payouts: number; reports: number; disputes: number; pendingDocuments: number };
  reports: number;
  generatedAt: string;
}
