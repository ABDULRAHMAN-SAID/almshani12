import { state } from './store.js';

/* ----------------------------- أدوات نصّية ----------------------------- */

/** يمنع حقن HTML من بيانات المستخدمين. */
export function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function money(amount) {
  const decimals = state.config?.currency?.decimals ?? 3;
  const symbol = state.config?.currency?.symbol ?? 'ر.ع';
  return `${Number(amount || 0).toFixed(decimals)} ${symbol}`;
}

export function priceTag(price, discount) {
  const final = discount ?? price;
  if (Number(final) === 0) return `<span class="text-brand-600 font-extrabold">مجاناً</span>`;
  if (discount != null && discount < price) {
    return `<span class="font-extrabold text-slate-900">${money(discount)}</span>
            <span class="text-sm text-slate-400 line-through mr-1.5">${money(price)}</span>`;
  }
  return `<span class="font-extrabold text-slate-900">${money(price)}</span>`;
}

const AR_DATE = { weekday: 'long', day: 'numeric', month: 'long' };

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value.includes?.('T') || value.includes?.('Z') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ar', withTime ? { ...AR_DATE, hour: '2-digit', minute: '2-digit' } : AR_DATE);
}

export function fromNow(value) {
  const date = new Date(value?.includes('T') ? value : `${value}Z`);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  const units = [['year', 31536e6], ['month', 2592e6], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'الآن';
}

export function duration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h) return `${h} س ${m} د`;
  if (m) return `${m} دقيقة`;
  return `${total} ثانية`;
}

export const stars = (rating, count) => {
  const value = Number(rating) || 0;
  const full = '★'.repeat(Math.round(value));
  const empty = '☆'.repeat(5 - Math.round(value));
  return `<span class="text-amber-500 text-sm">${full}${empty}</span>
          <span class="text-xs text-slate-500">${value.toFixed(1)}${count != null ? ` (${count})` : ''}</span>`;
};

export const initials = (name) => (name || '؟').trim().slice(0, 2);

/** الأبعاد مضمّنة لأن Tailwind لا يولّد أصنافاً تُبنى وقت التشغيل. */
export const avatar = (url, name, size = 10) => {
  const px = size * 4;
  const box = `width:${px}px;height:${px}px;font-size:${Math.max(11, px / 2.6)}px`;
  return url
    ? `<img src="${esc(url)}" alt="${esc(name)}" style="${box}" class="rounded-full object-cover bg-slate-200 shrink-0" />`
    : `<div style="${box}" class="rounded-full bg-brand-100 text-brand-700 grid place-items-center font-bold shrink-0">${esc(initials(name))}</div>`;
};

