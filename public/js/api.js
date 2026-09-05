/** طبقة الاتصال بالواجهة البرمجية مع تجديد تلقائي للجلسة. */

const ACCESS_KEY = 'manassah_access';
const REFRESH_KEY = 'manassah_refresh';

export const tokens = {
  get access() { return localStorage.getItem(ACCESS_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set({ accessToken, refreshToken }) {
    if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY); },
};

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}

let refreshing = null;

/** يجدّد رمز الدخول مرّة واحدة حتى لو تزامنت عدّة طلبات. */
async function refreshSession() {
  if (!tokens.refresh) return false;
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
    })
      .then(async (res) => {
        if (!res.ok) { tokens.clear(); return false; }
        tokens.set(await res.json());
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function request(method, path, body, options = {}) {
  const send = async () => {
    const headers = { ...(options.headers || {}) };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

    return fetch(`/api${path}`, {
      method,
      headers,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await send();
  if (res.status === 401 && tokens.refresh && !options.noRetry) {
    if (await refreshSession()) res = await send();
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = data?.error || {};
    throw new ApiError(err.message || `خطأ غير متوقّع (${res.status})`, res.status, err.code, err.details);
  }
  return data;
}

export const api = {
  get: (path, params) => {
    const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))}` : '';
    return request('GET', path + qs);
  },
  post: (path, body, options) => request('POST', path, body ?? {}, options),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  delete: (path) => request('DELETE', path),
  upload: (file, purpose = 'general') => {
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', purpose);
    return request('POST', '/uploads', form);
  },
};

export default api;
