import jwt from 'jsonwebtoken';
import config from '../config.js';
import { q } from '../db/database.js';
import { unauthorized, forbidden } from './error.js';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTtl },
  );
}

export function verifyAccessToken(token) {
  try { return jwt.verify(token, config.jwt.secret); } catch { return null; }
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies?.access_token) return req.cookies.access_token;
  return null;
}

/** يحمّل المستخدم إن وُجد رمز صالح — دون إلزام. */
export function attachUser(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      const user = q.get('SELECT * FROM users WHERE id = ? AND status = ?', payload.sub, 'active');
      if (user) req.user = user;
    }
  }
  next();
}

/** يلزم تسجيل الدخول. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** يلزم دوراً معيّناً (المدير يمرّ دائماً). */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
  return next(forbidden());
};

export const requireAdmin = requireRole('admin');

/** معلّم معتمد فقط. */
export function requireInstructor(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role === 'admin') return next();
  if (req.user.role !== 'instructor') return next(forbidden('هذه الصفحة للمعلّمين فقط'));
  const profile = q.get('SELECT approved FROM instructor_profiles WHERE user_id = ?', req.user.id);
  if (!profile?.approved) return next(forbidden('حسابك كمعلّم قيد المراجعة من الإدارة'));
  next();
}

/** يتحقّق من ملكية العنصر أو صلاحية الإدارة. */
export const ownsOrAdmin = (getOwnerId) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role === 'admin') return next();
  const ownerId = getOwnerId(req);
  if (ownerId !== req.user.id) return next(forbidden());
  next();
};
