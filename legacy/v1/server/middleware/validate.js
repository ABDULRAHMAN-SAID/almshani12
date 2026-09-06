import { z } from 'zod';
import { AppError } from './error.js';

/** يتحقّق من body/query/params ويستبدلها بالنسخة المُنقّاة. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
    return next(new AppError('البيانات المُرسلة غير صحيحة', 422, 'validation_error', details));
  }
  if (source === 'body') req.body = result.data;
  else req.valid = { ...(req.valid || {}), [source]: result.data };
  return next();
};

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const arabicText = (min = 1, max = 5000) =>
  z.string().trim().min(min, `النص قصير جداً (الحد الأدنى ${min})`).max(max, `النص طويل جداً (الحد الأقصى ${max})`);

export const emailField = z.string().trim().toLowerCase().email('صيغة البريد الإلكتروني غير صحيحة');

export const passwordField = z.string()
  .min(8, 'كلمة المرور يجب ألا تقل عن ٨ أحرف')
  .max(128, 'كلمة المرور طويلة جداً')
  .refine(v => /[A-Za-z؀-ۿ]/.test(v) && /\d/.test(v), 'كلمة المرور يجب أن تحتوي على حروف وأرقام');

export const priceField = z.coerce.number().min(0, 'السعر لا يمكن أن يكون سالباً').max(100000);

export { z };
