import { api } from '../api.js';
import { addToCart, isLoggedIn, state } from '../store.js';
import {
  esc, money, priceTag, spinner, section, pageHeader, summaryCard, stars, avatar,
  emptyState, errorState, pagination, toast, markdown, fromNow,
} from '../ui.js';
import { navigate } from '../router.js';
import { openReviewModal } from './courses.js';

/* ============================ قائمة الملخّصات ============================ */
export async function summaryList({ view, query }) {
  const categories = await api.get('/categories').then(r => r.data).catch(() => []);

  view.innerHTML = pageHeader('ملخّصات الكتب', 'خلاصة كتاب في دقائق — قراءةً واستماعاً') + section(`
    <form id="filters" class="card p-4 mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <input name="search" value="${esc(query.search || '')}" placeholder="ابحث بعنوان الكتاب أو المؤلف..." class="field lg:col-span-2" />
      <select name="category" class="field">
        <option value="">كل التصنيفات</option>
        ${categories.map(c => `<option value="${esc(c.slug)}" ${query.category === c.slug ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('')}
      </select>
      <select name="sort" class="field">
        ${[['newest', 'الأحدث'], ['popular', 'الأكثر مبيعاً'], ['rating', 'الأعلى تقييماً'], ['shortest', 'الأقصر وقتاً'], ['price_asc', 'الأقل سعراً']]
          .map(([v, l]) => `<option value="${v}" ${query.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select name="max_minutes" class="field">
        <option value="">أي مدة قراءة</option>
        ${[10, 15, 20, 30].map(m => `<option value="${m}" ${query.max_minutes == m ? 'selected' : ''}>أقل من ${m} دقيقة</option>`).join('')}
      </select>
      <label class="flex items-center gap-2 text-sm font-semibold px-2">
        <input type="checkbox" name="free" value="true" ${query.free === 'true' ? 'checked' : ''} class="w-4 h-4 accent-emerald-600" /> مجانية فقط
      </label>
      <div class="flex gap-2 lg:col-span-2">
        <button class="btn btn-primary btn-sm flex-1">تطبيق</button>
        <a href="#/summaries" class="btn btn-ghost btn-sm">مسح</a>
      </div>
    </form>
    <div id="results">${spinner()}</div>`);

  document.getElementById('filters').addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(e.target)) if (value) params.set(key, value);
    navigate(`/summaries?${params}`);
  });

  try {
    const result = await api.get('/summaries', query);
    document.getElementById('results').innerHTML = result.data.length
      ? `<p class="text-sm text-slate-500 mb-4">${result.meta.total} ملخّص</p>
         <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">${result.data.map(summaryCard).join('')}</div>
         ${pagination(result.meta, `#/summaries`)}`
      : emptyState('📚', 'لا توجد ملخّصات مطابقة', 'جرّب معايير بحث أخرى.');
  } catch (err) {
    document.getElementById('results').innerHTML = errorState(err.message);
  }
}

