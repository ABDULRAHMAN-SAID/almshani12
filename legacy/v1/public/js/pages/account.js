import { api } from '../api.js';
import { state, refreshUser, setState } from '../store.js';
import {
  esc, money, spinner, section, pageHeader, emptyState, errorState, toast,
  formatDate, fromNow, avatar, courseCard, summaryCard, confirmDialog, duration,
} from '../ui.js';
import { navigate } from '../router.js';

/* ============================ لوحة الطالب ============================ */
export async function dashboard({ view }) {
  view.innerHTML = spinner();
  let data;
  try { data = await api.get('/me/dashboard'); }
  catch (err) { view.innerHTML = errorState(err.message); return; }

  const statCard = (icon, value, label, href) => `
    <a href="${href}" class="card p-4 text-center card-hover">
      <div class="text-3xl mb-1">${icon}</div>
      <div class="text-2xl font-extrabold font-display">${value}</div>
      <div class="text-xs text-slate-500">${label}</div>
    </a>`;

  view.innerHTML = pageHeader(`أهلاً ${state.user.name} 👋`, 'تابع رحلتك التعليمية من هنا') + section(`
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
      ${statCard('📚', data.stats.courses, 'دورة', '#/my-learning')}
      ${statCard('✅', data.stats.completed, 'مكتملة', '#/my-learning')}
      ${statCard('📖', data.stats.summaries, 'ملخّص', '#/my-learning')}
      ${statCard('🔴', data.stats.liveSessions, 'حصة', '#/live')}
      ${statCard('🎓', data.stats.certificates, 'شهادة', '#/certificates')}
      ${statCard('⏱', data.stats.watchMinutes, 'دقيقة تعلّم', '#/my-learning')}
      ${statCard('💰', Number(data.stats.wallet).toFixed(1), 'رصيدك', '#/wallet')}
    </div>

    ${data.upcomingLive.length ? `
      <div class="card p-5 mb-8 border-r-4 border-r-rose-500">
        <h2 class="font-bold font-display mb-3">🔴 حصصك القادمة</h2>
        <div class="space-y-2">
          ${data.upcomingLive.map(s => `
            <a href="#/live/${s.id}" class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50">
              <div class="text-2xl">${s.status === 'live' ? '🔴' : '📅'}</div>
              <div class="flex-1 min-w-0">
                <p class="font-bold text-sm truncate">${esc(s.title)}</p>
                <p class="text-xs text-slate-500">${formatDate(s.starts_at, true)} • ${esc(s.instructor_name)}</p>
              </div>
              ${s.status === 'live'
                ? `<a href="#/live/${s.id}/room" class="btn btn-danger btn-sm">ادخل الآن</a>`
                : `<span class="text-xs text-slate-400">${fromNow(s.starts_at)}</span>`}
            </a>`).join('')}
        </div>
      </div>` : ''}

    ${data.inProgress.length ? `
      <h2 class="text-xl font-bold font-display mb-4">📚 تابع من حيث توقّفت</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        ${data.inProgress.map(course => `
          <a href="#/learn/${course.id}" class="card p-4 card-hover">
            <h3 class="font-bold clamp-2 mb-2">${esc(course.title)}</h3>
            <p class="text-xs text-slate-500 mb-3">${esc(course.instructor_name)}</p>
            <div class="progress"><div style="width:${course.progress_percent}%"></div></div>
            <p class="text-xs text-slate-500 mt-1.5">${Math.round(course.progress_percent)}٪ مكتمل</p>
          </a>`).join('')}
      </div>` : emptyState('🚀', 'ابدأ أول دورة لك', 'اختر من مكتبة دوراتنا وابدأ التعلّم اليوم.',
          '<a href="#/courses" class="btn btn-primary">تصفّح الدورات</a>')}

    ${data.recentSummaries.length ? `
      <h2 class="text-xl font-bold font-display mb-4">📖 ملخّصاتك</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        ${data.recentSummaries.map(s => `
          <a href="#/read/${s.id}" class="card p-3 card-hover text-center">
            <div class="text-3xl mb-2">📖</div>
            <p class="font-bold text-sm clamp-2">${esc(s.title)}</p>
            <p class="text-xs text-slate-400 mt-1">${s.reading_minutes} د</p>
          </a>`).join('')}
      </div>` : ''}`);
}

