import { api } from '../api.js';
import { addToCart, isLoggedIn, state } from '../store.js';
import {
  esc, money, priceTag, spinner, section, pageHeader, liveCard, stars, avatar,
  emptyState, errorState, pagination, toast, formatDate, markdown, fromNow,
} from '../ui.js';
import { navigate } from '../router.js';
import { openReviewModal } from './courses.js';

/* ============================ قائمة الحصص ============================ */
export async function liveList({ view, query }) {
  const scope = query.scope || 'upcoming';
  const tab = (value, label) => `
    <a href="#/live?scope=${value}" class="px-4 py-2 rounded-xl text-sm font-bold transition-colors
       ${scope === value ? 'bg-white text-brand-800 shadow-sm' : 'text-white/80 hover:bg-white/10'}">${label}</a>`;

  view.innerHTML = pageHeader('الحصص المباشرة', 'تعلّم مباشرة مع معلّم — أسئلة، نقاش، ومسابقات تفاعلية',
    `<div class="flex gap-2 mt-5 bg-black/20 p-1.5 rounded-2xl w-fit flex-wrap">
       ${tab('upcoming', '📅 قادمة')} ${tab('live', '🔴 تُبثّ الآن')} ${tab('past', '🗄 سابقة')}
     </div>`) +
    section(`<div id="results">${spinner()}</div>`);

  try {
    const result = await api.get('/live', { ...query, scope });
    document.getElementById('results').innerHTML = result.data.length
      ? `<p class="text-sm text-slate-500 mb-4">${result.meta.total} حصة</p>
         <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">${result.data.map(liveCard).join('')}</div>
         ${pagination(result.meta, `#/live?scope=${scope}`)}`
      : emptyState('📭',
          scope === 'live' ? 'لا توجد حصص تُبثّ الآن' : scope === 'past' ? 'لا توجد حصص سابقة' : 'لا حصص مجدولة حالياً',
          'تابعنا — تُضاف حصص جديدة أسبوعياً.',
          '<a href="#/courses" class="btn btn-primary">تصفّح الدورات</a>');
  } catch (err) {
    document.getElementById('results').innerHTML = errorState(err.message);
  }
}

