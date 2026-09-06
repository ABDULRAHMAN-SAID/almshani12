import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { OtpRequest, OtpVerify, RefreshRequest } from '@manassah/shared';
import { config } from '../config.ts';
import { db, q, nowIso } from '../db/index.ts';
import { AppError, asyncHandler, badRequest, unauthorized } from '../lib/errors.ts';
import { validate, body } from '../lib/validate.ts';
import { signAccessToken, requireAuth } from '../lib/auth.ts';
import { sha256, safeEqual, randomDigits, randomToken } from '../lib/helpers.ts';
import { userView } from '../lib/views.ts';
import { sendOtp } from '../services/messaging.ts';
import { audit } from '../lib/audit.ts';

/**
 * الدخول برمز تحقّق (هاتف/بريد) — لا كلمات مرور يدوية.
 * Apple/Google: نقطتا نهاية جاهزتان لكنهما تتطلّبان مفاتيح المتاجر (تُرفضان بوضوح حتى ضبطها).
 */
const router = Router();

const otpLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: config.rateLimit.otpPer15Min, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => !config.rateLimit.enabled,
  keyGenerator: req => `${req.ip}:${String(req.body?.target ?? '').toLowerCase()}`,
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'محاولات كثيرة. انتظر قليلاً ثم حاول.' } }),
});

/** رقم عُماني محلي (8 أرقام) يُكمَّل بـ +968؛ البريد يُصغَّر */
export function normalizeTarget(channel: 'phone' | 'email', raw: string): string {
  if (channel === 'email') {
    const e = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw badRequest('البريد الإلكتروني غير صالح');
    return e;
  }
  let p = raw.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (/^\d{8}$/.test(p)) p = `+968${p}`;
  if (!p.startsWith('+')) p = `+${p}`;
  if (!/^\+\d{8,15}$/.test(p)) throw badRequest('رقم الهاتف غير صالح');
  return p;
}

/* ---------- الجلسات ---------- */
export function issueSession(userId: number, req: { ip?: string; headers: Record<string, unknown> }, isNew = false) {
  const roles = q.all<{ role: any }>('SELECT role FROM user_roles WHERE user_id = ?', userId).map(r => r.role);
  const accessToken = signAccessToken(userId, roles);
  const refreshToken = randomToken(48);
  q.run('INSERT INTO refresh_tokens (user_id, token_hash, device, ip, expires_at) VALUES (?,?,?,?,?)',
    userId, sha256(refreshToken), String(req.headers['user-agent'] ?? '').slice(0, 200), req.ip ?? null,
    Math.floor(Date.now() / 1000) + config.jwt.refreshTtlDays * 86_400);
  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), userId);
  return { user: userView(userId)!, accessToken, refreshToken, isNew };
}

function findOrCreateUser(channel: 'phone' | 'email', target: string): { id: number; isNew: boolean } {
  const col = channel === 'phone' ? 'phone' : 'email';
  const existing = q.get<{ id: number; status: string }>(`SELECT id, status FROM users WHERE ${col} = ?`, target);
  if (existing) {
    if (existing.status !== 'active') throw new AppError('forbidden', 'هذا الحساب موقوف', 403);
    return { id: existing.id, isNew: false };
  }
  return db.transaction(() => {
    const info = q.run(`INSERT INTO users (${col}) VALUES (?)`, target);
    const id = Number(info.lastInsertRowid);
    q.run('INSERT INTO profiles (user_id, display_name) VALUES (?, ?)', id, '');
    q.run('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', id, 'student');
    q.run('INSERT INTO auth_identities (user_id, provider, provider_uid) VALUES (?,?,?)', id, channel === 'phone' ? 'phone_otp' : 'email_otp', target);
    return { id, isNew: true };
  })();
}