/* ============================ مكتبتي ============================ */
export async function library({ view, query }) {
  const tab = query.tab || 'courses';
  const tabButton = (value, label, count) => `
    <a href="#/my-learning?tab=${value}" class="px-4 py-2 rounded-xl text-sm font-bold transition-colors
       ${tab === value ? 'bg-white text-brand-800 shadow-sm' : 'text-white/80 hover:bg-white/10'}">${label} (${count})</a>`;

  view.innerHTML = spinner();
  const data = await api.get('/me/library');

  const content = {
    courses: () => data.courses.length ? `
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        ${data.courses.map(course => `
          <div class="card overflow-hidden card-hover">
            <a href="#/learn/${course.id}" class="block p-4">
              <h3 class="font-bold font-display clamp-2 mb-1">${esc(course.title)}</h3>
              <p class="text-xs text-slate-500 mb-3">${esc(course.instructor_name)} • ${course.lessons_count} درس</p>
              <div class="progress"><div style="width:${course.progress_percent}%"></div></div>
              <p class="text-xs text-slate-500 mt-1.5">${Math.round(course.progress_percent)}٪ مكتمل</p>
            </a>
            <div class="px-4 pb-4 flex gap-2">
              <a href="#/learn/${course.id}" class="btn btn-primary btn-sm flex-1">
                ${course.progress_percent > 0 ? 'تابع' : 'ابدأ'}</a>
              ${course.progress_percent >= 100
                ? (course.has_certificate
                    ? '<a href="#/certificates" class="btn btn-ghost btn-sm">🎓 شهادتي</a>'
                    : `<button data-cert="${course.id}" class="btn btn-amber btn-sm">🎓 الشهادة</button>`) : ''}
            </div>
          </div>`).join('')}
      </div>`
      : emptyState('📚', 'لم تشترك في دورات بعد', '', '<a href="#/courses" class="btn btn-primary">تصفّح الدورات</a>'),

    summaries: () => data.summaries.length ? `
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        ${data.summaries.map(s => `
          <div class="card p-4 card-hover">
            <div class="text-3xl mb-2">📖</div>
            <h3 class="font-bold clamp-2">${esc(s.title)}</h3>
            <p class="text-xs text-slate-500 mt-1">${esc(s.book_author || '')} • ${s.reading_minutes} د</p>
            <div class="flex gap-2 mt-3">
              <a href="#/read/${s.id}" class="btn btn-primary btn-sm flex-1">اقرأ</a>
              ${s.has_audio ? '<span class="btn btn-ghost btn-sm">🎧</span>' : ''}
            </div>
          </div>`).join('')}
      </div>`
      : emptyState('📖', 'لا ملخّصات في مكتبتك', '', '<a href="#/summaries" class="btn btn-primary">تصفّح الملخّصات</a>'),

    live: () => data.liveSessions.length ? `
      <div class="space-y-3">
        ${data.liveSessions.map(s => {
          const upcoming = new Date(s.starts_at) > new Date();
          return `
            <div class="card p-4 flex items-center gap-4">
              <div class="text-3xl">${s.status === 'live' ? '🔴' : upcoming ? '📅' : '🗄'}</div>
              <div class="flex-1 min-w-0">
                <h3 class="font-bold truncate">${esc(s.title)}</h3>
                <p class="text-xs text-slate-500">${formatDate(s.starts_at, true)} • ${esc(s.instructor_name)}</p>
              </div>
              ${s.status === 'live' ? `<a href="#/live/${s.id}/room" class="btn btn-danger btn-sm">ادخل</a>`
                : upcoming ? `<a href="#/live/${s.id}" class="btn btn-ghost btn-sm">التفاصيل</a>`
                : s.recording_url ? `<a href="${esc(s.recording_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">▶️ التسجيل</a>`
                : '<span class="text-xs text-slate-400">انتهت</span>'}
            </div>`;
        }).join('')}
      </div>`
      : emptyState('🔴', 'لم تحجز حصصاً بعد', '', '<a href="#/live" class="btn btn-primary">الحصص المتاحة</a>'),
  };

  view.innerHTML = pageHeader('مكتبتي', 'كل ما اشتريته في مكان واحد',
    `<div class="flex gap-2 mt-5 bg-black/20 p-1.5 rounded-2xl w-fit flex-wrap">
       ${tabButton('courses', '🎬 الدورات', data.courses.length)}
       ${tabButton('summaries', '📖 الملخّصات', data.summaries.length)}
       ${tabButton('live', '🔴 الحصص', data.liveSessions.length)}
     </div>`) + section(content[tab]());

  view.querySelectorAll('[data-cert]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await api.post(`/certificates/${btn.dataset.cert}/issue`);
      toast('صدرت شهادتك 🎓', 'success');
      navigate('/certificates');
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  }));
}

