import { q } from '../db/database.js';
import { nowIso } from '../utils/helpers.js';

/** الاشتراك الفعّال للمستخدم (إن وُجد). */
export function activeSubscription(userId) {
  if (!userId) return null;
  return q.get(
    `SELECT s.*, p.name AS plan_name, p.slug AS plan_slug, p.includes
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = ? AND s.status = 'active' AND s.ends_at > ?
      ORDER BY s.ends_at DESC LIMIT 1`,
    userId, nowIso(),
  );
}

function subscriptionCovers(sub, itemType) {
  if (!sub) return false;
  let includes = {};
  try { includes = JSON.parse(sub.includes || '{}'); } catch {}
  if (itemType === 'course') return !!includes.courses;
  if (itemType === 'summary') return !!includes.summaries;
  return false;
}

/**
 * هل يملك المستخدم صلاحية الوصول لهذا العنصر؟
 * يُرجع { allowed, reason } — reason ∈ owner|admin|free|purchase|subscription|none
 */
export function checkAccess(userId, itemType, itemId, opts = {}) {
  if (!userId) return { allowed: false, reason: 'guest' };

  const user = opts.user || q.get('SELECT id, role FROM users WHERE id = ?', userId);
  if (!user) return { allowed: false, reason: 'guest' };
  if (user.role === 'admin') return { allowed: true, reason: 'admin' };

  // صاحب المحتوى
  if (itemType === 'course') {
    const c = q.get('SELECT instructor_id, price, discount_price FROM courses WHERE id = ?', itemId);
    if (!c) return { allowed: false, reason: 'none' };
    if (c.instructor_id === userId) return { allowed: true, reason: 'owner' };
    if (Number(c.discount_price ?? c.price) === 0) return { allowed: true, reason: 'free' };
  }
  if (itemType === 'summary') {
    const s = q.get('SELECT author_id, price, discount_price FROM summaries WHERE id = ?', itemId);
    if (!s) return { allowed: false, reason: 'none' };
    if (s.author_id === userId) return { allowed: true, reason: 'owner' };
    if (Number(s.discount_price ?? s.price) === 0) return { allowed: true, reason: 'free' };
  }
  if (itemType === 'live_session') {
    const l = q.get('SELECT instructor_id, price FROM live_sessions WHERE id = ?', itemId);
    if (!l) return { allowed: false, reason: 'none' };
    if (l.instructor_id === userId) return { allowed: true, reason: 'owner' };
    // الحصة المجانية تظل بمقاعد محدودة: الدخول يتطلّب حجزاً فعلياً لا مجرّد سعر صفري
  }

  const ent = q.get(
    `SELECT * FROM entitlements
      WHERE user_id = ? AND item_type = ? AND item_id = ?
        AND (expires_at IS NULL OR expires_at > ?)`,
    userId, itemType, itemId, nowIso(),
  );
  if (ent) return { allowed: true, reason: ent.source };

  const sub = activeSubscription(userId);
  if (subscriptionCovers(sub, itemType)) return { allowed: true, reason: 'subscription', subscription: sub };

  return { allowed: false, reason: 'none' };
}

/** يمنح صلاحية وصول (idempotent). */
export function grantAccess(userId, itemType, itemId, { source = 'purchase', orderId = null, expiresAt = null } = {}) {
  q.run(
    `INSERT INTO entitlements (user_id, item_type, item_id, source, order_id, expires_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET
       source = excluded.source, order_id = COALESCE(excluded.order_id, entitlements.order_id),
       expires_at = excluded.expires_at`,
    userId, itemType, itemId, source, orderId, expiresAt,
  );

  if (itemType === 'course') {
    q.run(
      `INSERT INTO enrollments (user_id, course_id) VALUES (?,?)
       ON CONFLICT(user_id, course_id) DO NOTHING`,
      userId, itemId,
    );
    q.run('UPDATE courses SET students_count = (SELECT COUNT(*) FROM enrollments WHERE course_id = ?) WHERE id = ?', itemId, itemId);
    const c = q.get('SELECT instructor_id FROM courses WHERE id = ?', itemId);
    if (c) {
      q.run(
        `UPDATE instructor_profiles SET students_count =
           (SELECT COUNT(DISTINCT e.user_id) FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.instructor_id = ?)
         WHERE user_id = ?`, c.instructor_id, c.instructor_id,
      );
    }
  }

  if (itemType === 'live_session') {
    q.run(
      `INSERT INTO live_bookings (session_id, user_id, order_id) VALUES (?,?,?)
       ON CONFLICT(session_id, user_id) DO UPDATE SET status = 'booked'`,
      itemId, userId, orderId,
    );
  }

  if (itemType === 'summary') {
    q.run('UPDATE summaries SET sales_count = sales_count + 1 WHERE id = ?', itemId);
  }
}

/** يمنح كل عناصر الحزمة. */
export function grantBundle(userId, bundleId, opts = {}) {
  const bundle = q.get('SELECT * FROM bundles WHERE id = ?', bundleId);
  if (!bundle) return;
  let items = [];
  try { items = JSON.parse(bundle.items || '[]'); } catch {}
  grantAccess(userId, 'bundle', bundleId, opts);
  for (const it of items) grantAccess(userId, it.type, it.id, { ...opts, source: 'bundle' });
}