/* ---------- OTP ---------- */
router.post('/otp/request', otpLimiter, validate(OtpRequest), asyncHandler(async (req, res) => {
  const { channel, target: raw } = body<typeof OtpRequest>(req);
  const target = normalizeTarget(channel, raw);
  const code = config.otp.devCode ?? randomDigits(6);
  q.run('UPDATE otp_codes SET consumed_at = ? WHERE target = ? AND channel = ? AND consumed_at IS NULL', nowIso(), target, channel);
  q.run('INSERT INTO otp_codes (channel, target, code_hash, expires_at) VALUES (?,?,?,?)',
    channel, target, sha256(code), Math.floor(Date.now() / 1000) + config.otp.ttlSeconds);
  await sendOtp(channel, target, code);
  res.json({ ok: true, target, ttlSeconds: config.otp.ttlSeconds, ...(config.otp.devCode ? { devCode: code } : {}) });
}));

router.post('/otp/verify', otpLimiter, validate(OtpVerify), asyncHandler(async (req, res) => {
  const { channel, target: raw, code } = body<typeof OtpVerify>(req);
  const target = normalizeTarget(channel, raw);
  const row = q.get<any>('SELECT * FROM otp_codes WHERE target = ? AND channel = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1', target, channel);
  if (!row) throw new AppError('otp_expired', 'اطلب رمزاً جديداً', 400);
  if (row.expires_at < Math.floor(Date.now() / 1000)) throw new AppError('otp_expired', 'انتهت صلاحية الرمز', 400);
  if (row.attempts >= config.otp.maxAttempts) throw new AppError('otp_expired', 'تجاوزت عدد المحاولات. اطلب رمزاً جديداً', 400);
  if (!safeEqual(row.code_hash, sha256(code))) {
    q.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw new AppError('otp_invalid', 'رمز التحقّق غير صحيح', 400);
  }
  q.run('UPDATE otp_codes SET consumed_at = ? WHERE id = ?', nowIso(), row.id);
  const { id, isNew } = findOrCreateUser(channel, target);
  res.json(issueSession(id, req, isNew));
}));

/* ---------- Apple / Google ---------- */
router.post('/apple', asyncHandler(async () => {
  throw new AppError('content_unavailable', 'تسجيل الدخول بحساب Apple يتطلّب ضبط مفاتيح المطوّر (APPLE_CLIENT_ID)', 501);
}));
router.post('/google', asyncHandler(async () => {
  throw new AppError('content_unavailable', 'تسجيل الدخول بحساب Google يتطلّب ضبط GOOGLE_CLIENT_ID', 501);
}));

/* ---------- تجديد الجلسة (تدوير + كشف إعادة الاستخدام) ---------- */
router.post('/refresh', validate(RefreshRequest), asyncHandler(async (req, res) => {
  const { refreshToken } = body<typeof RefreshRequest>(req);
  const row = q.get<any>('SELECT * FROM refresh_tokens WHERE token_hash = ?', sha256(refreshToken));
  if (!row) throw unauthorized('جلسة غير صالحة');
  if (row.revoked) {
    // رمز مُلغى يُقدَّم مجدداً → سرقة محتملة: نُنهي كل جلسات المستخدم
    q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', row.user_id);
    audit(req, 'auth.refresh_reuse', 'user', row.user_id);
    throw new AppError('auth_expired', 'انتهت الجلسة', 401);
  }
  if (row.expires_at < Math.floor(Date.now() / 1000)) throw new AppError('auth_expired', 'انتهت الجلسة', 401);
  const user = q.get<{ status: string }>('SELECT status FROM users WHERE id = ?', row.user_id);
  if (!user || user.status !== 'active') throw new AppError('forbidden', 'هذا الحساب موقوف', 403);
  q.run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', row.id);
  const session = issueSession(row.user_id, req);
  res.json({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  if (token) q.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ? AND user_id = ?', sha256(token), req.user!.id);
  else q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', req.user!.id);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => { res.json(userView(req.user!.id)); });

export default router;
