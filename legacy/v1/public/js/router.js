/** موجّه بسيط قائم على الـ hash مع دعم المعاملات وحماية المسارات. */

const routes = [];
let notFoundHandler = null;
let currentCleanup = null;

/** يحوّل "/courses/:slug" إلى تعبير نمطي مع أسماء المتغيّرات. */
function compile(pattern) {
  const keys = [];
  const regex = new RegExp('^' + pattern
    .replace(/\/$/, '')
    .replace(/:([A-Za-z_]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })
    .replace(/\*/g, '.*') + '/?$');
  return { regex, keys };
}

export function route(pattern, handler, options = {}) {
  routes.push({ ...compile(pattern), handler, options, pattern });
}

export const setNotFound = (handler) => { notFoundHandler = handler; };

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString] = raw.split('?');
  return {
    path: path.replace(/\/$/, '') || '/',
    query: Object.fromEntries(new URLSearchParams(queryString || '')),
  };
}

export const navigate = (path, { replace = false } = {}) => {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (replace) location.replace(hash);
  else location.hash = hash;
};

export async function resolve() {
  const { path, query } = parseHash();
  const view = document.getElementById('view');

  // ينظّف مؤقتات/مستمعات الصفحة السابقة قبل رسم الجديدة
  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch {} }
  currentCleanup = null;

  for (const item of routes) {
    const match = item.regex.exec(path);
    if (!match) continue;

    const params = Object.fromEntries(item.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
    const context = { params, query, path, view };

    if (item.options.guard) {
      const redirect = await item.options.guard(context);
      if (redirect) return navigate(redirect, { replace: true });
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
    try {
      currentCleanup = await item.handler(context);
    } catch (err) {
      console.error('[route]', err);
      view.innerHTML = `<div class="max-w-2xl mx-auto px-4 py-20 text-center">
        <div class="text-5xl mb-3">😕</div>
        <h2 class="text-xl font-bold mb-2">حدث خطأ أثناء عرض الصفحة</h2>
        <p class="text-slate-500 mb-4">${err.message || ''}</p>
        <a href="#/" class="btn btn-primary">العودة للرئيسية</a></div>`;
    }
    return;
  }

  if (notFoundHandler) currentCleanup = await notFoundHandler({ path, query, view });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
