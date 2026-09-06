import { config } from '../config.ts';
import { db, q } from '../db/index.ts';
import { AppError, forbidden, notFound } from '../lib/errors.ts';
import { randomToken, hmac, safeEqual } from '../lib/helpers.ts';
import { audit } from '../lib/audit.ts';
import { fulfillOrder } from './checkout.ts';
import { notifyStaff } from './notifications.ts';

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
const thawaniCfg = () => config.payments.thawani;
/** طلب HTTP بمهلة إلى البوابات — أخطاء الشبكة تتحوّل إلى payment_failed دون تفاصيل داخلية */
const GATEWAY_TIMEOUT_MS = 10_000;
async function gatewayFetch(url: string, init: RequestInit): Promise<{ res: Response; data: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const data: any = await res.json().catch(() => ({}));
    return { res, data };
  } catch (err) {
    console.error('[payments] gateway error', (err as Error)?.name === 'AbortError' ? 'timeout' : (err as Error)?.message);
    throw new AppError('payment_failed', 'فشل الاتصال ببوابة الدفع', 502);
  } finally { clearTimeout(timer); }
}
/** body غير محدّد = GET (قراءة جلسة)، وإلا POST */
async function thawaniRequest(pathname: string, body?: unknown) {
  const { res, data } = await gatewayFetch(`${thawaniCfg().baseUrl}/api/v1/${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'thawani-api-key': thawaniCfg().secretKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok || data?.success === false) {
    // نصّ البوابة يُسجَّل للمشغّل فقط — لا يصل إلى العميل
    console.error('[payments] thawani', res.status, String(data?.description ?? data?.code ?? '').slice(0, 200));
    throw new AppError('payment_failed', 'فشل الاتصال ببوابة الدفع', 502);
  }
  return data;
}
const thawani: PaymentProvider = {
  id: 'thawani', label: 'بطاقة بنكية', description: 'Thawani — بطاقات بنكية عُمانية',
  async createCheckout(order) {
    // سطر واحد بإجمالي الطلب (بعد الخصم والضريبة) بالبيسة (١ ريال = ١٠٠٠ بيسة) — أسعار العناصر قبل الخصم لا تطابق ما يُخصم فعلاً
    const session = await thawaniRequest('checkout/session', {
      client_reference_id: order.number,
      mode: 'payment',
      products: [{ name: orderLabel(order), quantity: 1, unit_amount: expectedMinor(order, 'thawani') }],
      success_url: `${config.publicUrl}/pay/success?order=${order.number}`,
      cancel_url: `${config.publicUrl}/pay/cancel?order=${order.number}`,
      metadata: { orderId: order.id },
    });
    const sessionId = session.data.session_id as string;
    recordPayment(order, 'thawani', sessionId, { session_id: sessionId });
    return {
      provider: 'thawani', reference: sessionId, requiresRedirect: true,
      checkoutUrl: `${thawaniCfg().baseUrl}/pay/${sessionId}?key=${thawaniCfg().publishableKey}`,
    };
  },
};

/** حالة الجلسة كما يراها المزوّد — المصدر الوحيد للحقيقة قبل تنفيذ أي طلب */
export interface ProviderSession { paid: boolean; status: string; reference: string | null; amountMinor: number | null; raw: unknown }
export async function fetchThawaniSession(sessionId: string): Promise<ProviderSession> {
  const data = await thawaniRequest(`checkout/session/${encodeURIComponent(sessionId)}`);
  const d = data?.data ?? {};
  return { paid: d.payment_status === 'paid', status: String(d.payment_status ?? 'unknown'), reference: d.client_reference_id ?? null, amountMinor: d.total_amount != null ? Number(d.total_amount) : null, raw: data };
}

/* ----------------------------- Stripe (توسّع) ----------------------------- */
/** params غير محدّدة = GET */
async function stripeRequest(pathname: string, params?: Record<string, string>) {
  const { res, data } = await gatewayFetch(`https://api.stripe.com/v1/${pathname}`, {
    method: params ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${config.payments.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  if (!res.ok) {
    console.error('[payments] stripe', res.status, String(data?.error?.message ?? data?.error?.type ?? '').slice(0, 200));
    throw new AppError('payment_failed', 'فشل الاتصال ببوابة الدفع', 502);
  }
  return data;
}
const stripe: PaymentProvider = {
  id: 'stripe', label: 'بطاقة ائتمانية', description: 'Stripe',
  async createCheckout(order) {
    // سطر واحد بإجمالي الطلب (بعد الخصم والضريبة)؛ الجلسة تنتهي عند Stripe بعد ٣١ دقيقة كي توافق مهلة الطلب (الحدّ الأدنى عندهم ٣٠)
    const params: Record<string, string> = {
      mode: 'payment', client_reference_id: order.number, 'metadata[order_id]': String(order.id),
      success_url: `${config.publicUrl}/pay/success?order=${order.number}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${config.publicUrl}/pay/cancel?order=${order.number}`,
      expires_at: String(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_MS / 1000 + 60),
      'line_items[0][price_data][currency]': order.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(expectedMinor(order, 'stripe')),
      'line_items[0][price_data][product_data][name]': orderLabel(order),
      'line_items[0][quantity]': '1',
    };
    const session = await stripeRequest('checkout/sessions', params);
    recordPayment(order, 'stripe', session.id, { id: session.id });
    return { provider: 'stripe', reference: session.id, requiresRedirect: true, checkoutUrl: session.url };
  },
};
export async function fetchStripeSession(sessionId: string): Promise<ProviderSession> {
  const s = await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  return { paid: s?.payment_status === 'paid', status: String(s?.payment_status ?? 'unknown'), reference: s?.client_reference_id ?? null, amountMinor: s?.amount_total != null ? Number(s.amount_total) : null, raw: s };
}

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

/** وضع البوابة كي يعرض التطبيق «وضع التجربة» للبوابات غير الحيّة */
export type ProviderMode = 'uat' | 'test' | 'live' | null;
export const providerMode = (id: string): ProviderMode =>
  id === 'thawani' ? config.payments.thawani.mode : id === 'stripe' ? config.payments.stripe.mode : null;

export const providerCatalog = () => availableProviders().map(id => ({
  id, label: registry[id].label, description: registry[id].description,
  instructions: id === 'manual' ? { ...config.payments.manual } : null,
  mode: providerMode(id),
}));

/* ----------------------------- تأكيد الدفع من المزوّد ----------------------------- */
/** أصغر وحدة للعملة عند البوابات: بيسة/فلس (٣ منازل) أو سنت */
export const minorFactor = (currency: string) => (['OMR', 'KWD', 'BHD'].includes(currency) ? 1000 : 100);
/**
 * المبلغ الذي يُرسَل إلى البوابة ويُطابَق عند التأكيد = إجمالي الطلب (بعد الخصم والضريبة) بأصغر وحدة.
 * Stripe يشترط في عملات الثلاث منازل مضاعفات ١٠ (أقرب ١٠ بيسات) — ثواني تقبل البيسة كما هي.
 */
export function expectedMinor(order: { total: number; currency: string }, provider: string): number {
  const factor = minorFactor(order.currency);
  const minor = Math.round(order.total * factor);
  return provider === 'stripe' && factor === 1000 ? Math.round(minor / 10) * 10 : minor;
}
/** اسم السطر على صفحة البوابة: عناوين العناصر مختصرة (ثواني ≤ ٤٠ حرفاً) */
const orderLabel = (order: OrderRow): string => {
  const titles = q.all<{ title: string }>('SELECT title FROM order_items WHERE order_id = ? ORDER BY id', order.id).map(r => r.title);
  const text = titles.length > 1 ? `${titles[0]} +${titles.length - 1}` : titles[0] || `طلب ${order.number}`;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
};
const SESSION_MAX_AGE_MS = 30 * 60_000;
/** created_at في SQLite بصيغة 'YYYY-MM-DD HH:MM:SS' (UTC) أو ISO */
const sqlDate = (v: string) => new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);

export interface ConfirmResult { status: string; paid: boolean; provider: string | null }
/**
 * يسأل المزوّد (ثواني/Stripe) عن الجلسة ثم ينفّذ الطلب إن كانت مدفوعة — لا يُوثَق بأي جسم webhook أو صفحة عودة وحدها.
 * userId: المالك فقط (403 لغيره). sessionId/provider: تلميحان من صفحة العودة أو الـ webhook (المسار خاص بمزوّد بعينه) يُستعملان فقط حين لا مرجع مخزّن،
 * والجلسة المجلوبة يُتحقّق من انتمائها للطلب. جلسة غير مدفوعة أقدم من ٣٠ دقيقة تُنهي الطلب (expired) إن كان ما زال معلّقاً؛
 * وطلب منتهٍ يؤكّد المزوّد دفعه لاحقاً يُنفَّذ مع تنبيه الماليّين. آمن للتكرار.
 */
export type ConfirmHints = { userId?: number; sessionId?: string | null; provider?: 'thawani' | 'stripe' };
export async function confirmOrderWithProvider(orderNumber: string, { userId, sessionId, provider: providerHint }: ConfirmHints = {}): Promise<ConfirmResult> {
  const order = q.get<any>('SELECT * FROM orders WHERE number = ?', orderNumber);
  if (!order) throw notFound('الطلب غير موجود');
  if (userId != null && order.user_id !== userId) throw forbidden();
  const payment = q.get<any>("SELECT * FROM payments WHERE order_id = ? AND provider IN ('thawani','stripe') ORDER BY id DESC LIMIT 1", order.id);
  const provider: string | null = payment?.provider ?? (['thawani', 'stripe'].includes(order.provider) ? order.provider : providerHint ?? null);
  const done = (status: string) => ({ status, paid: status === 'paid', provider: provider ?? order.provider ?? null });
  // «expired» يبقى قابلاً للتأكيد: من دفع بعد انقضاء المهلة أُخذ ماله فعلاً فيُنفَّذ طلبه ويُنبَّه الماليّون (لا مالٌ بلا مقابل)
  if (!['pending', 'expired'].includes(order.status) || !provider) return done(order.status);
  const ref: string | null = payment?.provider_ref ?? order.provider_ref ?? sessionId ?? null;
  if (!ref) return done(order.status);
  const cfg = config.payments;
  if (provider === 'thawani' ? !cfg.thawani.secretKey : !cfg.stripe.secretKey) { console.error('[payments] confirm: no secret key for', provider); return done(order.status); }

  const session = provider === 'thawani' ? await fetchThawaniSession(ref) : await fetchStripeSession(ref);
  // الجلسة يجب أن تخصّ هذا الطلب نفسه — تلميح مزوّر لا يُنفّذ طلباً آخر
  if (session.reference && session.reference !== order.number) { console.error('[payments] confirm: session/order mismatch', order.number); return done(order.status); }
  if (session.amountMinor != null && session.amountMinor !== expectedMinor(order, provider)) { console.error('[payments] confirm: amount mismatch', order.number); return done(order.status); }

  if (session.paid) {
    const afterExpiry = order.status === 'expired';
    const { alreadyPaid } = fulfillOrder(order.id, { provider, providerRef: ref });
    if (!alreadyPaid) {
      audit(null, 'order.paid_confirm', 'orders', order.id, { provider, userId: userId ?? null, afterExpiry }, order.user_id);
      if (afterExpiry) notifyStaff(['finance', 'admin'], { type: 'system', title: 'دفع بعد انتهاء مهلة الطلب', body: `الطلب ${order.number} دُفع بعد انقضاء ٣٠ دقيقة — راجع الحجز أو استرجع المبلغ`, data: { orderId: order.id, provider } });
    }
    return done('paid');
  }
  const createdAt = sqlDate(String(payment?.created_at ?? order.created_at));
  if (Date.now() - createdAt.getTime() > SESSION_MAX_AGE_MS) {
    db.transaction(() => {
      const changed = q.run("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'", order.id).changes;
      if (changed) q.run("UPDATE payments SET status = 'failed' WHERE order_id = ? AND status = 'pending'", order.id);
    })();
    return done(q.val<string>('SELECT status FROM orders WHERE id = ?', order.id) ?? 'expired');
  }
  return done('pending');
}

/** تحقّق توقيع Stripe مع رفض الطوابع الزمنية الأقدم من ٥ دقائق */
export function verifyStripeSignature(rawBody: string, header: string | undefined): boolean {
  const secret = config.payments.stripe.webhookSecret;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  return safeEqual(hmac(`${parts.t}.${rawBody}`, secret), parts.v1);
}

/** ثواني يرسل توقيع HMAC للجسم في ترويسة — بلا سرّ مضبوط يُقبل الجسم كمُحفِّز فقط (التأكيد دائماً من المزوّد) */
export function verifyThawaniSignature(rawBody: string, header: string | undefined): boolean {
  const secret = config.payments.thawani.webhookSecret;
  if (!secret) return true;
  if (!header) return false;
  return safeEqual(hmac(rawBody, secret), header);
}
