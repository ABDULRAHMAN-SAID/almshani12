import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { q } from '../db/database.js';
import { asyncHandler, AppError, unauthorized } from '../middleware/error.js';
import { validate, z, emailField, passwordField, arabicText } from '../middleware/validate.js';
import { attachUser, requireAuth, signAccessToken } from '../middleware/auth.js';
import { publicUser, randomCode, randomToken, sha256, nowIso, addDays } from '../utils/helpers.js';
import { notify, notifyAdmins } from '../services/notifications.js';
import { sendMail } from '../services/mailer.js';

const router = express.Router();

const authLimiter = config.rateLimit.enabled
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: config.rateLimit.authPer15Min,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'محاولات كثيرة، حاول بعد قليل' } },
    })
  : (_req, _res, next) => next();

const registerSchema = z.object({
  name: arabicText(2, 80),
  email: emailField,
  password: passwordField,
  phone: z.string().trim().max(30).optional().nullable(),
  role: z.enum(['student', 'instructor']).default('student'),
  referral: z.string().trim().max(20).optional().nullable(),
});

function issueRefreshToken(userId, req) {
  const token = randomToken(40);
  q.run(
    'INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip, expires_at) VALUES (?,?,?,?,?)',
    userId, sha256(token), req.headers['user-agent']?.slice(0, 200) ?? null, req.ip,
    Date.now() + config.jwt.refreshTtlDays * 86400000,
  );
  return token;
}

function authPayload(user, req) {
  return {
    user: publicUser(user),
    accessToken: signAccessToken(user),
    refreshToken: issueRefreshToken(user.id, req),
  };
}

/* ------------------------- تسجيل حساب جديد ------------------------- */
router.post('/register', authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, referral } = req.body;

  if (q.get('SELECT 1 AS x FROM users WHERE email = ?', email)) {
    throw new AppError('هذا البريد مسجّل مسبقاً', 409, 'email_taken');
  }

  const referrer = referral ? q.get('SELECT id FROM users WHERE referral_code = ?', referral.toUpperCase()) : null;
  const verifyToken = randomToken(16);
  const info = q.run(
    `INSERT INTO users (name, email, phone, password_hash, role, referral_code, referred_by, verify_token)
     VALUES (?,?,?,?,?,?,?,?)`,
    name, email, phone || null, bcrypt.hashSync(password, config.security.bcryptRounds),
    role, randomCode(8), referrer?.id ?? null, verifyToken,
  );
  const user = q.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);

  if (role === 'instructor') {
    // المعلّم يبدأ غير معتمد حتى تراجعه الإدارة
    q.run('INSERT INTO instructor_profiles (user_id, approved, applied_at) VALUES (?, 0, ?)', user.id, nowIso());
    notifyAdmins({
      type: 'instructor_application', title: 'طلب انضمام معلّم جديد',
      body: `${name} تقدّم للانضمام كمعلّم`, link: '#/admin/instructors',
    });
  }

  notify(user.id, {
    type: 'welcome', title: `أهلاً بك في ${config.platform.name} 👋`,
    body: 'ابدأ باستكشاف الدورات والحصص المباشرة وملخّصات الكتب.', link: '#/courses',
  });
  await sendMail({
    to: email, subject: `تفعيل حسابك في ${config.platform.name}`,
    text: `مرحباً ${name},\nفعّل حسابك عبر الرابط:\n${config.publicUrl}/#/verify?token=${verifyToken}`,
  });

  res.status(201).json(authPayload(user, req));
}));

/* ------------------------- تسجيل الدخول ------------------------- */
router.post('/login', authLimiter, validate(z.object({
  email: emailField,
  password: z.string().min(1, 'أدخل كلمة المرور'),
})), asyncHandler(async (req, res) => {
  const user = q.get('SELECT * FROM users WHERE email = ?', req.body.email);
  // نفس الرسالة في الحالتين حتى لا نكشف البُرد المسجّلة
  if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) {
    throw new AppError('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401, 'invalid_credentials');
  }
  if (user.status === 'suspended') throw new AppError('تم إيقاف هذا الحساب، تواصل مع الدعم', 403, 'account_suspended');

  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
  res.json(authPayload(user, req));
}));

/* ------------------------- تجديد الجلسة ------------------------- */
router.post('/refresh', validate(z.object({ refreshToken: z.string().min(10) })), asyncHandler(async (req, res) => {
  const row = q.get('SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0', sha256(req.body.refreshToken));
  if (!row || row.expires_at < Date.now()) throw unauthorized('انتهت الجلسة، سجّل الدخول مجدداً');

  const user = q.get('SELECT * FROM users WHERE id = ? AND status = ?', row.user_id, 'active');
  if (!user) throw unauthorized();

  // تدوير الرمز: كل تجديد يُبطل الرمز السابق
  q.run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', row.id);
  res.json({ accessToken: signAccessToken(user), refreshToken: issueRefreshToken(user.id, req), user: publicUser(user) });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  if (req.body?.refreshToken) {
    q.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', sha256(req.body.refreshToken));
  }
  res.json({ ok: true });
}));

/* ------------------------- الحساب الحالي ------------------------- */
router.get('/me', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const profile = req.user.role === 'instructor'
    ? q.get('SELECT * FROM instructor_profiles WHERE user_id = ?', req.user.id) : null;
  const subscription = q.get(
    "SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ? AND s.status='active' AND s.ends_at > ? ORDER BY s.ends_at DESC LIMIT 1",
    req.user.id, nowIso());
  const unread = q.val('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id);
  const cartCount = q.val('SELECT COUNT(*) AS c FROM cart_items WHERE user_id = ?', req.user.id);
  res.json({ user: publicUser(req.user), instructorProfile: profile, subscription, unreadNotifications: unread, cartCount });
}));

