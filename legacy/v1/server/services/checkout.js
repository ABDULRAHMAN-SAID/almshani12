import config from '../config.js';
import { db, q } from '../db/database.js';
import { AppError } from '../middleware/error.js';
import { money, orderNumber, nowIso, addDays, json } from '../utils/helpers.js';
import { grantAccess, grantBundle, checkAccess } from './access.js';
import * as wallet from './wallet.js';
import { notify, notifyAdmins } from './notifications.js';

/** يجلب بيانات عنصر قابل للشراء موحّدة الشكل. */
export function resolveItem(itemType, itemId) {
  switch (itemType) {
    case 'course': {
      const row = q.get('SELECT * FROM courses WHERE id = ?', itemId);
      if (!row || row.status !== 'published') return null;
      return { type: 'course', id: row.id, title: row.title, price: money(row.discount_price ?? row.price),
               listPrice: money(row.price), instructorId: row.instructor_id, cover: row.thumbnail, slug: row.slug };
    }
    case 'summary': {
      const row = q.get('SELECT * FROM summaries WHERE id = ?', itemId);
      if (!row || row.status !== 'published') return null;
      return { type: 'summary', id: row.id, title: row.title, price: money(row.discount_price ?? row.price),
               listPrice: money(row.price), instructorId: row.author_id, cover: row.cover, slug: row.slug };
    }
    case 'live_session': {
      const row = q.get('SELECT * FROM live_sessions WHERE id = ?', itemId);
      if (!row || row.status === 'cancelled') return null;
      return { type: 'live_session', id: row.id, title: row.title, price: money(row.price),
               listPrice: money(row.price), instructorId: row.instructor_id, cover: row.cover, startsAt: row.starts_at };
    }
    case 'bundle': {
      const row = q.get('SELECT * FROM bundles WHERE id = ? AND active = 1', itemId);
      if (!row) return null;
      return { type: 'bundle', id: row.id, title: row.title, price: money(row.price), listPrice: money(row.price),
               instructorId: null, cover: row.cover, slug: row.slug };
    }
    case 'plan': {
      const row = q.get('SELECT * FROM plans WHERE id = ? AND active = 1', itemId);
      if (!row) return null;
      return { type: 'plan', id: row.id, title: `اشتراك ${row.name}`, price: money(row.price),
               listPrice: money(row.price), instructorId: null, interval: row.interval };
    }
    default:
      return null;
  }
}

/** يتحقّق من الكوبون ويحسب الخصم على المجموع المؤهَّل. */
export function applyCoupon(code, items, userId) {
  if (!code) return { discount: 0, coupon: null };
  const coupon = q.get('SELECT * FROM coupons WHERE code = ? AND active = 1', String(code).trim().toUpperCase());
  if (!coupon) throw new AppError('رمز الخصم غير صحيح', 400, 'invalid_coupon');

  const now = nowIso();
  if (coupon.starts_at && coupon.starts_at > now) throw new AppError('رمز الخصم لم يُفعّل بعد', 400, 'coupon_not_started');
  if (coupon.expires_at && coupon.expires_at < now) throw new AppError('انتهت صلاحية رمز الخصم', 400, 'coupon_expired');
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) throw new AppError('استُنفد رمز الخصم', 400, 'coupon_exhausted');

  const scope = json(coupon.applies_to, { type: 'all' });
  const eligible = items.filter(it => {
    if (!scope || scope.type === 'all') return true;
    if (scope.type === it.type) return !scope.ids?.length || scope.ids.includes(it.id);
    return false;
  });
  const eligibleTotal = money(eligible.reduce((s, it) => s + it.price, 0));
  if (eligibleTotal <= 0) throw new AppError('رمز الخصم لا ينطبق على محتويات السلة', 400, 'coupon_not_applicable');
  if (eligibleTotal < coupon.min_amount) {
    throw new AppError(`الحد الأدنى لاستخدام هذا الرمز ${coupon.min_amount} ${config.money.symbol}`, 400, 'coupon_min_amount');
  }

  const raw = coupon.type === 'percent' ? (eligibleTotal * coupon.value) / 100 : coupon.value;
  return { discount: money(Math.min(raw, eligibleTotal)), coupon };
}

/** يحسب فاتورة السلة دون إنشاء طلب. */
export function quote({ items, couponCode = null, userId = null }) {
  const resolved = [];
  for (const raw of items) {
    const item = resolveItem(raw.item_type || raw.type, raw.item_id ?? raw.id);
    if (!item) throw new AppError('أحد العناصر غير متاح للشراء', 400, 'item_unavailable');
    if (userId && item.type !== 'plan') {
      const access = checkAccess(userId, item.type, item.id);
      if (access.allowed && ['purchase', 'admin', 'bundle', 'gift'].includes(access.reason)) {
        throw new AppError(`لقد اشتريت «${item.title}» مسبقاً`, 409, 'already_owned');
      }
    }
    resolved.push(item);
  }

  const subtotal = money(resolved.reduce((s, it) => s + it.price, 0));
  const { discount, coupon } = applyCoupon(couponCode, resolved, userId);
  const taxable = money(subtotal - discount);
  const tax = money(taxable * config.money.taxRate);
  const total = money(taxable + tax);

  return { items: resolved, subtotal, discount, tax, total, coupon, currency: config.money.currency };
}

