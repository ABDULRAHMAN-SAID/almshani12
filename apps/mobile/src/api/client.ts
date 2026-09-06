import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { z } from 'zod';
import { ApiErrorBody, type ErrorCode } from '@manassah/shared';
import { tokens, useAuth, defaultLearner } from '@/state/auth';

import { useUi } from '@/state/ui';

const ENV_BASE = ((Constants.expoConfig?.extra?.apiUrl as string | undefined) || process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');

/**
 * عنوان الخادم بالأولوية: ما ضبطه المستخدم في الإعدادات → app.json/المتغيّر البيئي →
 * على الويب أصل الصفحة نفسه (الخادم يخدم التطبيق والواجهة معاً) → localhost للتطوير.
 */
export function resolveBase(): string {
  const custom = useUi.getState().serverUrl;
  if (custom) return custom;
  if (ENV_BASE) return ENV_BASE;
  // النسخة المبنيّة تُخدَم من الخادم نفسه أيّاً كان منفذه؛ أما خادم التطوير (expo start على localhost) فالواجهة على 4000
  if (Platform.OS === 'web' && typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) && (!__DEV__ || !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname))) return window.location.origin;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

export class ApiError extends Error {
  constructor(public code: ErrorCode | string, message: string, public status: number, public details?: { field: string; message: string }[]) {
    super(message);
  }
}

/** يحوّل أي خطأ إلى مفتاح رسالة عربية مفهومة */
export function errorMessageKey(err: unknown): string {
  if (err instanceof ApiError) {
    const map: Record<string, string> = {
      network_error: 'errors.network', auth_expired: 'errors.authExpired', unauthorized: 'errors.authExpired',
      validation_error: 'errors.validation', payment_failed: 'errors.paymentFailed', booking_conflict: 'errors.bookingConflict',
      teacher_unavailable: 'errors.teacherUnavailable', slot_expired: 'errors.slotExpired',
      content_unavailable: 'errors.contentUnavailable', otp_invalid: 'errors.otpInvalid', otp_expired: 'errors.otpExpired',
      forbidden: 'errors.forbidden', not_found: 'errors.notFound', rate_limited: 'errors.rateLimited', insufficient_funds: 'errors.insufficientFunds',
      learner_forbidden: 'errors.learnerForbidden', learner_required: 'errors.learnerRequired', learner_limit: 'learners.limit',
      learner_has_upcoming: 'learners.hasUpcoming', last_learner: 'learners.lastLearner',
      otp_delivery_unavailable: 'errors.otpDeliveryUnavailable', otp_send_failed: 'errors.otpSendFailed', otp_country_not_allowed: 'errors.otpCountryNotAllowed',
    };
    return map[err.code] ?? 'errors.generic';
  }
  if (err instanceof TypeError) return 'errors.network';
  return 'errors.generic';
}