/* ============================ الشهادات ============================ */
export async function certificates({ view }) {
  view.innerHTML = pageHeader('شهاداتي', 'شهادات إتمام قابلة للتحقّق العلني') + section(`<div id="box">${spinner()}</div>`);
  const data = await api.get('/certificates');

  document.getElementById('box').innerHTML = data.data.length ? `
    <div class="grid gap-6 md:grid-cols-2">
      ${data.data.map(cert => `
        <div class="card p-6 border-2 border-amber-300 bg-gradient-to-bl from-amber-50 to-white relative overflow-hidden">
          <div class="absolute top-2 left-2 text-6xl opacity-10">🎓</div>
          <p class="text-xs text-amber-700 font-bold mb-2">شهادة إتمام</p>
          <h3 class="text-lg font-extrabold font-display mb-1">${esc(cert.course_title)}</h3>
          <p class="text-sm text-slate-600">المعلّم: ${esc(cert.instructor_name)}</p>
          <p class="text-sm text-slate-500 mt-1">📅 ${formatDate(cert.issued_at)}</p>
          ${cert.grade != null ? `<p class="text-sm font-bold text-brand-700 mt-1">الدرجة: ${Math.round(cert.grade)}٪</p>` : ''}
          <p class="font-mono text-xs bg-white rounded-lg px-2 py-1.5 mt-3 border">${esc(cert.serial)}</p>
          <div class="flex gap-2 mt-4">
            <a href="#/verify-certificate?serial=${esc(cert.serial)}" class="btn btn-ghost btn-sm flex-1">🔍 صفحة التحقّق</a>
            <button data-copy="${esc(cert.serial)}" class="btn btn-ghost btn-sm">📋 نسخ الرقم</button>
          </div>
        </div>`).join('')}
    </div>`
    : emptyState('🎓', 'لا شهادات بعد', 'أكمل دورة واجتز اختباراتها للحصول على شهادة موثّقة.',
        '<a href="#/my-learning" class="btn btn-primary">مكتبتي</a>');

  view.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(btn.dataset.copy);
    toast('نُسخ رقم الشهادة', 'success');
  }));
}

/* ============================ الإشعارات ============================ */
export async function notifications({ view }) {
  view.innerHTML = pageHeader('الإشعارات') + section(`<div id="box">${spinner()}</div>`);
  const box = document.getElementById('box');

  const render = async () => {
    const data = await api.get('/me/notifications');
    setState({ unread: data.unread });

    box.innerHTML = data.data.length ? `
      ${data.unread > 0 ? '<button id="readAll" class="btn btn-ghost btn-sm mb-4">✓ تعليم الكل كمقروء</button>' : ''}
      <div class="space-y-2">
        ${data.data.map(n => `
          <div class="card p-4 flex gap-3 ${n.read_at ? '' : 'border-r-4 border-r-brand-500 bg-brand-50/30'}">
            <div class="text-2xl shrink-0">${{
              welcome: '👋', order: '🧾', sale: '💰', question: '❓', answer: '💬', certificate: '🎓',
              live_started: '🔴', live_scheduled: '📅', live_cancelled: '🚫', payout: '🏦',
              referral: '🎁', course: '🎬', summary: '📖', subscription: '⭐', refund: '💸',
            }[n.type] || '🔔'}</div>
            <div class="flex-1 min-w-0">
              <p class="font-bold text-sm">${esc(n.title)}</p>
              ${n.body ? `<p class="text-sm text-slate-600 mt-0.5">${esc(n.body)}</p>` : ''}
              <p class="text-xs text-slate-400 mt-1">${fromNow(n.created_at)}</p>
            </div>
            ${n.link ? `<a href="${esc(n.link)}" class="btn btn-ghost btn-sm shrink-0">عرض</a>` : ''}
          </div>`).join('')}
      </div>`
      : emptyState('🔔', 'لا إشعارات', 'ستصلك هنا تحديثات دوراتك وحصصك وطلباتك.');

    document.getElementById('readAll')?.addEventListener('click', async () => {
      await api.post('/me/notifications/read', {});
      render();
    });
  };
  await render();
}

