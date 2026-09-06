import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@manassah/shared';
import { config } from '../config.ts';
import { q } from '../db/index.ts';
import { unauthorized, forbidden, authExpired } from './errors.ts';

export interface AuthUser {
  id: number;
  roles: Role[];
  status: string;
  locale: string;
  timezone: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    /** المتعلّم الذي يعمل عليه العميل (ترويسة X-Learner-Id) — يُحسم في services/learners.ts لا هنا */
    learnerId?: number | null;
  }
}

/** ترويسة X-Learner-Id: عدد صحيح موجب أو null — بلا وصول لقاعدة البيانات */
export function parseLearnerHeader(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d{1,12}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n > 0 ? n : null;
}

const ROLE_RANK: Record<Role, number> = {
  student: 1, parent: 1, teacher: 2, content_reviewer: 3, support: 3, finance: 4, admin: 5, super_admin: 6,
};

export function signAccessToken(userId: number, roles: Role[]): string {
  return jwt.sign({ sub: String(userId), roles }, config.jwt.secret, { expiresIn: config.jwt.accessTtl as jwt.SignOptions['expiresIn'] });
}

export function verifyAccessToken(token: string): { sub: string; roles: Role[] } | null {
  try { return jwt.verify(token, config.jwt.secret) as { sub: string; roles: Role[] }; } catch { return null; }
}

export function loadUser(userId: number): AuthUser | null {
  const row = q.get<{ id: number; status: string; locale: string; timezone: string }>(
    'SELECT id, status, locale, timezone FROM users WHERE id = ?', userId);
  if (!row || row.status !== 'active') return null;
  const roles = q.all<{ role: Role }>('SELECT role FROM user_roles WHERE user_id = ?', userId).map(r => r.role);
  return { ...row, roles };
}

/** يحمّل المستخدم إن وُجد رمز صالح — دون إلزام */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      const user = loadUser(Number(payload.sub));
      if (user) req.user = user;
    } else {
      // رمز موجود لكنه منتهٍ — نميّزه عن عدم تسجيل الدخول
      req.headers['x-token-expired'] = '1';
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.user) { req.learnerId = parseLearnerHeader(req.headers['x-learner-id']); return next(); }
  next(req.headers['x-token-expired'] ? authExpired() : unauthorized());
}

/** الصلاحية بالأدوار — super_admin وadmin يمرّان دائماً */
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  const has = req.user.roles.some(r => r === 'admin' || r === 'super_admin' || roles.includes(r));
  next(has ? undefined : forbidden());
};

/** صلاحية صارمة: admin لا يمرّ تلقائياً (للعمليات المحجوزة لـ super_admin) */
export const requireExactRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  next(req.user.roles.some(r => roles.includes(r)) ? undefined : forbidden());
};

export const hasRole = (user: AuthUser | undefined, role: Role) =>
  !!user && (user.roles.includes(role) || user.roles.includes('admin') || user.roles.includes('super_admin'));

export const isStaff = (user: AuthUser | undefined) =>
  !!user && user.roles.some(r => ROLE_RANK[r] >= ROLE_RANK.content_reviewer);

/** معلّم معتمد فقط — الاعتماد حالة في قاعدة البيانات لا في الرمز */
export function requireVerifiedTeacher(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (hasRole(req.user, 'admin')) return next();
  if (!req.user.roles.includes('teacher')) return next(forbidden('هذه الخدمة للمعلّمين'));
  const status = q.val<string>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', req.user.id);
  if (status !== 'verified') return next(forbidden('حسابك كمعلّم لم يُعتمد بعد'));
  next();
}
