import { db, q, settings, nowIso, json } from '../db/index.ts';
import { config } from '../config.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { money, orderNumber, addMinutes, hoursUntil } from '../lib/helpers.ts';
import { grantAccess, revokeAccess, checkAccess } from './access.ts';
import * as wallet from './wallet.ts';
import { recordEarning, reverseEarning } from './earnings.ts';
import { notify } from './notifications.ts';
import { sendReceipt, notifyBookingConfirmed } from './mail.ts';

export type ItemType = 'book' | 'course' | 'lesson' | 'package' | 'subscription';
export interface ResolvedItem {
  type: ItemType; id: number; title: string; price: number; listPrice: number;
  teacherId: number | null; coverFileId: number | null;
}

/** يجلب عنصراً قابلاً للشراء بشكل موحّد — الأسعار من قاعدة البيانات لا من العميل */
export function resolveItem(type: ItemType, id: number): ResolvedItem | null {
  switch (type) {
    case 'book': {
      const r = q.get<any>("SELECT id, title, price, author_id, cover_file_id FROM books WHERE id = ? AND status = 'published'", id);
      return r ? { type, id: r.id, title: r.title, price: money(r.price), listPrice: money(r.price), teacherId: r.author_id, coverFileId: r.cover_file_id } : null;
    }
    case 'course': {
      const r = q.get<any>("SELECT id, title, price, teacher_id, cover_file_id FROM courses WHERE id = ? AND status = 'published'", id);
      return r ? { type, id: r.id, title: r.title, price: money(r.price), listPrice: money(r.price), teacherId: r.teacher_id, coverFileId: r.cover_file_id } : null;
    }
    case 'lesson': {
      const r = q.get<any>(`SELECT b.id, b.price, b.teacher_id, s.name AS subject, b.duration_minutes FROM bookings b JOIN subjects s ON s.id = b.subject_id WHERE b.id = ? AND b.status = 'pending_payment'`, id);
      return r ? { type, id: r.id, title: `حصة ${r.subject} (${r.duration_minutes} د)`, price: money(r.price), listPrice: money(r.price), teacherId: r.teacher_id, coverFileId: null } : null;
    }
    case 'package': {
      const r = q.get<any>(`SELECT p.*, tp.price AS unit FROM lesson_packages p LEFT JOIN teacher_prices tp ON tp.teacher_id = p.teacher_id AND tp.duration_minutes = p.duration_minutes AND tp.mode = p.mode WHERE p.id = ? AND p.active = 1`, id);
      return r ? { type, id: r.id, title: `باقة ${r.lessons_count} حصص (${r.duration_minutes} د)`, price: money(r.price), listPrice: money((r.unit ?? 0) * r.lessons_count || r.price), teacherId: r.teacher_id, coverFileId: null } : null;
    }
    default: return null;
  }
}

/* ---------- الكوبونات ---------- */
export function applyCoupon(code: string | null | undefined, items: ResolvedItem[], userId: number) {
  if (!code) return { discount: 0, coupon: null as any };
  const c = q.get<any>('SELECT * FROM coupons WHERE code = ? AND active = 1', code.trim().toUpperCase());
  if (!c) throw new AppError('validation_error', 'رمز الخصم غير صحيح', 400);
  const now = nowIso();
  if (c.starts_at && c.starts_at > now) throw new AppError('validation_error', 'رمز الخصم لم يُفعَّل بعد', 400);
  if (c.ends_at && c.ends_at < now) throw new AppError('validation_error', 'انتهت صلاحية رمز الخصم', 400);
  // السقوف تحسب المحجوز أيضاً: طلب معلّق لم تنتهِ مهلته يحجز استخداماً — وإلا تُتجاوز السقوف بإنشاء طلبات متوازية ثم دفعها
  const pending = (extra: string, ...p: unknown[]) =>
    q.val<number>(`SELECT COUNT(*) FROM orders WHERE coupon_id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)${extra}`, c.id, now, ...p) ?? 0;
  if (c.usage_limit != null && c.used_count + pending('') >= c.usage_limit) throw new AppError('validation_error', 'استُنفد رمز الخصم', 400);
  if (c.user_limit != null) {
    const used = q.val<number>('SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?', c.id, userId) ?? 0;
    if (used + pending(' AND user_id = ?', userId) >= c.user_limit) throw new AppError('validation_error', 'استخدمت هذا الرمز من قبل', 400);
  }
  const scope = json<{ products?: { type: string; id: number }[]; teacherId?: number; category?: string }>(c.scope, {});
  const eligible = items.filter(it => {
    if (scope.products?.length) return scope.products.some(p => p.type === it.type && p.id === it.id);
    if (scope.teacherId) return it.teacherId === scope.teacherId;
    if (scope.category) return it.type === scope.category;
    return true;
  });
  const base = money(eligible.reduce((s, it) => s + it.price, 0));
  if (base <= 0) throw new AppError('validation_error', 'رمز الخصم لا ينطبق على هذه العناصر', 400);
  const raw = c.type === 'percentage' ? base * (c.value / 100) : c.value;
  return { discount: money(Math.min(raw, base)), coupon: c };
}

