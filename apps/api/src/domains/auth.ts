import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { OtpRequest, OtpVerify, RefreshRequest, GoogleLogin, AppleLogin, PasswordRegister, PasswordLogin, ResetPassword } from '@manassah/shared';
import { config } from '../config.ts';
import { q, nowIso } from '../db/index.ts';
import { AppError, asyncHandler, badRequest, unauthorized } from '../lib/errors.ts';
import { validate, body } from '../lib/validate.ts';
import { signAccessToken, requireAuth } from '../lib/auth.ts';
import { sha256, randomToken } from '../lib/helpers.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { userView } from '../lib/views.ts';
import { otpMethods, startOtp, checkOtp } from '../services/otp.ts';
import { findOrCreateUser, findOrLinkSocialUser, registerWithPassword, findUserForPasswordLogin } from '../services/accounts.ts';
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

/** تخمين كلمة مرور: محاولات محدودة على نفس الهدف (لا نفس IP وحده — عدة أجهزة قد تخمّن نفس الحساب) */
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => !config.rateLimit.enabled,
  keyGenerator: req => `${req.ip}:${String(req.body?.target ?? '').trim().toLowerCase()}`,
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'محاولات دخول كثيرة. انتظر قليلاً ثم حاول.' } }),
});
/** إنشاء حسابات آلياً: سقف عام بالـIP وحده — التسجيل نفسه بلا رمز تحقّق فلا مفتاح هدف ذي معنى بعد */
const registerLimiter = rateLimit({
  windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => !config.rateLimit.enabled,
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'محاولات كثيرة. حاول لاحقاً.' } }),
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
/** family: سلسلة الجهاز الواحد. دخول جديد يبدأ سلسلة، والتجديد يبقى في سلسلته — فإنهاؤها لا يمسّ بقيّة الأجهزة. */
export function issueSession(userId: number, req: { ip?: string; headers: Record<string, unknown> }, isNew = false, family?: string) {
  const roles = q.all<{ role: any }>('SELECT role FROM user_roles WHERE user_id = ?', userId).map(r => r.role);
  const accessToken = signAccessToken(userId, roles);
  const refreshToken = randomToken(48);
  q.run('INSERT INTO refresh_tokens (user_id, token_hash, family, device, ip, expires_at) VALUES (?,?,?,?,?,?)',
    userId, sha256(refreshToken), family ?? randomToken(16), String(req.headers['user-agent'] ?? '').slice(0, 200), req.ip ?? null,
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

/* ---------- كلمة المرور ---------- */
router.post('/register', registerLimiter, validate(PasswordRegister), asyncHandler(async (req, res) => {
  const b = body<typeof PasswordRegister>(req);
  const phone = normalizeTarget('phone', b.phone);
  const email = normalizeTarget('email', b.email);
  // البريد لا الهاتف: القناة الوحيدة المضبوطة فعلياً (لا مزوّد رسائل نصية بعد) — العميل يطلب الرمز
  // مسبقاً بـ /auth/otp/request(channel:'email') قبل هذا الطلب؛ رمز خاطئ/منتهٍ يرمي هنا فلا يُنشأ حساب
  await checkOtp({ channel: 'email', target: email, code: b.code });
  const { id, isNew } = registerWithPassword({ displayName: b.displayName, phone, email, passwordHash: hashPassword(b.password), locale: b.locale });
  audit(req, 'auth.register', 'user', id);
  res.json(issueSession(id, req, isNew));
}));

router.post('/login', loginLimiter, validate(PasswordLogin), asyncHandler(async (req, res) => {
  const { channel, target: raw, password } = body<typeof PasswordLogin>(req);
  const target = normalizeTarget(channel, raw);
  const row = findUserForPasswordLogin(channel, target);
  // رسالة واحدة لعدم وجود الحساب أو كلمة مرور خاطئة — كي لا تكشف الاستجابة أرقاماً/بُرداً مسجّلة على الخادم
  if (!row || !row.passwordHash || !verifyPassword(password, row.passwordHash)) throw new AppError('invalid_credentials', 'رقم الهاتف/البريد أو كلمة المرور غير صحيحة', 401);
  if (row.status !== 'active') throw new AppError('forbidden', 'هذا الحساب موقوف', 403);
  res.json(issueSession(row.id, req, false));
}));

/** نسيت كلمة المرور: رمز تحقّق (نفس /otp/request) ثم هنا — يتحقّق من الرمز ويضبط كلمة مرور جديدة، ويُدخل مباشرة */
router.post('/password/reset', otpLimiter, validate(ResetPassword), asyncHandler(async (req, res) => {
  const { channel, target: raw, code, newPassword } = body<typeof ResetPassword>(req);
  const target = normalizeTarget(channel, raw);
  await checkOtp({ channel, target, code });
  const row = q.get<{ id: number; status: string }>(`SELECT id, status FROM users WHERE ${channel} = ?`, target);
  if (!row) throw new AppError('not_found', 'لا يوجد حساب بهذا الرقم أو البريد', 404);
  if (row.status !== 'active') throw new AppError('forbidden', 'هذا الحساب موقوف', 403);
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(newPassword), row.id);
  audit(req, 'auth.password_reset', 'user', row.id);
  res.json(issueSession(row.id, req, false));
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
/** مهلة سماح للتدوير: الشبكة تُسقط ردّاً أحياناً فيُعيد العميل الرمز نفسه خلال ثوانٍ — هذه ليست سرقة.
 *  قصيرة عمداً: كل ثانية زيادة هي ثانية يمرّ فيها رمز مسروق مُدوَّر. */
const REFRESH_GRACE_SECONDS = 10;
router.post('/refresh', validate(RefreshRequest), asyncHandler(async (req, res) => {
  const { refreshToken } = body<typeof RefreshRequest>(req);
  const row = q.get<any>('SELECT * FROM refresh_tokens WHERE token_hash = ?', sha256(refreshToken));
  if (!row) throw unauthorized('جلسة غير صالحة');
  const now = Math.floor(Date.now() / 1000);
  if (row.revoked) {
    // رمز دُوِّر قبل ثوانٍ يُقدَّم مجدداً وسلسلته ما زالت حيّة: ردّ ضاع في الطريق — لا سرقة، فلا نُسقط شيئاً.
    // شرط «حيّة» ضروري: بعد الخروج أو بعد كشف سرقة تُبطَل السلسلة كلّها، فلا تُحيي المهلةُ رمزاً منها.
    const chainAlive = !!q.val<number>('SELECT 1 FROM refresh_tokens WHERE family = ? AND revoked = 0 LIMIT 1', row.family);
    if (chainAlive && row.rotated_at && now - row.rotated_at <= REFRESH_GRACE_SECONDS) {
      audit(req, 'auth.refresh_grace', 'user', row.user_id);
    } else {
      // خارج المهلة → سرقة محتملة: نُنهي سلسلة هذا الجهاز وحدها. إنهاء كل السلاسل كان يُخرج
      // المستخدم من هاتفه وحاسوبه لأن كتابة رمز واحدة فشلت على جهاز واحد.
      q.run('UPDATE refresh_tokens SET revoked = 1 WHERE family = ? AND revoked = 0', row.family);
      audit(req, 'auth.refresh_reuse', 'user', row.user_id);
      throw new AppError('auth_expired', 'انتهت الجلسة', 401);
    }
  }
  if (row.expires_at < now) throw new AppError('auth_expired', 'انتهت الجلسة', 401);
  const user = q.get<{ status: string }>('SELECT status FROM users WHERE id = ?', row.user_id);
  if (!user || user.status !== 'active') throw new AppError('forbidden', 'هذا الحساب موقوف', 403);
  q.run('UPDATE refresh_tokens SET revoked = 1, rotated_at = ? WHERE id = ?', now, row.id);
  const session = issueSession(row.user_id, req, false, row.family);
  res.json({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  // الخروج ينهي سلسلة هذا الجهاز كلّها: إبطال البصمة وحدها كان يترك سابقاتها في السلسلة قابلة لإعادة الاستخدام
  if (token) q.run(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?
                    AND family = (SELECT family FROM refresh_tokens WHERE token_hash = ? AND user_id = ?)`,
    req.user!.id, sha256(token), req.user!.id);
  else q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', req.user!.id);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => { res.json(userView(req.user!.id)); });

export default router;