/* ============================ تفاصيل الحصة ============================ */
export async function liveDetail({ view, params }) {
  view.innerHTML = spinner();
  let data;
  try { data = await api.get(`/live/${params.id}`); }
  catch (err) { view.innerHTML = errorState(err.message, '#/live'); return; }

  const { session, access, booking, seatsLeft, reviews } = data;
  const booked = booking && !['cancelled', 'refunded'].includes(booking.status);
  const isLive = session.status === 'live';
  const isEnded = session.status === 'ended';
  const startsIn = new Date(session.starts_at).getTime() - Date.now();
  const canJoin = access.allowed && (isLive || startsIn <= 15 * 60000) && !isEnded;

  const countdown = () => {
    if (isEnded) return '<span class="badge bg-slate-200 text-slate-700">انتهت الحصة</span>';
    if (isLive) return '<span class="badge bg-rose-600 text-white"><span class="w-2 h-2 rounded-full bg-white live-dot inline-block"></span> تُبثّ الآن</span>';
    if (startsIn <= 0) return '<span class="badge bg-amber-100 text-amber-800">على وشك البدء</span>';
    const days = Math.floor(startsIn / 86400000);
    const hours = Math.floor((startsIn % 86400000) / 3600000);
    const mins = Math.floor((startsIn % 3600000) / 60000);
    return `<span class="badge bg-white/20">⏳ تبدأ بعد ${days ? `${days} يوم و` : ''}${hours} ساعة و${mins} دقيقة</span>`;
  };

  view.innerHTML = `
    <div class="bg-gradient-to-l from-slate-900 ${isLive ? 'to-rose-800' : 'to-indigo-800'} text-white">
      <div class="max-w-7xl mx-auto px-4 py-10 grid lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2">
          <div class="mb-3">${countdown()}</div>
          <h1 class="text-3xl md:text-4xl font-extrabold font-display mb-3">${esc(session.title)}</h1>
          <div class="flex flex-wrap gap-4 text-sm text-white/90">
            <span>🗓 ${formatDate(session.starts_at, true)}</span>
            <span>⏱ ${session.duration_minutes} دقيقة</span>
            <span>🪑 ${session.booked_count} / ${session.capacity} مقعد</span>
          </div>
          <a href="#/instructors/${session.instructor_id}" class="inline-flex items-center gap-3 mt-5">
            ${avatar(session.instructor_avatar, session.instructor_name, 10)}
            <div><p class="font-bold text-sm">${esc(session.instructor_name)}</p>
            <p class="text-xs text-white/70">${esc(session.instructor_title || '')}</p></div>
          </a>
        </div>

        <aside>
          <div class="card p-5 text-slate-900 lg:sticky lg:top-20">
            <div class="text-center mb-4">
              <div class="text-3xl font-extrabold">${session.price === 0 ? '<span class="text-brand-600">مجاناً</span>' : money(session.price)}</div>
              <p class="text-xs text-slate-500 mt-1">${session.price > 0 ? 'رسوم حضور الحصة' : 'حصة مفتوحة للجميع'}</p>
            </div>

            ${booked ? `
              <div class="bg-brand-50 border border-brand-200 rounded-xl p-3 mb-3 text-center text-sm text-brand-800 font-bold">
                ✅ مقعدك محجوز
              </div>
              ${canJoin
                ? `<a href="#/live/${session.id}/room" class="btn ${isLive ? 'btn-danger' : 'btn-primary'} w-full mb-2">
                     ${isLive ? '🔴 ادخل البثّ الآن' : '🚪 ادخل القاعة'}</a>`
                : isEnded
                  ? (session.recording_url
                      ? `<a href="${esc(session.recording_url)}" target="_blank" rel="noopener" class="btn btn-primary w-full mb-2">▶️ شاهد التسجيل</a>`
                      : '<p class="text-center text-sm text-slate-500 mb-2">انتهت الحصة — سيُرفع التسجيل قريباً</p>')
                  : '<p class="text-center text-sm text-slate-500 mb-2">تفتح القاعة قبل الموعد بـ ١٥ دقيقة</p>'}
              ${!isEnded ? '<button id="cancelBtn" class="btn btn-ghost w-full text-sm">إلغاء الحجز</button>' : ''}
              ${isEnded ? '<button id="rateBtn" class="btn btn-ghost w-full text-sm">⭐ قيّم الحصة</button>' : ''}
            ` : isEnded ? '<p class="text-center text-slate-500 text-sm">انتهت هذه الحصة</p>'
              : seatsLeft <= 0 ? '<button disabled class="btn btn-ghost w-full">اكتمل العدد</button>'
              : session.price === 0
                ? '<button id="bookBtn" class="btn btn-primary w-full mb-2">احجز مقعدك مجاناً</button>'
                : `<button id="cartBtn" class="btn btn-primary w-full mb-2">🛒 أضف للسلة</button>
                   <button id="buyBtn" class="btn btn-amber w-full">احجز الآن</button>`}

            <div class="mt-4 pt-4 border-t text-sm space-y-2 text-slate-600">
              <p class="${seatsLeft <= 5 && seatsLeft > 0 ? 'text-rose-600 font-bold' : ''}">
                ${seatsLeft > 0 ? `🪑 ${seatsLeft} مقعد متبقٍ` : '❌ اكتمل العدد'}</p>
              <p>💬 دردشة مباشرة مع المعلّم</p>
              <p>✋ رفع اليد وطرح الأسئلة</p>
              <p>🏆 مسابقات تفاعلية أثناء البثّ</p>
              ${session.course_title ? `<p>📚 ضمن دورة: <a href="#/courses/${esc(session.course_slug)}" class="text-brand-700 font-semibold hover:underline">${esc(session.course_title)}</a></p>` : ''}
            </div>
          </div>
        </aside>
      </div>
    </div>

    ${section(`
      <div class="grid lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2 space-y-6">
          ${session.description ? `<div class="card p-6">
            <h2 class="text-xl font-bold font-display mb-3">عن الحصة</h2>
            <div class="prose-ar">${markdown(session.description)}</div></div>` : ''}

          <div class="card p-6">
            <h2 class="text-xl font-bold font-display mb-3">كيف تسير الحصة؟</h2>
            <ol class="space-y-3 text-sm text-slate-700">
              ${[['١', 'احجز مقعدك', 'ادفع مرّة واحدة ويُحجز مقعدك فوراً.'],
                 ['٢', 'ادخل القاعة', 'تفتح القاعة قبل الموعد بـ ١٥ دقيقة.'],
                 ['٣', 'شارك بفاعلية', 'دردشة، رفع يد، ومسابقات تُحتسب فيها نقاط السرعة.'],
                 ['٤', 'راجع التسجيل', 'يُرفع التسجيل بعد الحصة إن أتاحه المعلّم.']]
                .map(([num, title, text]) => `
                  <li class="flex gap-3">
                    <span class="w-7 h-7 rounded-full bg-brand-100 text-brand-700 grid place-items-center font-bold shrink-0">${num}</span>
                    <div><p class="font-bold">${title}</p><p class="text-slate-600">${text}</p></div>
                  </li>`).join('')}
            </ol>
          </div>

          ${reviews.length ? `<div class="card p-6">
            <h2 class="text-xl font-bold font-display mb-4">آراء الحاضرين</h2>
            <div class="space-y-3">${reviews.map(r => `
              <div class="pb-3 border-b last:border-0">
                <div class="flex items-center gap-2"><span class="font-bold text-sm">${esc(r.user_name)}</span>${stars(r.rating)}
                  <span class="text-xs text-slate-400">${fromNow(r.created_at)}</span></div>
                ${r.comment ? `<p class="text-sm text-slate-700 mt-1">${esc(r.comment)}</p>` : ''}
              </div>`).join('')}</div></div>` : ''}
        </div>
      </div>`)}`;

  const requireLogin = () => {
    if (isLoggedIn()) return true;
    navigate(`/login?next=${encodeURIComponent(location.hash.slice(1))}`);
    return false;
  };

  document.getElementById('bookBtn')?.addEventListener('click', async (e) => {
    if (!requireLogin()) return;
    e.target.disabled = true;
    try { await api.post(`/live/${session.id}/book`); toast('تم حجز مقعدك 🎟', 'success'); liveDetail({ view, params }); }
    catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  });

  document.getElementById('cartBtn')?.addEventListener('click', async (e) => {
    if (!requireLogin()) return;
    e.target.disabled = true;
    try { await addToCart('live_session', session.id); toast('أُضيفت الحصة للسلة 🛒', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { e.target.disabled = false; }
  });

  document.getElementById('buyBtn')?.addEventListener('click', async () => {
    if (!requireLogin()) return;
    try { await addToCart('live_session', session.id); } catch {}
    navigate('/checkout');
  });

  document.getElementById('cancelBtn')?.addEventListener('click', async () => {
    try {
      const result = await api.post(`/live/${session.id}/cancel-booking`);
      toast(result.message, 'info');
      liveDetail({ view, params });
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('rateBtn')?.addEventListener('click', () =>
    openReviewModal('live_session', session.id, () => liveDetail({ view, params })));
}