/* ---------- التسعير ---------- */
export function quote({ items, couponCode, userId }: { items: { type: ItemType; id: number }[]; couponCode?: string | null; userId: number }) {
  const resolved: ResolvedItem[] = [];
  for (const raw of items) {
    const item = resolveItem(raw.type, raw.id);
    if (!item) throw new AppError('content_unavailable', 'أحد العناصر غير متاح للشراء', 400);
    if ((item.type === 'book' || item.type === 'course') && checkAccess(userId, item.type, item.id).allowed) {
      throw new AppError('conflict', `تملك «${item.title}» بالفعل`, 409);
    }
    resolved.push(item);
  }
  const subtotal = money(resolved.reduce((s, it) => s + it.price, 0));
  const { discount, coupon } = applyCoupon(couponCode, resolved, userId);
  const taxRate = settings.get<number>('tax_rate');
  const tax = money((subtotal - discount) * taxRate);
  return { items: resolved, subtotal, discount, tax, taxRate, total: money(subtotal - discount + tax), coupon };
}

/* ---------- إنشاء الطلب ---------- */
/** learnerId: نسبة الطلب لمتعلّم (للعرض والتقارير) — الملكية تبقى للحساب userId */
export function createOrder(userId: number, { items, couponCode, meta, learnerId = null }: { items: { type: ItemType; id: number }[]; couponCode?: string | null; meta?: unknown; learnerId?: number | null }) {
  if (!items.length) throw new AppError('validation_error', 'لا عناصر للشراء', 400);
  const calc = quote({ items, couponCode, userId });
  return db.transaction(() => {
    const info = q.run(
      `INSERT INTO orders (number, user_id, subtotal, discount, tax, total, currency, coupon_id, status, expires_at, meta, learner_id)
       VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)`,
      orderNumber(), userId, calc.subtotal, calc.discount, calc.tax, calc.total, config.money.currency,
      calc.coupon?.id ?? null, addMinutes(30), meta ? JSON.stringify(meta) : null, learnerId ?? null);
    const orderId = Number(info.lastInsertRowid);
    for (const it of calc.items) {
      const share = calc.subtotal > 0 ? it.price / calc.subtotal : 0;
      const net = money(it.price - calc.discount * share);
      const rate = it.teacherId ? (q.val<number>('SELECT commission_rate FROM teacher_profiles WHERE user_id = ?', it.teacherId) ?? settings.get<number>('commission_rate')) : 0;
      const teacherShare = it.teacherId ? money(net * (1 - rate)) : 0;
      q.run(`INSERT INTO order_items (order_id, item_type, item_id, title, unit_price, quantity, teacher_id, teacher_share, platform_share) VALUES (?,?,?,?,?,1,?,?,?)`,
        orderId, it.type, it.id, it.title, it.price, it.teacherId, teacherShare, money(net - teacherShare));
      if (it.type === 'lesson') q.run('UPDATE bookings SET order_id = ? WHERE id = ?', orderId, it.id);
    }
    return q.get<any>('SELECT * FROM orders WHERE id = ?', orderId)!;
  })();
}

