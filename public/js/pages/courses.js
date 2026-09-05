import { api } from '../api.js';
import { state, addToCart, isLoggedIn } from '../store.js';
import {
  esc, money, priceTag, spinner, section, pageHeader, courseCard, stars, avatar, duration,
  emptyState, errorState, pagination, toast, formatDate, markdown, fromNow, modal, confirmDialog,
} from '../ui.js';
import { navigate } from '../router.js';

/* ============================ قائمة الدورات ============================ */
export async function courseList({ view, query }) {
  const categories = await api.get('/categories').then(r => r.data).catch(() => []);

  const filterBar = `
    <form id="filters" class="card p-4 mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <input name="search" value="${esc(query.search || '')}" placeholder="ابحث في الدورات..." class="field lg:col-span-2" />
      <select name="category" class="field">
        <option value="">كل التصنيفات</option>
        ${categories.map(c => `<option value="${esc(c.slug)}" ${query.category === c.slug ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('')}
      </select>
      <select name="level" class="field">
        <option value="">كل المستويات</option>
        ${[['beginner', 'مبتدئ'], ['intermediate', 'متوسّط'], ['advanced', 'متقدّم'], ['all', 'جميع المستويات']]
          .map(([v, l]) => `<option value="${v}" ${query.level === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select name="sort" class="field">
        ${[['newest', 'الأحدث'], ['popular', 'الأكثر رواجاً'], ['rating', 'الأعلى تقييماً'], ['price_asc', 'الأقل سعراً'], ['price_desc', 'الأعلى سعراً']]
          .map(([v, l]) => `<option value="${v}" ${query.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="flex items-center gap-2 text-sm font-semibold px-2">
        <input type="checkbox" name="free" value="true" ${query.free === 'true' ? 'checked' : ''} class="w-4 h-4 accent-emerald-600" /> مجانية فقط
      </label>
      <div class="flex gap-2 lg:col-span-2">
        <button class="btn btn-primary btn-sm flex-1">تطبيق</button>
        <a href="#/courses" class="btn btn-ghost btn-sm">مسح</a>
      </div>
    </form>`;

  view.innerHTML = pageHeader('الدورات', 'تعلّم بوتيرتك مع دورات مسجّلة ومباشرة') +
    section(filterBar + `<div id="results">${spinner()}</div>`);

  document.getElementById('filters').addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(e.target)) if (value) params.set(key, value);
    navigate(`/courses?${params}`);
  });

  try {
    const result = await api.get('/courses', query);
    document.getElementById('results').innerHTML = result.data.length
      ? `<p class="text-sm text-slate-500 mb-4">${result.meta.total} دورة</p>
         <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">${result.data.map(courseCard).join('')}</div>
         ${pagination(result.meta, `#/courses?${new URLSearchParams({ ...query, page: '' })}`.replace(/page=$/, ''))}`
      : emptyState('🔍', 'لا توجد دورات مطابقة', 'جرّب تعديل معايير البحث.');
  } catch (err) {
    document.getElementById('results').innerHTML = errorState(err.message);
  }
}

/* ============================ تفاصيل الدورة ============================ */
export async function courseDetail({ view, params }) {
  view.innerHTML = spinner();
  let data;
  try { data = await api.get(`/courses/${encodeURIComponent(params.slug)}`); }
  catch (err) { view.innerHTML = errorState(err.message, '#/courses'); return; }

  const { course, curriculum, reviews, liveSessions, access, progress } = data;
  const price = course.discount_price ?? course.price;
  const owned = access.allowed;

  const levelLabel = { beginner: 'مبتدئ', intermediate: 'متوسّط', advanced: 'متقدّم', all: 'جميع المستويات' }[course.level];
  const typeLabel = { recorded: 'دورة مسجّلة', live: 'دورة مباشرة', hybrid: 'مسجّلة + مباشرة' }[course.type];

  const lessonRow = (lesson) => {
    const openable = owned || lesson.is_free_preview;
    const icon = { video: '▶️', article: '📄', pdf: '📕', quiz: '📝', live: '🔴', audio: '🎧' }[lesson.type] || '📄';
    return `
      <li class="flex items-center gap-3 px-4 py-3 border-t border-slate-100 ${openable ? 'hover:bg-brand-50/50 cursor-pointer' : ''}"
          ${openable ? `data-lesson="${lesson.id}"` : ''}>
        <span>${icon}</span>
        <span class="flex-1 text-sm ${openable ? 'text-slate-800' : 'text-slate-500'}">${esc(lesson.title)}</span>
        ${lesson.is_free_preview && !owned ? '<span class="badge bg-brand-100 text-brand-700">معاينة مجانية</span>' : ''}
        ${!openable ? '<span class="text-slate-400">🔒</span>' : ''}
        <span class="text-xs text-slate-400 tabular-nums">${lesson.duration_seconds ? duration(lesson.duration_seconds) : ''}</span>
      </li>`;
  };

  view.innerHTML = `
    <div class="bg-gradient-to-l from-slate-900 to-brand-800 text-white">
      <div class="max-w-7xl mx-auto px-4 py-10 grid lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2">
          <div class="flex flex-wrap gap-2 mb-3">
            <span class="badge bg-white/15">${esc(typeLabel)}</span>
            <span class="badge bg-white/15">${esc(levelLabel)}</span>
            ${course.category_name ? `<span class="badge bg-white/15">${esc(course.category_name)}</span>` : ''}
          </div>
          <h1 class="text-3xl md:text-4xl font-extrabold font-display mb-3">${esc(course.title)}</h1>
          ${course.subtitle ? `<p class="text-lg text-brand-100 mb-4">${esc(course.subtitle)}</p>` : ''}
          <div class="flex flex-wrap items-center gap-4 text-sm">
            <span>${stars(course.rating_avg, course.rating_count)}</span>
            <span>🎓 ${course.students_count} طالب</span>
            <span>📚 ${course.lessons_count} درس</span>
            <span>⏱ ${duration(course.total_seconds)}</span>
          </div>
          <a href="#/instructors/${course.instructor_id}" class="inline-flex items-center gap-3 mt-5 hover:opacity-90">
            ${avatar(course.instructor_avatar, course.instructor_name, 10)}
            <div><p class="font-bold text-sm">${esc(course.instructor_name)}</p>
            <p class="text-xs text-brand-200">${esc(course.instructor_title || '')}</p></div>
          </a>
        </div>

        <!-- بطاقة الشراء -->
        <aside class="lg:row-span-2">
          <div class="card p-5 text-slate-900 lg:sticky lg:top-20">
            ${course.thumbnail ? `<img src="${esc(course.thumbnail)}" class="w-full h-40 object-cover rounded-xl mb-4" alt="" />` : ''}
            ${owned ? `
              <div class="bg-brand-50 border border-brand-200 rounded-xl p-3 mb-4 text-center">
                <p class="text-brand-800 font-bold text-sm">✅ أنت مشترك في هذه الدورة</p>
                ${progress ? `<div class="progress mt-2"><div style="width:${progress.progress_percent}%"></div></div>
                  <p class="text-xs text-slate-600 mt-1">أكملت ${Math.round(progress.progress_percent)}٪</p>` : ''}
              </div>
              <a href="#/learn/${course.id}" class="btn btn-primary w-full mb-2">
                ${progress?.progress_percent > 0 ? 'تابع التعلّم' : 'ابدأ التعلّم'}
              </a>
              ${progress?.progress_percent >= 100 ? '<button id="certBtn" class="btn btn-amber w-full">🎓 استخرج الشهادة</button>' : ''}
            ` : `
              <div class="text-center mb-4">
                <div class="text-3xl font-extrabold">${price === 0 ? '<span class="text-brand-600">مجاناً</span>' : money(price)}</div>
                ${course.discount_price != null && course.discount_price < course.price ? `
                  <p class="text-sm text-slate-400 line-through">${money(course.price)}</p>
                  <span class="badge bg-rose-100 text-rose-700 mt-1">وفّر ${Math.round((1 - course.discount_price / course.price) * 100)}٪</span>` : ''}
              </div>
              ${price === 0
                ? '<button id="enrollBtn" class="btn btn-primary w-full mb-2">سجّل مجاناً</button>'
                : `<button id="cartBtn" class="btn btn-primary w-full mb-2">🛒 أضف إلى السلة</button>
                   <button id="buyNowBtn" class="btn btn-amber w-full mb-2">اشترِ الآن</button>`}
              <button id="wishBtn" class="btn btn-ghost w-full text-sm">❤️ أضف للمفضّلة</button>
            `}
            <ul class="mt-4 pt-4 border-t text-sm text-slate-600 space-y-2">
              <li>♾️ وصول مدى الحياة</li>
              <li>📱 يعمل على الجوال والحاسوب</li>
              <li>🎓 شهادة إتمام بعد إنهاء الدورة</li>
              <li>💬 أسئلة وأجوبة مع المعلّم</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>

    ${section(`
      <div class="grid lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2 space-y-8">
          ${course.outcomes?.length ? `
            <div class="card p-6">
              <h2 class="text-xl font-bold font-display mb-4">ماذا ستتعلّم؟</h2>
              <ul class="grid sm:grid-cols-2 gap-3">
                ${course.outcomes.map(o => `<li class="flex gap-2 text-sm text-slate-700"><span class="text-brand-600">✓</span>${esc(o)}</li>`).join('')}
              </ul>
            </div>` : ''}

          <div class="card overflow-hidden">
            <div class="p-6 pb-4">
              <h2 class="text-xl font-bold font-display">محتوى الدورة</h2>
              <p class="text-sm text-slate-500 mt-1">${curriculum.length} أقسام • ${course.lessons_count} درس • ${duration(course.total_seconds)}</p>
            </div>
            ${curriculum.map(sec => `
              <div class="border-t">
                <div class="px-4 py-3 bg-slate-50 font-bold text-sm flex justify-between">
                  <span>${esc(sec.title)}</span>
                  <span class="text-slate-500 font-normal">${sec.lessons.length} درس</span>
                </div>
                <ul>${sec.lessons.map(lessonRow).join('')}</ul>
              </div>`).join('')}
          </div>

          ${course.description ? `<div class="card p-6">
            <h2 class="text-xl font-bold font-display mb-3">وصف الدورة</h2>
            <div class="prose-ar">${markdown(course.description)}</div></div>` : ''}

          ${course.requirements?.length ? `<div class="card p-6">
            <h2 class="text-xl font-bold font-display mb-3">المتطلّبات</h2>
            <ul class="list-disc pr-5 space-y-1 text-slate-700 text-sm">${course.requirements.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}

          ${liveSessions.length ? `<div class="card p-6">
            <h2 class="text-xl font-bold font-display mb-4">🔴 حصص مباشرة مرتبطة</h2>
            <div class="space-y-3">
              ${liveSessions.map(ls => `
                <a href="#/live/${ls.id}" class="flex items-center gap-3 p-3 rounded-xl border hover:border-brand-300 hover:bg-brand-50/40">
                  <div class="text-2xl">${ls.status === 'live' ? '🔴' : '📅'}</div>
                  <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm truncate">${esc(ls.title)}</p>
                    <p class="text-xs text-slate-500">${formatDate(ls.starts_at, true)} • ${ls.duration_minutes} دقيقة</p>
                  </div>
                  <div class="text-sm">${priceTag(ls.price)}</div>
                </a>`).join('')}
            </div></div>` : ''}

          <div class="card p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-bold font-display">التقييمات</h2>
              ${owned ? '<button id="reviewBtn" class="btn btn-ghost btn-sm">✍️ اكتب تقييمك</button>' : ''}
            </div>
            ${reviews.length ? `<div class="space-y-4">${reviews.map(r => `
              <div class="flex gap-3 pb-4 border-b last:border-0">
                ${avatar(r.user_avatar, r.user_name, 10)}
                <div class="flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-sm">${esc(r.user_name)}</span>
                    ${stars(r.rating)}
                    <span class="text-xs text-slate-400">${fromNow(r.created_at)}</span>
                  </div>
                  ${r.comment ? `<p class="text-sm text-slate-700 mt-1 leading-relaxed">${esc(r.comment)}</p>` : ''}
                </div>
              </div>`).join('')}</div>` : '<p class="text-slate-500 text-sm">لا توجد تقييمات بعد — كن أول من يقيّم.</p>'}
          </div>
        </div>
      </div>`)}`;

  /* ------------------ التفاعلات ------------------ */
  view.querySelectorAll('[data-lesson]').forEach(el => el.addEventListener('click', () => {
    navigate(`/learn/${course.id}/${el.dataset.lesson}`);
  }));

  const requireLogin = () => {
    if (isLoggedIn()) return true;
    toast('سجّل الدخول أولاً', 'warn');
    navigate(`/login?next=${encodeURIComponent(location.hash.slice(1))}`);
    return false;
  };

  document.getElementById('cartBtn')?.addEventListener('click', async (e) => {
    if (!requireLogin()) return;
    e.target.disabled = true;
    try { await addToCart('course', course.id); toast('أُضيفت الدورة إلى السلة 🛒', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { e.target.disabled = false; }
  });

  document.getElementById('buyNowBtn')?.addEventListener('click', async () => {
    if (!requireLogin()) return;
    try { await addToCart('course', course.id); } catch {}
    navigate('/checkout');
  });

  document.getElementById('enrollBtn')?.addEventListener('click', async (e) => {
    if (!requireLogin()) return;
    e.target.disabled = true;
    try {
      await api.post(`/courses/${course.id}/enroll`);
      toast('تم تسجيلك في الدورة 🎉', 'success');
      navigate(`/learn/${course.id}`);
    } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  });

  document.getElementById('wishBtn')?.addEventListener('click', async () => {
    if (!requireLogin()) return;
    try { await api.post('/wishlist', { item_type: 'course', item_id: course.id }); toast('أُضيفت للمفضّلة ❤️', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('certBtn')?.addEventListener('click', async () => {
    try {
      const result = await api.post(`/certificates/${course.id}/issue`);
      toast(result.existing ? 'شهادتك جاهزة مسبقاً' : 'تهانينا! صدرت شهادتك 🎓', 'success');
      navigate('/certificates');
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('reviewBtn')?.addEventListener('click', () => openReviewModal('course', course.id));
}

/** نافذة كتابة تقييم مشتركة بين الدورات والملخّصات والحصص. */
export function openReviewModal(itemType, itemId, onDone) {
  const dialog = modal({
    title: 'تقييمك يساعد غيرك',
    body: `
      <form id="reviewForm" class="space-y-4">
        <div>
          <label class="label">تقييمك</label>
          <div class="flex gap-1 text-3xl" id="starPicker">
            ${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" class="text-slate-300 hover:text-amber-400 transition-colors">★</button>`).join('')}
          </div>
          <input type="hidden" name="rating" value="5" />
        </div>
        <div><label class="label">تعليقك <span class="text-slate-400 font-normal">(اختياري)</span></label>
          <textarea name="comment" rows="4" class="field" placeholder="ما الذي أعجبك؟ وما الذي يمكن تحسينه؟"></textarea></div>
        <button class="btn btn-primary w-full">إرسال التقييم</button>
      </form>`,
  });

  const form = dialog.el.querySelector('#reviewForm');
  const setStars = (value) => {
    form.rating.value = value;
    dialog.el.querySelectorAll('[data-star]').forEach(btn => {
      btn.className = Number(btn.dataset.star) <= value
        ? 'text-amber-400 transition-colors' : 'text-slate-300 hover:text-amber-400 transition-colors';
    });
  };
  dialog.el.querySelectorAll('[data-star]').forEach(btn =>
    btn.addEventListener('click', () => setStars(Number(btn.dataset.star))));
  setStars(5);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/reviews', {
        item_type: itemType, item_id: itemId,
        rating: Number(form.rating.value), comment: form.comment.value || null,
      });
      toast('شكراً لتقييمك ⭐', 'success');
      dialog.close();
      onDone ? onDone() : location.reload();
    } catch (err) { toast(err.message, 'error'); }
  });
}