router.patch('/me', attachUser, requireAuth, validate(z.object({
  name: arabicText(2, 80).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  avatar: z.string().trim().max(500).nullable().optional(),
  country: z.string().trim().max(60).nullable().optional(),
})), asyncHandler(async (req, res) => {
  const fields = Object.entries(req.body).filter(([, v]) => v !== undefined);
  if (fields.length) {
    q.run(`UPDATE users SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...fields.map(([, v]) => v), req.user.id);
  }
  res.json({ user: publicUser(q.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
}));

router.post('/change-password', attachUser, requireAuth, validate(z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordField,
})), asyncHandler(async (req, res) => {
  if (!bcrypt.compareSync(req.body.currentPassword, req.user.password_hash)) {
    throw new AppError('كلمة المرور الحالية غير صحيحة', 400, 'wrong_password');
  }
  q.run('UPDATE users SET password_hash = ? WHERE id = ?',
    bcrypt.hashSync(req.body.newPassword, config.security.bcryptRounds), req.user.id);
  // إبطال كل الجلسات الأخرى بعد تغيير كلمة المرور
  q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true, ...authPayload(q.get('SELECT * FROM users WHERE id = ?', req.user.id), req) });
}));

/* ------------------------- استرجاع كلمة المرور ------------------------- */
router.post('/forgot-password', authLimiter, validate(z.object({ email: emailField })), asyncHandler(async (req, res) => {
  const user = q.get('SELECT * FROM users WHERE email = ?', req.body.email);
  if (user) {
    const token = randomToken(24);
    q.run('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', token, Date.now() + 3600000, user.id);
    await sendMail({
      to: user.email, subject: 'إعادة تعيين كلمة المرور',
      text: `الرابط صالح لساعة واحدة:\n${config.publicUrl}/#/reset?token=${token}`,
    });
  }
  // ردّ موحّد لعدم كشف البُرد المسجّلة
  res.json({ ok: true, message: 'إن كان البريد مسجّلاً فستصلك رسالة خلال دقائق' });
}));

router.post('/reset-password', authLimiter, validate(z.object({
  token: z.string().min(10),
  password: passwordField,
})), asyncHandler(async (req, res) => {
  const user = q.get('SELECT * FROM users WHERE reset_token = ?', req.body.token);
  if (!user || !user.reset_expires || user.reset_expires < Date.now()) {
    throw new AppError('رابط الاستعادة منتهي أو غير صالح', 400, 'invalid_token');
  }
  q.run('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
    bcrypt.hashSync(req.body.password, config.security.bcryptRounds), user.id);
  q.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', user.id);
  res.json({ ok: true });
}));

router.post('/verify-email', validate(z.object({ token: z.string().min(6) })), asyncHandler(async (req, res) => {
  const user = q.get('SELECT * FROM users WHERE verify_token = ?', req.body.token);
  if (!user) throw new AppError('رمز التفعيل غير صالح', 400, 'invalid_token');
  q.run('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?', user.id);
  res.json({ ok: true });
}));

/* ------------------------- التقدّم كمعلّم ------------------------- */
router.post('/apply-instructor', attachUser, requireAuth, validate(z.object({
  title: arabicText(2, 100),
  specialty: arabicText(2, 100),
  headline: z.string().trim().max(300).optional().nullable(),
  years_exp: z.coerce.number().int().min(0).max(60).default(0),
})), asyncHandler(async (req, res) => {
  const { title, specialty, headline, years_exp } = req.body;
  const existing = q.get('SELECT * FROM instructor_profiles WHERE user_id = ?', req.user.id);
  if (existing?.approved) throw new AppError('أنت معلّم معتمد بالفعل', 409, 'already_instructor');

  q.run(
    `INSERT INTO instructor_profiles (user_id, title, specialty, headline, years_exp, applied_at, commission_rate)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET title=excluded.title, specialty=excluded.specialty,
       headline=excluded.headline, years_exp=excluded.years_exp, applied_at=excluded.applied_at`,
    req.user.id, title, specialty, headline || null, years_exp, nowIso(), config.money.commissionRate,
  );
  notifyAdmins({
    type: 'instructor_application', title: 'طلب انضمام معلّم',
    body: `${req.user.name} — ${specialty}`, link: '#/admin/instructors',
  });
  res.json({ ok: true, message: 'تم استلام طلبك، سيراجعه الفريق خلال ٤٨ ساعة' });
}));

/* ------------------------- الإحالة ------------------------- */
router.get('/referral', attachUser, requireAuth, asyncHandler(async (req, res) => {
  let code = req.user.referral_code;
  if (!code) {
    code = randomCode(8);
    q.run('UPDATE users SET referral_code = ? WHERE id = ?', code, req.user.id);
  }
  const invited = q.all('SELECT id, name, created_at FROM users WHERE referred_by = ? ORDER BY id DESC', req.user.id);
  const earned = q.val("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE user_id = ? AND type = 'referral'", req.user.id);
  res.json({ code, link: `${config.publicUrl}/#/register?ref=${code}`, invited, earned, bonus: config.money.referralBonus });
}));

export default router;