/* ============================ المفضّلة ============================ */
export async function wishlist({ view }) {
  view.innerHTML = pageHeader('المفضّلة') + section(`<div id="box">${spinner()}</div>`);
  const box = document.getElementById('box');

  const render = async () => {
    const data = await api.get('/wishlist');
    box.innerHTML = data.data.length ? `
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        ${data.data.map(row => `
          <div class="card p-4">
            <span class="badge bg-slate-100 text-slate-600 mb-2">${
              { course: '🎬 دورة', summary: '📖 ملخّص', live_session: '🔴 حصة' }[row.item_type] || ''}</span>
            <h3 class="font-bold clamp-2">${esc(row.item.title)}</h3>
            <p class="font-extrabold mt-2">${row.item.price === 0 ? 'مجاناً' : money(row.item.price)}</p>
            <div class="flex gap-2 mt-3">
              <a href="#/${row.item_type === 'course' ? 'courses' : row.item_type === 'summary' ? 'summaries' : 'live'}/${esc(row.item.slug || row.item.id)}"
                 class="btn btn-primary btn-sm flex-1">عرض</a>
              <button data-remove="${row.item_type}/${row.item_id}" class="btn btn-ghost btn-sm">🗑</button>
            </div>
          </div>`).join('')}
      </div>`
      : emptyState('❤️', 'قائمتك فارغة', 'أضف ما يعجبك لتعود إليه لاحقاً.',
          '<a href="#/courses" class="btn btn-primary">تصفّح</a>');

    box.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', async () => {
      await api.delete(`/wishlist/${btn.dataset.remove}`);
      render();
    }));
  };
  await render();
}

/* ============================ ملاحظاتي ============================ */
export async function notes({ view }) {
  view.innerHTML = pageHeader('ملاحظاتي', 'كل ما دوّنته أثناء التعلّم') + section(`<div id="box">${spinner()}</div>`);
  const data = await api.get('/me/notes');

  document.getElementById('box').innerHTML = data.data.length ? `
    <div class="space-y-3 max-w-3xl">
      ${data.data.map(note => `
        <div class="card p-4">
          <p class="text-slate-800 leading-relaxed">${esc(note.body)}</p>
          <div class="flex items-center gap-2 mt-2 text-xs text-slate-400">
            ${note.lesson_title ? `<a href="#/learn/${note.course_id}/${note.lesson_id}" class="text-brand-700 hover:underline">📚 ${esc(note.lesson_title)}</a>` : ''}
            ${note.summary_title ? `<a href="#/read/${note.summary_id}" class="text-brand-700 hover:underline">📖 ${esc(note.summary_title)}</a>` : ''}
            <span>• ${fromNow(note.created_at)}</span>
          </div>
        </div>`).join('')}
    </div>`
    : emptyState('📝', 'لا ملاحظات بعد', 'دوّن ملاحظاتك أثناء مشاهدة الدروس أو قراءة الملخّصات.');
}

