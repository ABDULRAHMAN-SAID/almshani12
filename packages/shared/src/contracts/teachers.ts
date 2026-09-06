import { z } from 'zod';
import { Id, Money, IsoDateTime, HHmm, PageQuery } from './common';
import { SubjectRef, GradeRef } from './catalog';
import { BookCard, ReviewItem } from './books';
import { CourseCard } from './courses';
import { VerificationStatus } from './auth';

export const LessonMode = z.enum(['individual', 'group']);
export type LessonMode = z.infer<typeof LessonMode>;
export const LessonDuration = z.union([z.literal(30), z.literal(45), z.literal(60)]);

export const TeacherCard = z.object({
  id: Id,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  verified: z.boolean(),
  headline: z.string().nullable(),
  subjects: z.array(SubjectRef),
  yearsExp: z.number().int(),
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
  studentsCount: z.number().int(),
  priceFrom: Money,
  nextSlotAt: IsoDateTime.nullable(),
  availableNow: z.boolean(),
  modes: z.array(LessonMode),
  favorited: z.boolean(),
});
export type TeacherCard = z.infer<typeof TeacherCard>;

export const LessonPrice = z.object({ durationMinutes: LessonDuration, mode: LessonMode, price: Money });
export const LessonPackage = z.object({
  id: Id,
  lessonsCount: z.number().int(),
  durationMinutes: LessonDuration,
  mode: LessonMode,
  price: Money,
  /** السعر الأصلي لو اشتُريت الحصص منفردة — لعرض التوفير */
  listPrice: Money,
  savePercent: z.number().int(),
});

export const TeacherProfile = TeacherCard.extend({
  bio: z.string(),
  lessonsCount: z.number().int(),
  grades: z.array(GradeRef),
  teachingStyle: z.array(z.string()),
  languages: z.array(z.string()),
  prices: z.array(LessonPrice),
  packages: z.array(LessonPackage),
  courses: z.array(CourseCard),
  books: z.array(BookCard),
  reviews: z.array(ReviewItem),
  canReview: z.boolean(),
  /** أول ٧ أيام من التوفّر كملخّص للعرض */
  availabilityPreview: z.array(z.object({ date: z.string(), slotsCount: z.number().int() })),
  /** شريط الأرقام: الطلاب = متعلّمون متمايزون في حصص مكتملة */
  stats: z.object({ studentsCount: z.number().int(), lessonsCount: z.number().int(), ratingCount: z.number().int(), yearsExp: z.number().int() }),
  /** قواعد التوفّر الأسبوعية (بلا مدد الخانات) */
  availabilityRules: z.array(z.object({ weekday: z.number().int().min(0).max(6), startTime: HHmm, endTime: HHmm })),
  /** الإجازات المتقاطعة مع الـ٣٠ يوماً القادمة — بلا أسباب */
  timeOff: z.array(z.object({ from: IsoDateTime, to: IsoDateTime })),
});
export type TeacherProfile = z.infer<typeof TeacherProfile>;

export const TeachersQuery = PageQuery.extend({
  q: z.string().trim().max(120).optional(),
  subjectId: z.coerce.number().int().optional(),
  gradeId: z.coerce.number().int().optional(),
  maxPrice: z.coerce.number().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  availableNow: z.coerce.boolean().optional(),
  mode: LessonMode.optional(),
  gender: z.enum(['male', 'female']).optional(),
  language: z.string().max(10).optional(),
  minYearsExp: z.coerce.number().int().optional(),
  sort: z.enum(['recommended', 'rating', 'price_asc', 'soonest']).default('recommended'),
});

/* ---------- التوفّر والمواعيد ---------- */
export const TimeSlot = z.object({ startsAt: IsoDateTime, endsAt: IsoDateTime, available: z.boolean() });
export type TimeSlot = z.infer<typeof TimeSlot>;
export const DayAvailability = z.object({ date: z.string(), slots: z.array(TimeSlot) });
export type DayAvailability = z.infer<typeof DayAvailability>;
export const AvailabilityQuery = z.object({
  from: z.string().min(10),
  days: z.coerce.number().int().min(1).max(30).default(14),
  durationMinutes: z.coerce.number().int().default(60),
});

export const AvailabilityRule = z.object({
  weekday: z.number().int().min(0).max(6),  // 0 = الأحد
  startTime: HHmm,
  endTime: HHmm,
  slotMinutes: z.number().int().min(15).max(120).default(60),
  breakMinutes: z.number().int().min(0).max(60).default(0),
});
export const AvailabilityRules = z.array(AvailabilityRule).max(21);

export const TimeOff = z.object({
  id: Id.optional(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  reason: z.string().trim().max(120).nullable().optional(),
});

/* ---------- طلب الانضمام كمعلّم ---------- */
export const TeacherDocumentType = z.enum(['id', 'degree', 'certificate', 'photo', 'other']);
export const TeacherApplication = z.object({
  displayName: z.string().trim().min(2).max(60),
  headline: z.string().trim().min(5).max(120),
  bio: z.string().trim().min(30).max(2000),
  yearsExp: z.number().int().min(0).max(60),
  qualification: z.string().trim().min(2).max(160),
  specialty: z.string().trim().min(2).max(120),
  subjectIds: z.array(Id).min(1).max(8),
  gradeIds: z.array(Id).min(1).max(12),
  prices: z.array(LessonPrice).min(1),
  languages: z.array(z.string().max(10)).min(1),
  gender: z.enum(['male', 'female']).optional(),
  documents: z.array(z.object({ type: TeacherDocumentType, fileId: Id })).min(1),
});
export type TeacherApplication = z.infer<typeof TeacherApplication>;

export const TeacherVerificationDecision = z.object({
  decision: z.enum(['under_review', 'verified', 'rejected', 'suspended']),
  reason: z.string().trim().max(500).nullable().optional(),
  commissionRate: z.number().min(0).max(0.9).optional(),
});

export const TeacherDashboard = z.object({
  verificationStatus: VerificationStatus,
  monthIncome: Money,
  todayLessons: z.number().int(),
  upcomingLessons: z.number().int(),
  studentsCount: z.number().int(),
  ratingAvg: z.number(),
  availableBalance: Money,
  booksSold: z.number().int(),
  coursesSold: z.number().int(),
  pendingHomeworkReviews: z.number().int(),
});

export const TeacherEarnings = z.object({
  gross: Money, commission: Money, net: Money,
  pending: Money, available: Money, paid: Money,
  breakdown: z.object({ lessons: Money, books: Money, courses: Money }),
  commissionRate: z.number(),
  minPayout: Money,
  payouts: z.array(z.object({
    id: Id, amount: Money, status: z.enum(['pending', 'approved', 'paid', 'rejected']),
    requestedAt: IsoDateTime, processedAt: IsoDateTime.nullable(),
  })),
});
