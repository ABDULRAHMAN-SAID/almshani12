import { z } from 'zod';

export const Id = z.number().int().positive();
export const Money = z.number().nonnegative();
export const Currency = z.string().length(3);
export const IsoDateTime = z.string().min(10);
export const HHmm = z.string().regex(/^\d{2}:\d{2}$/);

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(20),
});

export const PageMeta = z.object({
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  pages: z.number().int(),
});

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), meta: PageMeta });

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  }),
});

/** رموز الأخطاء الموحّدة — العميل يحوّلها إلى رسائل عربية */
export const ErrorCode = z.enum([
  'validation_error', 'unauthorized', 'forbidden', 'not_found', 'conflict',
  'rate_limited', 'payment_required', 'payment_failed', 'booking_conflict',
  'teacher_unavailable', 'slot_expired', 'content_unavailable', 'auth_expired',
  'otp_invalid', 'otp_expired', 'insufficient_funds', 'network_error', 'server_error',
  /* المتعلّمون وإدارة الأشخاص */
  'learner_required', 'learner_forbidden', 'learner_limit', 'learner_has_upcoming', 'last_learner',
  'last_super_admin', 'teacher_verified', 'phone_taken', 'email_taken', 'self_target',
  /* إيصال رموز التحقّق */
  'otp_delivery_unavailable', 'otp_send_failed', 'otp_country_not_allowed',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Ok = z.object({ ok: z.literal(true) });

export type PageMeta = z.infer<typeof PageMeta>;
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** GET /config — ما يحتاجه التطبيق قبل الدخول: معرّفات عامة فقط (لا أسرار) */
export const PublicConfig = z.object({
  brand: z.unknown().optional(),
  paymentProviders: z.array(z.string()),
  roomProvider: z.string(),
  devOtp: z.boolean(),
  mockPayments: z.boolean(),
  /** معرّف عميل Google للويب، وApple: Services ID للويب + هل الدخول الأصلي مضبوط */
  auth: z.object({ google: z.string().nullable(), apple: z.object({ servicesId: z.string().nullable(), native: z.boolean() }) }),
  /** مفتاح VAPID العام لإشعارات المتصفح */
  push: z.object({ web: z.string().nullable() }),
  /** وسائل الدفع المتاحة فعلاً ووضع ثواني (uat = تجربة) */
  payments: z.object({ providers: z.array(z.string()), thawaniMode: z.enum(['uat', 'live']).nullable() }),
});
export type PublicConfig = z.infer<typeof PublicConfig>;