/* ---------- التنفيذ بعد الدفع (آمن للتكرار) ---------- */
export function fulfillOrder(orderId: number, { provider, providerRef }: { provider: string; providerRef?: string | null }) {
  const result = fulfillOrderTx(orderId, { provider, providerRef });
  if (!result.alreadyPaid) {
    // بريد بعد الالتزام (fire-and-forget): إيصال للحساب، وتأكيد لكل حصة صارت مؤكَّدة بهذا الطلب — لا يمسّ منطق المال
    void sendReceipt(result.order);
    for (const it of q.all<{ item_id: number }>("SELECT item_id FROM order_items WHERE order_id = ? AND item_type = 'lesson'", orderId)) void notifyBookingConfirmed(it.item_id);
  }
  return result;
}
function fulfillOrderTx(orderId: number, { provider, providerRef }: { provider: string; providerRef?: string | null }) {
  return db.transaction(() => {
    const order = q.get<any>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) throw notFound('الطلب غير موجود');
    if (order.status === 'paid') return { order, alreadyPaid: true };
    if (order.status === 'refunded') throw new AppError('conflict', 'تم استرجاع هذا الطلب', 409);

    const items = q.all<any>('SELECT * FROM order_items WHERE order_id = ?', orderId);
    for (const it of items) {
      if (it.item_type === 'book' || it.item_type === 'course') {
        grantAccess(order.user_id, it.item_type, it.item_id, { source: 'purchase', orderId });
      } else if (it.item_type === 'lesson') {
        q.run("UPDATE bookings SET status = 'confirmed', expires_at = NULL WHERE id = ? AND status = 'pending_payment'", it.item_id);
      } else if (it.item_type === 'package') {
        // الباقة تتبع متعلّم الطلب (NULL = لأي متعلّم في الحساب)
        const pkg = q.get<any>('SELECT * FROM lesson_packages WHERE id = ?', it.item_id);
        q.run('INSERT INTO package_purchases (user_id, package_id, teacher_id, order_id, total, remaining, learner_id) VALUES (?,?,?,?,?,?,?)',
          order.user_id, pkg.id, pkg.teacher_id, orderId, pkg.lessons_count, pkg.lessons_count, order.learner_id ?? null);
      }
      if (it.teacher_id && it.unit_price > 0) {
        const gross = money(it.teacher_share + it.platform_share);
        const rate = gross > 0 ? it.platform_share / gross : 0;
        recordEarning(it.teacher_id, { sourceType: it.item_type, sourceId: it.item_id, orderId, gross, commissionRate: rate });
        // teacherSale يميّز إشعار البائع عن إشعار المشتري: التطبيق يفتح به الأرباح لا «مشترياتي»
        notify(it.teacher_id, { type: 'system', title: 'عملية بيع جديدة', body: it.title, data: { orderId, teacherSale: true } });
      }
    }
    q.run("UPDATE orders SET status = 'paid', paid_at = ?, provider = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ?", nowIso(), provider, providerRef ?? null, orderId);
    q.run("UPDATE payments SET status = 'succeeded' WHERE order_id = ? AND status = 'pending'", orderId);
    if (order.coupon_id) {
      q.run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', order.coupon_id);
      q.run('INSERT OR IGNORE INTO coupon_redemptions (coupon_id, user_id, order_id) VALUES (?,?,?)', order.coupon_id, order.user_id, orderId);
    }
    q.run('DELETE FROM cart_items WHERE user_id = ? AND (item_type, item_id) IN (SELECT item_type, item_id FROM order_items WHERE order_id = ?)', order.user_id, orderId);
    return { order: q.get<any>('SELECT * FROM orders WHERE id = ?', orderId), alreadyPaid: false };
  })();
}

/* ---------- الاسترجاع ---------- */
/** مجموع ما استُرجع من الطلب حتى الآن */
export const refundedTotal = (orderId: number): number =>
  money(q.val<number>('SELECT COALESCE(SUM(amount),0) FROM refunds WHERE order_id = ?', orderId) ?? 0);

/** المتبقّي القابل للاسترجاع = المدفوع − ما استُرجع */
export const refundableRemaining = (order: { id: number; total: number }): number =>
  money(order.total - refundedTotal(order.id));

/**
 * ما دُفع فعلاً مقابل عنصر في الطلب (حصّته من الإجمالي بعد الكوبون والضريبة) —
 * أساس أي استرجاع، لا السعر المعلن (حصة بكوبون خصم تُسترجع بما دُفع).
 */
export function paidForItem(orderId: number, itemType: ItemType, itemId: number): number {
  const order = q.get<{ total: number; subtotal: number }>('SELECT total, subtotal FROM orders WHERE id = ?', orderId);
  const item = q.get<{ unit_price: number }>('SELECT unit_price FROM order_items WHERE order_id = ? AND item_type = ? AND item_id = ?', orderId, itemType, itemId);
  if (!order || !item) return 0;
  if (order.subtotal <= 0) return money(order.total);
  return money(order.total * (item.unit_price / order.subtotal));
}
/** ما دُفع مقابل حصة (طلب الحصة الواحدة) */
export const paidForBooking = (orderId: number, bookingId: number): number => paidForItem(orderId, 'lesson', bookingId);

