import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors.ts';

type Source = 'body' | 'query' | 'params';

declare module 'express-serve-static-core' {
  interface Request {
    valid: { body?: unknown; query?: unknown; params?: unknown };
  }
}

/** يتحقّق بمخطّط Zod ويضع النسخة المنقّاة في req.valid[source] */
export const validate = <S extends ZodTypeAny>(schema: S, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
      return next(new AppError('validation_error', 'بعض البيانات غير صحيحة', 422, details));
    }
    req.valid = { ...(req.valid ?? {}), [source]: result.data };
    if (source === 'body') req.body = result.data;
    next();
  };

export const body = <S extends ZodTypeAny>(req: Request): z.infer<S> => req.valid.body as z.infer<S>;
export const query = <S extends ZodTypeAny>(req: Request): z.infer<S> => req.valid.query as z.infer<S>;
export const idParam = (req: Request, name = 'id'): number => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new AppError('validation_error', 'معرّف غير صالح', 400);
  return n;
};