/* ============================ تفاصيل الملخّص ============================ */
export async function summaryDetail({ view, params }) {
  view.innerHTML = spinner();
  let data;
  try { data = await api.get(`/summaries/${encodeURIComponent(params.slug)}`); }
  catch (err) { view.innerHTML = errorState(err.message, '#/summaries'); return; }

  const { summary, access, related, reviews } = data;
  const price = summary.discount_price ?? summary.price;
  const owned = access.allowed;

  view.innerHTML = `
    <div class="bg-gradient-to-l from-amber-800 to-orange-700 text-white">
      <div class="max-w-7xl mx-auto px-4 py-10 grid lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2">
          <span class="badge bg-white/15 mb-3">📖 ملخّص كتاب</span>
          <h1 class="text-3xl md:text-4xl font-extrabold font-display mb-2">${esc(summary.title)}</h1>
          <p class="text-orange-100 text-lg">من كتاب «${esc(summary.book_title)}» — ${esc(summary.book_author)}</p>
          <div class="flex flex-wrap gap-4 text-sm mt-4">
            <span>⏱ ${summary.reading_minutes} دقيقة قراءة</span>
            <span>${stars(summary.rating_avg, summary.rating_count)}</span>
            <span>🛒 ${summary.sales_count} عملية شراء</span>
            ${summary.has_audio ? '<span>🎧 نسخة صوتية</span>' : ''}
            ${summary.has_pdf ? '<span>📄 نسخة PDF</span>' : ''}
          </div>
          <a href="#/instructors/${summary.author_id}" class="inline-flex items-center gap-3 mt-5">
            ${avatar(summary.author_avatar, summary.author_name, 10)}
            <div><p class="text-xs text-orange-200">إعداد</p><p class="font-bold text-sm">${esc(summary.author_name)}</p></div>
          </a>
        </div>

        <aside>
          <div class="card p-5 text-slate-900 lg:sticky lg:top-20">
            ${summary.cover ? `<img src="${esc(summary.cover)}" class="w-full h-44 object-cover rounded-xl mb-4" alt="" />` : ''}
            ${owned ? `
              <div class="bg-brand-50 border border-brand-200 rounded-xl p-3 mb-3 text-center text-sm font-bold text-brand-800">
                ✅ الملخّص في مكتبتك
              </div>
              <a href="#/read/${summary.id}" class="btn btn-primary w-full mb-2">📖 اقرأ الآن</a>
              ${summary.audio_url ? `<a href="${esc(summary.audio_url)}" target="_blank" rel="noopener" class="btn btn-ghost w-full mb-2">🎧 استمع</a>` : ''}
              ${summary.pdf_url ? `<a href="${esc(summary.pdf_url)}" target="_blank" rel="noopener" class="btn btn-ghost w-full mb-2">📄 حمّل PDF</a>` : ''}
              <button id="rateBtn" class="btn btn-ghost w-full text-sm">⭐ قيّم الملخّص</button>
            ` : `
              <div class="text-center mb-4">
                <div class="text-3xl font-extrabold">${price === 0 ? '<span class="text-brand-600">مجاناً</span>' : money(price)}</div>
                ${summary.discount_price != null && summary.discount_price < summary.price
                  ? `<p class="text-sm text-slate-400 line-through">${money(summary.price)}</p>` : ''}
              </div>
              ${price === 0
                ? '<button id="claimBtn" class="btn btn-primary w-full mb-2">احصل عليه مجاناً</button>'
                : `<button id="cartBtn" class="btn btn-primary w-full mb-2">🛒 أضف للسلة</button>
                   <button id="buyBtn" class="btn btn-amber w-full mb-2">اشترِ الآن</button>`}
              <button id="wishBtn" class="btn btn-ghost w-full text-sm">❤️ أضف للمفضّلة</button>
              ${state.subscription ? '<p class="text-xs text-brand-700 text-center mt-2">✨ مشمول في اشتراكك</p>' : `
                <a href="#/plans" class="block text-xs text-center text-slate-500 mt-3 hover:text-brand-700">
                  أو اشترك واحصل على كل الملخّصات ←</a>`}
            `}
            <ul class="mt-4 pt-4 border-t text-sm text-slate-600 space-y-2">
              <li>♾️ وصول دائم بعد الشراء</li>
              <li>📝 ملاحظات شخصية على الملخّص</li>
              <li>💡 أهم الأفكار في نقاط</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>

    ${section(`
      <div class="grid lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2 space-y-6">
          ${summary.description ? `<div class="card p-6">
            <h2 class="text-xl font-bold font-display mb-3">عن الملخّص</h2>
            <p class="text-slate-700 leading-relaxed">${esc(summary.description)}</p></div>` : ''}

          ${summary.key_ideas?.length ? `<div class="card p-6">
            <h2 class="text-xl font-bold font-display mb-4">💡 أهم الأفكار</h2>
            <ul class="space-y-3">
              ${summary.key_ideas.map((idea, i) => `
                <li class="flex gap-3">
                  <span class="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 grid place-items-center font-bold text-sm shrink-0">${i + 1}</span>
                  <span class="text-slate-700 ${!owned && i > 1 ? 'blur-sm select-none' : ''}">${esc(idea)}</span>
                </li>`).join('')}
            </ul>
            ${!owned && summary.key_ideas.length > 2
              ? '<p class="text-sm text-slate-500 mt-4 text-center">🔒 اشترِ الملخّص لعرض بقية الأفكار</p>' : ''}
          </div>` : ''}

          ${summary.preview_content && !owned ? `
            <div class="card p-6 relative overflow-hidden">
              <h2 class="text-xl font-bold font-display mb-3">📖 مقتطف مجاني</h2>
              <div class="prose-ar">${markdown(summary.preview_content)}</div>
              <div class="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-white to-transparent"></div>
            </div>` : ''}

          <div class="card p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-bold font-display">التقييمات</h2>
              ${owned ? '<button id="rateBtn2" class="btn btn-ghost btn-sm">✍️ اكتب تقييمك</button>' : ''}
            </div>
            ${reviews.length ? `<div class="space-y-3">${reviews.map(r => `
              <div class="pb-3 border-b last:border-0 flex gap-3">
                ${avatar(r.user_avatar, r.user_name, 9)}
                <div class="flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-sm">${esc(r.user_name)}</span>${stars(r.rating)}
                    <span class="text-xs text-slate-400">${fromNow(r.created_at)}</span></div>
                  ${r.comment ? `<p class="text-sm text-slate-700 mt-1">${esc(r.comment)}</p>` : ''}
                </div></div>`).join('')}</div>`
              : '<p class="text-slate-500 text-sm">لا تقييمات بعد.</p>'}
          </div>
        </div>
      </div>

      ${related.length ? `<div class="mt-10">
        <h2 class="text-xl font-bold font-display mb-4">ملخّصات مشابهة</h2>
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">${related.map(summaryCard).join('')}</div>
      </div>` : ''}
    `)}`;

  const requireLogin = () => {
    if (isLoggedIn()) return true;
    navigate(`/login?next=${encodeURIComponent(location.hash.slice(1))}`);
    return false;
  };

  document.getElementById('cartBtn')?.addEventListener('click', async (e) => {
    if (!requireLogin()) return;
    e.target.disabled = true;
    try { await addToCart('summary', summary.id); toast('أُضيف الملخّص للسلة 🛒', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { e.target.disabled = false; }
  });

  document.getElementById('buyBtn')?.addEventListener('click', async () => {
    if (!requireLogin()) return;
    try { await addToCart('summary', summary.id); } catch {}
    navigate('/checkout');
  });

  document.getElementById('claimBtn')?.addEventListener('click', async (e) => {
    if (!requireLogin()) return;
    e.target.disabled = true;
    try { await api.post(`/summaries/${summary.id}/claim`); toast('أُضيف لمكتبتك 📚', 'success'); navigate(`/read/${summary.id}`); }
    catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  });

  document.getElementById('wishBtn')?.addEventListener('click', async () => {
    if (!requireLogin()) return;
    try { await api.post('/wishlist', { item_type: 'summary', item_id: summary.id }); toast('أُضيف للمفضّلة ❤️', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });

  for (const id of ['rateBtn', 'rateBtn2']) {
    document.getElementById(id)?.addEventListener('click', () =>
      openReviewModal('summary', summary.id, () => summaryDetail({ view, params })));
  }
}

/* ============================ قارئ الملخّص ============================ */
export async function reader({ view, params }) {
  view.innerHTML = spinner('نفتح الملخّص...');

  let data;
  try { data = await api.get(`/summaries/${params.id}/read`); }
  catch (err) {
    view.innerHTML = emptyState('🔒', 'هذا الملخّص غير متاح لك',
      err.message, `<a href="#/summaries" class="btn btn-primary">تصفّح الملخّصات</a>`);
    return;
  }

  let fontSize = Number(localStorage.getItem('reader_font') || 17);

  const render = () => {
    view.innerHTML = `
      <div class="bg-white min-h-screen">
        <div class="sticky top-16 z-30 bg-white/95 backdrop-blur border-b no-print">
          <div class="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
            <a href="#/summaries/${data.id}" class="text-slate-500 hover:text-slate-900 text-sm">←</a>
            <h1 class="font-bold truncate flex-1 text-sm">${esc(data.title)}</h1>
            <button id="fontDown" class="btn btn-ghost btn-sm">أ-</button>
            <button id="fontUp" class="btn btn-ghost btn-sm">أ+</button>
            <button id="printBtn" class="btn btn-ghost btn-sm hidden sm:inline-flex">🖨</button>
          </div>
        </div>

        <article class="max-w-3xl mx-auto px-4 py-8">
          <header class="mb-8 pb-6 border-b">
            <p class="text-sm text-amber-700 font-bold mb-1">📖 ملخّص كتاب</p>
            <h1 class="text-3xl font-extrabold font-display mb-2">${esc(data.title)}</h1>
            <p class="text-slate-600">«${esc(data.book_title)}» — ${esc(data.book_author)}</p>
            <p class="text-sm text-slate-400 mt-2">⏱ ${data.reading_minutes} دقيقة قراءة</p>
            <div class="flex gap-2 mt-4 no-print">
              ${data.audio_url ? `<a href="${esc(data.audio_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">🎧 استمع</a>` : ''}
              ${data.pdf_url ? `<a href="${esc(data.pdf_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">📄 PDF</a>` : ''}
            </div>
          </header>

          ${data.key_ideas?.length ? `
            <div class="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-8">
              <h2 class="font-bold font-display mb-3 text-amber-900">💡 الأفكار المفتاحية</h2>
              <ul class="space-y-2">
                ${data.key_ideas.map((idea, i) => `
                  <li class="flex gap-2 text-sm text-slate-700">
                    <span class="font-bold text-amber-700">${i + 1}.</span>${esc(idea)}</li>`).join('')}
              </ul>
            </div>` : ''}

          <div class="prose-ar" style="font-size:${fontSize}px">${markdown(data.content)}</div>

          <div class="mt-10 pt-6 border-t no-print">
            <h3 class="font-bold font-display mb-3">📝 ملاحظاتي</h3>
            <form id="noteForm" class="flex gap-2 mb-3">
              <input name="body" required placeholder="اكتب ملاحظة..." class="field flex-1" />
              <button class="btn btn-primary btn-sm">حفظ</button>
            </form>
            <div id="notesList" class="space-y-2"></div>
          </div>
        </article>
      </div>`;

    document.getElementById('fontUp').addEventListener('click', () => {
      fontSize = Math.min(26, fontSize + 1); localStorage.setItem('reader_font', fontSize); render();
    });
    document.getElementById('fontDown').addEventListener('click', () => {
      fontSize = Math.max(14, fontSize - 1); localStorage.setItem('reader_font', fontSize); render();
    });
    document.getElementById('printBtn').addEventListener('click', () => window.print());

    document.getElementById('noteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post(`/summaries/${data.id}/notes`, { body: e.target.body.value });
        e.target.reset(); toast('حُفظت الملاحظة', 'success'); loadNotes();
      } catch (err) { toast(err.message, 'error'); }
    });
    loadNotes();
  };

  const loadNotes = async () => {
    try {
      const result = await api.get('/me/notes');
      const mine = result.data.filter(n => n.summary_id === data.id);
      document.getElementById('notesList').innerHTML = mine.length
        ? mine.map(n => `<div class="bg-slate-50 rounded-lg p-3 text-sm">${esc(n.body)}
            <span class="text-xs text-slate-400 block mt-1">${fromNow(n.created_at)}</span></div>`).join('')
        : '<p class="text-sm text-slate-400">لا ملاحظات بعد.</p>';
    } catch {}
  };

  render();
}