let refreshing: Promise<boolean> | null = null;
async function refreshSession(): Promise<boolean> {
  if (!tokens.refresh) return false;
  if (!refreshing) {
    refreshing = fetch(`${resolveBase()}/api/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
    })
      .then(async res => {
        if (!res.ok) { await tokens.clear(); return false; }
        const data = await res.json();
        await tokens.set(data.accessToken, data.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

interface RequestOptions { auth?: boolean; noRetry?: boolean; signal?: AbortSignal }

/** وضع العرض: التطبيق كاملاً بلا خادم (EXPO_PUBLIC_DEMO=1) — انظر ./demo.ts */
export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';
/** علامة البناء تُضمَّن في الحزمة كسلسلة ثابتة كي يتحقّق scripts/check-web-build.mjs أن حزمة الويب الحقيقية ليست نسخة عرض */
export const BUILD_MARK = process.env.EXPO_PUBLIC_DEMO === '1' ? 'manassah-build:demo' : 'manassah-build:api';
/**
 * وضع العرض يعمل ما لم يُعرَف خادم حقيقي من أي مصدر: ما ضبطه المستخدم من الإعدادات/رابط الاتصال،
 * أو الخادم المضمَّن وقت البناء (EXPO_PUBLIC_API_URL أو extra.apiUrl) — نسخة APK قد تحمل حزمة العرض وعنوان الخادم معاً.
 */
export const isDemo = (): boolean => DEMO && !useUi.getState().serverUrl && !ENV_BASE;
/** هل تعود النسخة إلى العرض عند مسح عنوان المستخدم؟ فقط حين تُوجد حزمة العرض ولا خادم مضمَّن وقت البناء يحلّ محلّه */
export const DEMO_FALLBACK = DEMO && !ENV_BASE;
// يُحمَّل بشكل متزامن كي تعمل النسخة أحادية الملف بلا جلب أجزاء إضافية؛ الشرط يُطوى وقت البناء فلا يدخل الإنتاج
// eslint-disable-next-line @typescript-eslint/no-require-imports
const demoModule: typeof import('./demo') | null = process.env.EXPO_PUBLIC_DEMO === '1' ? require('./demo') : null;
/** نسخة العرض تتابع المتعلّم النشط بنفسها (لا ترويسات) */
export const demoSetLearner = (id: number | null) => { if (isDemo() && demoModule) demoModule.setLearner(id); };

/**
 * معرّف متعلّم قديم (أُرشف أو حُذف من جهاز آخر) → الخادم يردّ 403 learner_forbidden:
 * نعود إلى المتعلّم الافتراضي مرة واحدة ونعيد الطلب؛ لو كنّا على الافتراضي أصلاً فالخطأ حقيقي.
 */
function recoverLearner(): boolean {
  const s = useAuth.getState();
  const fallback = defaultLearner(s.user)?.id ?? null;
  if (fallback === s.activeLearnerId) return false;
  s.setActiveLearner(fallback);
  return true;
}

function finish<T>(data: unknown, path: string, schema?: z.ZodType<T>): T {
  if (!schema) return data as T;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    if (__DEV__) console.warn('[api] contract mismatch', path, parsed.error.issues.slice(0, 3));
    // لا نُسقط الشاشة بسبب حقل إضافي — نمرّر البيانات كما وصلت
    return data as T;
  }
  return parsed.data;
}

async function request<T>(method: string, path: string, body?: unknown, schema?: z.ZodType<T>, opts: RequestOptions = {}): Promise<T> {
  const learnerId = useAuth.getState().activeLearnerId;
  if (isDemo() && demoModule) {
    const r = await demoModule.handle(method, path, body instanceof FormData ? undefined : body, { learnerId });
    if (r.status >= 400) {
      const e = r.body?.error ?? { code: 'server_error', message: `HTTP ${r.status}` };
      if (e.code === 'learner_forbidden' && !opts.noRetry && recoverLearner()) return request<T>(method, path, body, schema, { ...opts, noRetry: true });
      throw new ApiError(e.code, e.message, r.status);
    }
    return finish<T>(r.body, path, schema);
  }
  const send = async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (tokens.access && opts.auth !== false) headers.Authorization = `Bearer ${tokens.access}`;
    // المتعلّم النشط على هذا الجهاز — الخادم يرجع إلى users.active_learner_id ثم الافتراضي عند غيابها
    if (learnerId && opts.auth !== false) headers['X-Learner-Id'] = String(learnerId);
    return fetch(`${resolveBase()}/api${path}`, {
      method, headers, signal: opts.signal,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res: Response;
  try { res = await send(); }
  catch { throw new ApiError('network_error', 'network', 0); }

  if (res.status === 401 && tokens.refresh && !opts.noRetry) {
    if (await refreshSession()) {
      try { res = await send(); } catch { throw new ApiError('network_error', 'network', 0); }
    }
  }

  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!res.ok) {
    const parsed = ApiErrorBody.safeParse(data);
    const err = parsed.success ? parsed.data.error : { code: res.status === 401 ? 'auth_expired' : 'server_error', message: `HTTP ${res.status}` };
    if (__DEV__) console.warn('[api]', method, path, res.status, err.code, err.message);
    if (err.code === 'learner_forbidden' && !opts.noRetry && recoverLearner()) return request<T>(method, path, body, schema, { ...opts, noRetry: true });
    throw new ApiError(err.code, err.message, res.status, (err as { details?: { field: string; message: string }[] }).details);
  }

  return finish<T>(data, path, schema);
}

const qs = (params?: Record<string, unknown>) => {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
};

export const api = {
  get base() { return resolveBase(); },
  get: <T>(path: string, schema?: z.ZodType<T>, params?: Record<string, unknown>, opts?: RequestOptions) =>
    request<T>('GET', path + qs(params), undefined, schema, opts),
  post: <T>(path: string, body?: unknown, schema?: z.ZodType<T>, opts?: RequestOptions) =>
    request<T>('POST', path, body ?? {}, schema, opts),
  patch: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) => request<T>('PATCH', path, body ?? {}, schema),
  put: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) => request<T>('PUT', path, body ?? {}, schema),
  delete: <T>(path: string, schema?: z.ZodType<T>, body?: unknown) => request<T>('DELETE', path, body, schema),
};