/* ----------------------------- تنبيهات ----------------------------- */
export function toast(message, type = 'info', timeout = 4000) {
  const palette = {
    success: 'bg-brand-600', error: 'bg-rose-600', warn: 'bg-amber-500', info: 'bg-slate-800',
  }[type] || 'bg-slate-800';
  const icon = { success: '✅', error: '⚠️', warn: '⚡', info: 'ℹ️' }[type] || 'ℹ️';

  const el = document.createElement('div');
  el.className = `${palette} text-white rounded-xl px-4 py-3 shadow-lg animate-slide-in flex items-start gap-2 text-sm`;
  el.innerHTML = `<span>${icon}</span><div class="flex-1">${esc(message)}</div>`;
  el.onclick = () => el.remove();
  document.getElementById('toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, timeout);
}

/* ----------------------------- نوافذ ----------------------------- */
export function modal({ title, body, actions = [], size = 'max-w-lg', onClose }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/50 animate-fade-in';
  wrap.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full ${size} max-h-[90vh] overflow-auto animate-fade-up" role="dialog" aria-modal="true">
      <div class="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white rounded-t-2xl">
        <h3 class="font-bold text-lg font-display">${esc(title)}</h3>
        <button data-close class="text-slate-400 hover:text-slate-700 text-2xl leading-none px-2" aria-label="إغلاق">&times;</button>
      </div>
      <div class="p-5" data-body></div>
      ${actions.length ? '<div class="px-5 py-4 border-t flex gap-2 justify-end bg-slate-50 rounded-b-2xl" data-actions></div>' : ''}
    </div>`;

  wrap.querySelector('[data-body]').innerHTML = body;
  const close = () => { wrap.remove(); onClose?.(); };
  wrap.querySelector('[data-close]').onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };

  const actionsEl = wrap.querySelector('[data-actions]');
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = `btn ${action.variant || 'btn-ghost'}`;
    btn.textContent = action.label;
    btn.onclick = () => action.onClick?.(wrap, close);
    actionsEl.append(btn);
  }

  root.append(wrap);
  return { el: wrap, close };
}

export const confirmDialog = (message, { title = 'تأكيد', confirmLabel = 'تأكيد', variant = 'btn-danger' } = {}) =>
  new Promise((resolve) => {
    modal({
      title, body: `<p class="text-slate-700 leading-relaxed">${esc(message)}</p>`,
      onClose: () => resolve(false),
      actions: [
        { label: 'إلغاء', onClick: (_, close) => { close(); resolve(false); } },
        { label: confirmLabel, variant, onClick: (_, close) => { close(); resolve(true); } },
      ],
    });
  });

/* ----------------------------- حالات العرض ----------------------------- */
export const spinner = (label = 'جارٍ التحميل...') => `
  <div class="flex flex-col items-center justify-center py-20 gap-3 text-slate-500">
    <div class="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
    <p class="text-sm">${esc(label)}</p>
  </div>`;

export const emptyState = (icon, title, subtitle = '', action = '') => `
  <div class="text-center py-16 px-4">
    <div class="text-6xl mb-4 opacity-70">${icon}</div>
    <h3 class="text-xl font-bold font-display text-slate-800 mb-2">${esc(title)}</h3>
    ${subtitle ? `<p class="text-slate-500 max-w-md mx-auto mb-5">${esc(subtitle)}</p>` : ''}
    ${action}
  </div>`;

export const errorState = (message, retryHash) => `
  <div class="text-center py-16 px-4">
    <div class="text-5xl mb-3">😕</div>
    <h3 class="text-lg font-bold text-slate-800 mb-2">تعذّر تحميل الصفحة</h3>
    <p class="text-slate-500 mb-4">${esc(message)}</p>
    <a href="${retryHash || '#/'}" class="btn btn-primary">العودة للرئيسية</a>
  </div>`;

export const skeletonGrid = (count = 6) => `
  <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
    ${Array.from({ length: count }).map(() => `
      <div class="card p-4 animate-pulse">
        <div class="h-36 bg-slate-200 rounded-xl mb-3"></div>
        <div class="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
        <div class="h-3 bg-slate-200 rounded w-1/2"></div>
      </div>`).join('')}
  </div>`;

/* ----------------------------- تخطيط ----------------------------- */
export const pageHeader = (title, subtitle = '', extra = '') => `
  <div class="bg-gradient-to-l from-brand-800 to-brand-600 text-white">
    <div class="max-w-7xl mx-auto px-4 py-10">
      <h1 class="text-3xl md:text-4xl font-extrabold font-display">${esc(title)}</h1>
      ${subtitle ? `<p class="text-brand-100 mt-2 text-lg">${esc(subtitle)}</p>` : ''}
      ${extra}
    </div>
  </div>`;

export const section = (content, classes = '') => `<div class="max-w-7xl mx-auto px-4 py-8 ${classes}">${content}</div>`;

export const pagination = (meta, hashBase) => {
  if (!meta || meta.pages <= 1) return '';
  const pages = [];
  for (let i = 1; i <= meta.pages; i++) {
    if (i === 1 || i === meta.pages || Math.abs(i - meta.page) <= 2) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return `
    <nav class="flex items-center justify-center gap-1.5 mt-8 flex-wrap">
      ${pages.map(p => p === '…'
        ? '<span class="px-2 text-slate-400">…</span>'
        : `<a href="${hashBase}${hashBase.includes('?') ? '&' : '?'}page=${p}"
              class="min-w-10 h-10 px-3 grid place-items-center rounded-lg font-semibold text-sm ${
                p === meta.page ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 hover:bg-slate-50'}">${p}</a>`).join('')}
    </nav>`;
};

/* ----------------------------- بطاقات ----------------------------- */
export function courseCard(course) {
  const cover = course.thumbnail
    ? `<img src="${esc(course.thumbnail)}" alt="" class="w-full h-40 object-cover" loading="lazy" />`
    : `<div class="w-full h-40 bg-gradient-to-bl from-brand-500 to-brand-700 grid place-items-center text-white text-4xl font-display">${esc(initials(course.title))}</div>`;

  const typeLabel = { recorded: '🎬 مسجّلة', live: '🔴 مباشرة', hybrid: '🎬🔴 مختلطة' }[course.type] || '';

  return `
    <a href="#/courses/${esc(course.slug || course.id)}" class="card card-hover overflow-hidden flex flex-col group">
      <div class="relative">${cover}
        <span class="absolute top-2 right-2 badge bg-white/95 text-slate-700 shadow-sm">${typeLabel}</span>
      </div>
      <div class="p-4 flex-1 flex flex-col">
        <h3 class="font-bold font-display text-slate-900 clamp-2 group-hover:text-brand-700 transition-colors">${esc(course.title)}</h3>
        ${course.subtitle ? `<p class="text-sm text-slate-500 clamp-2 mt-1">${esc(course.subtitle)}</p>` : ''}
        <p class="text-xs text-slate-500 mt-2">👤 ${esc(course.instructor_name || '')}</p>
        <div class="flex items-center gap-2 mt-2 text-xs text-slate-500">
          <span>${stars(course.rating_avg, course.rating_count)}</span>
          <span>•</span><span>${course.students_count || 0} طالب</span>
          ${course.lessons_count ? `<span>•</span><span>${course.lessons_count} درس</span>` : ''}
        </div>
        <div class="mt-auto pt-3 flex items-center justify-between">
          <div>${priceTag(course.price, course.discount_price)}</div>
          <span class="text-brand-600 text-sm font-semibold">التفاصيل ←</span>
        </div>
      </div>
    </a>`;
}

export function summaryCard(summary) {
  const cover = summary.cover
    ? `<img src="${esc(summary.cover)}" alt="" class="w-full h-44 object-cover" loading="lazy" />`
    : `<div class="w-full h-44 bg-gradient-to-bl from-amber-400 to-orange-600 grid place-items-center text-white p-3 text-center">
         <div><div class="text-3xl mb-1">📖</div><div class="text-sm font-bold clamp-2">${esc(summary.book_title || summary.title)}</div></div>
       </div>`;

  return `
    <a href="#/summaries/${esc(summary.slug || summary.id)}" class="card card-hover overflow-hidden flex flex-col group">
      <div class="relative">${cover}
        <span class="absolute top-2 right-2 badge bg-white/95 text-slate-700 shadow-sm">⏱ ${summary.reading_minutes} د</span>
      </div>
      <div class="p-4 flex-1 flex flex-col">
        <h3 class="font-bold font-display clamp-2 group-hover:text-brand-700 transition-colors">${esc(summary.title)}</h3>
        <p class="text-xs text-slate-500 mt-1">✍️ ${esc(summary.book_author || '')}</p>
        ${summary.description ? `<p class="text-sm text-slate-500 clamp-2 mt-2">${esc(summary.description)}</p>` : ''}
        <div class="mt-auto pt-3 flex items-center justify-between">
          <div>${priceTag(summary.price, summary.discount_price)}</div>
          ${summary.rating_count ? stars(summary.rating_avg, summary.rating_count) : '<span class="text-xs text-slate-400">جديد</span>'}
        </div>
      </div>
    </a>`;
}

export function liveCard(session) {
  const isLive = session.status === 'live';
  const seatsLeft = Math.max(0, (session.capacity || 0) - (session.booked_count || 0));
  return `
    <a href="#/live/${session.id}" class="card card-hover overflow-hidden flex flex-col group">
      <div class="bg-gradient-to-bl ${isLive ? 'from-rose-500 to-rose-700' : 'from-sky-500 to-indigo-700'} text-white p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="badge bg-white/20 backdrop-blur">
            ${isLive ? '<span class="w-2 h-2 rounded-full bg-white live-dot inline-block"></span> تُبثّ الآن' : '📅 مجدولة'}
          </span>
          <span class="text-xs">${session.duration_minutes} دقيقة</span>
        </div>
        <h3 class="font-bold font-display text-lg clamp-2">${esc(session.title)}</h3>
      </div>
      <div class="p-4 flex-1 flex flex-col">
        <p class="text-sm text-slate-600">🗓 ${formatDate(session.starts_at, true)}</p>
        <p class="text-xs text-slate-500 mt-1">👤 ${esc(session.instructor_name || '')}</p>
        <p class="text-xs mt-2 ${seatsLeft <= 3 ? 'text-rose-600 font-bold' : 'text-slate-500'}">
          ${seatsLeft > 0 ? `🪑 ${seatsLeft} مقعد متبقٍ` : '❌ اكتمل العدد'}
        </p>
        <div class="mt-auto pt-3 flex items-center justify-between">
          <div>${priceTag(session.price)}</div>
          <span class="text-brand-600 text-sm font-semibold">${isLive ? 'ادخل الآن ←' : 'احجز مقعدك ←'}</span>
        </div>
      </div>
    </a>`;
}

/* ----------------------------- Markdown مبسّط ----------------------------- */
/** يحوّل Markdown محدوداً إلى HTML بعد تهريب الوسوم. */
export function markdown(text) {
  if (!text) return '';
  const lines = esc(text).split('\n');
  const out = [];
  let inList = false;

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^### /.test(trimmed)) { closeList(); out.push(`<h3>${trimmed.slice(4)}</h3>`); }
    else if (/^## /.test(trimmed)) { closeList(); out.push(`<h2>${trimmed.slice(3)}</h2>`); }
    else if (/^# /.test(trimmed)) { closeList(); out.push(`<h1>${trimmed.slice(2)}</h1>`); }
    else if (/^&gt; /.test(trimmed)) { closeList(); out.push(`<blockquote>${trimmed.slice(5)}</blockquote>`); }
    else if (/^[-*] /.test(trimmed)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${trimmed.slice(2)}</li>`);
    } else if (!trimmed) { closeList(); }
    else { closeList(); out.push(`<p>${trimmed}</p>`); }
  }
  closeList();

  return out.join('')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

/** يربط أحداث النقر بدوال — بديل آمن لـ onclick داخل innerHTML. */
export function bind(root, selector, event, handler) {
  root.querySelectorAll(selector).forEach(el => el.addEventListener(event, handler));
}

/** يقرأ قيم نموذج كائناً. */
export const formData = (form) => Object.fromEntries(new FormData(form).entries());