export function refundOrder(orderId: number, { amount, reason, bookingId, processedBy, toWallet = true, clamp = false }:
  { amount?: number; reason?: string | null; bookingId?: number | null; processedBy?: number | null; toWallet?: boolean; clamp?: boolean }) {
  return db.transaction(() => {
    const order = q.get<any>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) throw notFound('الطلب غير موجود');
    if (order.status !== 'paid' && order.status !== 'partially_refunded') throw new AppError('conflict', 'لا يمكن استرجاع طلب غير مدفوع', 409);
    // سقف الاسترجاع: لا يتجاوز المدفوع ناقص ما استُرجع سابقاً — بأي حال (إدارة كانت أو إلغاء حصة)
    const remaining = refundableRemaining(order);
    if (remaining <= 0) throw new AppError('conflict', 'استُرجع هذا الطلب بالكامل', 409);
    const requested = money(amount ?? remaining);
    if (requested <= 0) throw new AppError('validation_error', 'مبلغ الاسترجاع يجب أن يكون أكبر من صفر', 400);
    if (requested > remaining && !clamp) throw new AppError('conflict', `المبلغ يتجاوز المتبقّي القابل للاسترجاع (${remaining} ${order.currency})`, 409);
    const refundAmount = Math.min(requested, remaining);
    const items = q.all<any>('SELECT * FROM order_items WHERE order_id = ?', orderId);
    const full = money(remaining - refundAmount) <= 0;

    for (const it of items) {
      if (bookingId && !(it.item_type === 'lesson' && it.item_id === bookingId)) continue;
      if (full || bookingId) {
        if (it.item_type === 'book' || it.item_type === 'course') revokeAccess(order.user_id, it.item_type, it.item_id);
        if (it.item_type === 'package') q.run('UPDATE package_purchases SET remaining = 0 WHERE order_id = ? AND package_id = ?', orderId, it.item_id);
        if (it.teacher_id) reverseEarning({ orderId, sourceType: it.item_type, sourceId: it.item_id });
      }
    }
    if (toWallet && refundAmount > 0) wallet.credit(order.user_id, refundAmount, { type: 'refund', refType: 'order', refId: orderId, note: `استرجاع الطلب ${order.number}` });
    q.run('INSERT INTO refunds (order_id, booking_id, amount, reason, policy_applied, status, processed_by, processed_at) VALUES (?,?,?,?,?,?,?,?)',
      orderId, bookingId ?? null, refundAmount, reason ?? null, JSON.stringify(settings.get('cancellation_policy')), 'processed', processedBy ?? null, nowIso());
    q.run('UPDATE orders SET status = ? WHERE id = ?', full ? 'refunded' : 'partially_refunded', orderId);
    if (full) q.run("UPDATE payments SET status = 'refunded' WHERE order_id = ?", orderId);
    notify(order.user_id, { type: 'refund_processed', title: 'تم استرجاع المبلغ', body: `${refundAmount} ${order.currency} — ${order.number}`, data: { orderId } });
    return q.get<any>('SELECT * FROM orders WHERE id = ?', orderId);
  })();
}

/** يُنهي الطلبات المعلّقة المنتهية (مهمة دورية) */
export function expirePendingOrders(): number {
  const rows = q.all<{ id: number }>("SELECT id FROM orders WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?", nowIso());
  for (const r of rows) {
    q.run("UPDATE orders SET status = 'expired' WHERE id = ?", r.id);
    q.run("UPDATE payments SET status = 'failed' WHERE order_id = ? AND status = 'pending'", r.id);
  }
  return rows.length;
}

/** نسبة الاسترجاع حسب سياسة الإلغاء (من الإعدادات، لا من الشيفرة) */
export function refundPercentFor(startsAt: string): number {
  const policy = settings.get<{ hoursBefore: number; refundPercent: number }[]>('cancellation_policy');
  const hours = hoursUntil(startsAt);
  const sorted = [...policy].sort((a, b) => b.hoursBefore - a.hoursBefore);
  for (const rule of sorted) if (hours >= rule.hoursBefore) return rule.refundPercent;
  return 0;
}
