/** عميل API للوحة الإدارة: رمز في localStorage، تجديد تلقائي عند 401، وأخطاء عربية من الخادم */
const BASE = import.meta.env.VITE_API_URL || '';
export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }

export const session = {
  get access() { return localStorage.getItem('adm_access'); },
  get refresh() { return localStorage.getItem('adm_refresh'); },
  set(a: string | null, r: string | null) { a ? localStorage.setItem('adm_access', a) : localStorage.removeItem('adm_access'); r ? localStorage.setItem('adm_refresh', r) : localStorage.removeItem('adm_refresh'); },
};

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!session.refresh) return false;
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refresh }) })
    .then(async r => { if (!r.ok) { session.set(null, null); return false; } const d = await r.json(); session.set(d.accessToken, d.refreshToken); return true; })
    .catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.access) headers.Authorization = `Bearer ${session.access}`;
  let res: Response;
  try { res = await fetch(`${BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError('network_error', 'لا يوجد اتصال بالخادم', 0); }
  if (res.status === 401 && retry && await refresh()) return request<T>(method, path, body, false);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error?.code ?? 'server_error', data?.error?.message ?? `HTTP ${res.status}`, res.status);
  return data as T;
}
const qs = (p?: Record<string, unknown>) => { const e = Object.entries(p ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== null); return e.length ? `?${new URLSearchParams(e.map(([k, v]) => [k, String(v)]))}` : ''; };
export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) => request<T>('GET', path + qs(params)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
export const money = (n: number) => `${Number(n).toFixed(3)} ر.ع`;
export const pct = (n: number) => `${Math.round(Number(n) * 100)}٪`;
/** كسر من الكل كنسبة مئوية — ٠ عند غياب الأساس */
export const share = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}٪` : '٠٪';
export const when = (iso?: string | null) => iso ? new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' }).format(new Date(iso)) : '—';
export const day = (iso?: string | null) => iso ? new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeZone: 'Asia/Muscat' }).format(new Date(iso)) : '—';
