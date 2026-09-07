import { z } from 'zod';
import { Id, Money, IsoDateTime } from './common';
import { SubjectRef } from './catalog';
import { LessonMode, LessonDuration } from './teachers';
import { LearnerRef } from './auth';

export const BookingStatus = z.enum([
  'pending_payment', 'confirmed', 'in_progress', 'completed',
  'cancelled_by_student', 'cancelled_by_teacher', 'no_show', 'disputed', 'expired',
]);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const CreateBooking = z.object({
  teacherId: Id,
  subjectId: Id,
  mode: LessonMode,
  durationMinutes: LessonDuration,
  startsAt: IsoDateTime,
  /** استخدام حصة من باقة مشتراة بدل الدفع */
  packagePurchaseId: Id.nullable().optional(),
  couponCode: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  /** لمن الحصة؟ وإلا المتعلّم النشط (ترويسة X-Learner-Id ثم users.active_learner_id ثم الافتراضي) */
  learnerId: Id.optional(),
});
export type CreateBooking = z.infer<typeof CreateBooking>;

/** استعلام تبويب الحصص: as=teacher لحصص المعلّم؛ learnerId يرشّح حصص متعلّم واحد (بلاه: كل المتعلّمين) */
export const LessonsQuery = z.object({
  as: z.enum(['student', 'teacher']).optional(),
  learnerId: z.coerce.number().int().positive().optional(),
});
export type LessonsQuery = z.infer<typeof LessonsQuery>;

export const PersonRef = z.object({ id: Id, name: z.string(), avatarUrl: z.string().nullable(), verified: z.boolean().optional() });

export const Booking = z.object({
  id: Id,
  status: BookingStatus,
  mode: LessonMode,
  durationMinutes: z.number().int(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  price: Money,
  subject: SubjectRef,
  teacher: PersonRef,
  student: PersonRef,
  /** المتعلّم صاحب الحصة — LearnerRef فقط (null للحجوزات القديمة التي سبقت المتعلّمين) */
  learner: LearnerRef.nullable(),
  /** متى يُسمَح بالدخول (قبل الموعد بمدّة من الإعدادات) */
  roomOpensAt: IsoDateTime,
  canJoin: z.boolean(),
  canCancel: z.boolean(),
  canReschedule: z.boolean(),
  /** نسبة الاسترجاع لو أُلغي الآن — من سياسة الإلغاء */
  cancelRefundPercent: z.number().int().min(0).max(100),
  /** للطالب: هل انتهت الحصة ولم يقيّم بعد */
  needsReview: z.boolean(),
  notes: z.object({
    summary: z.string().nullable(),
    homework: z.string().nullable(),
    attachments: z.array(z.object({ name: z.string(), url: z.string() })),
  }).nullable(),
  attendance: z.object({
    studentSeconds: z.number().int(),
    teacherSeconds: z.number().int(),
    studentJoinedAt: IsoDateTime.nullable(),
    teacherJoinedAt: IsoDateTime.nullable(),
  }).nullable(),
  createdAt: IsoDateTime,
});
export type Booking = z.infer<typeof Booking>;

export const BookingCreated = z.object({
  booking: Booking,
  /** إن لم تُستخدَم باقة: طلب دفع يُكمَل خلال دقائق محدودة */
  paymentRequired: z.boolean(),
  orderNumber: z.string().nullable(),
  checkoutUrl: z.string().nullable(),
  expiresAt: IsoDateTime.nullable(),
});

/** قواعد مرتّبة تنازلياً وقت التطبيق: ساعات فريدة (وإلّا صارت القاعدة المطبَّقة ملتبسة) وقاعدة صفر كحدّ أدنى */
export const CancellationPolicy = z.array(z.object({
  /** «قبل أكثر من X ساعة» */
  hoursBefore: z.number().int().min(0),
  refundPercent: z.number().int().min(0).max(100),
})).min(1)
  .refine(p => new Set(p.map(r => r.hoursBefore)).size === p.length, { message: 'لا تكرّر عدد الساعات في أكثر من قاعدة' })
  .refine(p => p.some(r => r.hoursBefore === 0), { message: 'أضِف قاعدة بصفر ساعات كحدّ أدنى' });
export type CancellationPolicy = z.infer<typeof CancellationPolicy>;

export const CancelBooking = z.object({ reason: z.string().trim().max(300).nullable().optional() });
export const RescheduleBooking = z.object({ startsAt: IsoDateTime });

export const LessonsFeed = z.object({
  upcoming: z.object({
    today: z.array(Booking), tomorrow: z.array(Booking), thisWeek: z.array(Booking), later: z.array(Booking),
  }),
  past: z.array(Booking),
  packages: z.array(z.object({
    id: Id, teacher: PersonRef, lessonsCount: z.number().int(), remaining: z.number().int(),
    durationMinutes: z.number().int(), mode: LessonMode, expiresAt: IsoDateTime.nullable(),
    /** null = لأي متعلّم في الحساب */
    learnerId: Id.nullable(),
  })),
  /** متعلّمو الحساب — لشرائح الترشيح (فارغة في عرض المعلّم as=teacher) */
  learners: z.array(LearnerRef),
});
export type LessonsFeed = z.infer<typeof LessonsFeed>;

/* ---------- الغرفة المباشرة ---------- */
export const RoomAccess = z.object({
  provider: z.enum(['internal', 'livekit', 'daily', 'agora']),
  roomId: z.string(),
  token: z.string(),
  expiresAt: IsoDateTime,
  joinUrl: z.string().nullable(),
  /** خادم Socket.IO للدردشة والحضور — دائماً */
  realtimeNamespace: z.string(),
  isHost: z.boolean(),
  booking: Booking,
  /** خوادم STUN/TURN للفيديو المباشر — يقرّرها الخادم لا التطبيق */
  iceServers: z.array(z.object({ urls: z.union([z.string(), z.array(z.string())]), username: z.string().optional(), credential: z.string().optional() })).optional(),
});
export type RoomAccess = z.infer<typeof RoomAccess>;

export const PostLessonNotes = z.object({
  summary: z.string().trim().max(3000).nullable(),
  homework: z.string().trim().max(3000).nullable(),
  attachmentFileIds: z.array(Id).max(10).default([]),
  suggestNext: z.boolean().default(false),
});
