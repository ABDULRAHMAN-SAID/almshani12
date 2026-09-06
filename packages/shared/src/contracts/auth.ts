import { z } from 'zod';
import { Id, IsoDateTime } from './common';

export const Role = z.enum([
  'student', 'parent', 'teacher', 'content_reviewer', 'support', 'finance', 'admin', 'super_admin',
]);
export type Role = z.infer<typeof Role>;

export const SignupRole = z.enum(['student', 'teacher', 'parent']);
export const OtpChannel = z.enum(['phone', 'email']);
/** وسيلة إيصال رمز الهاتف */
export const OtpVia = z.enum(['sms', 'whatsapp']);
export type OtpVia = z.infer<typeof OtpVia>;

export const OtpRequest = z.object({
  channel: OtpChannel,
  /** رقم بصيغة دولية (+968…) أو بريد */
  target: z.string().trim().min(5).max(120),
  via: OtpVia.optional(),
  role: SignupRole.optional(),
  locale: z.enum(['ar', 'en']).default('ar'),
});

/** كيف وصل الرمز فعلاً — test = رمز ثابت (تطوير أو حساب تجريبي) يُعاد في devCode */
export const OtpDelivery = z.enum(['sms', 'whatsapp', 'email', 'test']);
export type OtpDelivery = z.infer<typeof OtpDelivery>;
export const OtpRequestResult = z.object({
  ok: z.literal(true), target: z.string(), ttlSeconds: z.number(), delivery: OtpDelivery, devCode: z.string().optional(),
});
export type OtpRequestResult = z.infer<typeof OtpRequestResult>;

/** طرق الدخول المتاحة على الخادم (GET /auth/methods) */
export const AuthMethods = z.object({
  phone: z.boolean(), whatsapp: z.boolean(), email: z.boolean(), testCode: z.boolean(),
  /** الدخول الاجتماعي مضبوط على الخادم (معرّفات العملاء موجودة) */
  google: z.boolean().default(false), apple: z.boolean().default(false),
});
export type AuthMethods = z.infer<typeof AuthMethods>;

export const OtpVerify = z.object({
  channel: OtpChannel,
  target: z.string().trim().min(5).max(120),
  code: z.string().regex(/^\d{6}$/),
});

export const VerificationStatus = z.enum(['pending', 'under_review', 'verified', 'rejected', 'suspended']);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const StudentContext = z.object({
  curriculumId: Id.nullable(),
  gradeId: Id.nullable(),
  gradeName: z.string().nullable(),
  semesterId: Id.nullable(),
  semesterName: z.string().nullable(),
  subjectIds: z.array(Id),
});

/** ما يراه المعلّم أو أي طرف ثالث عن متعلّم — لا هاتف ولا بريد ولا معرّف حساب أبداً */
export const LearnerRef = z.object({
  id: Id, displayName: z.string(), gradeName: z.string().nullable(), avatarUrl: z.string().nullable(),
});
export type LearnerRef = z.infer<typeof LearnerRef>;

/** ملفّ تعلّم مملوك للحساب: الطالب نفسه (isSelf) أو ابن/ابنة وليّ الأمر — ليس حساب دخول */
export const Learner = LearnerRef.extend({
  isSelf: z.boolean(),
  gender: z.enum(['male', 'female']).nullable(),
  curriculumId: Id.nullable(), gradeId: Id.nullable(),
  semesterId: Id.nullable(), semesterName: z.string().nullable(),
  subjectIds: z.array(Id), school: z.string().nullable(),
  position: z.number().int(), archivedAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
});
export type Learner = z.infer<typeof Learner>;

export const LearnerUpsert = z.object({
  displayName: z.string().trim().min(2).max(60),
  gender: z.enum(['male', 'female']).nullable().optional(),
  /** عند الإنشاء فقط؛ يُتجاهل في PATCH */
  isSelf: z.boolean().optional(),
  curriculumId: Id, gradeId: Id, semesterId: Id,
  subjectIds: z.array(Id).min(1).max(12),
  school: z.string().trim().max(120).nullable().optional(),
  avatarFileId: Id.nullable().optional(),
});
export type LearnerUpsert = z.infer<typeof LearnerUpsert>;
export const LearnerPatch = LearnerUpsert.partial();
export type LearnerPatch = z.infer<typeof LearnerPatch>;

export const User = z.object({
  id: Id,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  roles: z.array(Role),
  locale: z.enum(['ar', 'en']),
  timezone: z.string(),
  onboardingCompleted: z.boolean(),
  /** @deprecated مرآة للمتعلّم النشط — يُحذف في الإصدار التالي؛ استخدم learners */
  student: StudentContext.nullable(),
  /** غير المؤرشفين فقط، مرتّبون: isSelf تنازلياً ثم position */
  learners: z.array(Learner),
  /** users.active_learner_id (حقيقة الخادم) */
  activeLearnerId: Id.nullable(),
  teacher: z.object({ verificationStatus: VerificationStatus }).nullable(),
  createdAt: IsoDateTime,
});
export type User = z.infer<typeof User>;

export const AuthSession = z.object({
  user: User,
  accessToken: z.string(),
  refreshToken: z.string(),
  /** true عندما يكون الحساب جديداً ويحتاج الإعداد الأوّلي */
  isNew: z.boolean(),
});
export type AuthSession = z.infer<typeof AuthSession>;

export const StudentSetup = z.object({
  displayName: z.string().trim().min(2).max(60),
  curriculumId: Id,
  gradeId: Id,
  semesterId: Id,
  subjectIds: z.array(Id).min(1).max(12),
  school: z.string().trim().max(120).optional(),
});
export type StudentSetup = z.infer<typeof StudentSetup>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(10) });

/* ---------- الدخول الاجتماعي (POST /auth/google، /auth/apple) ---------- */
export const GoogleLogin = z.object({
  /** ID token من Google Identity Services أو expo-auth-session */
  idToken: z.string().min(20).max(8192),
  role: SignupRole.optional(),
  locale: z.enum(['ar', 'en']).default('ar'),
});
export type GoogleLogin = z.infer<typeof GoogleLogin>;
export const AppleLogin = z.object({
  identityToken: z.string().min(20).max(8192),
  /** Apple يرسل الاسم مرة واحدة فقط عند أول تفويض */
  fullName: z.object({ givenName: z.string().trim().max(60).optional().nullable(), familyName: z.string().trim().max(60).optional().nullable() }).optional().nullable(),
  role: SignupRole.optional(),
  locale: z.enum(['ar', 'en']).default('ar'),
});
export type AppleLogin = z.infer<typeof AppleLogin>;

/* ---------- الإشعارات الفورية (POST/DELETE /me/push) ---------- */
export const PushKind = z.enum(['expo', 'web']);
export type PushKind = z.infer<typeof PushKind>;
export const WebPushSubscription = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(200) }),
});
export type WebPushSubscription = z.infer<typeof WebPushSubscription>;
export const PushRegister = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('expo'), token: z.string().min(10).max(500), platform: z.enum(['ios', 'android']).optional() }),
  z.object({ kind: z.literal('web'), subscription: WebPushSubscription, platform: z.literal('web').optional() }),
]);
export type PushRegister = z.infer<typeof PushRegister>;
export const PushUnregister = z.object({ kind: PushKind, token: z.string().min(10).max(2000).optional(), endpoint: z.string().min(10).max(2000).optional() })
  .refine(v => !!(v.token || v.endpoint), { message: 'token أو endpoint مطلوب', path: ['token'] });
export type PushUnregister = z.infer<typeof PushUnregister>;
