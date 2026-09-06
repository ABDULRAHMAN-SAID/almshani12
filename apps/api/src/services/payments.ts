import { config } from '../config.ts';
import { q } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import { randomToken, hmac, safeEqual } from '../lib/helpers.ts';

/**
 * طبقة تجريد الدفع — منقولة من الإصدار الأول ومُوسَّعة.
 * البوابة قابلة للتبديل حسب البلد ومتطلّبات المتاجر دون لمس الواجهة.
 * لا تُخزَّن بيانات بطاقات هنا أبداً.
 */
export interface OrderRow { id: number; number: string; user_id: number; total: number; currency: string }
export interface CheckoutSession {
  provider: string;
  reference: string;
  requiresRedirect: boolean;
  checkoutUrl: string | null;
  settleImmediately?: boolean;
  awaitingReview?: boolean;
  instructions?: Record<string, string>;
}
export interface PaymentProvider {
  id: string;
  label: string;
  description: string | null;
  createCheckout(order: OrderRow): Promise<CheckoutSession>;
}

const recordPayment = (order: OrderRow, provider: string, ref: string, raw: unknown = null) => {
  q.run('INSERT INTO payments (order_id, provider, provider_ref, amount, currency, status, raw) VALUES (?,?,?,?,?,?,?)',
    order.id, provider, ref, order.total, order.currency, 'pending', raw ? JSON.stringify(raw) : null);
  q.run('UPDATE orders SET provider = ?, provider_ref = ? WHERE id = ?', provider, ref, order.id);
};

/* ----------------------------- mock (تطوير) ----------------------------- */
const mock: PaymentProvider = {
  id: 'mock', label: 'بطاقة تجريبية', description: 'وضع الاختبار — لا تُخصم أموال',
  async createCheckout(order) {
    const ref = `mock_${randomToken(8)}`;
    recordPayment(order, 'mock', ref);
    return { provider: 'mock', reference: ref, requiresRedirect: true, checkoutUrl: `${config.publicUrl}/pay/mock/${order.number}?ref=${ref}` };
  },
};

/* ----------------------------- المحفظة ----------------------------- */
const wallet: PaymentProvider = {
  id: 'wallet', label: 'الرصيد', description: 'خصم فوري من محفظتك',
  async createCheckout(order) {
    const ref = `wal_${randomToken(6)}`;
    recordPayment(order, 'wallet', ref);
    return { provider: 'wallet', reference: ref, requiresRedirect: false, checkoutUrl: null, settleImmediately: true };
  },
};

/* ----------------------------- تحويل بنكي ----------------------------- */
const manual: PaymentProvider = {
  id: 'manual', label: 'تحويل بنكي', description: 'يُفعَّل المحتوى بعد مراجعة التحويل',
  async createCheckout(order) {
    const ref = `man_${order.number}`;
    recordPayment(order, 'manual', ref);
    return {
      provider: 'manual', reference: ref, requiresRedirect: false, checkoutUrl: null, awaitingReview: true,
      instructions: { ...config.payments.manual, amount: String(order.total), currency: order.currency, reference: order.number },
    };
  },
};

/* ----------------------------- Thawani (عُمان) ----------------------------- */
async function thawaniRequest(pathname: string, body: unknown) {
  const res = await fetch(`https://checkout.thawani.om/api/v1/${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'thawani-api-key': config.payments.thawani.secretKey },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) throw new AppError('payment_failed', data?.description || 'فشل الاتصال ببوابة الدفع', 502);
  return data;
}
const thawani: PaymentProvider = {
  id: 'thawani', label: 'بطاقة بنكية', description: 'Thawani — بطاقات بنكية عُمانية',
  async createCheckout(order) {
    const items = q.all<{ title: string; unit_price: number; quantity: number }>('SELECT title, unit_price, quantity FROM order_items WHERE order_id = ?', order.id);
    // ثواني تتعامل بالبيسة (١ ريال = ١٠٠٠ بيسة)
    const session = await thawaniRequest('checkout/session', {
      client_reference_id: order.number,
      mode: 'payment',
      products: items.map(i => ({ name: i.title.slice(0, 40), quantity: i.quantity, unit_amount: Math.round(i.unit_price * 1000) })),
      success_url: `${config.publicUrl}/pay/success?order=${order.number}`,
      cancel_url: `${config.publicUrl}/pay/cancel?order=${order.number}`,
      metadata: { orderId: order.id },
    });
    const sessionId = session.data.session_id as string;
    recordPayment(order, 'thawani', sessionId, { session_id: sessionId });
    return {
      provider: 'thawani', reference: sessionId, requiresRedirect: true,
      checkoutUrl: `https://checkout.thawani.om/pay/${sessionId}?key=${config.payments.thawani.publishableKey}`,
    };
  },
};