/** ينشئ طلباً بحالة "معلّق". */
export function createOrder(userId, { items, couponCode = null, meta = null }) {
  if (!items?.length) throw new AppError('السلة فارغة', 400, 'empty_cart');
  const calc = quote({ items, couponCode, userId });

  return db.transaction(() => {
    const info = q.run(
      `INSERT INTO orders (number, user_id, subtotal, discount, tax, total, currency, coupon_id, status, meta)
       VALUES (?,?,?,?,?,?,?,?,'pending',?)`,
      orderNumber(), userId, calc.subtotal, calc.discount, calc.tax, calc.total,
      calc.currency, calc.coupon?.id ?? null, meta ? JSON.stringify(meta) : null,
    );
    const orderId = info.lastInsertRowid;
    const commission = config.money.commissionRate;

    for (const item of calc.items) {
      // توزيع الخصم على العناصر بالتناسب حتى تبقى حصص المعلّمين عادلة
      const share = calc.subtotal > 0 ? item.price / calc.subtotal : 0;
      const netPrice = money(item.price - calc.discount * share);
      const instructorShare = item.instructorId ? money(netPrice * (1 - commission)) : 0;
      q.run(
        `INSERT INTO order_items (order_id, item_type, item_id, title, unit_price, quantity, instructor_id, instructor_share, platform_share)
         VALUES (?,?,?,?,?,1,?,?,?)`,
        orderId, item.type, item.id, item.title, item.price,
        item.instructorId, instructorShare, money(netPrice - instructorShare),
      );
    }
    return q.get('SELECT * FROM orders WHERE id = ?', orderId);
  })();
}

/**
 * يعتمد الطلب بعد نجاح الدفع: يمنح الصلاحيات، يوزّع الأرباح، ويُشعر الأطراف.
 * آمن للتكرار (idempotent) — الطلب المدفوع مسبقاً لا يُعالَج مرتين.
 */
export function fulfillOrder(orderId, { provider = 'mock', providerRef = null } = {}) {
  return db.transaction(() => {
    const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) throw new AppError('الطلب غير موجود', 404, 'not_found');
    if (order.status === 'paid') return { order, alreadyPaid: true };
    if (order.status === 'refunded') throw new AppError('تم استرجاع هذا الطلب', 409, 'order_refunded');

    const items = q.all('SELECT * FROM order_items WHERE order_id = ?', orderId);

    for (const item of items) {
      if (item.item_type === 'bundle') {
        grantBundle(order.user_id, item.item_id, { source: 'purchase', orderId });
      } else if (item.item_type === 'plan') {
        activateSubscription(order.user_id, item.item_id, orderId);
      } else {
        grantAccess(order.user_id, item.item_type, item.item_id, { source: 'purchase', orderId });
      }

      if (item.instructor_id && item.instructor_share > 0) {
        wallet.creditInstructor(item.instructor_id, item.instructor_share, {
          refType: 'order', refId: orderId, note: `أرباح من: ${item.title}`,
        });
        notify(item.instructor_id, {
          type: 'sale', title: 'عملية بيع جديدة 🎉',
          body: `تم شراء «${item.title}» — حصّتك ${money(item.instructor_share)} ${config.money.symbol}`,
          link: '#/instructor/earnings',
        });
      }
    }

    q.run("UPDATE orders SET status = 'paid', paid_at = ?, provider = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ?",
      nowIso(), provider, providerRef, orderId);
    q.run("UPDATE payments SET status = 'succeeded' WHERE order_id = ? AND status = 'pending'", orderId);
    if (order.coupon_id) q.run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', order.coupon_id);

    payReferralBonus(order);

    notify(order.user_id, {
      type: 'order', title: 'تم تأكيد طلبك ✅',
      body: `الطلب ${order.number} — أصبح المحتوى متاحاً في «تعلّمي».`,
      link: '#/my-learning',
    });

    return { order: q.get('SELECT * FROM orders WHERE id = ?', orderId), alreadyPaid: false };
  })();
}

/** مكافأة الإحالة عند أول عملية شراء ناجحة. */
function payReferralBonus(order) {
  const bonus = config.money.referralBonus;
  if (bonus <= 0) return;
  const user = q.get('SELECT referred_by FROM users WHERE id = ?', order.user_id);
  if (!user?.referred_by) return;
  const priorPaid = q.val(
    "SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status = 'paid' AND id <> ?", order.user_id, order.id);
  if (priorPaid > 0) return;

  wallet.credit(user.referred_by, bonus, { type: 'referral', refType: 'order', refId: order.id, note: 'مكافأة إحالة صديق' });
  notify(user.referred_by, {
    type: 'referral', title: 'مكافأة إحالة 🎁',
    body: `أُضيف ${bonus} ${config.money.symbol} إلى محفظتك بعد أول عملية شراء لمن دعوتَه.`,
    link: '#/wallet',
  });
}

