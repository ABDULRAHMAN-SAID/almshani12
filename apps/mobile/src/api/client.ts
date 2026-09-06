import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { z } from 'zod';
import { ApiErrorBody, type ErrorCode } from '@manassah/shared';
import { tokens } from '@/state/auth';

/** عنوان الخادم: من app.json extra أو المتغيّر البيئي، وإلا localhost */
const BASE =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000');

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
      forbidden: 'errors.forbidden', not_found: 'errors.notFound', rate_limited: 'errors.rateLimited',
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
    refreshing = fetch(`${BASE}/api/auth/refresh`, {
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

async function request<T>(method: string, path: string, body?: unknown, schema?: z.ZodType<T>, opts: RequestOptions = {}): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (tokens.access && opts.auth !== false) headers.Authorization = `Bearer ${tokens.access}`;
    return fetch(`${BASE}/api${path}`, {
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
    throw new ApiError(err.code, err.message, res.status, (err as { details?: { field: string; message: string }[] }).details);
  }

  if (schema) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      if (__DEV__) console.warn('[api] contract mismatch', path, parsed.error.issues.slice(0, 3));
      // لا نُسقط الشاشة بسبب حقل إضافي — نمرّر البيانات كما وصلت
      return data as T;
    }
    return parsed.data;
  }
  return data as T;
}

const qs = (params?: Record<string, unknown>) => {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
};

export const api = {
  base: BASE,
  get: <T>(path: string, schema?: z.ZodType<T>, params?: Record<string, unknown>, opts?: RequestOptions) =>
    request<T>('GET', path + qs(params), undefined, schema, opts),
  post: <T>(path: string, body?: unknown, schema?: z.ZodType<T>, opts?: RequestOptions) =>
    request<T>('POST', path, body ?? {}, schema, opts),
  patch: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) => request<T>('PATCH', path, body ?? {}, schema),
  put: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) => request<T>('PUT', path, body ?? {}, schema),
  delete: <T>(path: string, schema?: z.ZodType<T>) => request<T>('DELETE', path, undefined, schema),
};
