/** خطأ تطبيقي بحالة HTTP محددة. */
export class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (m = 'طلب غير صالح', d) => new AppError(m, 400, 'bad_request', d);
export const unauthorized = (m = 'يجب تسجيل الدخول') => new AppError(m, 401, 'unauthorized');
export const forbidden = (m = 'لا تملك صلاحية لهذا الإجراء') => new AppError(m, 403, 'forbidden');
export const notFound = (m = 'العنصر غير موجود') => new AppError(m, 404, 'not_found');
export const conflict = (m = 'تعارض في البيانات') => new AppError(m, 409, 'conflict');
export const paymentRequired = (m = 'يجب شراء هذا المحتوى أولاً') => new AppError(m, 402, 'payment_required');

/** يلتقط أخطاء الدوال غير المتزامنة في المسارات. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: { code: 'not_found', message: 'المسار غير موجود' } });
  }
  next();
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', err);

  const payload = {
    error: {
      code: err.code || 'server_error',
      message: status >= 500 ? 'حدث خطأ في الخادم، حاول لاحقاً' : err.message,
    },
  };
  if (err.details) payload.error.details = err.details;
  res.status(status).json(payload);
}