/* ----------------------------- Stripe (توسّع) ----------------------------- */
async function stripeRequest(pathname: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.payments.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data: any = await res.json();
  if (!res.ok) throw new AppError('payment_failed', data?.error?.message || 'فشل الاتصال ببوابة الدفع', 502);
  return data;
}
const stripe: PaymentProvider = {
  id: 'stripe', label: 'بطاقة ائتمانية', description: 'Stripe',
  async createCheckout(order) {
    const items = q.all<{ title: string; unit_price: number; quantity: number }>('SELECT title, unit_price, quantity FROM order_items WHERE order_id = ?', order.id);
    const factor = ['OMR', 'KWD', 'BHD'].includes(order.currency) ? 1000 : 100;
    const params: Record<string, string> = {
      mode: 'payment', client_reference_id: order.number, 'metadata[order_id]': String(order.id),
      success_url: `${config.publicUrl}/pay/success?order=${order.number}`, cancel_url: `${config.publicUrl}/pay/cancel?order=${order.number}`,
    };
    items.forEach((it, i) => {
      params[`line_items[${i}][price_data][currency]`] = order.currency.toLowerCase();
      params[`line_items[${i}][price_data][unit_amount]`] = String(Math.round(it.unit_price * factor));
      params[`line_items[${i}][price_data][product_data][name]`] = it.title;
      params[`line_items[${i}][quantity]`] = String(it.quantity);
    });
    const session = await stripeRequest('checkout/sessions', params);
    recordPayment(order, 'stripe', session.id, { id: session.id });
    return { provider: 'stripe', reference: session.id, requiresRedirect: true, checkoutUrl: session.url };
  },
};

const registry: Record<string, PaymentProvider> = { mock, wallet, manual, thawani, stripe };

export const availableProviders = (): string[] =>
  config.payments.providers.filter(p =>
    p === 'stripe' ? !!config.payments.stripe.secretKey :
    p === 'thawani' ? !!config.payments.thawani.secretKey : !!registry[p]);

export function getProvider(id: string): PaymentProvider {
  const p = registry[id];
  if (!p) throw new AppError('validation_error', 'وسيلة دفع غير مدعومة', 400);
  if (!availableProviders().includes(id)) throw new AppError('validation_error', 'وسيلة الدفع غير مفعّلة', 400);
  return p;
}

export const providerCatalog = () => availableProviders().map(id => ({
  id, label: registry[id].label, description: registry[id].description,
  instructions: id === 'manual' ? { ...config.payments.manual } : null,
}));

/** تحقّق توقيع Stripe مع رفض الطوابع الزمنية الأقدم من ٥ دقائق */
export function verifyStripeSignature(rawBody: string, header: string | undefined): boolean {
  const secret = config.payments.stripe.webhookSecret;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  return safeEqual(hmac(`${parts.t}.${rawBody}`, secret), parts.v1);
}

/** ثواني يرسل توقيع HMAC للجسم في ترويسة */
export function verifyThawaniSignature(rawBody: string, header: string | undefined): boolean {
  const secret = config.payments.thawani.webhookSecret;
  if (!secret || !header) return false;
  return safeEqual(hmac(rawBody, secret), header);
}
