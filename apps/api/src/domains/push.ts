import { Router } from 'express';
import { PushRegister, PushUnregister } from '@manassah/shared';
import { config } from '../config.ts';
import { q, nowIso } from '../db/index.ts';
import { asyncHandler, badRequest } from '../lib/errors.ts';
import { validate, body } from '../lib/validate.ts';
import { requireAuth } from '../lib/auth.ts';

/**
 * أجهزة الإشعارات الفورية: تسجيل اشتراك المتصفح (Web Push) أو رمز Expo للحساب الحالي، وإلغاؤه.
 * التسجيل يُعيد إسناد الرمز نفسه للحساب الحالي (جهاز مشترك يبدّل مستخدمه) — الإرسال في services/push.ts.
 * عنوان اشتراك المتصفح يصبح وجهة طلبات HTTPS من الخادم عند كل إشعار، لذا يُقبل فقط https إلى مضيف عام باسم نطاق
 * (لا عناوين IP ولا شبكات داخلية)، ويُحتفظ لكل حساب بآخر ١٠ أجهزة فقط كي لا يتضخّم الإرسال.
 */
const router = Router();
const MAX_DEVICES_PER_USER = 10;
const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':');
const isInternalHost = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa') || !host.includes('.');
/** عنوان اشتراك متصفح مقبول: https + اسم نطاق عام */
function assertPushEndpoint(endpoint: string) {
  let u: URL;
  try { u = new URL(endpoint); } catch { throw badRequest('عنوان الاشتراك غير صالح'); }
  const host = u.hostname.toLowerCase();
  // للاختبار المحلي فقط (خارج الإنتاج): PUSH_ALLOW_LOCAL_ENDPOINTS=1 يسمح بخدمة إشعارات وهمية على localhost
  if (config.env !== 'production' && process.env.PUSH_ALLOW_LOCAL_ENDPOINTS === '1' && (host === 'localhost' || host === '127.0.0.1')) return;
  if (u.protocol !== 'https:' || u.username || u.password || isIpLiteral(host) || isInternalHost(host)) throw badRequest('عنوان الاشتراك غير مسموح — يجب أن يكون خدمة إشعارات عامة عبر https');
}

/** المفتاح العام VAPID الذي يشترك به المتصفح — عام بلا دخول */
router.get('/push/public-key', (_req, res) => { res.json({ key: config.push.vapid.publicKey || null }); });

router.post('/me/push', requireAuth, validate(PushRegister), asyncHandler(async (req, res) => {
  const d = body<typeof PushRegister>(req);
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 200) || null;
  if (d.kind === 'web') assertPushEndpoint(d.subscription.endpoint);
  const [token, auth, p256dh] = d.kind === 'web' ? [d.subscription.endpoint, d.subscription.keys.auth, d.subscription.keys.p256dh] : [d.token, null, null];
  q.run(`INSERT INTO push_devices (user_id, kind, token, auth, p256dh, platform, user_agent, last_used_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(kind, token) DO UPDATE SET user_id = excluded.user_id, auth = excluded.auth, p256dh = excluded.p256dh,
           platform = COALESCE(excluded.platform, push_devices.platform), user_agent = excluded.user_agent, last_used_at = excluded.last_used_at`,
    req.user!.id, d.kind, token, auth, p256dh, d.platform ?? (d.kind === 'web' ? 'web' : null), ua, nowIso());
  // الأقدم استعمالاً يُزاح حين يتجاوز الحساب الحدّ
  q.run(`DELETE FROM push_devices WHERE user_id = ? AND id NOT IN (SELECT id FROM push_devices WHERE user_id = ? ORDER BY COALESCE(last_used_at, created_at) DESC, id DESC LIMIT ?)`,
    req.user!.id, req.user!.id, MAX_DEVICES_PER_USER);
  res.json({ ok: true, kind: d.kind });
}));

router.delete('/me/push', requireAuth, validate(PushUnregister), asyncHandler(async (req, res) => {
  const d = body<typeof PushUnregister>(req);
  const token = d.token ?? d.endpoint!;
  const info = q.run('DELETE FROM push_devices WHERE user_id = ? AND kind = ? AND token = ?', req.user!.id, d.kind, token);
  res.json({ ok: true, removed: info.changes });
}));

export default router;