/* ============================ الحساب ============================ */
export async function profile({ view }) {
  const user = state.user;
  view.innerHTML = pageHeader('إعدادات الحساب') + section(`
    <div class="grid lg:grid-cols-3 gap-6 max-w-5xl">
      <div class="lg:col-span-2 space-y-6">
        <div class="card p-6">
          <h2 class="font-bold font-display mb-4">البيانات الشخصية</h2>
          <form id="profileForm" class="space-y-4">
            <div><label class="label">الاسم</label><input name="name" value="${esc(user.name)}" required class="field" /></div>
            <div><label class="label">البريد الإلكتروني</label>
              <input value="${esc(user.email)}" disabled class="field bg-slate-50 text-slate-500" />
              <p class="help">لتغيير البريد تواصل مع الدعم</p></div>
            <div><label class="label">رقم الجوال</label><input name="phone" value="${esc(user.phone || '')}" class="field" /></div>
            <div><label class="label">الدولة</label><input name="country" value="${esc(user.country || '')}" class="field" /></div>
            <div><label class="label">نبذة عنك</label><textarea name="bio" rows="3" class="field">${esc(user.bio || '')}</textarea></div>
            <div><label class="label">رابط الصورة الشخصية</label><input name="avatar" value="${esc(user.avatar || '')}" class="field" placeholder="https://..." /></div>
            <button class="btn btn-primary">حفظ التغييرات</button>
          </form>
        </div>

        <div class="card p-6">
          <h2 class="font-bold font-display mb-4">تغيير كلمة المرور</h2>
          <form id="passwordForm" class="space-y-4">
            <div><label class="label">كلمة المرور الحالية</label><input name="currentPassword" type="password" required class="field" /></div>
            <div><label class="label">كلمة المرور الجديدة</label><input name="newPassword" type="password" minlength="8" required class="field" /></div>
            <button class="btn btn-primary">تحديث كلمة المرور</button>
          </form>
        </div>
      </div>

      <div class="space-y-4">
        <div class="card p-5 text-center">
          ${avatar(user.avatar, user.name, 20)}
          <h3 class="font-bold mt-3">${esc(user.name)}</h3>
          <p class="text-sm text-slate-500">${{ student: 'طالب', instructor: 'معلّم', admin: 'مدير' }[user.role]}</p>
          <p class="text-xs text-slate-400 mt-1">عضو منذ ${formatDate(user.created_at)}</p>
        </div>
        <a href="#/referral" class="card p-5 block card-hover">
          <p class="font-bold">🎁 ادعُ صديقاً واربح</p>
          <p class="text-sm text-slate-500 mt-1">احصل على رصيد عند أول شراء لمن تدعوه.</p>
        </a>
        <a href="#/wallet" class="card p-5 block card-hover">
          <p class="font-bold">💰 محفظتي</p>
          <p class="text-sm text-slate-500 mt-1">رصيدك: ${money(user.wallet_balance)}</p>
        </a>
      </div>
    </div>`);

  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.patch('/auth/me', Object.fromEntries(new FormData(e.target)));
      await refreshUser();
      toast('حُفظت بياناتك ✅', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(e.target));
      const result = await api.post('/auth/change-password', values);
      const { tokens } = await import('../api.js');
      tokens.set(result);
      e.target.reset();
      toast('تم تحديث كلمة المرور 🔐', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ============================ الإحالة ============================ */
export async function referral({ view }) {
  view.innerHTML = spinner();
  const data = await api.get('/auth/referral');

  view.innerHTML = pageHeader('ادعُ أصدقاءك', `اربح ${money(data.bonus)} عن كل صديق يشترك ويشتري`) + section(`
    <div class="max-w-2xl mx-auto space-y-6">
      <div class="card p-6 text-center">
        <p class="text-sm text-slate-500 mb-2">رمز الدعوة الخاص بك</p>
        <p class="text-3xl font-extrabold font-mono tracking-widest text-brand-700 mb-4">${esc(data.code)}</p>
        <div class="flex gap-2">
          <input id="refLink" value="${esc(data.link)}" readonly class="field text-sm flex-1 bg-slate-50" />
          <button id="copyLink" class="btn btn-primary">📋 نسخ</button>
        </div>
      </div>

      <div class="card p-6">
        <h2 class="font-bold font-display mb-3">من دعوتَهم (${data.invited.length})</h2>
        ${data.invited.length ? `<div class="space-y-2">
          ${data.invited.map(u => `<div class="flex justify-between py-2 border-b last:border-0 text-sm">
            <span class="font-semibold">${esc(u.name)}</span>
            <span class="text-slate-400">${fromNow(u.created_at)}</span></div>`).join('')}
        </div>` : '<p class="text-slate-500 text-sm">لم تدعُ أحداً بعد.</p>'}
        <p class="mt-4 pt-4 border-t font-bold text-brand-700">إجمالي أرباح الإحالة: ${money(data.earned)}</p>
      </div>
    </div>`);

  document.getElementById('copyLink').addEventListener('click', async () => {
    await navigator.clipboard.writeText(data.link);
    toast('نُسخ رابط الدعوة 🔗', 'success');
  });
}
