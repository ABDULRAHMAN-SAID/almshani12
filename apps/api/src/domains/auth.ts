import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { OtpRequest, OtpVerify, RefreshRequest, GoogleLogin, AppleLogin } from '@manassah/shared';
import { config } from '../config.ts';
import { q, nowIso } from '../db/index.ts';
import { AppError, asyncHandler, badRequest, unauthorized } from '../lib/errors.ts';
import { validate, body } from '../lib/validate.ts';
import { signAccessToken, requireAuth } from '../lib/auth.ts';
import { sha256, randomToken } from '../lib/helpers.ts';
import { userView } from '../lib/views.ts';
import { otpMethods, startOtp, checkOtp } from '../services/otp.ts';
import { findOrCreateUser, findOrLinkSocialUser } from '../services/accounts.ts';
import { verifyGoogle, verifyApple, socialConfigured } from '../lib/social.ts';
import { audit } from '../lib/audit.ts';

/**
 * الدخول برمز تحقّق (هاتف/بريد) — لا كلمات مرور يدوية.
 * Apple/Google: تحقّق من رمز المزوّد (lib/social.ts) ثم ربط/إنشاء الحساب (services/accounts.ts) — 501 حتى تُضبط معرّفات العملاء.
 */
const router = Router();

const otpLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: config.rateLimit.otpPer15Min, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => !config.rateLimit.enabled,
  // المفتاح على الهدف المطبَّع (لا النص الخام) كي لا تمنح إعادة صياغة الرقم نفسه حصّة جديدة
  keyGenerator: req => {
    const ch = req.body?.channel === 'email' ? 'email' : 'phone';
    let t = String(req.body?.target ?? '');
    try { t = normalizeTarget(ch, t); } catch { t = t.trim().toLowerCase(); }
    return `${req.ip}:${t}`;
  },
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

/* ---------- OTP ---------- */
/** طرق الدخول المتاحة على هذا الخادم (عام، بلا محدّد) — العميل يخفي ما هو غير متاح */
router.get('/methods', (_req, res) => { res.json({ ...otpMethods(), google: socialConfigured('google'), apple: socialConfigured('apple') }); });

router.post('/otp/request', otpLimiter, validate(OtpRequest), asyncHandler(async (req, res) => {
  const { channel, target: raw, via, locale } = body<typeof OtpRequest>(req);
  const target = normalizeTarget(channel, raw);
  const r = await startOtp({ channel, target, via, ip: req.ip, locale });
  // حزام إضافي فوق تجاهل config للرمز الثابت في الإنتاج: لا يخرج رمز دخول في ردّ عام مهما كان الإعداد
  res.json({ ok: true, target, ttlSeconds: r.ttlSeconds, delivery: r.delivery, ...(r.devCode && config.env !== 'production' ? { devCode: r.devCode } : {}) });
}));

router.post('/otp/verify', otpLimiter, validate(OtpVerify), asyncHandler(async (req, res) => {
  const { channel, target: raw, code } = body<typeof OtpVerify>(req);
  const target = normalizeTarget(channel, raw);
  await checkOtp({ channel, target, code });
  const { id, isNew } = findOrCreateUser(channel, target);
  res.json(issueSession(id, req, isNew));
}));

/* ---------- Apple / Google ---------- */
/** بلا معرّفات عملاء مضبوطة يُرفض الطلب 501 قبل التحقّق من الجسم — كي يبقى الرد كما كان للعملاء القدامى */
const requireSocial = (provider: 'google' | 'apple') => asyncHandler(async (_req, _res, next) => {
  if (!socialConfigured(provider)) throw new AppError('content_unavailable', provider === 'google'
    ? 'تسجيل الدخول بحساب Google يتطلّب ضبط GOOGLE_CLIENT_ID'
    : 'تسجيل الدخول بحساب Apple يتطلّب ضبط مفاتيح المطوّر (APPLE_CLIENT_ID)', 501);
  next();
});

router.post('/google', requireSocial('google'), validate(GoogleLogin), asyncHandler(async (req, res) => {
  const { idToken, role, locale } = body<typeof GoogleLogin>(req);
  const identity = await verifyGoogle(idToken);
  const { id, isNew } = findOrLinkSocialUser(identity, { role, locale });
  if (isNew) audit(req, 'auth.social_signup', 'user', id, { provider: 'google' });
  res.json(issueSession(id, req, isNew));
}));

router.post('/apple', requireSocial('apple'), validate(AppleLogin), asyncHandler(async (req, res) => {
  const { identityToken, fullName, role, locale } = body<typeof AppleLogin>(req);
  const identity = await verifyApple(identityToken);
  const displayName = [fullName?.givenName, fullName?.familyName].filter(Boolean).join(' ').trim() || null;
  const { id, isNew } = findOrLinkSocialUser(identity, { role, locale, displayName });
  if (isNew) audit(req, 'auth.social_signup', 'user', id, { provider: 'apple' });
  res.json(issueSession(id, req, isNew));
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