/** يفعّل أو يمدّد اشتراك المستخدم. */
export function activateSubscription(userId, planId, orderId = null) {
  const plan = q.get('SELECT * FROM plans WHERE id = ?', planId);
  if (!plan) throw new AppError('الباقة غير موجودة', 404, 'not_found');

  const days = plan.interval === 'year' ? 365 : 30;
  const current = q.get(
    "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' AND ends_at > ? ORDER BY ends_at DESC LIMIT 1",
    userId, nowIso(),
  );
  // التمديد يبدأ من نهاية الاشتراك الحالي حتى لا تضيع أيام مدفوعة
  const startFrom = current ? new Date(current.ends_at) : new Date();
  const endsAt = addDays(days, startFrom);

  if (current && current.plan_id === planId) {
    q.run('UPDATE subscriptions SET ends_at = ? WHERE id = ?', endsAt, current.id);
    return q.get('SELECT * FROM subscriptions WHERE id = ?', current.id);
  }
  if (current) q.run("UPDATE subscriptions SET status = 'cancelled' WHERE id = ?", current.id);

  const info = q.run(
    'INSERT INTO subscriptions (user_id, plan_id, status, starts_at, ends_at, order_id) VALUES (?,?,?,?,?,?)',
    userId, planId, 'active', nowIso(), endsAt, orderId,
  );
  notify(userId, {
    type: 'subscription', title: `تم تفعيل باقة ${plan.name}`,
    body: `اشتراكك سارٍ حتى ${new Date(endsAt).toLocaleDateString('ar')}`, link: '#/plans',
  });
  return q.get('SELECT * FROM subscriptions WHERE id = ?', info.lastInsertRowid);
}

/** استرجاع كامل للطلب: سحب الصلاحيات، خصم أرباح المعلّم، وإرجاع المبلغ للمحفظة. */
export function refundOrder(orderId, { reason = null, toWallet = true } = {}) {
  return db.transaction(() => {
    const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) throw new AppError('الطلب غير موجود', 404, 'not_found');
    if (order.status !== 'paid') throw new AppError('لا يمكن استرجاع طلب غير مدفوع', 400, 'not_refundable');

    const items = q.all('SELECT * FROM order_items WHERE order_id = ?', orderId);
    for (const item of items) {
      q.run('DELETE FROM entitlements WHERE user_id = ? AND item_type = ? AND item_id = ?',
        order.user_id, item.item_type, item.item_id);
      if (item.item_type === 'course') {
        q.run('DELETE FROM enrollments WHERE user_id = ? AND course_id = ?', order.user_id, item.item_id);
        q.run('UPDATE courses SET students_count = (SELECT COUNT(*) FROM enrollments WHERE course_id = ?) WHERE id = ?',
          item.item_id, item.item_id);
      }
      if (item.item_type === 'live_session') {
        q.run("UPDATE live_bookings SET status = 'refunded' WHERE session_id = ? AND user_id = ?", item.item_id, order.user_id);
      }
      if (item.item_type === 'plan') {
        q.run("UPDATE subscriptions SET status = 'cancelled' WHERE order_id = ? AND user_id = ?", orderId, order.user_id);
      }
      if (item.instructor_id && item.instructor_share > 0) {
        const profile = q.get('SELECT balance FROM instructor_profiles WHERE user_id = ?', item.instructor_id);
        // لا نُدخل رصيد المعلّم في السالب إن كان قد سحب أرباحه
        const deduct = Math.min(profile?.balance ?? 0, item.instructor_share);
        if (deduct > 0) {
          q.run('UPDATE instructor_profiles SET balance = balance - ?, lifetime_earnings = lifetime_earnings - ? WHERE user_id = ?',
            deduct, deduct, item.instructor_id);
          q.run('INSERT INTO transactions (user_id, type, amount, balance_after, ref_type, ref_id, note) VALUES (?,?,?,?,?,?,?)',
            item.instructor_id, 'refund', -deduct,
            q.val('SELECT balance FROM instructor_profiles WHERE user_id = ?', item.instructor_id),
            'order', orderId, `استرجاع: ${item.title}`);
        }
      }
    }

    if (toWallet && order.total > 0) {
      wallet.credit(order.user_id, order.total, { type: 'refund', refType: 'order', refId: orderId, note: `استرجاع الطلب ${order.number}` });
    }

    q.run("UPDATE orders SET status = 'refunded' WHERE id = ?", orderId);
    q.run("UPDATE payments SET status = 'refunded' WHERE order_id = ?", orderId);
    notify(order.user_id, {
      type: 'refund', title: 'تم استرجاع مبلغ طلبك',
      body: `الطلب ${order.number}${reason ? ` — ${reason}` : ''}`, link: '#/orders',
    });
    notifyAdmins({ type: 'refund', title: 'استرجاع طلب', body: `الطلب ${order.number}`, link: '#/admin/orders' });
    return q.get('SELECT * FROM orders WHERE id = ?', orderId);
  })();
}
