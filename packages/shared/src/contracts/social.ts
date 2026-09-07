import { z } from 'zod';
import { Id, IsoDateTime } from './common';

export const ReviewTarget = z.enum(['teacher', 'book', 'course']);
export const CreateReview = z.object({
  targetType: ReviewTarget,
  targetId: Id,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1500).nullable().optional(),
  /** الحجز أو الطلب الذي يثبت التجربة — الخادم يتحقّق منه */
  gateRef: Id.nullable().optional(),
});

export const FavoriteTarget = z.enum(['book', 'course', 'teacher']);
export const FavoriteToggle = z.object({ targetType: FavoriteTarget, targetId: Id });

export const NotificationType = z.enum([
  'lesson_in_1h', 'lesson_in_15m', 'booking_confirmed', 'booking_cancelled_by_teacher',
  'refund_processed', 'book_published', 'favorite_discount', 'new_course_from_teacher',
  'message', 'homework', 'teacher_verified', 'teacher_rejected', 'content_approved', 'content_rejected',
  'payout_processed', 'teacher_document_rejected', 'wallet_adjusted', 'system',
]);
export const Notification = z.object({
  id: Id,
  /** الأنواع المعروفة أعلاه، وأي نوع من خادم أحدث يُمرَّر كما هو بدل إسقاط التغذية كلها */
  type: z.union([NotificationType, z.string()]),
  title: z.string(),
  body: z.string().nullable(),
  data: z.record(z.string(), z.any()).nullable(),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Notification = z.infer<typeof Notification>;

export const Conversation = z.object({
  id: Id,
  other: z.object({ id: Id, name: z.string(), avatarUrl: z.string().nullable(), role: z.string() }),
  lastMessage: z.string().nullable(),
  lastAt: IsoDateTime.nullable(),
  unread: z.number().int(),
  context: z.object({ type: z.enum(['booking', 'book', 'course']), id: Id, title: z.string() }).nullable(),
});
export const Message = z.object({
  id: Id,
  conversationId: Id,
  senderId: Id,
  kind: z.enum(['text', 'image', 'file']),
  body: z.string().nullable(),
  fileUrl: z.string().nullable(),
  replyToId: Id.nullable(),
  createdAt: IsoDateTime,
});
export const SendMessage = z.object({
  kind: z.enum(['text', 'image', 'file']).default('text'),
  body: z.string().trim().max(2000).nullable().optional(),
  fileId: Id.nullable().optional(),
  replyToId: Id.nullable().optional(),
});

export const ReportTarget = z.enum(['user', 'message', 'book', 'course', 'review']);
export const CreateReport = z.object({
  targetType: ReportTarget, targetId: Id, reason: z.string().trim().min(5).max(500),
});

export const AnalyticsEvent = z.object({
  name: z.enum([
    'app_open', 'book_view', 'book_preview', 'book_purchase', 'teacher_view', 'booking_started',
    'booking_completed', 'course_view', 'course_purchase', 'course_lesson_completed',
    'quiz_started', 'quiz_completed', 'search', 'payment_failed', 'room_join', 'room_disconnect',
  ]),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
