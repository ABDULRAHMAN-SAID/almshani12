import crypto from 'node:crypto';
import config from '../config.js';
import { q } from '../db/database.js';
import { AppError } from '../middleware/error.js';
import { randomToken } from '../utils/helpers.js';

/**
 * طبقة تجريد لبوابات الدفع.
 * - mock   : بوابة تجريبية كاملة تعمل بلا مفاتيح (للتطوير والعرض)
 * - wallet : خصم من رصيد المحفظة
 * - manual : تحويل بنكي يعتمده المدير يدوياً
 * - stripe : بوابة حقيقية عبر REST (تُفعَّل عند ضبط STRIPE_SECRET_KEY)
 */

export const availableProviders = () =>
  config.payments.providers.filter(p => (p === 'stripe' ? !!config.payments.stripe.secretKey : true));

/* ----------------------------- mock ----------------------------- */
const mock = {
  id: 'mock',
  label: 'بطاقة تجريبية (وضع الاختبار)',
  async createCheckout(order) {
    const ref = `mock_${randomToken(8)}`;
    q.run(
      'INSERT INTO payments (order_id, provider, provider_ref, amount, currency, status) VALUES (?,?,?,?,?,?)',
      order.id, 'mock', ref, order.total, order.currency, 'pending',
    );
    q.run('UPDATE orders SET provider = ?, provider_ref = ? WHERE id = ?', 'mock', ref, order.id);
    return {
      provider: 'mock',
      reference: ref,
      // صفحة دفع داخلية تحاكي البوابة
      checkoutUrl: `/#/checkout/pay/${order.number}?ref=${ref}`,
      requiresRedirect: true,
    };
  },
};

/* ---------------------------- wallet ---------------------------- */
const wallet = {
  id: 'wallet',
  label: 'الرصيد (المحفظة)',
  async createCheckout(order) {
    const ref = `wal_${randomToken(6)}`;
    q.run(
      'INSERT INTO payments (order_id, provider, provider_ref, amount, currency, status) VALUES (?,?,?,?,?,?)',
      order.id, 'wallet', ref, order.total, order.currency, 'pending',
    );
    q.run('UPDATE orders SET provider = ?, provider_ref = ? WHERE id = ?', 'wallet', ref, order.id);
    return { provider: 'wallet', reference: ref, requiresRedirect: false, settleImmediately: true };
  },
};

/* ---------------------------- manual ---------------------------- */
const manual = {
  id: 'manual',
  label: 'تحويل بنكي (تأكيد يدوي)',
  async createCheckout(order) {
    const ref = `man_${order.number}`;
    q.run(
      'INSERT INTO payments (order_id, provider, provider_ref, amount, currency, status) VALUES (?,?,?,?,?,?)',
      order.id, 'manual', ref, order.total, order.currency, 'pending',
    );
    q.run('UPDATE orders SET provider = ?, provider_ref = ? WHERE id = ?', 'manual', ref, order.id);
    return {
      provider: 'manual',
      reference: ref,
      requiresRedirect: false,
      awaitingReview: true,
      instructions: {
        ...config.payments.manual,
        amount: order.total,
        currency: order.currency,
        reference: order.number,
        note: 'أرسل صورة إشعار التحويل مع رقم الطلب، وسيتم تفعيل المحتوى بعد المراجعة.',
      },
    };
  },
};

/* ---------------------------- stripe ---------------------------- */
async function stripeRequest(path, params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.payments.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new AppError(data?.error?.message || 'فشل الاتصال ببوابة الدفع', 502, 'gateway_error');
  return data;
}

const stripe = {
  id: 'stripe',
  label: 'بطاقة ائتمانية (Stripe)',
  async createCheckout(order) {
    const items = q.all('SELECT * FROM order_items WHERE order_id = ?', order.id);
    const params = {
      mode: 'payment',
      'payment_method_types[0]': 'card',
      success_url: `${config.publicUrl}/#/checkout/success?order=${order.number}`,
      cancel_url: `${config.publicUrl}/#/checkout/cancel?order=${order.number}`,
      client_reference_id: order.number,
      'metadata[order_id]': String(order.id),
    };
    // Stripe يستخدم أصغر وحدة نقدية
    const factor = 10 ** (order.currency === 'OMR' || order.currency === 'KWD' || order.currency === 'BHD' ? 3 : 2);
    items.forEach((item, i) => {
      params[`line_items[${i}][price_data][currency]`] = order.currency.toLowerCase();
      params[`line_items[${i}][price_data][unit_amount]`] = String(Math.round(item.unit_price * factor));
      params[`line_items[${i}][price_data][product_data][name]`] = item.title;
      params[`line_items[${i}][quantity]`] = String(item.quantity);
    });
    if (order.discount > 0) params['metadata[discount]'] = String(order.discount);

    const session = await stripeRequest('checkout/sessions', params);
    q.run(
      'INSERT INTO payments (order_id, provider, provider_ref, amount, currency, status, raw) VALUES (?,?,?,?,?,?,?)',
      order.id, 'stripe', session.id, order.total, order.currency, 'pending', JSON.stringify({ id: session.id }),
    );
    q.run('UPDATE orders SET provider = ?, provider_ref = ? WHERE id = ?', 'stripe', session.id, order.id);
    return { provider: 'stripe', reference: session.id, checkoutUrl: session.url, requiresRedirect: true };
  },
};

const registry = { mock, wallet, manual, stripe };

export function getProvider(name) {
  const provider = registry[name];
  if (!provider) throw new AppError('وسيلة دفع غير مدعومة', 400, 'unsupported_provider');
  if (!availableProviders().includes(name)) throw new AppError('وسيلة الدفع غير مفعّلة حالياً', 400, 'provider_disabled');
  return provider;
}

export const providerCatalog = () =>
  availableProviders().map(id => ({
    id,
    label: registry[id].label,
    ...(id === 'manual' ? { instructions: config.payments.manual } : {}),
  }));

/** تحقّق من توقيع Stripe للـ webhook. */
export function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = config.payments.stripe.webhookSecret;
  if (!secret) return { ok: false, reason: 'webhook_secret_missing' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };

  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !provided) return { ok: false, reason: 'malformed_signature' };

  // رفض الطوابع الزمنية القديمة (٥ دقائق) لمنع إعادة الإرسال
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature_mismatch' };
  return { ok: true };
}
