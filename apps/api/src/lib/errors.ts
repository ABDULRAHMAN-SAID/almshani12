import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ErrorCode } from '@manassah/shared';
import { captureException } from './monitoring.ts';

export class AppError extends Error {
  constructor(
    public code: ErrorCode | string,
    message: string,
    public status = 400,
    public details?: { field: string; message: string }[],
  ) { super(message); }
}

export const badRequest = (m = 'طلب غير صالح', code = 'validation_error') => new AppError(code, m, 400);
export const unauthorized = (m = 'يجب تسجيل الدخول') => new AppError('unauthorized', m, 401);
export const authExpired = () => new AppError('auth_expired', 'انتهت الجلسة', 401);
export const forbidden = (m = 'لا تملك صلاحية لهذا الإجراء') => new AppError('forbidden', m, 403);
export const notFound = (m = 'العنصر غير موجود') => new AppError('not_found', m, 404);
export const conflict = (m = 'تعارض في البيانات', code = 'conflict') => new AppError(code, m, 409);
export const paymentRequired = (m = 'يجب الشراء أولاً') => new AppError('payment_required', m, 402);

export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };

export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: { code: 'not_found', message: 'المسار غير موجود' } });
  next();
}

/** أخطاء 5xx التي تصل رسالتها كما هي إلى العميل */
const USER_FACING_5XX = new Set<string>(['otp_send_failed', 'otp_delivery_unavailable', 'content_unavailable']);
/** ضغط تخزين عابر (قاعدة مشغولة أو قرص ممتلئ) — 503 ليعيد العميل المحاولة، لا 500 */
const TRANSIENT_STORAGE = /^SQLITE_(BUSY|LOCKED|FULL|IOERR|PROTOCOL|NOMEM)/;

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as AppError & { statusCode?: number; type?: string };
  // أخطاء تحليل الجسم من express
  if (e.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'validation_error', message: 'صيغة الطلب غير صحيحة' } });
  // أخطاء المكتبات تحمل رموزها الخاصة (SQLITE_BUSY، ENOENT…): رمز الخطأ عقدنا مع العميل، وتمريره كما هو يكشف محرّك التخزين وحالته
  const ours = err instanceof AppError;
  const transient = !ours && typeof e.code === 'string' && TRANSIENT_STORAGE.test(e.code);
  const status = transient ? 503 : e.status || e.statusCode || 500;
  // رسائل 5xx المقصودة للمستخدم هي رموز التحقّق فقط (نصّها ثابت من عندنا)؛ غيرها يُخفى ويُسجَّل كاملاً حتى لا يتسرّب نصّ بوابة خارجية
  const intended = ours && USER_FACING_5XX.has(e.code);
  if (status >= 500) { console.error('[error]', intended ? `${e.code}: ${e.message}` : err); if (!intended) captureException(err); }
  res.status(status).json({
    error: {
      // ضغط تخزين عابر يستحقّ رمزاً يفهمه العميل («حاول بعد لحظات») دون كشف محرّك التخزين ولا رمزه الأصلي
      code: ours ? e.code || 'server_error' : transient ? 'service_unavailable' : 'server_error',
      message: status >= 500 && !intended ? 'تعذّر إكمال العملية. حاول مرة أخرى.' : e.message,
      ...(e.details ? { details: e.details } : {}),
    },
  });
}
